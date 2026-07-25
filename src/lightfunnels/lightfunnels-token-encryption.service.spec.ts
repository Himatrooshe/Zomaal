import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { lightfunnelsAccessTokenContext } from './lightfunnels-token-context';
import { LightfunnelsTokenEncryptionService } from './lightfunnels-token-encryption.service';

describe('LightfunnelsTokenEncryptionService', () => {
  const key = randomBytes(32).toString('base64');
  const configService = {
    get: jest.fn((name: string) =>
      name === 'LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService;
  const service = new LightfunnelsTokenEncryptionService(configService);

  it('encrypts tokens with authenticated account-specific context', () => {
    const encrypted = service.encrypt(
      'secret-token',
      lightfunnelsAccessTokenContext('account-id'),
    );

    expect(encrypted).not.toContain('secret-token');
    expect(
      service.decrypt(encrypted, lightfunnelsAccessTokenContext('account-id')),
    ).toBe('secret-token');
  });

  it('rejects a token under a different account context', () => {
    const encrypted = service.encrypt(
      'secret-token',
      lightfunnelsAccessTokenContext('first-account'),
    );

    expect(() =>
      service.decrypt(
        encrypted,
        lightfunnelsAccessTokenContext('second-account'),
      ),
    ).toThrow(ServiceUnavailableException);
  });
});
