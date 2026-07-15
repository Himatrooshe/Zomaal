import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectOzoneExpressDto } from './dto/ozoneexpress-connection.dto';
import {
  OzoneExpressClient,
  type OzoneExpressCredentials,
} from './ozoneexpress.client';

@Injectable()
export class OzoneExpressConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly ozoneExpressClient: OzoneExpressClient,
  ) {}

  async connect(userId: string, payload: ConnectOzoneExpressDto) {
    const credentials: OzoneExpressCredentials = {
      customerId: payload.customerId.trim(),
      apiKey: payload.apiKey.trim(),
    };

    await this.ozoneExpressClient.checkConnection(credentials);

    const connection = await this.prisma.ozoneExpressConnection.upsert({
      where: { userId },
      create: {
        userId,
        encryptedCustomerId: this.encrypt(credentials.customerId),
        encryptedApiKey: this.encrypt(credentials.apiKey),
      },
      update: {
        encryptedCustomerId: this.encrypt(credentials.customerId),
        encryptedApiKey: this.encrypt(credentials.apiKey),
        connectedAt: new Date(),
      },
    });

    return this.toStatus(connection.connectedAt);
  }

  async getStatus(userId: string) {
    const connection = await this.prisma.ozoneExpressConnection.findUnique({
      where: { userId },
      select: { connectedAt: true },
    });

    if (!connection) {
      return {
        connected: false,
        provider: 'ozoneexpress.ma' as const,
        connectedAt: null,
        message: 'OzoneExpress account is not connected',
      };
    }

    return this.toStatus(connection.connectedAt);
  }

  async disconnect(userId: string) {
    await this.prisma.ozoneExpressConnection.deleteMany({ where: { userId } });

    return {
      connected: false,
      provider: 'ozoneexpress.ma' as const,
      connectedAt: null,
      message: 'OzoneExpress account disconnected',
    };
  }

  async getCredentials(userId: string): Promise<OzoneExpressCredentials> {
    const connection = await this.prisma.ozoneExpressConnection.findUnique({
      where: { userId },
      select: { encryptedCustomerId: true, encryptedApiKey: true },
    });

    if (!connection) {
      throw new ConflictException(
        'Connect your OzoneExpress account before using this feature',
      );
    }

    return {
      customerId: this.decrypt(connection.encryptedCustomerId),
      apiKey: this.decrypt(connection.encryptedApiKey),
    };
  }

  private toStatus(connectedAt: Date) {
    return {
      connected: true,
      provider: 'ozoneexpress.ma' as const,
      connectedAt: connectedAt.toISOString(),
      message: 'OzoneExpress account is connected',
    };
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
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

  private decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !encrypted) {
      throw new ServiceUnavailableException(
        'Stored OzoneExpress credentials are invalid',
      );
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.getEncryptionKey(),
        Buffer.from(iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException(
        'Unable to decrypt OzoneExpress credentials',
      );
    }
  }

  private getEncryptionKey(): Buffer {
    const configured = this.configService.get<string>(
      'SHIPPING_CREDENTIAL_ENCRYPTION_KEY',
    );
    const key = configured
      ? Buffer.from(configured, 'base64')
      : Buffer.alloc(0);

    if (key.length !== 32) {
      throw new ServiceUnavailableException(
        'SHIPPING_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }

    return key;
  }
}
