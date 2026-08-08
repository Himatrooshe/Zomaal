import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarehouseStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async requireStore(userId: string) {
    const store = await this.prisma.store.findUnique({ where: { userId } });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }
}
