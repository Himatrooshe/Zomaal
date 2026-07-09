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
      .setDescription('The Zomaal MVP API description')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(configService.get<number>('PORT', 3000));
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
