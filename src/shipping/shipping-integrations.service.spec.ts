import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShippingIntegrationsService } from './shipping-integrations.service';

describe('ShippingIntegrationsService', () => {
  type ConnectionMock = {
    getStatus: jest.Mock;
    connect: jest.Mock;
    disconnect: jest.Mock;
  };
  let sendit: ConnectionMock;
  let quickLivraison: ConnectionMock;
  let forceLog: ConnectionMock;
  let ozoneExpress: ConnectionMock;
  let ameex: ConnectionMock;
  let service: ShippingIntegrationsService;
  const senditGroupBy = jest.fn();
  const quickGroupBy = jest.fn();
  const forceLogGroupBy = jest.fn();
  const ozoneGroupBy = jest.fn();
  const senditFindFirst = jest.fn();
  const quickFindFirst = jest.fn();
  const forceLogFindFirst = jest.fn();
  const ozoneFindFirst = jest.fn();
  const ameexGroupBy = jest.fn();
  const ameexFindFirst = jest.fn();
  const suggestionCreate = jest.fn();

  const connectionMock = (provider: string): ConnectionMock => ({
    getStatus: jest.fn().mockResolvedValue({
      connected: false,
      connectedAt: null,
      message: `${provider} account is not connected`,
    }),
    connect: jest.fn().mockResolvedValue({
      connected: true,
      connectedAt: '2026-07-16T10:30:00.000Z',
      message: `${provider} account is connected`,
    }),
    disconnect: jest.fn().mockResolvedValue({
      connected: false,
      connectedAt: null,
      message: `${provider} account disconnected`,
    }),
  });

  beforeEach(() => {
    sendit = connectionMock('Sendit');
    quickLivraison = connectionMock('QuickLivraison');
    forceLog = connectionMock('ForceLog');
    ozoneExpress = connectionMock('OzoneExpress');
    ameex = connectionMock('Ameex');
    senditGroupBy.mockResolvedValue([]);
    quickGroupBy.mockResolvedValue([]);
    forceLogGroupBy.mockResolvedValue([]);
    ozoneGroupBy.mockResolvedValue([]);
    senditFindFirst.mockResolvedValue(null);
    quickFindFirst.mockResolvedValue(null);
    forceLogFindFirst.mockResolvedValue(null);
    ozoneFindFirst.mockResolvedValue(null);
    ameexGroupBy.mockResolvedValue([]);
    ameexFindFirst.mockResolvedValue(null);
    service = new ShippingIntegrationsService(
      sendit as never,
      quickLivraison as never,
      forceLog as never,
      ozoneExpress as never,
      ameex as never,
      {
        senditShipment: {
          groupBy: senditGroupBy,
          findFirst: senditFindFirst,
        },
        quickLivraisonShipment: {
          groupBy: quickGroupBy,
          findFirst: quickFindFirst,
        },
        forceLogShipment: {
          groupBy: forceLogGroupBy,
          findFirst: forceLogFindFirst,
        },
        ozoneExpressShipment: {
          groupBy: ozoneGroupBy,
          findFirst: ozoneFindFirst,
        },
        ameexShipment: {
          groupBy: ameexGroupBy,
          findFirst: ameexFindFirst,
        },
        shippingCourierSuggestion: { create: suggestionCreate },
      } as never,
    );
  });

  it('returns one frontend catalog with countries, companies, form fields, and status', async () => {
    sendit.getStatus.mockResolvedValue({
      connected: true,
      connectedAt: '2026-07-16T09:00:00.000Z',
      message: 'Sendit account is connected',
    });

    const result = await service.list('user-1');
    const morocco = result.countries.find((country) => country.code === 'MA');
    const algeria = result.countries.find((country) => country.code === 'DZ');
    const senditCompany = morocco?.companies.find(
      (company) => company.code === 'sendit',
    );
    const forceLogCompany = morocco?.companies.find(
      (company) => company.code === 'forcelog',
    );
    const ozoneCompany = morocco?.companies.find(
      (company) => company.code === 'ozoneexpress',
    );

    expect(morocco).toMatchObject({
      name: 'Morocco',
      status: 'available',
      availableCompanyCount: 5,
    });
    expect(algeria).toMatchObject({
      status: 'coming_soon',
      availableCompanyCount: 0,
      companies: [],
    });
    expect(senditCompany).toMatchObject({
      connected: true,
      connectedAt: '2026-07-16T09:00:00.000Z',
    });
    expect(forceLogCompany).toMatchObject({
      analyticsAvailable: true,
      totalShipments: 0,
      activeShipments: 0,
    });
    expect(ozoneCompany).toMatchObject({
      analyticsAvailable: true,
      totalShipments: 0,
      activeShipments: 0,
    });
    expect(sendit.getStatus).toHaveBeenCalledWith('user-1');
    expect(quickLivraison.getStatus).toHaveBeenCalledWith('user-1');
    expect(forceLog.getStatus).toHaveBeenCalledWith('user-1');
    expect(ozoneExpress.getStatus).toHaveBeenCalledWith('user-1');
    expect(ameex.getStatus).toHaveBeenCalledWith('user-1');
    expect(result.summary).toEqual({
      connectedCouriers: 1,
      totalShipments: 0,
      activeShipments: 0,
    });
  });

  it('adds local provider metrics and supports catalog filters', async () => {
    sendit.getStatus.mockResolvedValue({
      connected: true,
      connectedAt: '2026-07-16T09:00:00.000Z',
      message: 'Sendit account is connected',
    });
    quickLivraison.getStatus.mockResolvedValue({
      connected: true,
      connectedAt: '2026-07-16T09:00:00.000Z',
      message: 'QuickLivraison account is connected',
    });
    senditGroupBy.mockResolvedValue([
      {
        normalizedStatus: 'DELIVERED',
        _count: { _all: 8 },
      },
      {
        normalizedStatus: 'IN_TRANSIT',
        _count: { _all: 2 },
      },
    ]);
    quickGroupBy.mockResolvedValue([
      {
        normalizedStatus: 'PENDING',
        _count: { _all: 3 },
      },
    ]);

    const result = await service.list('user-1', {
      country: 'MA',
      search: 'quick',
      connected: true,
    });

    expect(result.summary).toEqual({
      connectedCouriers: 2,
      totalShipments: 13,
      activeShipments: 5,
    });
    expect(result.countries).toHaveLength(1);
    expect(result.countries[0].companies).toEqual([
      expect.objectContaining({
        code: 'quicklivraison',
        analyticsAvailable: true,
        totalShipments: 3,
        activeShipments: 3,
      }),
    ]);
  });

  it('uses secure_text metadata for sensitive values and never returns credentials', async () => {
    const result = await service.list('user-1');
    const morocco = result.countries.find((country) => country.code === 'MA');
    const forceLogCompany = morocco?.companies.find(
      (company) => company.code === 'forcelog',
    );
    const ozoneCompany = morocco?.companies.find(
      (company) => company.code === 'ozoneexpress',
    );

    expect(forceLogCompany?.authFields).toEqual([
      expect.objectContaining({
        key: 'apiKey',
        inputType: 'secure_text',
        sensitive: true,
      }),
    ]);
    expect(ozoneCompany?.authFields).toEqual([
      expect.objectContaining({
        key: 'customerId',
        inputType: 'text',
        sensitive: false,
      }),
      expect.objectContaining({
        key: 'apiKey',
        inputType: 'secure_text',
        sensitive: true,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('encryptedApiKey');
  });

  it('dispatches generic connections to the selected provider', async () => {
    await expect(
      service.connect('user-1', 'ozoneexpress', {
        customerId: '12345',
        apiKey: 'secret',
      }),
    ).resolves.toEqual({
      companyCode: 'ozoneexpress',
      connected: true,
      connectedAt: '2026-07-16T10:30:00.000Z',
      message: 'OzoneExpress account is connected',
    });
    expect(ozoneExpress.connect).toHaveBeenCalledWith('user-1', {
      customerId: '12345',
      apiKey: 'secret',
    });
  });

  it('rejects missing and provider-inappropriate credential fields', async () => {
    await expect(
      service.connect('user-1', 'forcelog', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.connect('user-1', 'forcelog', {
        apiKey: 'secret',
        customerId: 'not-allowed',
      }),
    ).rejects.toThrow('Unexpected credential fields for forcelog: customerId');
    expect(forceLog.connect).not.toHaveBeenCalled();
  });

  it('disconnects generically and rejects unknown company codes', async () => {
    await expect(
      service.disconnect('user-1', 'quicklivraison'),
    ).resolves.toMatchObject({
      companyCode: 'quicklivraison',
      connected: false,
    });
    expect(quickLivraison.disconnect).toHaveBeenCalledWith('user-1');
    await expect(
      service.disconnect('user-1', 'unknown'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores a courier suggestion without contacting a provider', async () => {
    suggestionCreate.mockResolvedValue({
      id: 'suggestion-1',
      courierName: 'Example Courier',
      website: 'https://example.ma',
      countryCode: 'MA',
      notes: 'Please add it',
      status: 'PENDING',
      createdAt: new Date('2026-08-14T00:00:00Z'),
    });

    await expect(
      service.suggestCourier('user-1', {
        courierName: 'Example Courier',
        website: 'https://example.ma',
        countryCode: 'MA',
        notes: 'Please add it',
      }),
    ).resolves.toEqual({
      id: 'suggestion-1',
      courierName: 'Example Courier',
      website: 'https://example.ma',
      countryCode: 'MA',
      notes: 'Please add it',
      status: 'PENDING',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
  });
});
