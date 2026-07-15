import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectQuickLivraisonDto } from './dto/quicklivraison-connection.dto';
import { QuickLivraisonClient } from './quicklivraison.client';

export type QuickLivraisonKeyType = 'primary' | 'subuser';

@Injectable()
export class QuickLivraisonConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly quickLivraisonClient: QuickLivraisonClient,
  ) {}

  async connect(userId: string, payload: ConnectQuickLivraisonDto) {
    const apiKey = payload.apiKey.trim();

    await this.quickLivraisonClient.checkConnection(apiKey);

    const keyType: QuickLivraisonKeyType = apiKey.startsWith('sub_')
      ? 'subuser'
      : 'primary';
    const connection = await this.prisma.quickLivraisonConnection.upsert({
      where: { userId },
      create: {
        userId,
        encryptedApiKey: this.encrypt(apiKey),
        keyType,
      },
      update: {
        encryptedApiKey: this.encrypt(apiKey),
        keyType,
        connectedAt: new Date(),
      },
    });

    return this.toStatus(connection.keyType, connection.connectedAt);
  }

  async getStatus(userId: string) {
    const connection = await this.prisma.quickLivraisonConnection.findUnique({
      where: { userId },
      select: { keyType: true, connectedAt: true },
    });

    if (!connection) {
      return {
        connected: false,
        provider: 'quicklivraison.ma' as const,
        keyType: null,
        connectedAt: null,
        message: 'QuickLivraison account is not connected',
      };
    }

    return this.toStatus(connection.keyType, connection.connectedAt);
  }

  async disconnect(userId: string) {
    await this.prisma.quickLivraisonConnection.deleteMany({
      where: { userId },
    });

    return {
      connected: false,
      provider: 'quicklivraison.ma' as const,
      keyType: null,
      connectedAt: null,
      message: 'QuickLivraison account disconnected',
    };
  }

  async getApiKey(userId: string): Promise<string> {
    const connection = await this.prisma.quickLivraisonConnection.findUnique({
      where: { userId },
      select: { encryptedApiKey: true },
    });

    if (!connection) {
      throw new ConflictException(
        'Connect your QuickLivraison account before using this feature',
      );
    }

    return this.decrypt(connection.encryptedApiKey);
  }

  private toStatus(keyType: string, connectedAt: Date) {
    return {
      connected: true,
      provider: 'quicklivraison.ma' as const,
      keyType: keyType as QuickLivraisonKeyType,
      connectedAt: connectedAt.toISOString(),
      message: 'QuickLivraison account is connected',
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
        'Stored QuickLivraison credentials are invalid',
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
        'Unable to decrypt QuickLivraison credentials',
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
