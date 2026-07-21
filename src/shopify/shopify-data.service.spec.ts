import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyDataService } from './shopify-data.service';

describe('ShopifyDataService', () => {
  let graphqlForUser: jest.Mock;
  let service: ShopifyDataService;

  beforeEach(() => {
    graphqlForUser = jest.fn();
    service = new ShopifyDataService({
      graphqlForUser,
    } as unknown as ShopifyConnectionService);
  });

  it('returns a stable shop overview without exposing Shopify credentials', async () => {
    graphqlForUser.mockResolvedValue({
      shop: {
        id: 'gid://shopify/Shop/1',
        name: 'Atlas Market',
        myshopifyDomain: 'atlas-market.myshopify.com',
        url: 'https://atlas-market.com',
        contactEmail: 'hello@atlas-market.com',
        currencyCode: 'MAD',
        ianaTimezone: 'Africa/Casablanca',
        createdAt: '2024-10-08T12:00:00Z',
        updatedAt: '2026-07-19T08:30:00Z',
        primaryDomain: {
          host: 'atlas-market.com',
          url: 'https://atlas-market.com',
          sslEnabled: true,
        },
        plan: {
          publicDisplayName: 'Basic',
          shopifyPlus: false,
          partnerDevelopment: false,
        },
        shopAddress: {
          address1: '12 Rue Al Massira',
          address2: null,
          city: 'Casablanca',
          province: 'Casablanca-Settat',
          provinceCode: 'CAS',
          country: 'Morocco',
          countryCodeV2: 'MA',
          zip: '20000',
          phone: '+212612345678',
        },
      },
    });

    const result = await service.getOverview('user-1');

    expect(result).toEqual({
      id: 'gid://shopify/Shop/1',
      name: 'Atlas Market',
      myshopifyDomain: 'atlas-market.myshopify.com',
      onlineStoreUrl: 'https://atlas-market.com',
      contactEmail: 'hello@atlas-market.com',
      currencyCode: 'MAD',
      timezone: 'Africa/Casablanca',
      createdAt: '2024-10-08T12:00:00Z',
      updatedAt: '2026-07-19T08:30:00Z',
      primaryDomain: {
        host: 'atlas-market.com',
        url: 'https://atlas-market.com',
        sslEnabled: true,
      },
      plan: {
        displayName: 'Basic',
        shopifyPlus: false,
        partnerDevelopment: false,
      },
      address: {
        address1: '12 Rue Al Massira',
        address2: null,
        city: 'Casablanca',
        province: 'Casablanca-Settat',
        provinceCode: 'CAS',
        country: 'Morocco',
        countryCode: 'MA',
        zip: '20000',
        phone: '+212612345678',
      },
    });
    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('query ZomaalShopOverview'),
    );
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('maps products and forwards opaque cursor pagination to Shopify', async () => {
    graphqlForUser.mockResolvedValue({
      products: {
        nodes: [
          {
            id: 'gid://shopify/Product/10',
            title: 'Leather Handbag',
            handle: 'leather-handbag',
            status: 'ACTIVE',
            vendor: 'Atlas',
            productType: 'Handbags',
            tags: ['leather'],
            totalInventory: 18,
            tracksInventory: true,
            priceRangeV2: {
              minVariantPrice: { amount: '349.90', currencyCode: 'MAD' },
              maxVariantPrice: { amount: '499.90', currencyCode: 'MAD' },
            },
            featuredMedia: {
              preview: {
                image: {
                  url: 'https://cdn.shopify.com/product.jpg',
                  altText: 'Black leather handbag',
                  width: 1200,
                  height: 1200,
                },
              },
            },
            createdAt: '2026-07-01T10:30:00Z',
            updatedAt: '2026-07-18T15:40:00Z',
          },
        ],
        pageInfo: {
          hasNextPage: true,
          hasPreviousPage: true,
          startCursor: 'cursor-start',
          endCursor: 'cursor-next',
        },
      },
    });

    const result = await service.listProducts('user-1', {
      first: 50,
      after: ' cursor-current ',
      query: ' status:active ',
    });

    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('query ZomaalProducts'),
      {
        first: 50,
        after: 'cursor-current',
        query: 'status:active',
      },
    );
    expect(result).toMatchObject({
      data: [
        {
          id: 'gid://shopify/Product/10',
          priceRange: {
            minimum: { amount: '349.90', currencyCode: 'MAD' },
            maximum: { amount: '499.90', currencyCode: 'MAD' },
          },
          featuredImage: {
            url: 'https://cdn.shopify.com/product.jpg',
          },
        },
      ],
      pageInfo: {
        hasNextPage: true,
        endCursor: 'cursor-next',
      },
    });
  });

  it('uses safe defaults and maps order summaries with nullable customers', async () => {
    graphqlForUser.mockResolvedValue({
      orders: {
        nodes: [
          {
            id: 'gid://shopify/Order/20',
            name: '#1042',
            displayFinancialStatus: 'PAID',
            displayFulfillmentStatus: 'UNFULFILLED',
            currentTotalPriceSet: {
              shopMoney: { amount: '720.00', currencyCode: 'MAD' },
            },
            currentSubtotalLineItemsQuantity: 3,
            customer: null,
            createdAt: '2026-07-18T15:40:00Z',
            updatedAt: '2026-07-18T15:45:00Z',
            processedAt: '2026-07-18T15:41:00Z',
            cancelledAt: null,
          },
        ],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: 'cursor-one',
          endCursor: 'cursor-one',
        },
      },
    });

    const result = await service.listOrders('user-1', {} as never);

    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('query ZomaalOrders'),
      {
        first: 20,
        after: null,
        query: null,
      },
    );
    expect(result.data[0]).toMatchObject({
      name: '#1042',
      customer: null,
      totalPrice: { amount: '720.00', currencyCode: 'MAD' },
      itemCount: 3,
      processedAt: '2026-07-18T15:41:00Z',
    });
  });

  it('keeps Shopify 64-bit customer order counts as strings', async () => {
    graphqlForUser.mockResolvedValue({
      customers: {
        nodes: [
          {
            id: 'gid://shopify/Customer/30',
            displayName: 'Sara Amrani',
            firstName: 'Sara',
            lastName: 'Amrani',
            defaultEmailAddress: { emailAddress: 'sara@example.com' },
            defaultPhoneNumber: null,
            numberOfOrders: '9007199254740993',
            amountSpent: { amount: '12750.25', currencyCode: 'MAD' },
            state: 'ENABLED',
            verifiedEmail: true,
            tags: ['VIP'],
            defaultAddress: {
              city: 'Casablanca',
              provinceCode: 'CAS',
              countryCodeV2: 'MA',
            },
            createdAt: '2025-11-12T09:15:00Z',
            updatedAt: '2026-07-18T15:40:00Z',
          },
        ],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: 'customer-one',
          endCursor: 'customer-one',
        },
      },
    });

    const result = await service.listCustomers('user-1', {
      first: 500,
    });

    expect(result.data[0]).toMatchObject({
      orderCount: '9007199254740993',
      email: 'sara@example.com',
      phone: null,
      defaultLocation: {
        city: 'Casablanca',
        countryCode: 'MA',
      },
    });
    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('query ZomaalCustomers'),
      {
        first: 100,
        after: null,
        query: null,
      },
    );
  });
});
