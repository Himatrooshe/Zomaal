import { NotFoundException } from '@nestjs/common';
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

  it('returns complete product details with independently paginated media and variants', async () => {
    graphqlForUser.mockResolvedValue({
      product: {
        id: 'gid://shopify/Product/9172411547890',
        legacyResourceId: '9172411547890',
        title: 'The Collection Snowboard: Hydrogen',
        handle: 'the-collection-snowboard-hydrogen',
        description: 'A responsive, all-mountain snowboard.',
        descriptionHtml: '<p>A responsive, all-mountain snowboard.</p>',
        status: 'ACTIVE',
        vendor: 'Hydrogen Vendor',
        productType: 'snowboard',
        tags: ['Accessory', 'Sport', 'Winter'],
        totalInventory: 12,
        tracksInventory: true,
        isGiftCard: false,
        hasOnlyDefaultVariant: false,
        onlineStoreUrl:
          'https://atlas-market.com/products/the-collection-snowboard-hydrogen',
        publishedAt: '2026-07-01T10:30:00Z',
        seo: {
          title: 'Hydrogen Snowboard',
          description: 'A responsive snowboard.',
        },
        priceRangeV2: {
          minVariantPrice: { amount: '600.00', currencyCode: 'USD' },
          maxVariantPrice: { amount: '650.00', currencyCode: 'USD' },
        },
        featuredMedia: {
          id: 'gid://shopify/MediaImage/1',
          alt: 'Hydrogen snowboard',
          mediaContentType: 'IMAGE',
          status: 'READY',
          preview: {
            image: {
              url: 'https://cdn.shopify.com/hydrogen.jpg',
              altText: 'Hydrogen snowboard',
              width: 1200,
              height: 1200,
            },
          },
        },
        options: [
          {
            id: 'gid://shopify/ProductOption/1',
            name: 'Size',
            position: 1,
            values: ['154 cm', '158 cm'],
          },
        ],
        media: {
          nodes: [
            {
              id: 'gid://shopify/MediaImage/1',
              alt: 'Hydrogen snowboard',
              mediaContentType: 'IMAGE',
              status: 'READY',
              preview: {
                image: {
                  url: 'https://cdn.shopify.com/hydrogen.jpg',
                  altText: 'Hydrogen snowboard',
                  width: 1200,
                  height: 1200,
                },
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: 'media-start',
            endCursor: 'media-end',
          },
        },
        variants: {
          nodes: [
            {
              id: 'gid://shopify/ProductVariant/100',
              legacyResourceId: '100',
              title: '154 cm',
              displayName: 'The Collection Snowboard: Hydrogen - 154 cm',
              sku: 'HYDROGEN-154',
              barcode: null,
              price: '600.00',
              compareAtPrice: '650.00',
              inventoryQuantity: 12,
              availableForSale: true,
              taxable: true,
              inventoryPolicy: 'DENY',
              position: 1,
              selectedOptions: [{ name: 'Size', value: '154 cm' }],
              image: null,
              createdAt: '2026-07-01T10:30:00Z',
              updatedAt: '2026-07-18T15:40:00Z',
            },
          ],
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: 'variant-start',
            endCursor: 'variant-next',
          },
        },
        createdAt: '2026-07-01T10:30:00Z',
        updatedAt: '2026-07-18T15:40:00Z',
      },
    });

    const result = await service.getProductDetails('user-1', '9172411547890', {
      variantsFirst: 25,
      variantsAfter: ' variant-cursor ',
      mediaFirst: 10,
      mediaAfter: ' media-cursor ',
    });

    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('query ZomaalProductDetails'),
      {
        id: 'gid://shopify/Product/9172411547890',
        variantsFirst: 25,
        variantsAfter: 'variant-cursor',
        mediaFirst: 10,
        mediaAfter: 'media-cursor',
      },
    );
    expect(result).toMatchObject({
      id: 'gid://shopify/Product/9172411547890',
      legacyResourceId: '9172411547890',
      descriptionHtml: '<p>A responsive, all-mountain snowboard.</p>',
      featuredImage: {
        url: 'https://cdn.shopify.com/hydrogen.jpg',
      },
      seo: {
        title: 'Hydrogen Snowboard',
      },
      media: {
        data: [
          {
            mediaContentType: 'IMAGE',
            previewImage: {
              url: 'https://cdn.shopify.com/hydrogen.jpg',
            },
          },
        ],
      },
      variants: {
        data: [
          {
            legacyResourceId: '100',
            sku: 'HYDROGEN-154',
            price: '600.00',
            image: null,
          },
        ],
        pageInfo: {
          hasNextPage: true,
          endCursor: 'variant-next',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('returns 404 when Shopify has no product with the requested ID', async () => {
    graphqlForUser.mockResolvedValue({ product: null });

    await expect(
      service.getProductDetails('user-1', '9172411547890', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns complete order details with paginated line items and fulfillment tracking', async () => {
    const moneyBag = (amount: string) => ({
      shopMoney: { amount, currencyCode: 'MAD' },
    });
    graphqlForUser.mockResolvedValue({
      order: {
        id: 'gid://shopify/Order/6632134869234',
        legacyResourceId: '6632134869234',
        name: '#1042',
        confirmationNumber: 'ABC123XYZ',
        currencyCode: 'MAD',
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
        fullyPaid: true,
        taxesIncluded: false,
        test: false,
        currentSubtotalLineItemsQuantity: 2,
        currentSubtotalPriceSet: moneyBag('1200.00'),
        currentTotalDiscountsSet: moneyBag('100.00'),
        currentShippingPriceSet: moneyBag('50.00'),
        currentTotalTaxSet: moneyBag('0.00'),
        currentTotalPriceSet: moneyBag('1150.00'),
        totalRefundedSet: moneyBag('0.00'),
        totalOutstandingSet: moneyBag('0.00'),
        discountCodes: ['SUMMER10'],
        tags: ['mobile'],
        customer: {
          id: 'gid://shopify/Customer/30',
          displayName: 'Sara Amrani',
        },
        lineItems: {
          nodes: [
            {
              id: 'gid://shopify/LineItem/40',
              name: 'Hydrogen Snowboard - 154 cm',
              title: 'Hydrogen Snowboard',
              variantTitle: '154 cm',
              sku: 'HYDROGEN-154',
              vendor: 'Hydrogen Vendor',
              quantity: 2,
              currentQuantity: 2,
              refundableQuantity: 2,
              unfulfilledQuantity: 1,
              requiresShipping: true,
              taxable: true,
              isGiftCard: false,
              originalUnitPriceSet: moneyBag('600.00'),
              discountedUnitPriceSet: moneyBag('550.00'),
              originalTotalSet: moneyBag('1200.00'),
              discountedTotalSet: moneyBag('1100.00'),
              totalDiscountSet: moneyBag('100.00'),
              image: {
                url: 'https://cdn.shopify.com/hydrogen.jpg',
                altText: 'Hydrogen Snowboard',
                width: 1200,
                height: 1200,
              },
              variant: {
                id: 'gid://shopify/ProductVariant/50',
                legacyResourceId: '50',
              },
            },
          ],
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: 'line-start',
            endCursor: 'line-next',
          },
        },
        fulfillments: [
          {
            id: 'gid://shopify/Fulfillment/60',
            legacyResourceId: '60',
            name: '#1042.1',
            status: 'SUCCESS',
            displayStatus: 'IN_TRANSIT',
            totalQuantity: 1,
            trackingInfo: [
              {
                company: 'DHL Express',
                number: 'TRACK-123',
                url: 'https://example.com/track/TRACK-123',
              },
            ],
            createdAt: '2026-07-18T16:00:00Z',
            updatedAt: '2026-07-19T10:00:00Z',
            deliveredAt: null,
            estimatedDeliveryAt: '2026-07-22T10:00:00Z',
            inTransitAt: '2026-07-19T10:00:00Z',
          },
        ],
        createdAt: '2026-07-18T15:40:00Z',
        updatedAt: '2026-07-19T10:00:00Z',
        processedAt: '2026-07-18T15:41:00Z',
        cancelledAt: null,
        cancelReason: null,
        closedAt: null,
      },
    });

    const result = await service.getOrderDetails('user-1', '6632134869234', {
      lineItemsFirst: 25,
      lineItemsAfter: ' line-cursor ',
      fulfillmentsFirst: 10,
    });

    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('query ZomaalOrderDetails'),
      {
        id: 'gid://shopify/Order/6632134869234',
        lineItemsFirst: 25,
        lineItemsAfter: 'line-cursor',
        fulfillmentsFirst: 10,
      },
    );
    expect(result).toMatchObject({
      legacyResourceId: '6632134869234',
      name: '#1042',
      totals: {
        subtotal: { amount: '1200.00', currencyCode: 'MAD' },
        total: { amount: '1150.00', currencyCode: 'MAD' },
      },
      lineItems: {
        data: [
          {
            sku: 'HYDROGEN-154',
            discountedUnitPrice: { amount: '550.00', currencyCode: 'MAD' },
            variant: { legacyResourceId: '50' },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: 'line-next' },
      },
      fulfillments: [
        {
          legacyResourceId: '60',
          displayStatus: 'IN_TRANSIT',
          trackingInfo: [{ number: 'TRACK-123' }],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('returns 404 when Shopify has no order with the requested ID', async () => {
    graphqlForUser.mockResolvedValue({ order: null });

    await expect(
      service.getOrderDetails('user-1', '6632134869234', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
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
