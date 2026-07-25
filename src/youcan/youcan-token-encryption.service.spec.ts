import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { YouCanTokenEncryptionService } from './youcan-token-encryption.service';

describe('YouCanTokenEncryptionService', () => {
  const key = randomBytes(32).toString('base64');
  const configService = {
    get: jest.fn((name: string) =>
      name === 'YOUCAN_TOKEN_ENCRYPTION_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService;
  const service = new YouCanTokenEncryptionService(configService);

  it('encrypts tokens with authenticated store-specific context', () => {
    const encrypted = service.encrypt(
      'secret-token',
      'youcan:store-id:access-token',
    );

    expect(encrypted).not.toContain('secret-token');
    expect(service.decrypt(encrypted, 'youcan:store-id:access-token')).toBe(
      'secret-token',
    );
  });

  it('rejects a token under a different store or token type', () => {
    const encrypted = service.encrypt(
      'secret-token',
      'youcan:first-store:access-token',
    );

    expect(() =>
      service.decrypt(encrypted, 'youcan:second-store:access-token'),
    ).toThrow(ServiceUnavailableException);
  });
});
