import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class ShopifyTokenEncryptionService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(value: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    return [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(value: string, context: string): string {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !encrypted) {
      throw new ServiceUnavailableException(
        'Stored Shopify credentials are invalid',
      );
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.getKey(),
        Buffer.from(iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException(
        'Unable to decrypt Shopify credentials',
      );
    }
  }

  assertConfigured(): void {
    this.getKey();
  }

  private getKey(): Buffer {
    const configured = this.configService.get<string>(
      'SHOPIFY_TOKEN_ENCRYPTION_KEY',
    );
    const key = configured
      ? Buffer.from(configured, 'base64')
      : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new ServiceUnavailableException(
        'SHOPIFY_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
    return key;
  }
}
