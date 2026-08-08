import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { dump } from 'js-yaml';
import { AppModule } from '../src/app.module';
import { createOpenApiConfig } from '../src/openapi.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';

async function generateOpenApi() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(REDIS_CLIENT)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication();

  try {
    const document = SwaggerModule.createDocument(app, createOpenApiConfig(), {
      deepScanRoutes: true,
      autoTagControllers: false,
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    });
    const destination = resolve(process.cwd(), 'docs/api/openapi.yaml');
    await writeFile(
      destination,
      dump(document, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      }),
      'utf8',
    );
    console.log(`Generated ${destination}`);
  } finally {
    await app.close();
  }
}

generateOpenApi().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
