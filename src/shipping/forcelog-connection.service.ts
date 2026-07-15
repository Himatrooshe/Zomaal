import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectForceLogDto } from './dto/forcelog-connection.dto';
import { ForceLogClient } from './forcelog.client';

@Injectable()
export class ForceLogConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly forceLogClient: ForceLogClient,
  ) {}

  async connect(userId: string, payload: ConnectForceLogDto) {
    const apiKey = payload.apiKey.trim();

    await this.forceLogClient.checkConnection(apiKey);

    const connection = await this.prisma.forceLogConnection.upsert({
      where: { userId },
      create: {
        userId,
        encryptedApiKey: this.encrypt(apiKey),
      },
      update: {
        encryptedApiKey: this.encrypt(apiKey),
        connectedAt: new Date(),
      },
    });

    return this.toStatus(connection.connectedAt);
  }

  async getStatus(userId: string) {
    const connection = await this.prisma.forceLogConnection.findUnique({
      where: { userId },
      select: { connectedAt: true },
    });

    if (!connection) {
      return {
        connected: false,
        provider: 'forcelog.ma' as const,
        connectedAt: null,
        message: 'ForceLog account is not connected',
      };
    }

    return this.toStatus(connection.connectedAt);
  }

  async disconnect(userId: string) {
    await this.prisma.forceLogConnection.deleteMany({ where: { userId } });

    return {
      connected: false,
      provider: 'forcelog.ma' as const,
      connectedAt: null,
      message: 'ForceLog account disconnected',
    };
  }

  async getApiKey(userId: string): Promise<string> {
    const connection = await this.prisma.forceLogConnection.findUnique({
      where: { userId },
      select: { encryptedApiKey: true },
    });

    if (!connection) {
      throw new ConflictException(
        'Connect your ForceLog account before using this feature',
      );
    }

    return this.decrypt(connection.encryptedApiKey);
  }

  private toStatus(connectedAt: Date) {
    return {
      connected: true,
      provider: 'forcelog.ma' as const,
      connectedAt: connectedAt.toISOString(),
      message: 'ForceLog account is connected',
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
        'Stored ForceLog credentials are invalid',
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
        'Unable to decrypt ForceLog credentials',
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
