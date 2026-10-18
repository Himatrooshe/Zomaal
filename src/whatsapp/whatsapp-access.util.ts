import { ForbiddenException } from '@nestjs/common';
import type {
  StoreAccess,
  StoreAccessService,
} from '../access/store-access.service';

/** WhatsApp spends the store's balance, so only the owner manages it. */
export async function requireWhatsAppOwner(
  storeAccess: StoreAccessService,
  userId: string,
): Promise<StoreAccess> {
  const access = await storeAccess.require(userId);
  if (!access.isOwner) {
    throw new ForbiddenException(
      'Only the store owner can manage WhatsApp automation',
    );
  }
  return access;
}
