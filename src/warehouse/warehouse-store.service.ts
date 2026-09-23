import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreAccessService } from '../access/store-access.service';

@Injectable()
export class WarehouseStoreService {
  constructor(private readonly storeAccess: StoreAccessService) {}

  async requireStore(userId: string) {
    return this.storeAccess.requireStore(userId);
  }
}
