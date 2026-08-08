import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { createOpenApiConfig } from './openapi.config';

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
  const allowAllCorsOrigins = corsOrigins.includes('*');

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: allowAllCorsOrigins ? '*' : corsOrigins,
      credentials: !allowAllCorsOrigins,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Accept', 'Authorization', 'Content-Type'],
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
    const config = createOpenApiConfig();
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
