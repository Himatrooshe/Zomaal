/**
 * ============================================================================
 * TEMPORARY — WHATSAPP MOCK DATA FOR FRONTEND PREVIEW ONLY
 * ============================================================================
 * Zomaal's Meta app (App ID, App Secret, Embedded Signup config) does not exist
 * yet, so no real WhatsApp connection, template or message can be produced.
 * Everything in this file is SYNTHETIC preview data that lets the frontend
 * build every WhatsApp screen while `WHATSAPP_MOCK_DATA=true`.
 *
 * - Not real merchants, customers, orders or Meta ids. Never copy into seeds,
 *   tests of real behaviour, or the database.
 * - Response shapes follow the real DTOs in `../dto/whatsapp.dto.ts`; Meta
 *   values (template statuses, rejected reasons, error codes, test-number
 *   format) follow the WhatsApp Cloud API documentation.
 * - Delete the whole `src/whatsapp/mock/` folder once Meta access is live —
 *   see "Removing the mock" in `docs/module-context/15-whatsapp.md`.
 * ============================================================================
 */
import { WhatsAppMessageStatus } from '@prisma/client';
import type { WhatsAppTrigger } from '../whatsapp.constants';

/** Response header on every mocked response, so mock data is never mistaken for real data. */
export const MOCK_DATA_HEADER = 'X-Zomaal-Mock-Data';

/** Same shape as the ConnectWhatsAppDto examples; not a real WhatsApp Business Account. */
export const MOCK_WABA_ID = '100000000000000';
export const MOCK_PHONE_NUMBER_ID = '100000000000001';

/** 555-01xx numbers are reserved for fiction; Meta's free test numbers use the same +1 555 format. */
export const MOCK_DISPLAY_PHONE_NUMBER = '+1 555-010-0000';

/** Fixed fake id for the mock connection row (UUID-shaped, all zeros = obviously not real). */
export const MOCK_CONNECTION_ID = '00000000-0000-4000-8000-000000000001';

/** Preview-only Zomaal fee and top-up. Real values come from super-admin pricing and credits. */
export const MOCK_PRICE_PER_MESSAGE = '0.50';
export const MOCK_TOP_UP_AMOUNT = '30.00';
export const MOCK_TOP_UP_DAYS_AGO = 12;

/** Which statuses start switched on, so the settings screen isn't all "off". */
export const MOCK_DEFAULT_STATUS_SETTINGS: Partial<
  Record<WhatsAppTrigger, { enabled: boolean; delayMinutes: number }>
> = {
  PICKED_UP: { enabled: true, delayMinutes: 0 },
  OUT_FOR_DELIVERY: { enabled: true, delayMinutes: 30 },
  DELIVERED: { enabled: true, delayMinutes: 60 },
};

/**
 * Non-approved template states shown after connecting, so the frontend can
 * style PENDING and REJECTED badges. Every other template is APPROVED.
 * Rejected reason values are Meta's (`rejected_reason` on message_templates).
 */
export const MOCK_TEMPLATE_OVERRIDES: Array<{
  trigger: WhatsAppTrigger;
  language: 'en' | 'ar' | 'fr';
  status: 'PENDING' | 'REJECTED';
  rejectedReason: string | null;
}> = [
  {
    trigger: 'REFUSED',
    language: 'fr',
    status: 'PENDING',
    rejectedReason: null,
  },
  {
    trigger: 'POSTPONED',
    language: 'ar',
    status: 'REJECTED',
    rejectedReason: 'INVALID_FORMAT',
  },
];

export interface MockMessageSpec {
  /** Fixed fake UUID so the same row keeps its id between requests. */
  id: string;
  trigger: WhatsAppTrigger;
  status: WhatsAppMessageStatus;
  /** Created this many minutes before "now" — keeps the preview data recent. */
  createdMinutesAgo: number;
  delayMinutes: number;
  customerName: string;
  /** Null shows the "no valid mobile number" case. */
  recipientPhone: string | null;
  orderName: string;
  errorCode?: string;
  errorMessage?: string;
}

const DAY = 24 * 60;

/**
 * One row per state the message log has to render: scheduled, sent,
 * delivered, read, Meta failure, Zomaal failure and skips.
 * Error codes 131026 / 131049 and their texts are from Meta's Cloud API
 * error-code reference; the rest are Zomaal's own codes.
 */
