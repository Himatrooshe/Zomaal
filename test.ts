import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({});
prisma.$connect().then(()=>console.log('Connected!')).catch(e=>console.error(e));
