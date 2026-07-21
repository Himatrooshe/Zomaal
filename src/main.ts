import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

type ExpressInstance = {
  disable: (setting: string) => void;
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService);

  const expressInstance = app.getHttpAdapter().getInstance() as ExpressInstance;
  expressInstance.disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()',
    );
    next();
  });

  const corsOrigins = configService
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
    }),
  );

  const swaggerEnabled =
    configService.get<string>('SWAGGER_ENABLED') === 'true' ||
    (configService.get<string>('NODE_ENV') !== 'production' &&
      configService.get<string>('SWAGGER_ENABLED') !== 'false');

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
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
        'Provider-neutral account synchronization and combined revenue reporting. Monetary values remain separated by currency.',
      )
      .addTag(
        'Shopify OAuth',
        'Public Shopify authorization callback. The frontend starts OAuth through the protected Shopify endpoint.',
      )
      .addTag(
        'Shopify Webhooks',
        'HMAC-verified Shopify uninstall and mandatory privacy callbacks. These endpoints do not use a Zomaal bearer token.',
      )
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Paste the access token only. Do not paste the refresh token or include the word Bearer.',
      })
      .build();
    const document = SwaggerModule.createDocument(app, config, {
      deepScanRoutes: true,
      autoTagControllers: false,
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    });
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs/openapi.json',
      yamlDocumentUrl: 'docs/openapi.yaml',
      customSiteTitle: 'Zomaal API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayOperationId: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        docExpansion: 'list',
        defaultModelExpandDepth: 3,
        defaultModelsExpandDepth: 2,
      },
    });
  }

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
