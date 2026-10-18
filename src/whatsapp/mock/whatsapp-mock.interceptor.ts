/**
 * TEMPORARY — routes merchant `/whatsapp/*` calls to WhatsAppMockService
 * while `WHATSAPP_MOCK_DATA=true`. With the flag off (default, and forced off
 * when `WHATSAPP_ENABLED=true`) it is a no-op and the real handler runs.
 *
 * Runs after the JWT and plan guards, so auth behaves exactly like the real
 * endpoints. Remove with the rest of `src/whatsapp/mock/` when Meta is live.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { from, type Observable } from 'rxjs';
import { MOCK_DATA_HEADER } from './whatsapp-mock.fixtures';
import { WhatsAppMockService, type MockRequest } from './whatsapp-mock.service';

@Injectable()
export class WhatsAppMockInterceptor implements NestInterceptor {
  constructor(private readonly mock: WhatsAppMockService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.mock.isEnabled()) return next.handle();
    const handler = this.mock.handlerFor(context.getHandler().name);
    if (!handler) return next.handle();

    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader(MOCK_DATA_HEADER, 'true');
    return from(handler(http.getRequest<MockRequest>()));
  }
}
