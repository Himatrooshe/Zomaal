import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  SenditConnectionService,
  type SenditCredentials,
} from './sendit-connection.service';
import type { SenditDeliveryDto } from './dto/sendit-delivery.dto';
import type { SenditShipmentQueryDto } from './dto/sendit-shipment-query.dto';
import { normalizeSenditStatus } from './sendit-status';

type SenditDeliveryRecord = Record<string, unknown>;

export type SenditProviderPageResult = {
  currentPage: number;
  lastPage: number;
  providerTotal: number | null;
  hasMore: boolean;
  processed: number;
  imported: number;
  reconciled: number;
};

@Injectable()
export class SenditShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senditConnection: SenditConnectionService,
  ) {}

  async persistCreatedDelivery(
    userId: string,
    request: SenditDeliveryDto,
    providerResponse: unknown,
  ) {
    const delivery = deliveryRecord(providerResponse);
    const providerCode = requiredString(delivery.code, 'code');
    const providerStatus = optionalString(delivery.status) ?? 'PENDING';
    const providerReturnStatus = optionalString(delivery.status_return);
    const normalizedStatus = normalizeSenditStatus(
      providerStatus,
      providerReturnStatus,
    );
    const eventAt = providerDate(delivery.last_action_at) ?? new Date();
    const district = record(delivery.district);
    const reference = optionalString(delivery.reference) ?? request.reference;

    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.senditConnection.findUnique({
        where: { userId },
        select: { id: true },
      });
      const dispatch = reference
        ? await tx.ecommerceOrderDispatch.findFirst({
            where: {
              provider: 'SENDIT',
              merchantTracking: reference,
              order: { connection: { store: { userId } } },
            },
            select: { id: true },
          })
        : null;

      const shipment = await tx.senditShipment.upsert({
        where: { userId_providerCode: { userId, providerCode } },
        create: {
          userId,
          connectionId: connection?.id,
          dispatchId: dispatch?.id,
          providerCode,
          providerStatus,
          providerReturnStatus,
          normalizedStatus,
          reference,
          recipientName: optionalString(delivery.name) ?? request.name,
          recipientPhone: optionalString(delivery.phone) ?? request.phone,
          address: optionalString(delivery.address) ?? request.address,
          city:
            optionalString(district?.ville) ?? optionalString(district?.name),
          pickupDistrictId:
            optionalInteger(delivery.pickup_district_id) ??
            request.pickup_district_id,
          destinationDistrictId:
            optionalInteger(district?.id) ??
            optionalInteger(delivery.district_id) ??
            request.district_id,
          codAmount: decimal(delivery.amount, request.amount),
          fee: optionalDecimal(delivery.fee),
          lastActionAt: providerDate(delivery.last_action_at),
          providerCreatedAt: providerDate(delivery.created_at),
          providerUpdatedAt: providerDate(delivery.updated_at),
        },
        update: {
          connectionId: connection?.id,
          dispatchId: dispatch?.id,
          providerStatus,
          providerReturnStatus,
          normalizedStatus,
          reference,
          recipientName: optionalString(delivery.name) ?? request.name,
          recipientPhone: optionalString(delivery.phone) ?? request.phone,
          address: optionalString(delivery.address) ?? request.address,
          city:
            optionalString(district?.ville) ?? optionalString(district?.name),
          pickupDistrictId:
            optionalInteger(delivery.pickup_district_id) ??
            request.pickup_district_id,
          destinationDistrictId:
            optionalInteger(district?.id) ??
            optionalInteger(delivery.district_id) ??
            request.district_id,
          codAmount: decimal(delivery.amount, request.amount),
          fee: optionalDecimal(delivery.fee),
          lastActionAt: providerDate(delivery.last_action_at),
          providerCreatedAt: providerDate(delivery.created_at),
          providerUpdatedAt: providerDate(delivery.updated_at),
        },
      });

      await tx.senditTrackingEvent.upsert({
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
          eventAt,
          actor: 'Sendit',
          rawPayload: jsonValue(providerResponse),
        },
        update: {
          normalizedStatus,
          eventAt,
          rawPayload: jsonValue(providerResponse),
        },
      });

      return shipment;
    });
  }

  async getByProviderCode(userId: string, providerCode: string) {
    const shipment = await this.prisma.senditShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      include: { events: { orderBy: { eventAt: 'desc' } } },
    });
    if (!shipment) {
      throw new NotFoundException('Stored Sendit shipment was not found');
    }

    return {
      id: shipment.id,
      provider: 'sendit' as const,
      providerCode: shipment.providerCode,
      providerStatus: shipment.providerStatus,
      providerReturnStatus: shipment.providerReturnStatus,
      normalizedStatus: shipment.normalizedStatus,
      reference: shipment.reference,
      recipientName: shipment.recipientName,
      recipientPhone: shipment.recipientPhone,
      address: shipment.address,
      city: shipment.city,
      pickupDistrictId: shipment.pickupDistrictId,
      destinationDistrictId: shipment.destinationDistrictId,
      codAmount: shipment.codAmount.toFixed(4),
      fee: shipment.fee?.toFixed(4) ?? null,
      currency: shipment.currency,
      lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
      events: shipment.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        providerStatus: event.providerStatus,
        normalizedStatus: event.normalizedStatus,
        message: event.message,
        proofImageUrl: event.proofImageUrl,
        deliverBy: event.deliverBy?.toISOString() ?? null,
        unreachableCount: event.unreachableCount,
        actor: event.actor,
        eventAt: event.eventAt.toISOString(),
      })),
    };
  }

  async list(userId: string, query: SenditShipmentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.SenditShipmentWhereInput = {
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
      this.prisma.senditShipment.count({ where }),
      this.prisma.senditShipment.findMany({
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
      data: shipments.map((shipment) => ({
        id: shipment.id,
        provider: 'sendit' as const,
        providerCode: shipment.providerCode,
        providerStatus: shipment.providerStatus,
        normalizedStatus: shipment.normalizedStatus,
        reference: shipment.reference,
        recipientName: shipment.recipientName,
        recipientPhone: shipment.recipientPhone,
        address: shipment.address,
        city: shipment.city,
        codAmount: shipment.codAmount.toFixed(4),
        fee: shipment.fee?.toFixed(4) ?? null,
        currency: shipment.currency,
        lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
        providerCreatedAt: shipment.providerCreatedAt?.toISOString() ?? null,
        providerUpdatedAt: shipment.providerUpdatedAt?.toISOString() ?? null,
        createdAt: shipment.createdAt.toISOString(),
        updatedAt: shipment.updatedAt.toISOString(),
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTimeline(userId: string, providerCode: string) {
    const shipment = await this.prisma.senditShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      select: {
        providerCode: true,
        providerStatus: true,
        providerReturnStatus: true,
        normalizedStatus: true,
        lastActionAt: true,
        events: { orderBy: { eventAt: 'desc' } },
      },
    });
    if (!shipment) {
      throw new NotFoundException('Stored Sendit shipment was not found');
    }

    return {
      providerCode: shipment.providerCode,
      providerStatus: shipment.providerStatus,
      providerReturnStatus: shipment.providerReturnStatus,
      normalizedStatus: shipment.normalizedStatus,
      lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
      events: shipment.events.map(trackingEventResponse),
    };
  }

  async reconcileProviderPage(
    userId: string,
    providerResponse: unknown,
  ): Promise<SenditProviderPageResult> {
    const page = providerDeliveryPage(providerResponse);
    const deliveries = page.data.map(providerDeliverySnapshot);

    const counts = await this.prisma.$transaction(async (tx) => {
      const connection = await tx.senditConnection.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!connection) {
        throw new NotFoundException('Connected Sendit account was not found');
      }

      const codes = deliveries.map((delivery) => delivery.providerCode);
      const existing = await tx.senditShipment.findMany({
        where: { userId, providerCode: { in: codes } },
      });
      const existingByCode = new Map(
        existing.map((shipment) => [shipment.providerCode, shipment]),
      );
      const references = deliveries
        .map((delivery) => delivery.reference)
        .filter((reference): reference is string => Boolean(reference));
      const referenceCounts = new Map<string, number>();
      for (const reference of references) {
        referenceCounts.set(
          reference,
          (referenceCounts.get(reference) ?? 0) + 1,
        );
      }
      const dispatches = references.length
        ? await tx.ecommerceOrderDispatch.findMany({
            where: {
              provider: 'SENDIT',
              merchantTracking: { in: references },
              order: { connection: { store: { userId } } },
            },
            select: {
              id: true,
              merchantTracking: true,
              senditShipment: { select: { providerCode: true } },
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
        const normalizedStatus = normalizeSenditStatus(
          delivery.providerStatus,
          delivery.providerReturnStatus,
        );
        const dispatch = delivery.reference
          ? dispatchByReference.get(delivery.reference)
          : undefined;
        const dispatchId =
          delivery.reference &&
          referenceCounts.get(delivery.reference) === 1 &&
          (!dispatch?.senditShipment ||
            dispatch.senditShipment.providerCode === delivery.providerCode)
            ? dispatch?.id
            : undefined;
        const shouldRefresh =
          !current ||
          !current.lastActionAt ||
          (delivery.lastActionAt !== null &&
            delivery.lastActionAt >= current.lastActionAt);

        let shipmentId: string;
        if (!current) {
          const created = await tx.senditShipment.create({
            data: {
              userId,
              connectionId: connection.id,
              dispatchId,
              providerCode: delivery.providerCode,
              providerStatus: delivery.providerStatus,
              providerReturnStatus: delivery.providerReturnStatus,
              normalizedStatus,
              reference: delivery.reference,
              recipientName: delivery.recipientName,
              recipientPhone: delivery.recipientPhone,
              address: delivery.address ?? '',
              city: delivery.city,
              pickupDistrictId: delivery.pickupDistrictId,
              destinationDistrictId: delivery.destinationDistrictId,
              codAmount: delivery.codAmount,
              fee: delivery.fee,
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
          if (shouldRefresh) {
            await tx.senditShipment.update({
              where: { id: current.id },
              data: {
                connectionId: connection.id,
                ...(dispatchId ? { dispatchId } : {}),
                providerStatus: delivery.providerStatus,
                providerReturnStatus: delivery.providerReturnStatus,
                normalizedStatus,
                reference: delivery.reference ?? current.reference,
                recipientName: delivery.recipientName,
                recipientPhone: delivery.recipientPhone,
                ...(delivery.address ? { address: delivery.address } : {}),
                city: delivery.city ?? current.city,
                pickupDistrictId:
                  delivery.pickupDistrictId ?? current.pickupDistrictId,
                destinationDistrictId:
                  delivery.destinationDistrictId ??
                  current.destinationDistrictId,
                codAmount: delivery.codAmount,
                ...(delivery.fee ? { fee: delivery.fee } : {}),
                lastActionAt: delivery.lastActionAt ?? current.lastActionAt,
                providerCreatedAt:
                  delivery.providerCreatedAt ?? current.providerCreatedAt,
                providerUpdatedAt:
                  delivery.providerUpdatedAt ?? current.providerUpdatedAt,
              },
            });
          }
        }

        const statusChanged =
          !current ||
          current.providerStatus !== delivery.providerStatus ||
          current.providerReturnStatus !== delivery.providerReturnStatus;
        if (statusChanged && (!current || shouldRefresh)) {
          const eventAt =
            delivery.lastActionAt ??
            delivery.providerUpdatedAt ??
            delivery.providerCreatedAt ??
            new Date();
          const eventType = current
            ? 'delivery.status.reconciled'
            : 'delivery.imported';
          const providerEventKey = syncEventKey(
            delivery.providerCode,
            delivery.providerStatus,
            delivery.providerReturnStatus,
            eventAt,
          );
          await tx.senditTrackingEvent.upsert({
            where: {
              shipmentId_providerEventKey: { shipmentId, providerEventKey },
            },
            create: {
              shipmentId,
              providerEventKey,
              eventType,
              providerStatus: delivery.providerStatus,
              normalizedStatus,
              actor: 'Sendit sync',
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

      return { imported, reconciled };
    });

    return {
      currentPage: page.currentPage,
      lastPage: page.lastPage,
      providerTotal: page.providerTotal,
      hasMore: page.hasMore,
      processed: deliveries.length,
      ...counts,
    };
  }

  async processStatusWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: unknown,
    rawBody?: Buffer,
  ) {
    const signature = headerValue(headers, 'x-sendit-signature');
    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing Sendit webhook signature');
    }

    const event = parseStatusWebhook(payload);
    const shipment = await this.prisma.senditShipment.findFirst({
      where: { providerCode: event.code },
      select: { id: true, userId: true, lastActionAt: true },
    });

    if (!shipment) {
      throw new NotFoundException('Tracked Sendit shipment was not found');
    }

    let credentials: SenditCredentials;
    try {
      credentials = await this.senditConnection.getCredentials(shipment.userId);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new UnauthorizedException('Invalid Sendit webhook signature');
      }
      throw error;
    }
    verifySignature(signature, rawBody, credentials.secretKey);

    const normalizedStatus = normalizeSenditStatus(event.newStatus);
    const eventAt = senditWebhookDate(event.lastActionAt, 'lastActionAt');
    const deliverBy = event.deliverBy
      ? senditWebhookDate(event.deliverBy, 'deliverBy')
      : null;
    const providerEventKey = webhookEventKey(event);

    await this.prisma.$transaction(async (tx) => {
      await tx.senditShipment.updateMany({
        where: {
          id: shipment.id,
          OR: [{ lastActionAt: null }, { lastActionAt: { lte: eventAt } }],
        },
        data: {
          providerStatus: event.newStatus,
          normalizedStatus,
          lastActionAt: eventAt,
          providerUpdatedAt: eventAt,
        },
      });

      await tx.senditTrackingEvent.upsert({
        where: {
          shipmentId_providerEventKey: {
            shipmentId: shipment.id,
            providerEventKey,
          },
        },
        create: {
          shipmentId: shipment.id,
          providerEventKey,
          eventType: event.event,
          providerStatus: event.newStatus,
          normalizedStatus,
          message: event.message,
          proofImageUrl: event.proofImage,
          deliverBy,
          unreachableCount: event.counterUnreachable,
          actor: 'Sendit',
          eventAt,
          rawPayload: jsonValue(payload),
        },
        update: {
          normalizedStatus,
          message: event.message,
          proofImageUrl: event.proofImage,
          deliverBy,
          unreachableCount: event.counterUnreachable,
          rawPayload: jsonValue(payload),
        },
      });
    });

    return {
      success: true,
      message: 'Sendit webhook received',
    };
  }
}

type SenditStatusWebhook = {
  event: 'delivery.status.update';
  code: string;
  oldStatus: string | null;
  newStatus: string;
  lastActionAt: string;
  message: string | null;
  proofImage: string | null;
  deliverBy: string | null;
  counterUnreachable: number | null;
};

function parseStatusWebhook(value: unknown): SenditStatusWebhook {
  const payload = record(value);
  if (!payload) {
    throw new BadRequestException('Sendit webhook body must be a JSON object');
  }

  const event = requiredWebhookString(payload.event, 'event');
  if (event !== 'delivery.status.update') {
    throw new BadRequestException(`Unsupported Sendit webhook event: ${event}`);
  }

  const counter = payload.counterUnreachable;
  if (
    counter !== undefined &&
    counter !== null &&
    (!Number.isSafeInteger(Number(counter)) || Number(counter) < 0)
  ) {
    throw new BadRequestException(
      'Sendit webhook counterUnreachable must be a non-negative integer',
    );
  }

  return {
    event,
    code: requiredWebhookString(payload.code, 'code'),
    oldStatus: optionalString(payload.oldStatus),
    newStatus: requiredWebhookString(payload.newStatus, 'newStatus'),
    lastActionAt: requiredWebhookString(payload.lastActionAt, 'lastActionAt'),
    message: optionalString(payload.message),
    proofImage: optionalString(payload.proofImage),
    deliverBy: optionalString(payload.deliverBy),
    counterUnreachable:
      counter === undefined || counter === null ? null : Number(counter),
  };
}

function requiredWebhookString(value: unknown, field: string): string {
  const parsed = optionalString(value);
  if (!parsed) {
    throw new BadRequestException(`Sendit webhook ${field} is required`);
  }
  return parsed;
}

function senditWebhookDate(value: string, field: string): Date {
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Sendit webhook ${field} is invalid`);
  }
  return parsed;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  )?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

function verifySignature(signature: string, rawBody: Buffer, secret: string) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const supplied = signature
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase();
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    throw new UnauthorizedException('Invalid Sendit webhook signature');
  }
}

function webhookEventKey(event: SenditStatusWebhook): string {
  return createHash('sha256')
    .update(
      [
        event.event,
        event.code,
        event.newStatus,
        event.lastActionAt,
        event.deliverBy ?? '',
        event.counterUnreachable?.toString() ?? '',
      ].join('\u0000'),
    )
    .digest('hex');
}

function deliveryRecord(value: unknown): SenditDeliveryRecord {
  const outer = record(value);
  const data = record(outer?.data);
  if (!data) {
    throw new BadGatewayException(
      'Sendit accepted the delivery but returned invalid shipment data',
    );
  }
  return data;
}

function providerDeliveryPage(value: unknown) {
  const body = record(value);
  if (!body || body.success === false || !Array.isArray(body.data)) {
    throw new BadGatewayException(
      'Sendit returned an invalid delivery collection',
    );
  }
  const pagination = record(body.pagination);
  const currentPage =
    positiveInteger(body.current_page) ??
    positiveInteger(pagination?.current_page) ??
    1;
  const lastPage =
    positiveInteger(body.last_page) ??
    positiveInteger(pagination?.last_page) ??
    currentPage;
  const providerTotal =
    nonNegativeInteger(body.total) ??
    nonNegativeInteger(pagination?.total) ??
    null;
  const nextPageUrl = body.next_page_url ?? pagination?.next_page_url;

  return {
    data: body.data,
    currentPage,
    lastPage,
    providerTotal,
    hasMore: currentPage < lastPage || optionalString(nextPageUrl) !== null,
  };
}

function providerDeliverySnapshot(value: unknown) {
  const delivery = record(value);
  if (!delivery) {
    throw new BadGatewayException('Sendit returned an invalid delivery');
  }
  const district = record(delivery.district);
  const providerCode = requiredString(delivery.code, 'code');
  const recipientName = requiredString(delivery.name, 'name');
  const recipientPhone = requiredString(delivery.phone, 'phone');
  const providerStatus = optionalString(delivery.status) ?? 'PENDING';
  const providerReturnStatus = optionalString(delivery.status_return);

  return {
    raw: delivery,
    providerCode,
    providerStatus,
    providerReturnStatus,
    reference: optionalString(delivery.reference),
    recipientName,
    recipientPhone,
    address: optionalString(delivery.address),
    city: optionalString(district?.ville) ?? optionalString(district?.name),
    pickupDistrictId: optionalInteger(delivery.pickup_district_id),
    destinationDistrictId:
      optionalInteger(district?.id) ?? optionalInteger(delivery.district_id),
    codAmount: decimal(delivery.amount, 0),
    fee: optionalDecimal(delivery.fee),
    lastActionAt: providerDate(delivery.last_action_at),
    providerCreatedAt: providerDate(delivery.created_at),
    providerUpdatedAt: providerDate(delivery.updated_at),
  };
}

function syncEventKey(
  providerCode: string,
  providerStatus: string,
  providerReturnStatus: string | null,
  eventAt: Date,
) {
  return createHash('sha256')
    .update(
      [
        'sync',
        providerCode,
        providerStatus,
        providerReturnStatus ?? '',
        eventAt.toISOString(),
      ].join('\u0000'),
    )
    .digest('hex');
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function trackingEventResponse(event: {
  id: string;
  eventType: string;
  providerStatus: string;
  normalizedStatus: import('@prisma/client').ShippingShipmentStatus;
  message: string | null;
  proofImageUrl: string | null;
  deliverBy: Date | null;
  unreachableCount: number | null;
  actor: string | null;
  eventAt: Date;
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    providerStatus: event.providerStatus,
    normalizedStatus: event.normalizedStatus,
    message: event.message,
    proofImageUrl: event.proofImageUrl,
    deliverBy: event.deliverBy?.toISOString() ?? null,
    unreachableCount: event.unreachableCount,
    actor: event.actor,
    eventAt: event.eventAt.toISOString(),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value);
  if (!parsed) {
    throw new BadGatewayException(
      `Sendit accepted the delivery but did not return ${field}`,
    );
  }
  return parsed;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function decimal(value: unknown, fallback: number): Prisma.Decimal {
  return optionalDecimal(value) ?? new Prisma.Decimal(fallback);
}

function optionalDecimal(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const parsed = new Prisma.Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function providerDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
