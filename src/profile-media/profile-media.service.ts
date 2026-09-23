import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../access/store-access.service';
import { ShopImageStorageService } from '../super-admin/shop/shop-image-storage.service';
import {
  validateImage,
  type WarehouseMediaUploadFile,
} from '../warehouse/media.service';

const PHOTO_EXTS = new Set(['jpg', 'png', 'webp']);

@Injectable()
export class ProfileMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ShopImageStorageService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  /**
   * Settings → Edit Profile → camera. Saves JPEG/PNG/WebP and points
   * ownerPhotoUrl / staff photoUrl at a public /profile-media/… path.
   */
  async uploadUserPhoto(
    userId: string,
    file?: WarehouseMediaUploadFile,
  ): Promise<string> {
    if (!file) throw new BadRequestException('Photo file is required');
    validateImage(file);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        stores: { orderBy: { createdAt: 'asc' } },
        activeStore: true,
        staffMembership: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const activeStore =
      user.activeStore ??
      user.stores.find((s) => s.id === user.activeStoreId) ??
      user.stores[0] ??
      null;

    if (!activeStore && !user.staffMembership) {
      throw new BadRequestException(
        'Complete store setup before uploading a profile photo',
      );
    }

    const ext = extensionFor(file.mimetype);
    const leaf = `photo-${randomUUID()}.${ext}`;
    const objectName = `profile/users/${userId}/${leaf}`;
    await this.images.save(objectName, file.buffer, file.mimetype);

    const publicPath = `/profile-media/users/${userId}/${leaf}`;
    const previousUrl = activeStore
      ? activeStore.ownerPhotoUrl
      : user.staffMembership?.photoUrl;

    if (activeStore) {
      await this.prisma.store.update({
        where: { id: activeStore.id },
        data: { ownerPhotoUrl: publicPath },
      });
      if (!user.activeStoreId) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { activeStoreId: activeStore.id },
        });
      }
    } else if (user.staffMembership) {
      await this.prisma.staffMember.update({
        where: { id: user.staffMembership.id },
        data: { photoUrl: publicPath },
      });
    }

    await this.removePreviousProfileObject(previousUrl);
    return publicPath;
  }

  /**
   * Settings → Store Information → Add Store Logo.
   */
  async uploadStoreLogo(
    userId: string,
    file?: WarehouseMediaUploadFile,
  ): Promise<string> {
    if (!file) throw new BadRequestException('Logo file is required');
    validateImage(file);

    const access = await this.storeAccess.requireOwner(userId);
    const store = await this.prisma.store.findUnique({
      where: { id: access.storeId },
    });
    if (!store) throw new NotFoundException('Store not found');

    const ext = extensionFor(file.mimetype);
    const leaf = `logo-${randomUUID()}.${ext}`;
    const objectName = `profile/stores/${store.id}/${leaf}`;
    await this.images.save(objectName, file.buffer, file.mimetype);

    const publicPath = `/profile-media/stores/${store.id}/${leaf}`;
    const previousUrl = store.logoUrl;

    await this.prisma.store.update({
      where: { id: store.id },
      data: { logoUrl: publicPath },
    });

    await this.removePreviousProfileObject(previousUrl);
    return publicPath;
  }

  async streamUserPhoto(
    userId: string,
    fileName: string,
    response: Response,
  ): Promise<void> {
    assertSafeLeaf(fileName, 'photo');
    await this.images.stream(
      `profile/users/${userId}/${fileName}`,
      contentTypeFor(fileName),
      response,
    );
  }

  async streamStoreLogo(
    storeId: string,
    fileName: string,
    response: Response,
  ): Promise<void> {
    assertSafeLeaf(fileName, 'logo');
    await this.images.stream(
      `profile/stores/${storeId}/${fileName}`,
      contentTypeFor(fileName),
      response,
    );
  }

  private async removePreviousProfileObject(url: string | null | undefined) {
    if (!url || !url.startsWith('/profile-media/')) return;
    const parts = url.split('/').filter(Boolean);
    // profile-media / users|stores / :id / :file
    if (parts.length !== 4 || parts[0] !== 'profile-media') return;
    const kind = parts[1];
    const id = parts[2];
    const leaf = parts[3];
    if (kind !== 'users' && kind !== 'stores') return;
    try {
      assertSafeLeaf(leaf, kind === 'users' ? 'photo' : 'logo');
      await this.images.remove(`profile/${kind}/${id}/${leaf}`);
    } catch {
      // Best-effort cleanup.
    }
  }
}

function extensionFor(contentType: string) {
  return contentType === 'image/jpeg'
    ? 'jpg'
    : contentType === 'image/png'
      ? 'png'
      : 'webp';
}

function contentTypeFor(fileName: string) {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function assertSafeLeaf(leaf: string, prefix: 'photo' | 'logo') {
  if (leaf.includes('..') || leaf.includes('/') || leaf.includes('\\')) {
    throw new NotFoundException('Image not found');
  }
  const match = leaf.match(
    new RegExp(`^${prefix}-[0-9a-f-]{36}\\.(jpg|png|webp)$`, 'i'),
  );
  if (!match || !PHOTO_EXTS.has(match[1].toLowerCase())) {
    throw new NotFoundException('Image not found');
  }
}
