import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShopBanner, ShopBannerLinkType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import {
  validateImage,
  type WarehouseMediaUploadFile,
} from '../../warehouse/media.service';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import { ShopImageStorageService } from './shop-image-storage.service';
import type {
  CreateShopBannerDto,
  UpdateShopBannerDto,
} from './dto/storefront-admin.dto';

@Injectable()
export class ShopBannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ShopImageStorageService,
    private readonly activity: ActivityLogService,
  ) {}

  async list() {
    const banners = await this.prisma.shopBanner.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return Promise.all(banners.map((b) => this.toResponse(b)));
  }

  async create(actor: SuperAdminJwtPayload, dto: CreateShopBannerDto) {
    await this.validateLink(
      dto.linkType ?? ShopBannerLinkType.NONE,
      dto.linkId,
    );
    this.validateWindow(dto.startsAt, dto.endsAt);
    const banner = await this.prisma.shopBanner.create({
      data: {
        title: dto.title?.trim() || null,
        subtitle: dto.subtitle?.trim() || null,
        linkType: dto.linkType ?? ShopBannerLinkType.NONE,
        linkId:
          dto.linkType && dto.linkType !== ShopBannerLinkType.NONE
            ? dto.linkId
            : null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      },
    });
    await this.log(
      actor,
      'BANNER_CREATED',
      banner,
      `Created banner "${banner.title ?? 'Untitled'}"`,
    );
    return this.toResponse(banner);
  }

  async update(
    actor: SuperAdminJwtPayload,
    id: string,
    dto: UpdateShopBannerDto,
  ) {
    const before = await this.require(id);
    const linkType = dto.linkType ?? before.linkType;
    const linkId = dto.linkId !== undefined ? dto.linkId : before.linkId;
    await this.validateLink(linkType, linkId ?? undefined);
    const startsAt =
      dto.startsAt !== undefined
        ? dto.startsAt
        : before.startsAt?.toISOString();
    const endsAt =
      dto.endsAt !== undefined ? dto.endsAt : before.endsAt?.toISOString();
    this.validateWindow(startsAt, endsAt);
    const banner = await this.prisma.shopBanner.update({
      where: { id },
      data: {
        ...(dto.title !== undefined
          ? { title: dto.title?.trim() || null }
          : {}),
        ...(dto.subtitle !== undefined
          ? { subtitle: dto.subtitle?.trim() || null }
          : {}),
        linkType,
        linkId: linkType === ShopBannerLinkType.NONE ? null : linkId,
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }
          : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
      },
    });
    await this.log(
      actor,
      'BANNER_UPDATED',
      banner,
      `Updated banner "${banner.title ?? 'Untitled'}"`,
    );
    return this.toResponse(banner);
  }

  async remove(actor: SuperAdminJwtPayload, id: string) {
    const banner = await this.require(id);
    await this.prisma.shopBanner.delete({ where: { id } });
    if (banner.imageObjectName)
      await this.images.remove(banner.imageObjectName);
    await this.log(
      actor,
      'BANNER_DELETED',
      banner,
      `Deleted banner "${banner.title ?? 'Untitled'}"`,
    );
    return { message: 'Banner deleted' };
  }

  async uploadImage(
    actor: SuperAdminJwtPayload,
    id: string,
    file?: WarehouseMediaUploadFile,
  ) {
    const banner = await this.require(id);
    if (!file) throw new BadRequestException('Image file is required');
    validateImage(file);
    const ext =
      file.mimetype === 'image/jpeg'
        ? 'jpg'
        : file.mimetype === 'image/png'
          ? 'png'
          : 'webp';
    const objectName = `shop/banners/${id}/${randomUUID()}.${ext}`;
    await this.images.save(objectName, file.buffer, file.mimetype);
    const updated = await this.prisma.shopBanner.update({
      where: { id },
      data: { imageObjectName: objectName, imageContentType: file.mimetype },
    });
    if (banner.imageObjectName)
      await this.images.remove(banner.imageObjectName);
    await this.log(
      actor,
      'BANNER_IMAGE_UPLOADED',
      updated,
      `Uploaded an image for banner "${updated.title ?? 'Untitled'}"`,
    );
    return this.toResponse(updated);
  }

  async streamImage(id: string, response: Response) {
    const banner = await this.prisma.shopBanner.findUnique({ where: { id } });
    if (!banner?.imageObjectName || !banner.imageContentType)
      throw new NotFoundException('Image not found');
    await this.images.stream(
      banner.imageObjectName,
      banner.imageContentType,
      response,
    );
  }

  private async require(id: string) {
    const banner = await this.prisma.shopBanner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }

  private async validateLink(
    linkType: ShopBannerLinkType,
    linkId?: string | null,
  ) {
    if (linkType === ShopBannerLinkType.NONE) return;
    if (!linkId)
      throw new BadRequestException(
        'Choose the product or category this banner opens.',
      );
    const exists =
      linkType === ShopBannerLinkType.PRODUCT
        ? await this.prisma.shopProduct.findUnique({
            where: { id: linkId },
            select: { id: true },
          })
        : await this.prisma.shopCategory.findUnique({
            where: { id: linkId },
            select: { id: true },
          });
    if (!exists)
      throw new BadRequestException(
        `That ${linkType.toLowerCase()} doesn't exist.`,
      );
  }

  private validateWindow(startsAt?: string | null, endsAt?: string | null) {
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      throw new BadRequestException(
        'The end date must be after the start date.',
      );
    }
  }

  private log(
    actor: SuperAdminJwtPayload,
    action: string,
    banner: ShopBanner,
    summary: string,
  ) {
    return this.activity.record(actor, {
      action,
      entityType: ActivityEntity.SHOP_BANNER,
      entityId: banner.id,
      summary,
    });
  }

  async toResponse(b: ShopBanner) {
    let linkName: string | null = null;
    if (b.linkId && b.linkType === ShopBannerLinkType.PRODUCT) {
      linkName =
        (
          await this.prisma.shopProduct.findUnique({
            where: { id: b.linkId },
            select: { name: true },
          })
        )?.name ?? null;
    } else if (b.linkId && b.linkType === ShopBannerLinkType.CATEGORY) {
      linkName =
        (
          await this.prisma.shopCategory.findUnique({
            where: { id: b.linkId },
            select: { name: true },
          })
        )?.name ?? null;
    }
    const now = new Date();
    return {
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      imageUrl: b.imageObjectName
        ? `/shop-media/banners/${b.id}?v=${b.updatedAt.getTime()}`
        : null,
      linkType: b.linkType,
      linkId: b.linkId,
      linkName,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
      startsAt: b.startsAt?.toISOString() ?? null,
      endsAt: b.endsAt?.toISOString() ?? null,
      // What merchants actually see right now.
      live:
        b.isActive &&
        !!b.imageObjectName &&
        (!b.startsAt || b.startsAt <= now) &&
        (!b.endsAt || b.endsAt >= now),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }
}
