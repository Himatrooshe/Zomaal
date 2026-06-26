import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';

@Injectable()
export class StoresService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, createStoreDto: CreateStoreDto) {
    const existingStore = await this.prisma.store.findUnique({
      where: { userId },
    });

    if (existingStore) {
      throw new ConflictException('User already has a store');
    }

    const store = await this.prisma.store.create({
      data: {
        ...createStoreDto,
        userId,
      },
    });

    // Mark user onboarding as complete
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingComplete: true },
    });

    return store;
  }

  async findOne(userId: string) {
    const store = await this.prisma.store.findUnique({
      where: { userId },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return store;
  }

  async update(userId: string, updateStoreDto: UpdateStoreDto) {
    const store = await this.prisma.store.findUnique({
      where: { userId },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return this.prisma.store.update({
      where: { userId },
      data: updateStoreDto,
    });
  }
}
