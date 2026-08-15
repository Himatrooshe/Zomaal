import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ShippingShipmentStatus,
  type AmeexShipment,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AmeexClient } from './ameex.client';
import { AmeexConnectionService } from './ameex-connection.service';
import type { AmeexParcelDto, AmeexWebhookDto } from './dto/ameex-parcel.dto';
import type {
  AmeexShipmentQueryDto,
  AmeexSyncQueryDto,
} from './dto/ameex-shipment-query.dto';
import { normalizeAmeexStatus, normalizeAmeexStatusCode } from './ameex-status';

type ProviderRecord = Record<string, unknown>;

@Injectable()
export class AmeexShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AmeexClient,
    private readonly connection: AmeexConnectionService,
  ) {}

  async persistCreatedParcel(
    userId: string,
    request: AmeexParcelDto,
    response: unknown,
  ) {
    const recordValue = findParcelRecord(response);
    const code = findString(response, [
      'CODE',
      'PARCEL_CODE',
      'TRACKING_NUMBER',
      'TRACKING-NUMBER',
    ]);
    if (!code) {
      throw new BadGatewayException({
        message: 'Ameex returned a parcel response without a tracking code',
        ameex: response,
      });
    }
    return this.persistSnapshot(userId, code, recordValue ?? {}, {
      request,
      rawPayload: response,
      created: true,
    });
  }

  async reconcileInfo(userId: string, code: string, response: unknown) {
    const recordValue = findParcelRecord(response) ?? record(response);
    if (!recordValue) throw malformed('parcel information');
    return this.persistSnapshot(userId, code, recordValue, {
      rawPayload: response,
    });
  }

  async reconcileTracking(userId: string, code: string, response: unknown) {
    const events = trackingRecords(response);
    if (!events.length) {
      const value = findParcelRecord(response) ?? record(response);
      if (!value) throw malformed('tracking history');
      events.push(value);
    }
    const latest = [...events]
      .sort((a, b) => eventDate(a).getTime() - eventDate(b).getTime())
      .at(-1)!;
    await this.persistSnapshot(userId, code, latest, { rawPayload: response });
    for (const event of events)
      await this.persistEventForUser(userId, code, event);
    return { reconciled: events.length };
  }

  async processWebhook(payload: AmeexWebhookDto) {
    const webhookRecord: ProviderRecord = { ...payload };
    const shipments = await this.prisma.ameexShipment.findMany({
      where: { providerCode: payload.CODE },
      select: { userId: true },
    });
    for (const shipment of shipments) {
      await this.persistSnapshot(shipment.userId, payload.CODE, webhookRecord, {
        rawPayload: payload,
      });
      await this.persistEventForUser(
        shipment.userId,
        payload.CODE,
        webhookRecord,
      );
    }
    return { received: true, matchedShipments: shipments.length };
  }

  async refresh(userId: string, code: string) {
    const credentials = await this.connection.getCredentials(userId);
    const [info, tracking] = await Promise.all([
      this.client.getParcelInfo(credentials, code),
      this.client.getTracking(credentials, code),
    ]);
    await this.reconcileInfo(userId, code, info);
    await this.reconcileTracking(userId, code, tracking);
    return this.get(userId, code);
  }

  async sync(userId: string, query: AmeexSyncQueryDto) {
    const limit = query.limit ?? 20;
    const credentials = await this.connection.getCredentials(userId);
    const importResult = await this.importRemoteParcels(
      userId,
      credentials,
      query.importPageSize ?? 100,
      query.maxImportPages ?? 10,
    );
    const rows = await this.prisma.ameexShipment.findMany({
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
    let trackingFallbacks = 0;
    if (rows.length) {
      const codes = rows.map((row) => row.providerCode);
      let responsesByCode = new Map<string, unknown>();
      try {
        const response = await this.client.massTracking(credentials, { codes });
        responsesByCode = massTrackingResponses(response, codes);
      } catch {
        // The single-parcel fallback below keeps manual synchronization useful
        // when Ameex's optional mass endpoint is unavailable.
      }
      for (const code of codes) {
        const massTracking = responsesByCode.get(code);
        if (massTracking !== undefined) {
          try {
            await this.reconcileTracking(userId, code, massTracking);
            refreshed += 1;
            continue;
          } catch {
            // Fall through when Ameex changes the mass response envelope.
          }
        }
        trackingFallbacks += 1;
        try {
          const tracking = await this.client.getTracking(credentials, code);
          await this.reconcileTracking(userId, code, tracking);
          refreshed += 1;
        } catch (error) {
          failures.push({
            providerCode: code,
            message: safeErrorMessage(error),
          });
        }
      }
    }
    const syncedAt = new Date();
    const errorCount = failures.length + importResult.failed;
    await this.connection.updateSyncHealth(
      userId,
      syncedAt,
      errorCount ? `${errorCount} Ameex parcel synchronizations failed` : null,
    );
    return {
      success: errorCount === 0,
      imported: importResult.imported,
      remoteFound: importResult.remoteFound,
      importPages: importResult.pages,
      importFailed: importResult.failed,
      selected: rows.length,
      refreshed,
      trackingFallbacks,
      failed: failures.length,
      syncedAt: syncedAt.toISOString(),
      importFailures: importResult.failures,
      failures,
    };
  }

  async list(userId: string, query: AmeexShipmentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.AmeexShipmentWhereInput = {
      userId,
      ...(query.status ? { normalizedStatus: query.status } : {}),
      ...(search
        ? {
            OR: [
              { providerCode: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
              { recipientName: { contains: search, mode: 'insensitive' } },
              { recipientPhone: { contains: search } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.ameexShipment.count({ where }),
      this.prisma.ameexShipment.findMany({
        where,
        orderBy: [{ lastActionAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: rows.map(summary),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async get(userId: string, code: string) {
    const shipment = await this.prisma.ameexShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode: code } },
      include: { events: { orderBy: { eventAt: 'desc' } } },
    });
    if (!shipment)
      throw new NotFoundException('Stored Ameex shipment was not found');
    return { ...summary(shipment), events: shipment.events.map(eventResponse) };
  }

  async timeline(userId: string, code: string) {
    const shipment = await this.get(userId, code);
    return {
      providerCode: shipment.providerCode,
      providerStatus: shipment.providerStatus,
      normalizedStatus: shipment.normalizedStatus,
      lastActionAt: shipment.lastActionAt,
      events: shipment.events,
    };
  }

  private async persistSnapshot(
    userId: string,
    code: string,
    value: ProviderRecord,
    options: {
      request?: AmeexParcelDto;
      rawPayload: unknown;
      created?: boolean;
    },
  ) {
    const status = text(first(value, 'STATUT', 'STATUS')) ?? 'NEW';
    const subStatus = text(first(value, 'STATUT_S', 'STATUS_S'));
    const normalizedStatus = normalizeAmeexStatus(status, subStatus);
    const now = eventDate(value);
    const request = options.request;
    const providerCreatedAt = providerDate(
      first(value, 'CREATED_AT', 'DATE_CREATION', 'CREATION_DATE', 'DATE_ADD'),
    );
    const providerUpdatedAt = providerDate(
      first(value, 'UPDATED_AT', 'DATE_UPDATE', 'MODIFIED_AT'),
    );
    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.ameexConnection.findUnique({
        where: { userId },
        select: { id: true },
      });
      const shipment = await tx.ameexShipment.upsert({
        where: { userId_providerCode: { userId, providerCode: code } },
        create: {
          userId,
          connectionId: connection?.id,
          providerCode: code,
          providerStatus: status,
          providerSubStatus: subStatus,
          normalizedStatus,
          reference:
            request?.orderNumber ??
            text(first(value, 'ORDER_NUM', 'ORDER_NUMBER')),
          recipientName:
            request?.receiver ?? text(first(value, 'RECEIVER', 'NAME')),
          recipientPhone: request?.phone ?? text(value.PHONE),
          address: request?.address ?? text(value.ADDRESS),
          city: text(first(value, 'CITY_NAME', 'CITY')),
          cityId:
            integer(first(value, 'CITY_ID', 'CITY')) ?? integer(request?.city),
          codAmount:
            decimal(first(value, 'COD', 'PRICE')) ?? decimal(request?.cod),
          note: request?.comment ?? text(first(value, 'COMMENT', 'HOW')),
          nature: request?.product ?? text(first(value, 'PRODUCT', 'NATURE')),
          lastActionAt: now,
          providerCreatedAt,
          providerUpdatedAt,
        },
        update: {
          connectionId: connection?.id,
          providerStatus: status,
          providerSubStatus: subStatus,
          normalizedStatus,
          lastActionAt: now,
          ...(providerCreatedAt ? { providerCreatedAt } : {}),
          ...(providerUpdatedAt ? { providerUpdatedAt } : {}),
          ...(request
            ? {
                reference: request.orderNumber,
                recipientName: request.receiver,
                recipientPhone: request.phone,
                address: request.address,
                cityId: integer(request.city),
                codAmount: decimal(request.cod),
                note: request.comment,
                nature: request.product,
              }
            : {}),
        },
      });
      if (options.created) {
        await tx.ameexTrackingEvent.upsert({
          where: {
            shipmentId_providerEventKey: {
              shipmentId: shipment.id,
              providerEventKey: 'created',
            },
          },
          create: {
            shipmentId: shipment.id,
            providerEventKey: 'created',
            eventType: 'parcel.created',
            providerStatus: status,
            providerSubStatus: subStatus,
            normalizedStatus,
            actor: 'Ameex',
            eventAt: now,
            rawPayload: json(options.rawPayload),
          },
          update: { rawPayload: json(options.rawPayload) },
        });
      }
      return shipment;
    });
  }

  private async persistEventForUser(
    userId: string,
    code: string,
    value: ProviderRecord,
  ) {
    const shipment = await this.prisma.ameexShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode: code } },
      select: { id: true },
    });
    if (!shipment) return;
    const status = text(first(value, 'STATUT', 'STATUS')) ?? 'UNKNOWN';
    const subStatus = text(first(value, 'STATUT_S', 'STATUS_S'));
    const date = eventDate(value);
    const providerDate = text(
      first(value, 'DATE_TIME', 'DATETIME', 'DATE', 'TIME'),
    );
    const key = createHash('sha256')
      .update(
        JSON.stringify({
          status: normalizeAmeexStatusCode(status),
          subStatus: normalizeAmeexStatusCode(subStatus),
          providerDate,
          message: text(first(value, 'COMMENT', 'HOW')),
        }),
      )
      .digest('hex');
    await this.prisma.ameexTrackingEvent.upsert({
      where: {
        shipmentId_providerEventKey: {
          shipmentId: shipment.id,
          providerEventKey: key,
        },
      },
      create: {
        shipmentId: shipment.id,
        providerEventKey: key,
        eventType: 'parcel.status',
        providerStatus: status,
        providerSubStatus: subStatus,
        normalizedStatus: normalizeAmeexStatus(status, subStatus),
        message: text(first(value, 'COMMENT', 'HOW')),
        actor: 'Ameex',
        eventAt: date,
        rawPayload: json(value),
      },
      update: {
        message: text(first(value, 'COMMENT', 'HOW')),
        rawPayload: json(value),
      },
    });
  }

  private async importRemoteParcels(
    userId: string,
    credentials: Awaited<ReturnType<AmeexConnectionService['getCredentials']>>,
    pageSize: number,
    maxPages: number,
  ) {
    const seen = new Set<string>();
    const failures: Array<{ providerCode: string; message: string }> = [];
    let pages = 0;
    let remoteFound = 0;
    let imported = 0;
    let start = 0;

    for (let page = 0; page < maxPages; page += 1) {
      let response: unknown;
      try {
        response = await this.client.listParcels(credentials, {
          start,
          length: pageSize,
        });
      } catch (error) {
        failures.push({
          providerCode: '*',
          message: safeErrorMessage(error),
        });
        break;
      }

      pages += 1;
      const records = parcelRecords(response);
      remoteFound += records.length;
      if (!records.length) break;

      let newCodes = 0;
      for (const value of records) {
        const code = parcelCode(value);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        newCodes += 1;
        try {
          await this.persistSnapshot(userId, code, value, {
            rawPayload: value,
          });
          await this.persistEventForUser(userId, code, value);
          imported += 1;
        } catch (error) {
          failures.push({
            providerCode: code,
            message: safeErrorMessage(error),
          });
        }
      }

      const total = providerListTotal(response);
      start += records.length;
      if (newCodes === 0 || (total !== null && start >= total)) break;
      if (total === null && records.length < pageSize) break;
    }

    return {
      imported,
      remoteFound,
      pages,
      failed: failures.length,
      failures,
    };
  }
}

function summary(value: AmeexShipment) {
  return {
    id: value.id,
    provider: 'ameex' as const,
    providerCode: value.providerCode,
    providerStatus: value.providerStatus,
    providerSubStatus: value.providerSubStatus,
    normalizedStatus: value.normalizedStatus,
    reference: value.reference,
    recipientName: value.recipientName,
    recipientPhone: value.recipientPhone,
    address: value.address,
    city: value.city,
    cityId: value.cityId,
    codAmount: value.codAmount?.toFixed(4) ?? null,
    fee: value.fee?.toFixed(4) ?? null,
    currency: value.currency,
    productName: value.nature,
    nature: value.nature,
    note: value.note,
    lastActionAt: value.lastActionAt?.toISOString() ?? null,
    providerCreatedAt: value.providerCreatedAt?.toISOString() ?? null,
    providerUpdatedAt: value.providerUpdatedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function eventResponse(value: {
  id: string;
  eventType: string;
  providerStatus: string;
  providerSubStatus: string | null;
  normalizedStatus: AmeexShipment['normalizedStatus'];
  message: string | null;
  actor: string | null;
  eventAt: Date;
  rawPayload?: Prisma.JsonValue | null;
}) {
  const raw = record(value.rawPayload);
  return {
    id: value.id,
    eventType: value.eventType,
    providerStatus: value.providerStatus,
    providerSubStatus: value.providerSubStatus,
    normalizedStatus: value.normalizedStatus,
    statusName: text(raw ? first(raw, 'STATUT_NAME', 'STATUS_NAME') : null),
    statusColor: text(raw ? first(raw, 'STATUT_COLOR', 'STATUS_COLOR') : null),
    providerSubStatusName: text(
      raw ? first(raw, 'STATUT_S_NAME', 'STATUS_S_NAME') : null,
    ),
    providerSubStatusColor: text(
      raw ? first(raw, 'STATUT_S_COLOR', 'STATUS_S_COLOR') : null,
    ),
    message: value.message,
    actor: value.actor,
    proofImageUrl: text(
      raw ? first(raw, 'PROOF_IMAGE', 'IMAGE', 'PHOTO') : null,
    ),
    eventAt: value.eventAt.toISOString(),
  };
}

function trackingRecords(value: unknown): ProviderRecord[] {
  const found: ProviderRecord[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    const item = record(candidate);
    if (!item) return;
    if (first(item, 'STATUT', 'STATUS')) found.push(item);
    else Object.values(item).forEach(visit);
  };
  visit(value);
  return found;
}

function parcelRecords(value: unknown): ProviderRecord[] {
  const found: ProviderRecord[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const item = record(candidate);
    if (!item) return;
    if (parcelCode(item)) {
      found.push(item);
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(value);
  return found;
}

function parcelCode(value: ProviderRecord) {
  return text(
    first(
      value,
      'CODE',
      'PARCEL_CODE',
      'PARCELCODE',
      'TRACKING_NUMBER',
      'TRACKING-NUMBER',
    ),
  );
}

function providerListTotal(value: unknown): number | null {
  const item = record(value);
  if (!item) return null;
  const direct = integer(
    first(item, 'recordsTotal', 'recordsFiltered', 'TOTAL_RECORDS'),
  );
  if (direct !== null) return direct;
  for (const nested of Object.values(item)) {
    const found = providerListTotal(nested);
    if (found !== null) return found;
  }
  return null;
}

function massTrackingResponses(value: unknown, codes: string[]) {
  const wanted = new Map(codes.map((code) => [code.toUpperCase(), code]));
  const found = new Map<string, unknown>();
  const visit = (candidate: unknown, parentKey?: string) => {
    if (parentKey) {
      const requestedCode = wanted.get(parentKey.toUpperCase());
      if (requestedCode && !found.has(requestedCode)) {
        found.set(requestedCode, candidate);
      }
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((nested) => visit(nested));
      return;
    }
    const item = record(candidate);
    if (!item) return;
    const code = parcelCode(item);
    if (code) {
      const requestedCode = wanted.get(code.toUpperCase());
      if (requestedCode && !found.has(requestedCode)) {
        found.set(requestedCode, item);
      }
    }
    Object.entries(item).forEach(([key, nested]) => visit(nested, key));
  };
  visit(value);
  return found;
}

function findParcelRecord(value: unknown): ProviderRecord | null {
  const item = record(value);
  if (!item) return null;
  if (
    first(item, 'CODE', 'PARCEL_CODE', 'TRACKING_NUMBER', 'TRACKING-NUMBER')
  ) {
    return item;
  }
  for (const nested of Object.values(item)) {
    const found = findParcelRecord(nested);
    if (found) return found;
  }
  return null;
}

function findString(value: unknown, keys: string[]): string | null {
  const item = record(value);
  if (!item) return null;
  const direct = text(first(item, ...keys));
  if (direct) return direct;
  for (const nested of Object.values(item)) {
    const found = findString(nested, keys);
    if (found) return found;
  }
  return null;
}

function eventDate(value: ProviderRecord) {
  return (
    providerDate(
      first(value, 'DATE_TIME', 'DATETIME', 'TIME_STR', 'DATE', 'TIME'),
    ) ?? new Date()
  );
}

function providerDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const numeric = Number(raw);
  const parsed = /^\d{10,13}$/.test(raw)
    ? new Date(numeric * (raw.length === 10 ? 1000 : 1))
    : new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function record(value: unknown): ProviderRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null;
}

function first(value: ProviderRecord, ...keys: string[]) {
  for (const key of keys) {
    if (value[key] !== undefined) return value[key];
    const actualKey = Object.keys(value).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (actualKey && value[actualKey] !== undefined) return value[actualKey];
  }
  return undefined;
}

function text(value: unknown) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function decimal(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    return null;
  }
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function malformed(part: string) {
  return new BadGatewayException(`Ameex returned malformed ${part}`);
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}
