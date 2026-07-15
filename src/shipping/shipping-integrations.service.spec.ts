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
  let service: ShippingIntegrationsService;

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
    service = new ShippingIntegrationsService(
      sendit as never,
      quickLivraison as never,
      forceLog as never,
      ozoneExpress as never,
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

    expect(morocco).toMatchObject({
      name: 'Morocco',
      status: 'available',
      availableCompanyCount: 4,
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
    expect(sendit.getStatus).toHaveBeenCalledWith('user-1');
    expect(quickLivraison.getStatus).toHaveBeenCalledWith('user-1');
    expect(forceLog.getStatus).toHaveBeenCalledWith('user-1');
    expect(ozoneExpress.getStatus).toHaveBeenCalledWith('user-1');
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
});
