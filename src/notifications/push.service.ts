import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body?: string | null;
  /** FCM data values must be strings. */
  data: Record<string, string>;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TIMEOUT_MS = 10_000;
// FCM error codes that mean the token will never work again. INVALID_ARGUMENT
// is excluded: a malformed payload returns it too, and would wipe good tokens.
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'SENDER_ID_MISMATCH']);

/**
 * Sends phone push through FCM HTTP v1 using Application Default Credentials
 * (the Cloud Run service account), so no key file is ever stored. A no-op
 * unless PUSH_NOTIFICATIONS_ENABLED=true — the in-app list never depends on it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;
  private readonly projectId: string;
  private auth?: GoogleAuth;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.enabled = config.get<string>('PUSH_NOTIFICATIONS_ENABLED') === 'true';
    this.projectId = config.get<string>('FCM_PROJECT_ID', '');
  }

  get isEnabled(): boolean {
    return this.enabled && Boolean(this.projectId);
  }

  /** Returns how many devices accepted the message. Never throws. */
  async sendToUsers(userIds: string[], message: PushMessage): Promise<number> {
    if (!this.isEnabled || userIds.length === 0) return 0;

    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, token: true },
    });
    if (devices.length === 0) return 0;

    const results = await Promise.all(
      devices.map((device) => this.sendOne(device.token, message)),
    );

    const dead = devices.filter((_, i) => results[i] === 'dead');
    if (dead.length > 0) {
      await this.prisma.pushDevice
        .deleteMany({ where: { id: { in: dead.map((d) => d.id) } } })
        .catch(() => undefined);
    }
    return results.filter((r) => r === 'sent').length;
  }

  private async sendOne(
    token: string,
    message: PushMessage,
  ): Promise<'sent' | 'dead' | 'failed'> {
    try {
      const client = await this.client().getClient();
      await client.request({
        url: `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        method: 'POST',
        timeout: FCM_TIMEOUT_MS,
        data: {
          message: {
            token,
            notification: {
              title: message.title,
              ...(message.body ? { body: message.body } : {}),
            },
            data: message.data,
          },
        },
      });
      return 'sent';
    } catch (err) {
      const code = fcmErrorCode(err);
      if (code && DEAD_TOKEN_CODES.has(code)) return 'dead';
      this.logger.warn(`FCM send failed: ${code ?? (err as Error).message}`);
      return 'failed';
    }
  }

  private client(): GoogleAuth {
    this.auth ??= new GoogleAuth({ scopes: [FCM_SCOPE] });
    return this.auth;
  }
}

function fcmErrorCode(err: unknown): string | null {
  const body = (
    err as {
      response?: {
        data?: {
          error?: { status?: string; details?: { errorCode?: string }[] };
        };
      };
    }
  )?.response?.data?.error;
  if (!body) return null;
  const detail = body.details?.find((d) => d.errorCode)?.errorCode;
  return detail ?? body.status ?? null;
}
