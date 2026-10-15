import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const phone = process.env.LOGGER_PHONE;
const password = process.env.LOGGER_PASSWORD;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!phone || !password) {
    throw new Error('LOGGER_PHONE and LOGGER_PASSWORD are required');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The logger seed must not run in production');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    await prisma.user.upsert({
      where: { phone },
      update: { passwordHash: await bcrypt.hash(password, 12) },
      create: {
        phone,
        passwordHash: await bcrypt.hash(password, 12),
        isPhoneVerified: true,
      },
    });
    console.log(`Logger user ready: ${phone}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
