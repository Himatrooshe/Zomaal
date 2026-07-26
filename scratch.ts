import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { LightfunnelsConnectionService } from './src/lightfunnels/lightfunnels-connection.service';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const user = await prisma.user.findFirst();
  if (!user) return;
  const service = app.get(LightfunnelsConnectionService);
  
  const query = `
    query {
      __type(name: "VariantSnapshot") {
        name
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  `;
  try {
    const res = await service.graphqlForUser(user.id, query, {});
    console.log(JSON.stringify(res, null, 2));
  } catch(e) {
    console.error(e);
  }

  const query2 = `
    query {
      __type(name: "OrderBumpSnapshot") {
        name
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  `;
  try {
    const res = await service.graphqlForUser(user.id, query2, {});
    console.log(JSON.stringify(res, null, 2));
  } catch(e) {
    console.error(e);
  }

  await app.close();
}
bootstrap();
