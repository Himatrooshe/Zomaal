import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShippingShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ForceLogConnectionService } from './forcelog-connection.service';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { SenditConnectionService } from './sendit-connection.service';
import { AmeexConnectionService } from './ameex-connection.service';
import type {
  ShippingAuthFieldDto,
  ShippingCompanyCode,
  ShippingIntegrationCredentialsDto,
} from './dto/shipping-integration.dto';
import type { ShippingIntegrationQueryDto } from './dto/shipping-integration-query.dto';
import type { CreateShippingCourierSuggestionDto } from './dto/shipping-courier-suggestion.dto';

type CountryDefinition = {
  code: string;
  name: string;
  status: 'available' | 'coming_soon';
};

type CompanyDefinition = {
  code: ShippingCompanyCode;
  countryCode: string;
  name: string;
  description: string;
  logoUrl: string | null;
  instructions: string;
  authFields: ShippingAuthFieldDto[];
};

const COUNTRIES: CountryDefinition[] = [
  { code: 'MA', name: 'Morocco', status: 'available' },
  { code: 'DZ', name: 'Algeria', status: 'coming_soon' },
  { code: 'TN', name: 'Tunisia', status: 'coming_soon' },
  { code: 'LY', name: 'Libya', status: 'coming_soon' },
  { code: 'EG', name: 'Egypt', status: 'coming_soon' },
];

const secureField = (
  key: string,
  label: string,
  placeholder: string,
): ShippingAuthFieldDto => ({
  key,
  label,
  placeholder,
  inputType: 'secure_text',
  required: true,
  sensitive: true,
});

const textField = (
  key: string,
  label: string,
  placeholder: string,
): ShippingAuthFieldDto => ({
  key,
  label,
  placeholder,
  inputType: 'text',
  required: true,
  sensitive: false,
});

const COMPANIES: CompanyDefinition[] = [
  {
    code: 'sendit',
    countryCode: 'MA',
    name: 'Sendit',
    description: 'Moroccan delivery and COD service',
    logoUrl: null,
    instructions: 'Enter the API credentials from your Sendit account.',
    authFields: [
      textField('public_key', 'Public key', 'Enter your public key'),
      secureField('secret_key', 'Secret key', 'Enter your secret key'),
    ],
  },
  {
    code: 'quicklivraison',
    countryCode: 'MA',
    name: 'QuickLivraison',
    description: 'Moroccan delivery and fulfillment service',
    logoUrl: null,
    instructions: 'Enter your primary or subuser QuickLivraison API key.',
    authFields: [secureField('apiKey', 'API key', 'Enter your API key')],
  },
  {
    code: 'forcelog',
    countryCode: 'MA',
    name: 'ForceLog',
    description: 'Moroccan delivery and COD service',
    logoUrl: null,
    instructions: 'Enter the API key from your ForceLog account.',
    authFields: [secureField('apiKey', 'API key', 'Enter your API key')],
  },
  {
    code: 'ozoneexpress',
    countryCode: 'MA',
    name: 'OzoneExpress',
    description: 'Moroccan parcel delivery service',
    logoUrl: null,
    instructions: 'Enter your OzoneExpress customer ID and API key.',
    authFields: [
      textField('customerId', 'Customer ID', 'Enter your customer ID'),
      secureField('apiKey', 'API key', 'Enter your API key'),
    ],
  },
  {
    code: 'ameex',
    countryCode: 'MA',
    name: 'Ameex',
    description: 'Moroccan parcel delivery and COD service',
    logoUrl: null,
    instructions: 'Enter the API ID and API key from your Ameex account.',
    authFields: [
      textField('apiId', 'API ID', 'Enter your API ID'),
      secureField('apiKey', 'API key', 'Enter your API key'),
    ],
  },
];

const RESOLVED_STATUSES = [
  ShippingShipmentStatus.DELIVERED,
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ShippingShipmentStatus.RETURN_PENDING,
  ShippingShipmentStatus.RETURN_IN_TRANSIT,
  ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  ShippingShipmentStatus.RETURN_INSPECTION,
  ShippingShipmentStatus.RETURNED_TO_STOCK,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
] as const;

type CompanyMetrics = {
  analyticsAvailable: boolean;
  totalShipments: number;
  activeShipments: number;
  dataUpdatedAt: string | null;
};

