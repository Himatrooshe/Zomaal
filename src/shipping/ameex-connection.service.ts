import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AmeexClient, type AmeexCredentials } from './ameex.client';
import type { ConnectAmeexDto } from './dto/ameex-connection.dto';

@Injectable()
export class AmeexConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: AmeexClient,
  ) {}

  async connect(userId: string, payload: ConnectAmeexDto) {
    const credentials = {
      apiId: payload.apiId.trim(),
      apiKey: payload.apiKey.trim(),
    };
    await this.client.checkConnection(credentials);
    const connection = await this.prisma.ameexConnection.upsert({
      where: { userId },
      create: {
        userId,
        encryptedApiId: this.encrypt(credentials.apiId),
        encryptedApiKey: this.encrypt(credentials.apiKey),
      },
      update: {
        encryptedApiId: this.encrypt(credentials.apiId),
        encryptedApiKey: this.encrypt(credentials.apiKey),
        connectedAt: new Date(),
      },
    });
    return this.toStatus(connection.connectedAt);
  }

  async getStatus(userId: string) {
    const connection = await this.prisma.ameexConnection.findUnique({
      where: { userId },
      select: { connectedAt: true, lastSyncedAt: true, lastSyncError: true },
    });
    if (!connection) {
      return {
        connected: false,
        provider: 'ameex.ma' as const,
        connectedAt: null,
        message: 'Ameex account is not connected',
      };
    }
    return {
      ...this.toStatus(connection.connectedAt),
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: connection.lastSyncError,
    };
  }

  async disconnect(userId: string) {
    await this.prisma.ameexConnection.deleteMany({ where: { userId } });
    return {
      connected: false,
      provider: 'ameex.ma' as const,
      connectedAt: null,
      message: 'Ameex account disconnected',
    };
  }

  async getCredentials(userId: string): Promise<AmeexCredentials> {
    const value = await this.prisma.ameexConnection.findUnique({
      where: { userId },
      select: { encryptedApiId: true, encryptedApiKey: true },
    });
    if (!value) {
      throw new ConflictException(
        'Connect your Ameex account before using this feature',
      );
    }
    return {
      apiId: this.decrypt(value.encryptedApiId),
      apiKey: this.decrypt(value.encryptedApiKey),
    };
  }

  async updateSyncHealth(userId: string, syncedAt: Date, error: string | null) {
    await this.prisma.ameexConnection.updateMany({
      where: { userId },
      data: { lastSyncedAt: syncedAt, lastSyncError: error },
    });
  }

  private toStatus(connectedAt: Date) {
    return {
      connected: true,
      provider: 'ameex.ma' as const,
      connectedAt: connectedAt.toISOString(),
      message: 'Ameex account is connected',
    };
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
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

  private decrypt(value: string) {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !encrypted) {
      throw new ServiceUnavailableException(
        'Stored Ameex credentials are invalid',
      );
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key(),
        Buffer.from(iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException(
        'Unable to decrypt Ameex credentials',
      );
    }
  }

  private key() {
    const key = Buffer.from(
      this.config.get<string>('SHIPPING_CREDENTIAL_ENCRYPTION_KEY') ?? '',
      'base64',
    );
    if (key.length !== 32) {
      throw new ServiceUnavailableException(
        'SHIPPING_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
    return key;
  }
}
