import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAssetPurpose, MediaAssetStatus } from '@prisma/client';
import { Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseStoreService } from './warehouse-store.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TEMPORARY_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const EXPIRED_UPLOAD_CLEANUP_BATCH = 25;

export interface WarehouseMediaUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class MediaService {
  private readonly storage = new Storage();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stores: WarehouseStoreService,
  ) {}

  async upload(
    userId: string,
    purpose: MediaAssetPurpose,
    file?: WarehouseMediaUploadFile,
  ) {
    if (!file) throw new BadRequestException('Image file is required');
    validateImage(file);
    const store = await this.stores.requireStore(userId);
    // Cloud Run may have multiple short-lived instances, so cleanup cannot rely
    // on an in-process timer. Every upload performs a bounded, best-effort sweep.
    await this.cleanupExpired(store.id).catch(() => undefined);
    const bucket = this.bucket();
    const extension = extensionFor(file.mimetype);
    const assetId = randomUUID();
    const objectName = `stores/${store.id}/media/${assetId}.${extension}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    try {
      await bucket.file(objectName).save(file.buffer, {
        resumable: false,
        validation: 'crc32c',
        metadata: {
          contentType: file.mimetype,
          cacheControl: 'private, max-age=3600',
          metadata: { sha256: checksum, storeId: store.id },
        },
      });
    } catch {
      throw new ServiceUnavailableException('Unable to store product image');
    }

    try {
      const asset = await this.prisma.mediaAsset.create({
        data: {
          id: assetId,
          storeId: store.id,
          objectName,
          originalName: safeFileName(file.originalname),
          contentType: file.mimetype,
          sizeBytes: file.buffer.length,
          checksum,
          purpose,
          expiresAt: new Date(Date.now() + TEMPORARY_UPLOAD_TTL_MS),
        },
      });
      return this.toResponse(asset);
    } catch (error) {
      await bucket
        .file(objectName)
        .delete({ ignoreNotFound: true })
        .catch(() => undefined);
      throw error;
    }
  }

  async stream(userId: string, assetId: string, response: Response) {
    const store = await this.stores.requireStore(userId);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, storeId: store.id },
    });
    if (!asset) throw new NotFoundException('Image not found');

    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Content-Length', String(asset.sizeBytes));
    response.setHeader('Cache-Control', 'private, max-age=3600');
    const stream = this.bucket().file(asset.objectName).createReadStream();
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(response);
    }).catch(() => {
      if (!response.headersSent) {
        throw new ServiceUnavailableException('Unable to read product image');
      }
      response.end();
    });
  }

  async streamPrivateObject(objectName: string, response: Response) {
    const file = this.bucket().file(objectName);
    try {
      const [metadata] = await file.getMetadata();
      response.setHeader(
        'Content-Type',
        metadata.contentType || 'application/octet-stream',
      );
      if (metadata.size) {
        response.setHeader('Content-Length', String(metadata.size));
      }
      response.setHeader('Cache-Control', 'private, max-age=3600');
      const stream = file.createReadStream();
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject);
        stream.on('end', resolve);
        stream.pipe(response);
      });
    } catch {
      if (!response.headersSent) {
        throw new ServiceUnavailableException('Unable to read packaging image');
      }
      response.end();
    }
  }

  async removeTemporary(userId: string, assetId: string) {
    const store = await this.stores.requireStore(userId);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, storeId: store.id },
    });
    if (!asset) return { deleted: false };
    if (asset.status !== MediaAssetStatus.TEMPORARY) {
      throw new BadRequestException(
        'Attached product images cannot be deleted directly',
      );
    }
    try {
      await this.bucket()
        .file(asset.objectName)
        .delete({ ignoreNotFound: true });
    } catch {
      throw new ServiceUnavailableException('Unable to delete product image');
    }
    await this.prisma.mediaAsset.delete({ where: { id: asset.id } });
    return { deleted: true };
  }

  async cleanupExpired(
    storeId: string,
    limit = EXPIRED_UPLOAD_CLEANUP_BATCH,
  ): Promise<number> {
    const expired = await this.prisma.mediaAsset.findMany({
      where: {
        storeId,
        status: MediaAssetStatus.TEMPORARY,
        expiresAt: { lte: new Date() },
      },
      select: { id: true, objectName: true },
      orderBy: { expiresAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    let deleted = 0;
    for (const asset of expired) {
      const result = await this.prisma.mediaAsset.deleteMany({
        where: {
          id: asset.id,
          storeId,
          status: MediaAssetStatus.TEMPORARY,
          expiresAt: { lte: new Date() },
        },
      });
      if (result.count === 0) continue;
      await this.bucket()
        .file(asset.objectName)
        .delete({ ignoreNotFound: true });
      deleted += result.count;
    }
    return deleted;
  }

  toResponse(asset: {
    id: string;
    contentType: string;
    sizeBytes: number;
    expiresAt: Date | null;
  }) {
    return {
      id: asset.id,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      previewPath: `/warehouse/media/${asset.id}/content`,
      expiresAt: asset.expiresAt?.toISOString() ?? null,
    };
  }

  private bucket() {
    const name = this.config.get<string>('PRODUCT_IMAGE_BUCKET')?.trim();
    if (!name) {
      throw new ServiceUnavailableException(
        'Product image storage is not configured',
      );
    }
    return this.storage.bucket(name);
  }
}

export function validateImage(file: WarehouseMediaUploadFile) {
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    throw new BadRequestException('Image must be no larger than 5 MB');
  }
  const signatures: Record<string, (buffer: Buffer) => boolean> = {
    'image/jpeg': (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
    'image/png': (buffer) =>
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/webp': (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  };
  if (!signatures[file.mimetype]?.(file.buffer)) {
    throw new BadRequestException(
      'Image must be a valid JPEG, PNG, or WebP file',
    );
  }
}

function extensionFor(contentType: string) {
  return contentType === 'image/jpeg'
    ? 'jpg'
    : contentType === 'image/png'
      ? 'png'
      : 'webp';
}

function safeFileName(value: string) {
  const leaf = value.replace(/\\/g, '/').split('/').pop() || 'image';
  return leaf.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'image';
}
