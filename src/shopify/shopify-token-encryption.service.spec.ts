import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { ShopifyTokenEncryptionService } from './shopify-token-encryption.service';

describe('ShopifyTokenEncryptionService', () => {
  const key = randomBytes(32).toString('base64');
  const configService = {
    get: jest.fn((name: string) =>
      name === 'SHOPIFY_TOKEN_ENCRYPTION_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService;
  const service = new ShopifyTokenEncryptionService(configService);

  it('encrypts and decrypts a token using authenticated context', () => {
    const encrypted = service.encrypt(
      'shpat_secret',
      'shopify:test.myshopify.com:access-token',
    );

    expect(encrypted).not.toContain('shpat_secret');
    expect(
      service.decrypt(encrypted, 'shopify:test.myshopify.com:access-token'),
    ).toBe('shpat_secret');
  });

  it('rejects a token under a different shop or token type', () => {
    const encrypted = service.encrypt(
      'shpat_secret',
      'shopify:first.myshopify.com:access-token',
    );

    expect(() =>
      service.decrypt(encrypted, 'shopify:second.myshopify.com:access-token'),
    ).toThrow(ServiceUnavailableException);
  });
});