@Injectable()
export class ShippingIntegrationsService {
  constructor(
    private readonly senditConnection: SenditConnectionService,
    private readonly quickLivraisonConnection: QuickLivraisonConnectionService,
    private readonly forceLogConnection: ForceLogConnectionService,
    private readonly ozoneExpressConnection: OzoneExpressConnectionService,
    private readonly ameexConnection: AmeexConnectionService,
    private readonly prisma: PrismaService,
  ) {}

  async list(userId: string, query: ShippingIntegrationQueryDto = {}) {
    const [statuses, metrics] = await Promise.all([
      Promise.all(
        COMPANIES.map(
          async (company) =>
            [company.code, await this.getStatus(company.code, userId)] as const,
        ),
      ),
      this.getCompanyMetrics(userId),
    ]);
    const statusByCode = new Map(statuses);
    const search = query.search?.trim().toLocaleLowerCase();
    const countries = COUNTRIES.filter(
      (country) => !query.country || country.code === query.country,
    ).map((country) => {
      const definitions = COMPANIES.filter((company) => {
        if (company.countryCode !== country.code) return false;
        const status = statusByCode.get(company.code);
        if (
          query.connected !== undefined &&
          status?.connected !== query.connected
        ) {
          return false;
        }
        return (
          !search ||
          company.name.toLocaleLowerCase().includes(search) ||
          company.description.toLocaleLowerCase().includes(search)
        );
      });
      const companies = definitions.map((company) => {
        const status = statusByCode.get(company.code)!;
        const companyMetrics = metrics.get(company.code)!;
        return {
          code: company.code,
          name: company.name,
          description: company.description,
          logoUrl: company.logoUrl,
          status: 'available' as const,
          connected: status.connected,
          connectedAt: status.connectedAt,
          instructions: company.instructions,
          authFields: company.authFields,
          ...companyMetrics,
        };
      });

      return {
        ...country,
        availableCompanyCount: companies.length,
        companies,
      };
    });

    return {
      summary: {
        connectedCouriers: statuses.filter(([, status]) => status.connected)
          .length,
        totalShipments: sum(
          [...metrics.values()].map((item) => item.totalShipments),
        ),
        activeShipments: sum(
          [...metrics.values()].map((item) => item.activeShipments),
        ),
      },
      countries,
    };
  }

  async suggestCourier(
    userId: string,
    payload: CreateShippingCourierSuggestionDto,
  ) {
    const suggestion = await this.prisma.shippingCourierSuggestion.create({
      data: {
        userId,
        courierName: payload.courierName,
        website: payload.website || null,
        countryCode: payload.countryCode,
        notes: payload.notes || null,
      },
    });

    return {
      id: suggestion.id,
      courierName: suggestion.courierName,
      website: suggestion.website,
      countryCode: suggestion.countryCode,
      notes: suggestion.notes,
      status: 'PENDING' as const,
      createdAt: suggestion.createdAt.toISOString(),
    };
  }

  async connect(
    userId: string,
    companyCode: string,
    credentials: ShippingIntegrationCredentialsDto,
  ) {
    const company = this.getCompany(companyCode);
    const requiredFields = company.authFields.map((field) => field.key);
    this.assertCredentialFields(company.code, credentials, requiredFields);

    let status: {
      connected: boolean;
      connectedAt: string | null;
      message: string;
    };

    switch (company.code) {
      case 'sendit':
        status = await this.senditConnection.connect(userId, {
          public_key: credentials.public_key!,
          secret_key: credentials.secret_key!,
        });
        break;
      case 'quicklivraison':
        status = await this.quickLivraisonConnection.connect(userId, {
          apiKey: credentials.apiKey!,
        });
        break;
      case 'forcelog':
        status = await this.forceLogConnection.connect(userId, {
          apiKey: credentials.apiKey!,
        });
        break;
      case 'ozoneexpress':
        status = await this.ozoneExpressConnection.connect(userId, {
          customerId: credentials.customerId!,
          apiKey: credentials.apiKey!,
        });
        break;
      case 'ameex':
        status = await this.ameexConnection.connect(userId, {
          apiId: credentials.apiId!,
          apiKey: credentials.apiKey!,
        });
        break;
    }

    return this.normalizeStatus(company.code, status);
  }

