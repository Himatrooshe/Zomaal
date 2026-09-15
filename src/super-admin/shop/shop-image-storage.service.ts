import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Response } from 'express';

export type ShopImageStorageDriver = 'gcs' | 'local';

// Where Zomaal Shop product images live.
//
//  - gcs:   the PRODUCT_IMAGE_BUCKET bucket. Production default — Cloud Run
//           instances are short-lived, so their disk can't hold uploads.
//  - local: files under SHOP_IMAGE_LOCAL_DIR (default ./storage/shop-images).
//           Default everywhere except production, so image upload works on a
//           developer machine without cloud credentials or billing.
//
// SHOP_IMAGE_STORAGE overrides the default; env validation refuses `local`
// in production.
@Injectable()
export class ShopImageStorageService {
  private readonly logger = new Logger(ShopImageStorageService.name);
  readonly driver: ShopImageStorageDriver;
  private readonly localRoot: string;
  private storage?: Storage;

  constructor(private readonly config: ConfigService) {
    const explicit = this.config.get<string>('SHOP_IMAGE_STORAGE')?.trim();
    const production = this.config.get<string>('NODE_ENV') === 'production';
    this.driver =
      explicit === 'gcs' || explicit === 'local'
        ? explicit
        : production
          ? 'gcs'
          : 'local';
    this.localRoot = resolve(
      this.config.get<string>('SHOP_IMAGE_LOCAL_DIR')?.trim() ||
        'storage/shop-images',
    );
    this.logger.log(
      this.driver === 'local'
        ? `Shop images stored on local disk at ${this.localRoot}`
        : 'Shop images stored in the PRODUCT_IMAGE_BUCKET bucket',
    );
  }

  async save(objectName: string, buffer: Buffer, contentType: string) {
    if (this.driver === 'local') {
      const path = this.localPath(objectName);
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, buffer);
      } catch (error) {
        this.logger.error(`Local image write failed: ${String(error)}`);
        throw new ServiceUnavailableException('Unable to store product image');
      }
      return;
    }

    try {
      await this.bucket()
        .file(objectName)
        .save(buffer, {
          resumable: false,
          validation: 'crc32c',
          metadata: { contentType, cacheControl: 'public, max-age=86400' },
        });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`GCS image write failed: ${String(error)}`);
      throw new ServiceUnavailableException(
        'Unable to store product image — cloud storage rejected the upload',
      );
    }
  }

  async stream(objectName: string, contentType: string, response: Response) {
    if (this.driver === 'local') {
      const path = this.localPath(objectName);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw new NotFoundException('Image not found');
      response.setHeader('Content-Type', contentType);
      response.setHeader('Content-Length', String(info.size));
      response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      await pipeToResponse(createReadStream(path), response);
      return;
    }

    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    await pipeToResponse(
      this.bucket().file(objectName).createReadStream(),
      response,
    );
  }

  // Best-effort: an orphaned file is harmless (nothing references it), so a
  // cleanup failure must never fail the admin action that triggered it.
  async remove(objectName: string) {
    try {
      if (this.driver === 'local') {
        await rm(this.localPath(objectName), { force: true });
      } else {
        await this.bucket().file(objectName).delete({ ignoreNotFound: true });
      }
    } catch (error) {
      this.logger.warn(
        `Could not delete image ${objectName}: ${String(error)}`,
      );
    }
  }

  // objectName is always generated server-side, but resolve-and-check anyway
  // so no value can ever escape the storage root.
  private localPath(objectName: string) {
    const path = resolve(this.localRoot, objectName);
    if (!path.startsWith(this.localRoot + sep)) {
      throw new NotFoundException('Image not found');
    }
    return path;
  }

  private bucket() {
    const name = this.config.get<string>('PRODUCT_IMAGE_BUCKET')?.trim();
    if (!name) {
      throw new ServiceUnavailableException(
        'Product image storage is not configured (PRODUCT_IMAGE_BUCKET)',
      );
    }
    this.storage ??= new Storage();
    return this.storage.bucket(name);
  }
}

function pipeToResponse(
  stream: NodeJS.ReadableStream,
  response: Response,
): Promise<void> {
  return new Promise<void>((resolvePipe, reject) => {
    stream.on('error', reject);
    stream.on('end', resolvePipe);
    stream.pipe(response);
  }).catch(() => {
    if (!response.headersSent) {
      throw new ServiceUnavailableException('Unable to load product image');
    }
    response.end();
  });
}