export const MOCK_MESSAGES: MockMessageSpec[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    trigger: 'OUT_FOR_DELIVERY',
    status: WhatsAppMessageStatus.SCHEDULED,
    createdMinutesAgo: 10,
    delayMinutes: 30,
    customerName: 'Mock Customer 1',
    recipientPhone: '+15550100001',
    orderName: '#MOCK-1016',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    trigger: 'PICKED_UP',
    status: WhatsAppMessageStatus.SENT,
    createdMinutesAgo: 25,
    delayMinutes: 0,
    customerName: 'Mock Customer 2',
    recipientPhone: '+15550100002',
    orderName: '#MOCK-1015',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    trigger: 'DELIVERED',
    status: WhatsAppMessageStatus.READ,
    createdMinutesAgo: 90,
    delayMinutes: 60,
    customerName: 'Mock Customer 3',
    recipientPhone: '+15550100003',
    orderName: '#MOCK-1014',
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    trigger: 'OUT_FOR_DELIVERY',
    status: WhatsAppMessageStatus.DELIVERED,
    createdMinutesAgo: 140,
    delayMinutes: 30,
    customerName: 'Mock Customer 4',
    recipientPhone: '+15550100004',
    orderName: '#MOCK-1013',
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    trigger: 'PICKED_UP',
    status: WhatsAppMessageStatus.FAILED,
    createdMinutesAgo: 200,
    delayMinutes: 0,
    customerName: 'Mock Customer 5',
    recipientPhone: '+15550100005',
    orderName: '#MOCK-1012',
    errorCode: '131026',
    errorMessage: 'Message undeliverable',
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    trigger: 'IN_TRANSIT',
    status: WhatsAppMessageStatus.SKIPPED,
    createdMinutesAgo: 1 * DAY,
    delayMinutes: 0,
    customerName: 'Mock Customer 6',
    recipientPhone: null,
    orderName: '#MOCK-1011',
    errorCode: 'NO_VALID_PHONE',
    errorMessage: 'The order has no valid mobile number for the customer',
  },
  {
    id: '00000000-0000-4000-8000-000000000107',
    trigger: 'DELIVERED',
    status: WhatsAppMessageStatus.READ,
    createdMinutesAgo: 1 * DAY + 120,
    delayMinutes: 60,
    customerName: 'Mock Customer 7',
    recipientPhone: '+15550100007',
    orderName: '#MOCK-1010',
  },
  {
    id: '00000000-0000-4000-8000-000000000108',
    trigger: 'OUT_FOR_DELIVERY',
    status: WhatsAppMessageStatus.SKIPPED,
    createdMinutesAgo: 2 * DAY,
    delayMinutes: 30,
    customerName: 'Mock Customer 8',
    recipientPhone: '+15550100008',
    orderName: '#MOCK-1009',
    errorCode: 'STATUS_CHANGED',
    errorMessage: 'The parcel moved to DELIVERED before the message was due',
  },
  {
    id: '00000000-0000-4000-8000-000000000109',
    trigger: 'PICKED_UP',
    status: WhatsAppMessageStatus.DELIVERED,
    createdMinutesAgo: 3 * DAY,
    delayMinutes: 0,
    customerName: 'Mock Customer 9',
    recipientPhone: '+15550100009',
    orderName: '#MOCK-1008',
  },
  {
    id: '00000000-0000-4000-8000-000000000110',
    trigger: 'REFUSED',
    status: WhatsAppMessageStatus.FAILED,
    createdMinutesAgo: 4 * DAY,
    delayMinutes: 0,
    customerName: 'Mock Customer 10',
    recipientPhone: '+15550100010',
    orderName: '#MOCK-1007',
    errorCode: 'INSUFFICIENT_BALANCE',
    errorMessage: 'Not enough WhatsApp balance to send this message',
  },
  {
    id: '00000000-0000-4000-8000-000000000111',
    trigger: 'DELIVERED',
    status: WhatsAppMessageStatus.READ,
    createdMinutesAgo: 5 * DAY,
    delayMinutes: 60,
    customerName: 'Mock Customer 11',
    recipientPhone: '+15550100011',
    orderName: '#MOCK-1006',
  },
  {
    id: '00000000-0000-4000-8000-000000000112',
    trigger: 'OUT_FOR_DELIVERY',
    status: WhatsAppMessageStatus.DELIVERED,
    createdMinutesAgo: 6 * DAY,
    delayMinutes: 30,
    customerName: 'Mock Customer 12',
    recipientPhone: '+15550100012',
    orderName: '#MOCK-1005',
  },
  {
    id: '00000000-0000-4000-8000-000000000113',
    trigger: 'POSTPONED',
    status: WhatsAppMessageStatus.FAILED,
    createdMinutesAgo: 7 * DAY,
    delayMinutes: 0,
    customerName: 'Mock Customer 13',
    recipientPhone: '+15550100013',
    orderName: '#MOCK-1004',
    errorCode: '131049',
    errorMessage:
      'This message was not delivered to maintain healthy ecosystem engagement.',
  },
  {
    id: '00000000-0000-4000-8000-000000000114',
    trigger: 'PICKED_UP',
    status: WhatsAppMessageStatus.READ,
    createdMinutesAgo: 8 * DAY,
    delayMinutes: 0,
    customerName: 'Mock Customer 14',
    recipientPhone: '+15550100014',
    orderName: '#MOCK-1003',
  },
  {
    id: '00000000-0000-4000-8000-000000000115',
    trigger: 'CANCELLED',
    status: WhatsAppMessageStatus.SENT,
    createdMinutesAgo: 9 * DAY,
    delayMinutes: 0,
    customerName: 'Mock Customer 15',
    recipientPhone: '+15550100015',
    orderName: '#MOCK-1002',
  },
  {
    id: '00000000-0000-4000-8000-000000000116',
    trigger: 'DELIVERED',
    status: WhatsAppMessageStatus.DELIVERED,
    createdMinutesAgo: 10 * DAY,
    delayMinutes: 60,
    customerName: 'Mock Customer 16',
    recipientPhone: '+15550100016',
    orderName: '#MOCK-1001',
  },
];

/** Fake order ids paired with the mock messages; GET /ecommerce/orders/:id returns 404 for them. */
export function mockOrderId(messageId: string): string {
  return messageId.replace('-8000-', '-9000-');
}
