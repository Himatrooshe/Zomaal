import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type QuickLivraisonShipment } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { QuickLivraisonDeliveryDto } from './dto/quicklivraison-delivery.dto';
import type { QuickLivraisonShipmentQueryDto } from './dto/quicklivraison-shipment-query.dto';
import { normalizeQuickLivraisonStatus } from './quicklivraison-status';

type ProviderRecord = Record<string, unknown>;

@Injectable()
export class QuickLivraisonShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async persistCreatedDelivery(
    userId: string,
    request: QuickLivraisonDeliveryDto,
    providerResponse: unknown,
  ) {
    const response = record(providerResponse);
    const providerCode = requiredString(
      response?.tracking_number,
      'tracking_number',
    );

    return this.persistDeliveries(userId, [
      { request, providerCode, providerResponse },
    ]);
  }

  async persistBulkCreatedDeliveries(
    userId: string,
    requests: QuickLivraisonDeliveryDto[],
    providerResponse: unknown,
  ) {
    const response = record(providerResponse);
    const results = array(response?.parcels);
    const deliveries = results.flatMap((value, position) => {
      const result = record(value);
      const providerCode = optionalString(result?.tracking_number);
      if (!result || !providerCode || isFailedBulkItem(result)) {
        return [];
      }

      const request = resolveBulkRequest(result, position, requests);
      return request
        ? [{ request, providerCode, providerResponse: result }]
        : [];
    });

    if (deliveries.length === 0 && results.length > 0) {
      return Promise.resolve([]);
    }
    if (deliveries.length === 0) {
      throw malformedResponse('parcels');
    }

    return this.persistDeliveries(userId, deliveries);
  }

  async getByProviderCode(userId: string, providerCode: string) {
    const shipment = await this.prisma.quickLivraisonShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      include: { events: { orderBy: { eventAt: 'desc' } } },
    });
    if (!shipment) {
      throw new NotFoundException(
        'Stored QuickLivraison shipment was not found',
      );
    }

    return {
      id: shipment.id,
      provider: 'quicklivraison' as const,
      providerCode: shipment.providerCode,
      providerStatus: shipment.providerStatus,
      providerSecondaryStatus: shipment.providerSecondaryStatus,
      situation: shipment.situation,
      normalizedStatus: shipment.normalizedStatus,
      reference: shipment.reference,
      recipientName: shipment.recipientName,
      recipientPhone: shipment.recipientPhone,
      address: shipment.address,
      city: shipment.city,
      destinationDistrictId: shipment.destinationDistrictId,
      codAmount: shipment.codAmount?.toFixed(4) ?? null,
      fee: shipment.fee?.toFixed(4) ?? null,
      currency: shipment.currency,
      storeName: shipment.storeName,
      lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
      providerCreatedAt: shipment.providerCreatedAt?.toISOString() ?? null,
      providerUpdatedAt: shipment.providerUpdatedAt?.toISOString() ?? null,
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
      events: shipment.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        providerStatus: event.providerStatus,
        providerSecondaryStatus: event.providerSecondaryStatus,
        normalizedStatus: event.normalizedStatus,
        message: event.message,
        actor: event.actor,
        eventAt: event.eventAt.toISOString(),
      })),
    };
  }

  async list(userId: string, query: QuickLivraisonShipmentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.QuickLivraisonShipmentWhereInput = {
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
      this.prisma.quickLivraisonShipment.count({ where }),
      this.prisma.quickLivraisonShipment.findMany({
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

  async getTimeline(userId: string, providerCode: string) {
    const shipment = await this.prisma.quickLivraisonShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      select: {
        providerCode: true,
        providerStatus: true,
        providerSecondaryStatus: true,
        situation: true,
        normalizedStatus: true,
        lastActionAt: true,
        events: { orderBy: { eventAt: 'desc' } },
      },
    });
    if (!shipment) {
      throw new NotFoundException(
        'Stored QuickLivraison shipment was not found',
      );
    }

    return {
      providerCode: shipment.providerCode,
      providerStatus: shipment.providerStatus,
      providerSecondaryStatus: shipment.providerSecondaryStatus,
      situation: shipment.situation,
      normalizedStatus: shipment.normalizedStatus,
      lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
      events: shipment.events.map(trackingEventResponse),
    };
  }

  async reconcileProviderDeliveries(userId: string, providerResponse: unknown) {
    const deliveries = providerDeliveryList(providerResponse).map(
      providerDeliverySnapshot,
    );

    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.quickLivraisonConnection.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!connection) {
        throw new NotFoundException(
          'Connected QuickLivraison account was not found',
        );
      }

      const existing = await tx.quickLivraisonShipment.findMany({
        where: {
          userId,
          providerCode: { in: deliveries.map((item) => item.providerCode) },
        },
      });
      const existingByCode = new Map(
        existing.map((shipment) => [shipment.providerCode, shipment]),
      );
      const references = deliveries
        .map((delivery) => delivery.reference)
        .filter((reference): reference is string => Boolean(reference));
      const dispatches = references.length
        ? await tx.ecommerceOrderDispatch.findMany({
            where: {
              provider: 'QUICKLIVRAISON',
              merchantTracking: { in: references },
              order: { connection: { store: { userId } } },
            },
            select: {
              id: true,
              merchantTracking: true,
              quickLivraisonShipment: { select: { providerCode: true } },
            },
          })
        : [];
      const dispatchByReference = new Map(
        dispatches.map((dispatch) => [dispatch.merchantTracking, dispatch]),
      );
      let imported = 0;
      let reconciled = 0;

      for (const delivery of deliveries) {
        const current = existingByCode.get(delivery.providerCode);
        const normalizedStatus = normalizeQuickLivraisonStatus(
          delivery.providerStatus,
          delivery.providerSecondaryStatus,
        );
        const dispatch = delivery.reference
          ? dispatchByReference.get(delivery.reference)
          : undefined;
        const dispatchId =
          !dispatch?.quickLivraisonShipment ||
          dispatch.quickLivraisonShipment.providerCode === delivery.providerCode
            ? dispatch?.id
            : undefined;
        let shipmentId: string;

        if (!current) {
          const created = await tx.quickLivraisonShipment.create({
            data: {
              userId,
              connectionId: connection.id,
              dispatchId,
              providerCode: delivery.providerCode,
              providerStatus: delivery.providerStatus,
              providerSecondaryStatus: delivery.providerSecondaryStatus,
              situation: delivery.situation,
              normalizedStatus,
              reference: delivery.reference,
              recipientName: delivery.recipientName,
              recipientPhone: delivery.recipientPhone,
              address: delivery.address,
              city: delivery.city,
              destinationDistrictId: delivery.destinationDistrictId,
              codAmount: delivery.codAmount,
              fee: delivery.fee,
              storeName: delivery.storeName,
              lastActionAt: delivery.lastActionAt,
              providerCreatedAt: delivery.providerCreatedAt,
              providerUpdatedAt: delivery.providerUpdatedAt,
            },
            select: { id: true },
          });
          shipmentId = created.id;
          imported += 1;
        } else {
          shipmentId = current.id;
          reconciled += 1;
          await tx.quickLivraisonShipment.update({
            where: { id: current.id },
            data: {
              connectionId: connection.id,
              ...(dispatchId ? { dispatchId } : {}),
              providerStatus: delivery.providerStatus,
              providerSecondaryStatus: delivery.providerSecondaryStatus,
              situation: delivery.situation ?? current.situation,
              normalizedStatus,
              reference: delivery.reference ?? current.reference,
              recipientName: delivery.recipientName ?? current.recipientName,
              recipientPhone: delivery.recipientPhone ?? current.recipientPhone,
              address: delivery.address ?? current.address,
              city: delivery.city ?? current.city,
              destinationDistrictId:
                delivery.destinationDistrictId ?? current.destinationDistrictId,
              codAmount: delivery.codAmount ?? current.codAmount,
              fee: delivery.fee ?? current.fee,
              storeName: delivery.storeName ?? current.storeName,
              lastActionAt: delivery.lastActionAt ?? current.lastActionAt,
              providerCreatedAt:
                delivery.providerCreatedAt ?? current.providerCreatedAt,
              providerUpdatedAt:
                delivery.providerUpdatedAt ?? current.providerUpdatedAt,
            },
          });
        }

        const statusChanged =
          !current ||
          current.providerStatus !== delivery.providerStatus ||
          current.providerSecondaryStatus !== delivery.providerSecondaryStatus;
        if (statusChanged) {
          const eventAt =
            delivery.lastActionAt ??
            delivery.providerUpdatedAt ??
            delivery.providerCreatedAt ??
            new Date();
          const providerEventKey = [
            'sync',
            delivery.providerCode,
            delivery.providerStatus,
            delivery.providerSecondaryStatus ?? '',
          ].join(':');
          await tx.quickLivraisonTrackingEvent.upsert({
            where: {
              shipmentId_providerEventKey: { shipmentId, providerEventKey },
            },
            create: {
              shipmentId,
              providerEventKey,
              eventType: current
                ? 'delivery.status.reconciled'
                : 'delivery.imported',
              providerStatus: delivery.providerStatus,
              providerSecondaryStatus: delivery.providerSecondaryStatus,
              normalizedStatus,
              actor: 'QuickLivraison sync',
              eventAt,
              rawPayload: jsonValue(delivery.raw),
            },
            update: {
              normalizedStatus,
              rawPayload: jsonValue(delivery.raw),
            },
          });
        }
      }

      return {
        processed: deliveries.length,
        imported,
        reconciled,
      };
    });
  }

  async processStatusWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: unknown,
    rawBody?: Buffer,
  ) {
    this.verifyWebhookSignature(headers, rawBody);
    const event = parseStatusWebhook(payload);
    const shipment = await this.prisma.quickLivraisonShipment.findFirst({
      where: { providerCode: event.providerCode },
      select: { id: true, lastActionAt: true },
    });
    if (!shipment) {
      throw new NotFoundException(
        'Tracked QuickLivraison shipment was not found',
      );
    }

    const normalizedStatus = normalizeQuickLivraisonStatus(
      event.providerStatus,
      event.providerSecondaryStatus,
    );
    const providerEventKey = [
      'webhook',
      event.providerCode,
      event.providerStatus,
      event.providerSecondaryStatus ?? '',
      event.eventAt.toISOString(),
    ].join(':');

    await this.prisma.$transaction(async (tx) => {
      await tx.quickLivraisonShipment.updateMany({
        where: {
          id: shipment.id,
          OR: [
            { lastActionAt: null },
            { lastActionAt: { lte: event.eventAt } },
          ],
        },
        data: {
          providerStatus: event.providerStatus,
          providerSecondaryStatus: event.providerSecondaryStatus,
          ...(event.situation ? { situation: event.situation } : {}),
          normalizedStatus,
          ...(event.recipientName
            ? { recipientName: event.recipientName }
            : {}),
          ...(event.recipientPhone
            ? { recipientPhone: event.recipientPhone }
            : {}),
          ...(event.address ? { address: event.address } : {}),
          ...(event.city ? { city: event.city } : {}),
          ...(event.codAmount ? { codAmount: event.codAmount } : {}),
          ...(event.storeName ? { storeName: event.storeName } : {}),
          lastActionAt: event.eventAt,
          providerUpdatedAt: event.eventAt,
        },
      });
      await tx.quickLivraisonTrackingEvent.upsert({
        where: {
          shipmentId_providerEventKey: {
            shipmentId: shipment.id,
            providerEventKey,
          },
        },
        create: {
          shipmentId: shipment.id,
          providerEventKey,
          eventType: 'status_changed',
          providerStatus: event.providerStatus,
          providerSecondaryStatus: event.providerSecondaryStatus,
          normalizedStatus,
          message: event.message,
          actor: 'QuickLivraison',
          eventAt: event.eventAt,
          rawPayload: jsonValue(payload),
        },
        update: {
          normalizedStatus,
          message: event.message,
          rawPayload: jsonValue(payload),
        },
      });
    });

    return { success: true, message: 'QuickLivraison webhook received' };
  }

  private verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody?: Buffer,
  ) {
    const secret = this.configService.get<string>(
      'QUICKLIVRAISON_WEBHOOK_SECRET',
    );
    if (!secret) {
      throw new ServiceUnavailableException(
        'QuickLivraison webhook secret is not configured',
      );
    }
    const signature = headerValue(headers, 'x-webhook-signature');
    if (!signature || !rawBody) {
      throw new UnauthorizedException(
        'Missing QuickLivraison webhook signature',
      );
    }
    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      throw new UnauthorizedException(
        'Invalid QuickLivraison webhook signature',
      );
    }
  }

  private persistDeliveries(
    userId: string,
    deliveries: Array<{
      request: QuickLivraisonDeliveryDto;
      providerCode: string;
      providerResponse: unknown;
    }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.quickLivraisonConnection.findUnique({
        where: { userId },
        select: { id: true },
      });
      const references = deliveries
        .map(({ request }) => request.code)
        .filter((value): value is string => Boolean(value));
      const dispatches = references.length
        ? await tx.ecommerceOrderDispatch.findMany({
            where: {
              provider: 'QUICKLIVRAISON',
              merchantTracking: { in: references },
              order: { connection: { store: { userId } } },
            },
            select: { id: true, merchantTracking: true },
          })
        : [];
      const dispatchByReference = new Map(
        dispatches.map((dispatch) => [dispatch.merchantTracking, dispatch.id]),
      );

      const stored: QuickLivraisonShipment[] = [];
      for (const delivery of deliveries) {
        const providerStatus = 'NEW_PARCEL';
        const normalizedStatus = normalizeQuickLivraisonStatus(providerStatus);
        const eventAt = new Date();
        const dispatchId = delivery.request.code
          ? dispatchByReference.get(delivery.request.code)
          : undefined;
        const data = {
          connectionId: connection?.id,
          ...(dispatchId ? { dispatchId } : {}),
          providerStatus,
          providerSecondaryStatus: null,
          situation: null,
          normalizedStatus,
          reference: delivery.request.code,
          recipientName: delivery.request.name,
          recipientPhone: delivery.request.phone,
          address: delivery.request.address,
          destinationDistrictId: delivery.request.district_id,
          codAmount: new Prisma.Decimal(delivery.request.amount),
          storeName: delivery.request.store_name,
        };
        const shipment = await tx.quickLivraisonShipment.upsert({
          where: {
            userId_providerCode: {
              userId,
              providerCode: delivery.providerCode,
            },
          },
          create: {
            userId,
            providerCode: delivery.providerCode,
            ...data,
          },
          update: data,
        });

        await tx.quickLivraisonTrackingEvent.upsert({
          where: {
            shipmentId_providerEventKey: {
              shipmentId: shipment.id,
              providerEventKey: `created:${providerStatus}`,
            },
          },
          create: {
            shipmentId: shipment.id,
            providerEventKey: `created:${providerStatus}`,
            eventType: 'delivery.created',
            providerStatus,
            normalizedStatus,
            actor: 'QuickLivraison',
            eventAt,
            rawPayload: jsonValue(delivery.providerResponse),
          },
          update: {
            normalizedStatus,
            rawPayload: jsonValue(delivery.providerResponse),
          },
        });
        stored.push(shipment);
      }

      return stored;
    });
  }
}

