import { DocumentBuilder } from '@nestjs/swagger';

export function createOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle('Zomaal API')
    .setDescription(
      [
        'Production API reference for Zomaal authentication, stores, and shipping providers.',
        '',
        '### Required headers',
        '- Requests with a JSON body: `Content-Type: application/json`',
        '- JSON responses: `Accept: application/json` (recommended)',
        '- Protected endpoints: `Authorization: Bearer <accessToken>`',
        '- Provider webhook signature headers are documented on each webhook operation.',
        '',
        '### Authentication',
        'Use `POST /auth/login` or `POST /auth/verify-otp` to receive an access token and refresh token. Click **Authorize** and paste the access token only; Swagger UI adds the `Bearer` prefix. Send refresh tokens only in the JSON body of `POST /auth/refresh`.',
        '',
        '### Response format',
        'Success responses use the schema shown per operation. Errors use `{ message, error, statusCode }`; validation errors can return an array in `message`.',
        '',
        '### Add Product workflow',
        '1. Load active categories from `GET /warehouse/categories`.',
        '2. Upload each main/gallery/variant image separately with `POST /warehouse/media` and retain each temporary upload ID.',
        '3. Optionally generate/validate a barcode, search active products for a gift, and load owned packaging.',
        '4. Submit the complete atomic request to `POST /warehouse/products` with a client-generated idempotency key.',
        '5. Use the returned variant barcode ID to preview or print a sticker from `GET /warehouse/barcodes/{barcodeId}/label`.',
        '6. Image URLs are private relative API paths; send the bearer token when loading them.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addTag(
      'Auth',
      'Phone/password login, OTP authentication, and refresh-token rotation.',
    )
    .addTag('Users', 'Authenticated user profile.')
    .addTag('Stores', 'Store onboarding and profile management.')
    .addTag(
      'Shipping Integrations',
      'Frontend catalog and generic shipping-company connection management.',
    )
    .addTag(
      'Shipping Overview',
      'Provider-independent shipping counts, costs, and home-screen metrics.',
    )
    .addTag(
      'Shipping - Sendit',
      'Sendit account connection, deliveries, districts, pickups, returns, and labels.',
    )
    .addTag(
      'Shipping - QuickLivraison',
      'QuickLivraison account connection, deliveries, tracking, products, and cities.',
    )
    .addTag(
      'Shipping - ForceLog',
      'ForceLog account connection, parcels, pickups, stock, returns, and stickers.',
    )
    .addTag(
      'Shipping - OzoneExpress',
      'OzoneExpress account connection, parcels, tracking, delivery notes, and cities.',
    )
    .addTag(
      'Provider Webhooks',
      'Public callbacks invoked by shipping providers. These endpoints do not use a Zomaal bearer token.',
    )
    .addTag(
      'Shopify',
      'Protected connection lifecycle for the current Zomaal store. Shopify access and refresh tokens are never returned by this API.',
    )
    .addTag(
      'Shopify Data',
      'Live, bearer-protected Shopify store, product, order, and customer reads with cursor pagination. Responses are not persisted by Zomaal.',
    )
    .addTag(
      'E-commerce Revenue',
      'Shopify, YouCan, and Lightfunnels order synchronization with provider-neutral combined revenue reporting. Monetary values remain separated by currency.',
    )
    .addTag(
      'Warehouse Products',
      'Atomic merchant-owned Add Product creation, search, details, optimistic metadata updates, and lifecycle. A product without options still receives one hidden default variant.',
    )
    .addTag(
      'Warehouse Categories',
      'Store-owned category hierarchy used by the Add Product category selector.',
    )
    .addTag(
      'Warehouse Barcodes',
      'Generate and validate inventory identifiers, resolve physical scanner input, and render printer-neutral PDF/SVG barcode stickers. Product barcodes are not shipment tracking numbers.',
    )
    .addTag(
      'Warehouse Media',
      'Private Cloud Storage upload/read/delete workflow for product and variant images.',
    )
    .addTag(
      'Warehouse Inventory',
      'Per-variant and packaging balances, available stock, idempotent adjustments, and immutable movement history.',
    )
    .addTag(
      'Warehouse Packaging',
      'Packaging owned through delivered Zomaal Shop purchases and available for product-level consumption requirements.',
    )
    .addTag(
      'Shopify OAuth',
      'Public Shopify authorization callback. The frontend starts OAuth through the protected Shopify endpoint.',
    )
    .addTag(
      'Shopify Webhooks',
      'HMAC-verified Shopify uninstall and mandatory privacy callbacks. These endpoints do not use a Zomaal bearer token.',
    )
    .addTag(
      'YouCan',
      'Protected YouCan connection lifecycle for the current Zomaal store. YouCan access and refresh tokens are encrypted and never returned.',
    )
    .addTag(
      'YouCan OAuth',
      'Public YouCan authorization callback. Start OAuth through the protected YouCan endpoint.',
    )
    .addTag(
      'Lightfunnels',
      'Protected Lightfunnels connection lifecycle for the current Zomaal store. Permanent access tokens are encrypted and never returned.',
    )
    .addTag(
      'Lightfunnels OAuth',
      'Public Lightfunnels authorization callback. Start OAuth through the protected Lightfunnels endpoint.',
    )
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Paste the access token only. Do not paste the refresh token or include the word Bearer.',
    })
    .build();
}
