import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectSenditDto } from './dto/sendit-connection.dto';
import { SenditClient } from './sendit.client';

export interface SenditCredentials {
  publicKey: string;
  secretKey: string;
}

@Injectable()
export class SenditConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly senditClient: SenditClient,
  ) {}

  async connect(userId: string, payload: ConnectSenditDto) {
    const credentials = {
      publicKey: payload.public_key,
      secretKey: payload.secret_key,
    };
    const login = await this.senditClient.authenticate(credentials);
    const accountName = login.data?.name ?? null;

    const connection = await this.prisma.senditConnection.upsert({
      where: { userId },
      create: {
        userId,
        encryptedPublicKey: this.encrypt(credentials.publicKey),
        encryptedSecretKey: this.encrypt(credentials.secretKey),
        accountName,
      },
      update: {
        encryptedPublicKey: this.encrypt(credentials.publicKey),
        encryptedSecretKey: this.encrypt(credentials.secretKey),
        accountName,
        connectedAt: new Date(),
      },
    });

    this.senditClient.cacheLogin(userId, login);
    return this.toStatus(connection.accountName, connection.connectedAt);
  }

  async getStatus(userId: string) {
    const connection = await this.prisma.senditConnection.findUnique({
      where: { userId },
      select: { accountName: true, connectedAt: true },
    });

    if (!connection) {
      return {
        connected: false,
        provider: 'sendit.ma' as const,
        accountName: null,
        connectedAt: null,
        message: 'Sendit account is not connected',
      };
    }

    return this.toStatus(connection.accountName, connection.connectedAt);
  }

  async disconnect(userId: string) {
    await this.prisma.senditConnection.deleteMany({ where: { userId } });
    this.senditClient.clearUserToken(userId);
    return {
      connected: false,
      provider: 'sendit.ma' as const,
      accountName: null,
      connectedAt: null,
      message: 'Sendit account disconnected',
    };
  }

  async getCredentials(userId: string): Promise<SenditCredentials> {
    const connection = await this.prisma.senditConnection.findUnique({
      where: { userId },
    });
    if (!connection) {
      throw new ConflictException(
        'Connect your Sendit account before using this feature',
      );
    }
    return {
      publicKey: this.decrypt(connection.encryptedPublicKey),
      secretKey: this.decrypt(connection.encryptedSecretKey),
    };
  }

  private toStatus(accountName: string | null, connectedAt: Date) {
    return {
      connected: true,
      provider: 'sendit.ma' as const,
      accountName,
      connectedAt: connectedAt.toISOString(),
      message: 'Sendit account is connected',
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
        'Stored Sendit credentials are invalid',
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
        'Unable to decrypt Sendit credentials',
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