function shipmentSummary(shipment: QuickLivraisonShipment) {
  return {
    id: shipment.id,
    provider: 'quicklivraison' as const,
    providerCode: shipment.providerCode,
    providerStatus: shipment.providerStatus,
    providerSecondaryStatus: shipment.providerSecondaryStatus,
    normalizedStatus: shipment.normalizedStatus,
    reference: shipment.reference,
    recipientName: shipment.recipientName,
    recipientPhone: shipment.recipientPhone,
    address: shipment.address,
    city: shipment.city,
    codAmount: shipment.codAmount?.toFixed(4) ?? null,
    fee: shipment.fee?.toFixed(4) ?? null,
    currency: shipment.currency,
    storeName: shipment.storeName,
    lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
    providerCreatedAt: shipment.providerCreatedAt?.toISOString() ?? null,
    providerUpdatedAt: shipment.providerUpdatedAt?.toISOString() ?? null,
    createdAt: shipment.createdAt.toISOString(),
    updatedAt: shipment.updatedAt.toISOString(),
  };
}

function trackingEventResponse(event: {
  id: string;
  eventType: string;
  providerStatus: string;
  providerSecondaryStatus: string | null;
  normalizedStatus: import('@prisma/client').ShippingShipmentStatus;
  message: string | null;
  actor: string | null;
  eventAt: Date;
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    providerStatus: event.providerStatus,
    providerSecondaryStatus: event.providerSecondaryStatus,
    normalizedStatus: event.normalizedStatus,
    message: event.message,
    actor: event.actor,
    eventAt: event.eventAt.toISOString(),
  };
}

