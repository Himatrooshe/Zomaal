import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ForceLogConnectionService } from './forcelog-connection.service';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { SenditConnectionService } from './sendit-connection.service';
import type {
  ShippingAuthFieldDto,
  ShippingCompanyCode,
  ShippingIntegrationCredentialsDto,
} from './dto/shipping-integration.dto';

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
];

@Injectable()
export class ShippingIntegrationsService {
  constructor(
    private readonly senditConnection: SenditConnectionService,
    private readonly quickLivraisonConnection: QuickLivraisonConnectionService,
    private readonly forceLogConnection: ForceLogConnectionService,
    private readonly ozoneExpressConnection: OzoneExpressConnectionService,
  ) {}

  async list(userId: string) {
    const countries = await Promise.all(
      COUNTRIES.map(async (country) => {
        const definitions = COMPANIES.filter(
          (company) => company.countryCode === country.code,
        );
        const companies = await Promise.all(
          definitions.map(async (company) => {
            const status = await this.getStatus(company.code, userId);
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
            };
          }),
        );

        return {
          ...country,
          availableCompanyCount: companies.length,
          companies,
        };
      }),
    );

    return { countries };
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
}
