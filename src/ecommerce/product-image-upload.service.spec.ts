import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { EcommercePlatform } from '@prisma/client';
import type { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import type { YouCanConnectionService } from '../youcan/youcan-connection.service';
import {
  ProductImageUploadService,
  type ProductImageUploadFile,
} from './product-image-upload.service';

describe('ProductImageUploadService', () => {
  const shopifyGraphql = jest.fn();
  const youCanPostImages = jest.fn();
  const service = new ProductImageUploadService(
    {
      graphqlForUser: shopifyGraphql,
    } as unknown as ShopifyConnectionService,
    {
      postImagesForUser: youCanPostImages,
    } as unknown as YouCanConnectionService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads bytes to a Shopify staged target and returns its resource URL', async () => {
    shopifyGraphql.mockResolvedValue({
      stagedUploadsCreate: {
        stagedTargets: [
          {
            url: 'https://shopify-staged-uploads.storage.googleapis.com/',
            resourceUrl:
              'https://shopify-staged-uploads.storage.googleapis.com/staged/image.jpg',
            parameters: [
              { name: 'key', value: 'staged/image.jpg' },
              { name: 'policy', value: 'signed-policy' },
            ],
          },
        ],
        userErrors: [],
      },
    });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      service.upload('user-id', EcommercePlatform.SHOPIFY, [jpegFile()]),
    ).resolves.toEqual({
      platform: EcommercePlatform.SHOPIFY,
      images: [
        {
          url: 'https://shopify-staged-uploads.storage.googleapis.com/staged/image.jpg',
          position: 0,
        },
      ],
    });

    expect(shopifyGraphql).toHaveBeenCalledWith(
      'user-id',
      expect.stringContaining('stagedUploadsCreate'),
      {
        input: [
          {
            filename: 'phone_image.jpg',
            mimeType: 'image/jpeg',
            httpMethod: 'POST',
            resource: 'PRODUCT_IMAGE',
          },
        ],
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [targetUrl, request] = fetchMock.mock.calls[0];
    expect(targetUrl).toEqual(
      new URL('https://shopify-staged-uploads.storage.googleapis.com/'),
    );
    expect(request?.method).toBe('POST');
    expect(request?.body).toBeInstanceOf(FormData);
  });

  it('uploads bytes into YouCan media and returns the YouCan CDN URL', async () => {
    youCanPostImages.mockResolvedValue([
      {
        name: 'stores/store/products/image.jpeg',
        link: 'https://cdn.youcan.shop/stores/store/products/image.jpeg',
      },
    ]);

    await expect(
      service.upload('user-id', EcommercePlatform.YOUCAN, [jpegFile()]),
    ).resolves.toEqual({
      platform: EcommercePlatform.YOUCAN,
      images: [
        {
          url: 'https://cdn.youcan.shop/stores/store/products/image.jpeg',
          position: 0,
        },
      ],
    });
    expect(youCanPostImages).toHaveBeenCalledWith(
      'user-id',
      '/media/product/upload-image',
      [expect.objectContaining({ originalname: 'phone image.jpg' })],
    );
  });

  it('rejects spoofed image content before contacting a provider', async () => {
    const spoofed = {
      ...jpegFile(),
      buffer: Buffer.from('not an image'),
      size: 12,
    };

    await expect(
      service.upload('user-id', EcommercePlatform.SHOPIFY, [spoofed]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(shopifyGraphql).not.toHaveBeenCalled();
  });

  it('fails explicitly instead of pretending Lightfunnels supports binary upload', async () => {
    await expect(
      service.upload('user-id', EcommercePlatform.LIGHTFUNNELS, [jpegFile()]),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });
});

function jpegFile(): ProductImageUploadFile {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);
  return {
    buffer,
    originalname: 'phone image.jpg',
    mimetype: 'image/jpeg',
    size: buffer.length,
  };
}