function providerDeliveryList(value: unknown): ProviderRecord[] {
  const envelope = record(value);
  let values: unknown[];
  if (Array.isArray(value)) {
    values = value;
  } else if (Array.isArray(envelope?.data)) {
    values = envelope.data;
  } else if (Array.isArray(envelope?.parcels)) {
    values = envelope.parcels;
  } else {
    throw malformedResponse('delivery list');
  }
  return values.map((item) => {
    const parsed = record(item);
    if (!parsed) throw malformedResponse('delivery record');
    return parsed;
  });
}

function providerDeliverySnapshot(raw: ProviderRecord) {
  const providerCode = requiredString(
    raw.tracking_number ?? raw.trackingNumber,
    'tracking_number',
  );
  const providerStatus =
    optionalString(raw.status ?? raw.new_status_code) ?? 'UNKNOWN';
  return {
    providerCode,
    providerStatus,
    providerSecondaryStatus: optionalString(raw.status_second),
    situation: optionalString(raw.situation),
    reference: optionalString(raw.code ?? raw.reference),
    recipientName: optionalString(raw.name ?? raw.receiver_name),
    recipientPhone: optionalString(raw.phone ?? raw.receiver_phone),
    address: optionalString(raw.address ?? raw.receiver_address),
    city: cityName(raw.city ?? raw.district),
    destinationDistrictId: optionalInteger(
      raw.district_id ?? record(raw.district)?.id,
    ),
    codAmount: optionalDecimal(raw.amount ?? raw.price),
    fee: optionalDecimal(raw.fee ?? raw.delivery_fee),
    storeName: optionalString(raw.store_name),
    lastActionAt: providerDate(
      raw.date_derniere_modification ?? raw.updated_at,
    ),
    providerCreatedAt: providerDate(raw.date_creation ?? raw.created_at),
    providerUpdatedAt: providerDate(
      raw.date_derniere_modification ?? raw.updated_at,
    ),
    raw,
  };
}

