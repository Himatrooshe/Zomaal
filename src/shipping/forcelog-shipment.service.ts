import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ShippingShipmentStatus,
  type ForceLogShipment,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ForceLogParcelDto } from './dto/forcelog-parcel.dto';
import type {
  ForceLogShipmentQueryDto,
  ForceLogSyncQueryDto,
} from './dto/forcelog-shipment-query.dto';
import { ForceLogClient } from './forcelog.client';
import { ForceLogConnectionService } from './forcelog-connection.service';
import {
  normalizeForceLogStatus,
  normalizeForceLogStatusCode,
} from './forcelog-status';

type ProviderRecord = Record<string, unknown>;

type ForceLogSnapshot = {
  providerCode: string;
  providerStatus: string;
  situation: string | null;
  normalizedStatus: ReturnType<typeof normalizeForceLogStatus>;
  reference: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  address: string | null;
  city: string | null;
  codAmount: Prisma.Decimal | null;
  fee: Prisma.Decimal | null;
  canOpen: boolean | null;
  comment: string | null;
  productNature: string | null;
  providerCreatedAt: Date | null;
};

@Injectable()
export class ForceLogShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ForceLogClient,
    private readonly connection: ForceLogConnectionService,
  ) {}

  async persistCreatedParcel(
    userId: string,
    request: ForceLogParcelDto,
    providerResponse: unknown,
  ) {
    const parcel = findNestedRecord(providerResponse, 'NEW-PARCEL');
    if (!parcel) throw malformedResponse('ADD-PARCEL.NEW-PARCEL');
    const snapshot = snapshotFromProvider(parcel, request, 'NEW_PARCEL');
    return this.persistSnapshot(userId, snapshot, providerResponse, true);
  }

  async reconcileProviderParcel(
    userId: string,
    providerCode: string,
    providerResponse: unknown,
  ) {
    const parcel =
      findNestedRecord(providerResponse, 'PARCEL') ??
      findTrackingRecord(providerResponse);
    if (!parcel) throw malformedResponse('PARCEL');
    const snapshot = snapshotFromProvider(parcel, undefined, undefined);
    if (snapshot.providerCode !== providerCode) {
      throw new BadGatewayException(
        'ForceLog returned a different parcel tracking number',
      );
    }
    return this.persistSnapshot(userId, snapshot, providerResponse, false);
  }

  async refresh(userId: string, providerCode: string) {
    const response = await this.client.getParcel(
      await this.connection.getApiKey(userId),
      providerCode,
    );
    await this.reconcileProviderParcel(userId, providerCode, response);
    return this.getByProviderCode(userId, providerCode);
  }

  async sync(userId: string, query: ForceLogSyncQueryDto) {
    const limit = query.limit ?? 20;
    const shipments = await this.prisma.forceLogShipment.findMany({
      where: {
        userId,
        normalizedStatus: {
          notIn: [
            ShippingShipmentStatus.DELIVERED,
            ShippingShipmentStatus.CANCELLED,
            ShippingShipmentStatus.RETURNED_TO_STOCK,
            ShippingShipmentStatus.RETURNED_TO_SELLER,
          ],
        },
      },
      select: { providerCode: true },
      orderBy: [{ lastActionAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
    const failures: Array<{ providerCode: string; message: string }> = [];
    let refreshed = 0;

    for (const shipment of shipments) {
      try {
        await this.refresh(userId, shipment.providerCode);
        refreshed += 1;
      } catch (error) {
        failures.push({
          providerCode: shipment.providerCode,
          message: safeErrorMessage(error),
        });
      }
    }

    const syncedAt = new Date();
    const lastSyncError = failures.length
      ? `${failures.length} ForceLog parcel refreshes failed`
      : null;
    await this.connection.updateSyncHealth(
      userId,
      failures.length === shipments.length && shipments.length > 0
        ? null
        : syncedAt,
      lastSyncError,
    );

    return {
      success: failures.length === 0,
      message: failures.length
        ? 'ForceLog shipments synchronized with partial failures'
        : 'ForceLog shipments synchronized',
      selected: shipments.length,
      refreshed,
      failed: failures.length,
      syncedAt: syncedAt.toISOString(),
      failures,
      limitation:
        'ForceLog has no account-wide parcel-list endpoint; only locally known tracking codes are refreshed.',
    };
  }

  async getByProviderCode(userId: string, providerCode: string) {
    const shipment = await this.prisma.forceLogShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      include: { events: { orderBy: { eventAt: 'desc' } } },
    });
    if (!shipment) {
      throw new NotFoundException('Stored ForceLog shipment was not found');
    }
    return shipmentDetails(shipment);
  }

  async getTimeline(userId: string, providerCode: string) {
    const shipment = await this.prisma.forceLogShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      select: {
        providerCode: true,
        providerStatus: true,
        situation: true,
        normalizedStatus: true,
        lastActionAt: true,
        events: { orderBy: { eventAt: 'desc' } },
      },
    });
    if (!shipment) {
      throw new NotFoundException('Stored ForceLog shipment was not found');
    }
    return {
      providerCode: shipment.providerCode,
      providerStatus: shipment.providerStatus,
      situation: shipment.situation,
      normalizedStatus: shipment.normalizedStatus,
      lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
      events: shipment.events.map(eventResponse),
    };
  }

  async list(userId: string, query: ForceLogShipmentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.ForceLogShipmentWhereInput = {
      userId,
      ...(query.status ? { normalizedStatus: query.status } : {}),
      ...(search
        ? {
            OR: [
              { providerCode: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
              { recipientName: { contains: search, mode: 'insensitive' } },
              { recipientPhone: { contains: search } },
              { address: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, shipments] = await Promise.all([
      this.prisma.forceLogShipment.count({ where }),
      this.prisma.forceLogShipment.findMany({
        where,
        orderBy: [
          { lastActionAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: shipments.map(shipmentSummary),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async persistSnapshot(
    userId: string,
    snapshot: ForceLogSnapshot,
    providerResponse: unknown,
    created: boolean,
  ) {
    const eventAt = new Date();
    const statusCode =
      normalizeForceLogStatusCode(snapshot.providerStatus) ?? 'UNKNOWN';

    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.forceLogConnection.findUnique({
        where: { userId },
        select: { id: true },
      });
      const dispatch = snapshot.reference
        ? await tx.ecommerceOrderDispatch.findFirst({
            where: {
              provider: 'FORCELOG',
              merchantTracking: snapshot.reference,
              order: { connection: { store: { userId } } },
            },
            select: { id: true },
          })
        : null;
      const shipment = await tx.forceLogShipment.upsert({
        where: {
          userId_providerCode: {
            userId,
            providerCode: snapshot.providerCode,
          },
        },
        create: {
          userId,
          connectionId: connection?.id,
          dispatchId: dispatch?.id,
          ...snapshot,
          lastActionAt: eventAt,
        },
        update: {
          connectionId: connection?.id,
          ...(dispatch?.id ? { dispatchId: dispatch.id } : {}),
          ...snapshot,
          lastActionAt: eventAt,
        },
      });
      await tx.forceLogTrackingEvent.upsert({
        where: {
          shipmentId_providerEventKey: {
            shipmentId: shipment.id,
            providerEventKey: `status:${statusCode}`,
          },
        },
        create: {
          shipmentId: shipment.id,
          providerEventKey: `status:${statusCode}`,
          eventType: created ? 'parcel.created' : 'parcel.status_refreshed',
          providerStatus: snapshot.providerStatus,
          normalizedStatus: snapshot.normalizedStatus,
          message: snapshot.situation,
          actor: 'ForceLog',
          eventAt,
          rawPayload: jsonValue(providerResponse),
        },
        update: {
          normalizedStatus: snapshot.normalizedStatus,
          message: snapshot.situation,
          rawPayload: jsonValue(providerResponse),
        },
      });
      return shipment;
    });
  }
}

function snapshotFromProvider(
  parcel: ProviderRecord,
  request?: ForceLogParcelDto,
  fallbackStatus?: string,
): ForceLogSnapshot {
  const providerCode = requiredString(
    first(parcel, 'TRACKING_NUMBER', 'CODE'),
    'TRACKING_NUMBER',
  );
  const providerStatus =
    optionalString(first(parcel, 'STATUS', 'STATUS_NAME')) ??
    fallbackStatus ??
    'UNKNOWN';
  return {
    providerCode,
    providerStatus,
    situation: optionalString(first(parcel, 'SITUATION', 'PAYMENT_STATUS')),
    normalizedStatus: normalizeForceLogStatus(providerStatus),
    reference:
      optionalString(first(parcel, 'ORDER_NUM', 'REFERENCE')) ??
      request?.ORDER_NUM ??
      null,
    recipientName:
      optionalString(first(parcel, 'RECEIVER', 'RECEIVE')) ??
      request?.RECEIVE ??
      null,
    recipientPhone:
      optionalString(first(parcel, 'PHONE')) ?? request?.PHONE ?? null,
    address:
      optionalString(first(parcel, 'ADDRESS')) ?? request?.ADDRESS ?? null,
    city:
      optionalString(first(parcel, 'CITY_NAME', 'CITY')) ??
      request?.CITY ??
      null,
    codAmount:
      optionalDecimal(first(parcel, 'PRICE', 'COD')) ??
      optionalDecimal(request?.COD),
    fee: optionalDecimal(first(parcel, 'DELIVERY_FEES', 'FEES')),
    canOpen:
      optionalBoolean(first(parcel, 'CAN_OPEN')) ?? request?.CAN_OPEN ?? null,
    comment:
      optionalString(first(parcel, 'COMMENT', 'HOW')) ?? request?.HOW ?? null,
    productNature:
      optionalString(first(parcel, 'PRODUCT_NATURE')) ??
      request?.PRODUCT_NATURE ??
      null,
    providerCreatedAt: providerDate(
      first(parcel, 'CREATION_TIME', 'CREATED_AT'),
    ),
  };
}

function shipmentSummary(shipment: ForceLogShipment) {
  return {
    id: shipment.id,
    provider: 'forcelog' as const,
    providerCode: shipment.providerCode,
    providerStatus: shipment.providerStatus,
    situation: shipment.situation,
    normalizedStatus: shipment.normalizedStatus,
    reference: shipment.reference,
    recipientName: shipment.recipientName,
    recipientPhone: shipment.recipientPhone,
    address: shipment.address,
    city: shipment.city,
    codAmount: shipment.codAmount?.toFixed(4) ?? null,
    fee: shipment.fee?.toFixed(4) ?? null,
    currency: shipment.currency,
    productName: shipment.productNature,
    productNature: shipment.productNature,
    note: shipment.comment,
    comment: shipment.comment,
    lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
    providerCreatedAt: shipment.providerCreatedAt?.toISOString() ?? null,
    providerUpdatedAt: shipment.providerUpdatedAt?.toISOString() ?? null,
    createdAt: shipment.createdAt.toISOString(),
    updatedAt: shipment.updatedAt.toISOString(),
  };
}

function shipmentDetails(
  shipment: ForceLogShipment & {
    events: Array<{
      id: string;
      eventType: string;
      providerStatus: string;
      normalizedStatus: ForceLogShipment['normalizedStatus'];
      message: string | null;
      actor: string | null;
      eventAt: Date;
    }>;
  },
) {
  return {
    ...shipmentSummary(shipment),
    address: shipment.address,
    canOpen: shipment.canOpen,
    comment: shipment.comment,
    productNature: shipment.productNature,
    providerCreatedAt: shipment.providerCreatedAt?.toISOString() ?? null,
    providerUpdatedAt: shipment.providerUpdatedAt?.toISOString() ?? null,
    events: shipment.events.map(eventResponse),
  };
}

function eventResponse(event: {
  id: string;
  eventType: string;
  providerStatus: string;
  normalizedStatus: ForceLogShipment['normalizedStatus'];
  message: string | null;
  actor: string | null;
  eventAt: Date;
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    providerStatus: event.providerStatus,
    normalizedStatus: event.normalizedStatus,
    message: event.message,
    actor: event.actor,
    eventAt: event.eventAt.toISOString(),
  };
}

function findNestedRecord(
  value: unknown,
  wantedKey: string,
): ProviderRecord | null {
  const root = record(value);
  if (!root) return null;
  const direct = record(root[wantedKey]);
  if (direct) return direct;
  for (const nested of Object.values(root)) {
    const found = findNestedRecord(nested, wantedKey);
    if (found) return found;
  }
  return null;
}

function findTrackingRecord(value: unknown): ProviderRecord | null {
  const root = record(value);
  if (!root) return null;
  if (first(root, 'TRACKING_NUMBER', 'CODE') !== undefined) return root;
  for (const nested of Object.values(root)) {
    const found = findTrackingRecord(nested);
    if (found) return found;
  }
  return null;
}

function record(value: unknown): ProviderRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null;
}

function first(recordValue: ProviderRecord, ...keys: string[]) {
  for (const key of keys) {
    if (recordValue[key] !== undefined && recordValue[key] !== null) {
      return recordValue[key];
    }
  }
  return undefined;
}

function requiredString(value: unknown, field: string) {
  const result = optionalString(value);
  if (!result) throw malformedResponse(field);
  return result;
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function optionalDecimal(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  try {
    return new Prisma.Decimal(value as Prisma.Decimal.Value);
  } catch {
    return null;
  }
}

function optionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'YES') {
    return true;
  }
  if (value === 0 || value === '0' || value === 'false' || value === 'NO') {
    return false;
  }
  return null;
}

function providerDate(value: unknown): Date | null {
  const text = optionalString(value);
  if (!text) return null;
  const french =
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      text,
    );
  if (french) {
    return new Date(
      Date.UTC(
        Number(french[3]),
        Number(french[2]) - 1,
        Number(french[1]),
        Number(french[4] ?? 0),
        Number(french[5] ?? 0),
        Number(french[6] ?? 0),
      ),
    );
  }
  const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function malformedResponse(field: string) {
  return new BadGatewayException(
    `ForceLog returned a malformed response: missing ${field}`,
  );
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 500)
    : 'ForceLog parcel refresh failed';
}
