import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EcommercePlatform } from '@prisma/client';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import { YouCanConnectionService } from '../youcan/youcan-connection.service';
import type { UploadProductImagesResponseDto } from './dto/product.dto';

const SHOPIFY_STAGED_UPLOADS_CREATE = `#graphql
  mutation ZomaalCreateProductImageUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ProductImageUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface ShopifyStagedUploadsResponse {
  stagedUploadsCreate: {
    stagedTargets: Array<{
      url: string;
      resourceUrl: string;
      parameters: Array<{ name: string; value: string }>;
    }>;
    userErrors: Array<{
      field: string[] | null;
      message: string;
    }>;
  };
}

interface YouCanUploadedImage {
  name?: unknown;
  link?: unknown;
}

@Injectable()
export class ProductImageUploadService {
  constructor(
    private readonly shopifyConnection: ShopifyConnectionService,
    private readonly youCanConnection: YouCanConnectionService,
  ) {}

  async upload(
    userId: string,
    platform: EcommercePlatform,
    files: ProductImageUploadFile[],
  ): Promise<UploadProductImagesResponseDto> {
    this.validateFiles(files);

    switch (platform) {
      case EcommercePlatform.SHOPIFY:
        return this.uploadToShopify(userId, files);
      case EcommercePlatform.YOUCAN:
        return this.uploadToYouCan(userId, files);
      case EcommercePlatform.LIGHTFUNNELS:
        throw new NotImplementedException(
          'Lightfunnels does not document a direct binary product-image upload API. Use Shopify or YouCan for phone uploads until a verified Lightfunnels media-import contract is available.',
        );
      default:
        throw new BadRequestException('Unsupported e-commerce platform');
    }
  }

  private async uploadToShopify(
    userId: string,
    files: ProductImageUploadFile[],
  ): Promise<UploadProductImagesResponseDto> {
    const response =
      await this.shopifyConnection.graphqlForUser<ShopifyStagedUploadsResponse>(
        userId,
        SHOPIFY_STAGED_UPLOADS_CREATE,
        {
          input: files.map((file) => ({
            filename: safeFileName(file.originalname),
            mimeType: file.mimetype,
            httpMethod: 'POST',
            resource: 'PRODUCT_IMAGE',
          })),
        },
      );
    const result = response.stagedUploadsCreate;
    if (result.userErrors.length > 0) {
      throw new BadGatewayException(
        `Shopify rejected the image upload: ${result.userErrors
          .map((error) => error.message)
          .join(', ')}`,
      );
    }
    if (result.stagedTargets.length !== files.length) {
      throw new BadGatewayException(
        'Shopify did not create every requested image upload target',
      );
    }

    await Promise.all(
      result.stagedTargets.map((target, index) =>
        this.sendShopifyStagedUpload(target, files[index]),
      ),
    );

    return {
      platform: EcommercePlatform.SHOPIFY,
      images: result.stagedTargets.map((target, position) => ({
        url: target.resourceUrl,
        position,
      })),
    };
  }

  private async sendShopifyStagedUpload(
    target: ShopifyStagedUploadsResponse['stagedUploadsCreate']['stagedTargets'][number],
    file: ProductImageUploadFile,
  ): Promise<void> {
    let targetUrl: URL;
    try {
      targetUrl = new URL(target.url);
    } catch {
      throw new BadGatewayException(
        'Shopify returned an invalid image upload target',
      );
    }
    if (targetUrl.protocol !== 'https:') {
      throw new BadGatewayException(
        'Shopify returned an insecure image upload target',
      );
    }

    const body = new FormData();
    for (const parameter of target.parameters) {
      body.append(parameter.name, parameter.value);
    }
    body.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      safeFileName(file.originalname),
    );

    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Unable to upload the image to Shopify',
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `Shopify image storage rejected the upload with HTTP ${response.status}`,
      );
    }
  }

  private async uploadToYouCan(
    userId: string,
    files: ProductImageUploadFile[],
  ): Promise<UploadProductImagesResponseDto> {
    const response = await this.youCanConnection.postImagesForUser<
      YouCanUploadedImage[]
    >(userId, '/media/product/upload-image', files);
    if (!Array.isArray(response) || response.length !== files.length) {
      throw new BadGatewayException(
        'YouCan did not return every uploaded image',
      );
    }

    return {
      platform: EcommercePlatform.YOUCAN,
      images: response.map((image, position) => {
        const url = nonEmptyString(image.link);
        const providerFileName = nonEmptyString(image.name);
        if (!url || !providerFileName || !isHttpUrl(url)) {
          throw new BadGatewayException(
            'YouCan returned an invalid image upload response',
          );
        }
        return {
          url,
          position,
        };
      }),
    };
  }

  private validateFiles(files: ProductImageUploadFile[]): void {
    if (!files?.length) {
      throw new BadRequestException(
        'At least one image is required in the images form field',
      );
    }
    for (const file of files) {
      if (!file.buffer?.length || file.size < 1) {
        throw new BadRequestException('Uploaded images cannot be empty');
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw new BadRequestException(
          `${safeFileName(file.originalname)} exceeds the 5 MB image limit`,
        );
      }
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        throw new BadRequestException(
          `${safeFileName(file.originalname)} must be JPEG, PNG, or WebP`,
        );
      }
      if (!hasExpectedSignature(file.buffer, file.mimetype)) {
        throw new BadRequestException(
          `${safeFileName(file.originalname)} content does not match its image type`,
        );
      }
    }
  }
}

function safeFileName(value: string): string {
  const leaf = value.replace(/\\/g, '/').split('/').pop() || 'image';
  const sanitized = leaf.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return sanitized || 'image';
}

function hasExpectedSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
