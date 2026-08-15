import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { SenditConnectionService } from './sendit-connection.service';
import { SenditShipmentService } from './sendit-shipment.service';

describe('SenditShipmentService', () => {
  let shipmentUpsertArgs: unknown;
  let eventUpsertArgs: unknown;
  let shipmentFindUniqueArgs: unknown;
  let shipmentFindManyArgs: unknown;
  let shipmentCountArgs: unknown;
  let shipmentFindUniqueResult: unknown;
  let shipmentFindManyResult: unknown[];
  let shipmentCountResult: number;
  let txShipmentFindManyResult: unknown[];
  let shipmentCreateArgs: unknown;
  const shipmentUpsert = jest.fn((args: unknown) => {
    shipmentUpsertArgs = args;
    return Promise.resolve({ id: 'shipment-1' });
  });
  const eventUpsert = jest.fn((args: unknown) => {
    eventUpsertArgs = args;
    return Promise.resolve({ id: 'event-1' });
  });
  const connectionFindUnique = jest.fn();
  const dispatchFindFirst = jest.fn();
  const shipmentFindFirst = jest.fn();
  const shipmentFindUnique = jest.fn((args: unknown) => {
    shipmentFindUniqueArgs = args;
    return Promise.resolve(shipmentFindUniqueResult);
  });
  const shipmentFindMany = jest.fn((args: unknown) => {
    shipmentFindManyArgs = args;
    return Promise.resolve(shipmentFindManyResult);
  });
  const shipmentCount = jest.fn((args: unknown) => {
    shipmentCountArgs = args;
    return Promise.resolve(shipmentCountResult);
  });
  const shipmentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const txShipmentFindMany = jest.fn(() =>
    Promise.resolve(txShipmentFindManyResult),
  );
  const shipmentCreate = jest.fn((args: unknown) => {
    shipmentCreateArgs = args;
    return Promise.resolve({ id: 'imported-shipment-1' });
  });
  const shipmentUpdate = jest.fn().mockResolvedValue({ id: 'shipment-1' });
  const dispatchFindMany = jest.fn().mockResolvedValue([]);
  const transaction = jest.fn(
    (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
      callback({
        senditConnection: { findUnique: connectionFindUnique },
        senditShipment: {
          upsert: shipmentUpsert,
          updateMany: shipmentUpdateMany,
          findMany: txShipmentFindMany,
          create: shipmentCreate,
          update: shipmentUpdate,
        },
        ecommerceOrderDispatch: {
          findFirst: dispatchFindFirst,
          findMany: dispatchFindMany,
        },
        senditTrackingEvent: { upsert: eventUpsert },
      }),
  );
  const prisma = {
    $transaction: transaction,
    senditShipment: {
      findFirst: shipmentFindFirst,
      findUnique: shipmentFindUnique,
      findMany: shipmentFindMany,
      count: shipmentCount,
    },
  } as unknown as PrismaService;
  const getCredentials = jest.fn();
  const connection = {
    getCredentials,
  } as unknown as SenditConnectionService;
  const service = new SenditShipmentService(prisma, connection);

  const request = {
    pickup_district_id: 1,
    district_id: 58,
    name: 'Sara Amrani',
    amount: 349.9,
    address: '12 Rue Al Massira, Casablanca',
    phone: '0612345678',
    reference: 'ORDER-2026-0042',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    shipmentUpsertArgs = undefined;
    eventUpsertArgs = undefined;
    shipmentFindUniqueArgs = undefined;
    shipmentFindManyArgs = undefined;
    shipmentCountArgs = undefined;
    shipmentFindUniqueResult = null;
    shipmentFindManyResult = [];
    shipmentCountResult = 0;
    txShipmentFindManyResult = [];
    shipmentCreateArgs = undefined;
    connectionFindUnique.mockResolvedValue({ id: 'connection-1' });
    dispatchFindFirst.mockResolvedValue({ id: 'dispatch-1' });
    shipmentFindFirst.mockResolvedValue({
      id: 'shipment-1',
      userId: 'user-1',
      lastActionAt: new Date('2025-06-11T15:00:00Z'),
    });
    getCredentials.mockResolvedValue({
      publicKey: 'sendit-public-key',
      secretKey: 'sendit-secret-key',
    });
    shipmentCountResult = 1;
    shipmentFindManyResult = [
      {
        id: 'shipment-1',
        providerCode: 'DHF420101C',
        providerStatus: 'POSTPONED',
        providerReturnStatus: null,
        normalizedStatus: ShippingShipmentStatus.POSTPONED,
        reference: 'ORDER-2026-0042',
        recipientName: 'Sara Amrani',
        recipientPhone: '0612345678',
        address: '12 Rue Al Massira, Casablanca',
        city: 'Casablanca',
        pickupDistrictId: 1,
        destinationDistrictId: 58,
        codAmount: new Prisma.Decimal('349.9000'),
        fee: new Prisma.Decimal('35.0000'),
        currency: 'MAD',
        lastActionAt: new Date('2026-08-13T16:05:05Z'),
        providerCreatedAt: new Date('2026-08-13T08:00:00Z'),
        providerUpdatedAt: new Date('2026-08-13T16:05:05Z'),
        createdAt: new Date('2026-08-13T08:00:00Z'),
        updatedAt: new Date('2026-08-13T16:05:05Z'),
        userId: 'user-1',
        connectionId: 'connection-1',
        dispatchId: null,
      },
    ];
  });

  it('upserts a normalized local shipment and its initial timeline event', async () => {
    await service.persistCreatedDelivery('user-1', request, {
      success: true,
      data: {
        code: 'DHF420101C',
        status: 'PENDING',
        status_return: null,
        fee: 35,
        amount: 349.9,
        name: 'Sara Amrani',
        phone: '0612345678',
        address: '12 Rue Al Massira, Casablanca',
        reference: 'ORDER-2026-0042',
        pickup_district_id: 1,
        district: { id: 58, ville: 'Casablanca' },
        created_at: '2026-08-13T08:00:00Z',
        updated_at: '2026-08-13T08:00:00Z',
      },
    });

    const shipmentCall = shipmentUpsertArgs as {
      where: { userId_providerCode: { userId: string; providerCode: string } };
      create: {
        connectionId: string;
        dispatchId: string;
        normalizedStatus: ShippingShipmentStatus;
        city: string;
        destinationDistrictId: number;
        codAmount: Prisma.Decimal;
        fee: Prisma.Decimal;
      };
    };
    expect(shipmentCall.where.userId_providerCode).toEqual({
      userId: 'user-1',
      providerCode: 'DHF420101C',
    });
    expect(shipmentCall.create).toMatchObject({
      connectionId: 'connection-1',
      dispatchId: 'dispatch-1',
      normalizedStatus: ShippingShipmentStatus.PENDING,
      city: 'Casablanca',
      destinationDistrictId: 58,
    });
    expect(shipmentCall.create.codAmount.toFixed(4)).toBe('349.9000');
    expect(shipmentCall.create.fee.toFixed(4)).toBe('35.0000');

    const eventCall = eventUpsertArgs as {
      create: {
        shipmentId: string;
        providerEventKey: string;
        eventType: string;
        normalizedStatus: ShippingShipmentStatus;
      };
    };
    expect(eventCall.create).toMatchObject({
      shipmentId: 'shipment-1',
      providerEventKey: 'created:PENDING',
      eventType: 'delivery.created',
      normalizedStatus: ShippingShipmentStatus.PENDING,
    });
  });

  it('rejects an incomplete successful provider response before writing', async () => {
    await expect(
      service.persistCreatedDelivery('user-1', request, {
        success: true,
        data: { status: 'PENDING' },
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lists only the user shipments with pagination, search, and status filters', async () => {
    const result = await service.list('user-1', {
      search: ' DHF4201 ',
      status: ShippingShipmentStatus.POSTPONED,
      page: 2,
      limit: 10,
    });

    const countCall = shipmentCountArgs as {
      where: Prisma.SenditShipmentWhereInput;
    };
    expect(countCall.where).toMatchObject({
      userId: 'user-1',
      normalizedStatus: ShippingShipmentStatus.POSTPONED,
    });
    expect(countCall.where.OR).toContainEqual({
      providerCode: { contains: 'DHF4201', mode: 'insensitive' },
    });
    const findManyCall = shipmentFindManyArgs as {
      skip: number;
      take: number;
      orderBy: Prisma.SenditShipmentOrderByWithRelationInput[];
    };
    expect(findManyCall).toMatchObject({
      skip: 10,
      take: 10,
      orderBy: [
        { lastActionAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          provider: 'sendit',
          providerCode: 'DHF420101C',
          normalizedStatus: ShippingShipmentStatus.POSTPONED,
          codAmount: '349.9000',
          fee: '35.0000',
        }),
      ],
      pagination: { total: 1, page: 2, limit: 10, totalPages: 1 },
    });
  });

  it('returns a newest-first shipment timeline without raw provider payloads', async () => {
    shipmentFindUniqueResult = {
      providerCode: 'DHF420101C',
      providerStatus: 'POSTPONED',
      providerReturnStatus: null,
      normalizedStatus: ShippingShipmentStatus.POSTPONED,
      lastActionAt: new Date('2026-08-13T16:05:05Z'),
      events: [
        {
          id: 'event-2',
          providerEventKey: 'private-dedup-key',
          eventType: 'delivery.status.update',
          providerStatus: 'POSTPONED',
          normalizedStatus: ShippingShipmentStatus.POSTPONED,
          message: 'Programmé par le client',
          proofImageUrl: 'https://app.sendit.ma/proof.jpg',
          deliverBy: new Date('2026-08-14T00:00:00Z'),
          unreachableCount: 1,
          actor: 'Sendit',
          eventAt: new Date('2026-08-13T16:05:05Z'),
          rawPayload: { private: 'not returned' },
          createdAt: new Date('2026-08-13T16:05:06Z'),
          shipmentId: 'shipment-1',
        },
      ],
    };

    const result = await service.getTimeline('user-1', 'DHF420101C');

    const timelineCall = shipmentFindUniqueArgs as {
      where: {
        userId_providerCode: { userId: string; providerCode: string };
      };
      select: { events: { orderBy: { eventAt: string } } };
    };
    expect(timelineCall.where).toEqual({
      userId_providerCode: {
        userId: 'user-1',
        providerCode: 'DHF420101C',
      },
    });
    expect(timelineCall.select.events).toEqual({
      orderBy: { eventAt: 'desc' },
    });
    expect(result.events[0]).toEqual({
      id: 'event-2',
      eventType: 'delivery.status.update',
      providerStatus: 'POSTPONED',
      normalizedStatus: ShippingShipmentStatus.POSTPONED,
      message: 'Programmé par le client',
      proofImageUrl: 'https://app.sendit.ma/proof.jpg',
      deliverBy: '2026-08-14T00:00:00.000Z',
      unreachableCount: 1,
      actor: 'Sendit',
      eventAt: '2026-08-13T16:05:05.000Z',
    });
    expect(result.events[0]).not.toHaveProperty('rawPayload');
    expect(result.events[0]).not.toHaveProperty('providerEventKey');
  });

  it('does not expose another user timeline', async () => {
    shipmentFindUniqueResult = null;

    await expect(
      service.getTimeline('user-2', 'DHF420101C'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('imports an existing Sendit delivery and reports provider continuation', async () => {
    const result = await service.reconcileProviderPage('user-1', {
      success: true,
      data: [
        {
          code: 'DHF420101C',
          status: 'TRANSIT',
          status_return: null,
          name: 'Sara Amrani',
          phone: '0612345678',
          amount: 349.9,
          fee: 35,
          reference: 'ORDER-2026-0042',
          last_action_at: '2026-08-13 16:05:05',
          district: { id: 58, ville: 'Casablanca' },
        },
      ],
      total: 12,
      current_page: 1,
      last_page: 2,
      next_page_url: 'https://app.sendit.ma/api/v1/deliveries?page=2',
    });

    expect(result).toEqual({
      currentPage: 1,
      lastPage: 2,
      providerTotal: 12,
      hasMore: true,
      processed: 1,
      imported: 1,
      reconciled: 0,
    });
    const createCall = shipmentCreateArgs as {
      data: {
        userId: string;
        connectionId: string;
        providerCode: string;
        normalizedStatus: ShippingShipmentStatus;
        address: string;
        lastActionAt: Date;
        codAmount: Prisma.Decimal;
      };
    };
    expect(createCall.data).toMatchObject({
      userId: 'user-1',
      connectionId: 'connection-1',
      providerCode: 'DHF420101C',
      normalizedStatus: ShippingShipmentStatus.IN_TRANSIT,
      address: '',
      lastActionAt: new Date('2026-08-13T16:05:05Z'),
    });
    expect(createCall.data.codAmount.toFixed(4)).toBe('349.9000');
    const importEvent = eventUpsertArgs as {
      create: {
        eventType: string;
        actor: string;
        normalizedStatus: ShippingShipmentStatus;
      };
    };
    expect(importEvent.create).toMatchObject({
      eventType: 'delivery.imported',
      actor: 'Sendit sync',
      normalizedStatus: ShippingShipmentStatus.IN_TRANSIT,
    });
  });

  it('reconciles an unchanged delivery without adding a duplicate event', async () => {
    txShipmentFindManyResult = [
      {
        id: 'shipment-1',
        providerCode: 'DHF420101C',
        providerStatus: 'TRANSIT',
        providerReturnStatus: null,
        normalizedStatus: ShippingShipmentStatus.IN_TRANSIT,
        reference: 'ORDER-2026-0042',
        recipientName: 'Sara Amrani',
        recipientPhone: '0612345678',
        address: '',
        city: 'Casablanca',
        pickupDistrictId: null,
        destinationDistrictId: 58,
        codAmount: new Prisma.Decimal('349.9'),
        fee: new Prisma.Decimal('35'),
        currency: 'MAD',
        lastActionAt: new Date('2026-08-13T16:05:05Z'),
        providerCreatedAt: null,
        providerUpdatedAt: null,
        createdAt: new Date('2026-08-13T08:00:00Z'),
        updatedAt: new Date('2026-08-13T16:05:05Z'),
        userId: 'user-1',
        connectionId: 'connection-1',
        dispatchId: null,
      },
    ];

    const result = await service.reconcileProviderPage('user-1', {
      success: true,
      data: [
        {
          code: 'DHF420101C',
          status: 'TRANSIT',
          name: 'Sara Amrani',
          phone: '0612345678',
          amount: 349.9,
          fee: 35,
          last_action_at: '2026-08-13 16:05:05',
        },
      ],
      total: 1,
      current_page: 1,
      last_page: 1,
      next_page_url: null,
    });

    expect(result).toMatchObject({
      imported: 0,
      reconciled: 1,
      hasMore: false,
    });
    expect(shipmentCreate).not.toHaveBeenCalled();
    expect(shipmentUpdate).toHaveBeenCalledTimes(1);
    expect(eventUpsert).not.toHaveBeenCalled();
  });

  it('verifies and persists a normalized Sendit status webhook', async () => {
    const payload = {
      event: 'delivery.status.update',
      code: 'DHF420101C',
      oldStatus: 'UNREACHABLE',
      newStatus: 'POSTPONED',
      lastActionAt: '2025-06-11 16:05:05',
      message: 'Programmé par le client',
      proofImage: 'https://app.sendit.ma/storage/deliveries/proof.jpg',
      deliverBy: '2025-06-12',
      counterUnreachable: 1,
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha256', 'sendit-secret-key')
      .update(rawBody)
      .digest('hex');

    await expect(
      service.processStatusWebhook(
        { 'x-sendit-signature': signature },
        payload,
        rawBody,
      ),
    ).resolves.toEqual({
      success: true,
      message: 'Sendit webhook received',
    });

    expect(shipmentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'shipment-1',
        OR: [
          { lastActionAt: null },
          { lastActionAt: { lte: new Date('2025-06-11T16:05:05Z') } },
        ],
      },
      data: {
        providerStatus: 'POSTPONED',
        normalizedStatus: ShippingShipmentStatus.POSTPONED,
        lastActionAt: new Date('2025-06-11T16:05:05Z'),
        providerUpdatedAt: new Date('2025-06-11T16:05:05Z'),
      },
    });

    const eventCall = eventUpsertArgs as {
      where: {
        shipmentId_providerEventKey: {
          shipmentId: string;
          providerEventKey: string;
        };
      };
      create: {
        providerStatus: string;
        normalizedStatus: ShippingShipmentStatus;
        proofImageUrl: string;
        deliverBy: Date;
        unreachableCount: number;
      };
    };
    expect(eventCall.where.shipmentId_providerEventKey.shipmentId).toBe(
      'shipment-1',
    );
    expect(
      eventCall.where.shipmentId_providerEventKey.providerEventKey,
    ).toHaveLength(64);
    expect(eventCall.create).toMatchObject({
      providerStatus: 'POSTPONED',
      normalizedStatus: ShippingShipmentStatus.POSTPONED,
      proofImageUrl: payload.proofImage,
      deliverBy: new Date('2025-06-12T00:00:00Z'),
      unreachableCount: 1,
    });
  });

  it('rejects an invalid signature without updating the shipment', async () => {
    const payload = {
      event: 'delivery.status.update',
      code: 'DHF420101C',
      oldStatus: 'PENDING',
      newStatus: 'DELIVERED',
      lastActionAt: '2025-06-11 16:05:05',
    };

    await expect(
      service.processStatusWebhook(
        { 'x-sendit-signature': 'not-a-valid-signature' },
        payload,
        Buffer.from(JSON.stringify(payload)),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported webhook events', async () => {
    await expect(
      service.processStatusWebhook(
        { 'x-sendit-signature': 'unused' },
        {
          event: 'delivery.created',
          code: 'DHF420101C',
          newStatus: 'PENDING',
          lastActionAt: '2025-06-11 16:05:05',
        },
        Buffer.from('{}'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(shipmentFindFirst).not.toHaveBeenCalled();
  });
});
