import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const phone = process.env.LOGGER_PHONE ?? '+212600000001';
const password = process.env.LOGGER_PASSWORD ?? 'ZomaalDemo#2026';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
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