  async disconnect(userId: string, companyCode: string) {
    const company = this.getCompany(companyCode);
    let status: {
      connected: boolean;
      connectedAt: string | null;
      message: string;
    };

    switch (company.code) {
      case 'sendit':
        status = await this.senditConnection.disconnect(userId);
        break;
      case 'quicklivraison':
        status = await this.quickLivraisonConnection.disconnect(userId);
        break;
      case 'forcelog':
        status = await this.forceLogConnection.disconnect(userId);
        break;
      case 'ozoneexpress':
        status = await this.ozoneExpressConnection.disconnect(userId);
        break;
      case 'ameex':
        status = await this.ameexConnection.disconnect(userId);
        break;
    }

    return this.normalizeStatus(company.code, status);
  }

  private getCompany(companyCode: string): CompanyDefinition {
    const company = COMPANIES.find(
      (candidate) => candidate.code === companyCode,
    );
    if (!company) {
      throw new NotFoundException(
        `Shipping company '${companyCode}' was not found`,
      );
    }
    return company;
  }

  private getStatus(companyCode: ShippingCompanyCode, userId: string) {
    switch (companyCode) {
      case 'sendit':
        return this.senditConnection.getStatus(userId);
      case 'quicklivraison':
        return this.quickLivraisonConnection.getStatus(userId);
      case 'forcelog':
        return this.forceLogConnection.getStatus(userId);
      case 'ozoneexpress':
        return this.ozoneExpressConnection.getStatus(userId);
      case 'ameex':
        return this.ameexConnection.getStatus(userId);
    }
  }

  private assertCredentialFields(
    companyCode: ShippingCompanyCode,
    credentials: ShippingIntegrationCredentialsDto,
    requiredFields: string[],
  ) {
    const suppliedFields = Object.entries(credentials)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    const missing = requiredFields.filter(
      (field) => !suppliedFields.includes(field),
    );
    const unexpected = suppliedFields.filter(
      (field) => !requiredFields.includes(field),
    );

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing credential fields for ${companyCode}: ${missing.join(', ')}`,
      );
    }
    if (unexpected.length > 0) {
      throw new BadRequestException(
        `Unexpected credential fields for ${companyCode}: ${unexpected.join(', ')}`,
      );
    }
  }

  private normalizeStatus(
    companyCode: ShippingCompanyCode,
    status: { connected: boolean; connectedAt: string | null; message: string },
  ) {
    return {
      companyCode,
      connected: status.connected,
      connectedAt: status.connectedAt,
      message: status.message,
    };
  }

  private async getCompanyMetrics(userId: string) {
    const [
      senditGroups,
      quickGroups,
      forceLogGroups,
      ozoneGroups,
      ameexGroups,
      latestSendit,
      latestQuick,
      latestForceLog,
      latestOzone,
      latestAmeex,
    ] = await Promise.all([
      this.prisma.senditShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.quickLivraisonShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.forceLogShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.ozoneExpressShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.ameexShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.senditShipment.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.quickLivraisonShipment.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.forceLogShipment.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.ozoneExpressShipment.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.ameexShipment.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);

    return new Map<ShippingCompanyCode, CompanyMetrics>([
      ['sendit', trackedMetrics(senditGroups, latestSendit?.updatedAt ?? null)],
      [
        'quicklivraison',
        trackedMetrics(quickGroups, latestQuick?.updatedAt ?? null),
      ],
      [
        'forcelog',
        trackedMetrics(forceLogGroups, latestForceLog?.updatedAt ?? null),
      ],
      [
        'ozoneexpress',
        trackedMetrics(ozoneGroups, latestOzone?.updatedAt ?? null),
      ],
      ['ameex', trackedMetrics(ameexGroups, latestAmeex?.updatedAt ?? null)],
    ]);
  }
}

function trackedMetrics(
  groups: Array<{
    normalizedStatus: ShippingShipmentStatus;
    _count: { _all: number };
  }>,
  dataUpdatedAt: Date | null,
): CompanyMetrics {
  const totalShipments = sum(groups.map((group) => group._count._all));
  const resolvedShipments = sum(
    groups
      .filter((group) =>
        RESOLVED_STATUSES.includes(
          group.normalizedStatus as (typeof RESOLVED_STATUSES)[number],
        ),
      )
      .map((group) => group._count._all),
  );
  return {
    analyticsAvailable: true,
    totalShipments,
    activeShipments: totalShipments - resolvedShipments,
    dataUpdatedAt: dataUpdatedAt?.toISOString() ?? null,
  };
}

function sum(values: Iterable<number>) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
