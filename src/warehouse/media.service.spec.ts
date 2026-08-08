import { BadRequestException } from '@nestjs/common';
import {
  MediaService,
  validateImage,
  type WarehouseMediaUploadFile,
} from './media.service';

describe('warehouse media validation', () => {
  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
  ])('accepts a real %s signature', (mimetype, buffer) => {
    expect(() => validateImage(file(mimetype, buffer))).not.toThrow();
  });

  it('rejects a file whose bytes do not match its claimed image type', () => {
    expect(() =>
      validateImage(file('image/png', Buffer.from('not-an-image'))),
    ).toThrow(BadRequestException);
  });

  it('rejects files larger than 5 MB', () => {
    expect(() =>
      validateImage({
        ...file('image/jpeg', Buffer.from([0xff, 0xd8, 0xff])),
        size: 5 * 1024 * 1024 + 1,
      }),
    ).toThrow('Image must be no larger than 5 MB');
  });
});

describe('MediaService temporary upload cleanup', () => {
  it('does not delete an object if another request attached it first', async () => {
    const deleteObject = jest.fn();
    const prisma = {
      mediaAsset: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'asset-1', objectName: 'stores/store-1/media/asset-1.webp' },
          ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const config = { get: jest.fn().mockReturnValue('product-images') };
    const service = new MediaService(
      prisma as never,
      config as never,
      {} as never,
    );
    Object.defineProperty(service, 'storage', {
      value: {
        bucket: () => ({ file: () => ({ delete: deleteObject }) }),
      },
    });

    await expect(service.cleanupExpired('store-1')).resolves.toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('removes the private object after claiming the expired database row', async () => {
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      mediaAsset: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'asset-1', objectName: 'stores/store-1/media/asset-1.webp' },
          ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const config = { get: jest.fn().mockReturnValue('product-images') };
    const service = new MediaService(
      prisma as never,
      config as never,
      {} as never,
    );
    Object.defineProperty(service, 'storage', {
      value: {
        bucket: () => ({ file: () => ({ delete: deleteObject }) }),
      },
    });

    await expect(service.cleanupExpired('store-1')).resolves.toBe(1);
    expect(deleteObject).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});

function file(mimetype: string, buffer: Buffer): WarehouseMediaUploadFile {
  return { buffer, mimetype, size: buffer.length, originalname: 'image.bin' };
}