function parseStatusWebhook(payload: unknown) {
  const root = record(payload);
  const data = record(root?.data);
  if (root?.event !== 'status_changed' || !data) {
    throw new BadRequestException(
      'Invalid QuickLivraison status_changed webhook payload',
    );
  }
  const providerStatus = requiredString(
    data.new_status_code ?? data.status,
    'data.status',
  );
  return {
    providerCode: requiredString(data.tracking_number, 'data.tracking_number'),
    providerStatus,
    providerSecondaryStatus: optionalString(data.status_second),
    situation: optionalString(data.situation),
    recipientName: optionalString(data.receiver_name),
    recipientPhone: optionalString(data.receiver_phone),
    address: optionalString(data.receiver_address),
    city: optionalString(data.city),
    codAmount: optionalDecimal(data.price),
    storeName: optionalString(data.store_name),
    message: optionalString(data.comment),
    eventAt: requiredDate(root.timestamp, 'timestamp'),
  };
}

function resolveBulkRequest(
  result: ProviderRecord,
  position: number,
  requests: QuickLivraisonDeliveryDto[],
) {
  const index = optionalInteger(result.index);
  if (index !== null && requests[index]) {
    return requests[index];
  }

  const code = optionalString(result.code);
  if (code) {
    return requests.find((request) => request.code === code);
  }

  return requests[position];
}

function isFailedBulkItem(result: ProviderRecord) {
  const status = optionalString(result.status)?.toLowerCase();
  return status === 'error' || status === 'failed' || status === 'failure';
}

function malformedResponse(field: string) {
  return new BadGatewayException({
    message: `QuickLivraison returned a malformed response without ${field}`,
  });
}

function requiredString(value: unknown, field: string) {
  const parsed = optionalString(value);
  if (!parsed) {
    throw malformedResponse(field);
  }
  return parsed;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function optionalDecimal(value: unknown): Prisma.Decimal | null {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    value === ''
  ) {
    return null;
  }
  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function cityName(value: unknown): string | null {
  if (typeof value === 'string') return optionalString(value);
  const item = record(value);
  return optionalString(item?.name ?? item?.ville ?? item?.city);
}

function providerDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}+01:00`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredDate(value: unknown, field: string): Date {
  const parsed = providerDate(value);
  if (!parsed) {
    throw new BadRequestException(`Invalid QuickLivraison webhook ${field}`);
  }
  return parsed;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

function record(value: unknown): ProviderRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
