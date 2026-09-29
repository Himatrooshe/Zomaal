import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfileMediaService } from './profile-media.service';

describe('ProfileMediaService', () => {
  function build() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      store: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      staffMember: { update: jest.fn(), findFirst: jest.fn() },
    };
    const images = {
      save: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      stream: jest.fn().mockResolvedValue(undefined),
    };
    const storeAccess = {
      requireOwner: jest.fn().mockResolvedValue({ storeId: 'store-1' }),
    };
    const service = new ProfileMediaService(
      prisma as never,
      images as never,
      storeAccess as never,
    );
    return { service, prisma, images, storeAccess };
  }

  const png = {
    buffer: Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
    originalname: 'avatar.png',
    mimetype: 'image/png',
    size: 16,
  };

  it('rejects missing photo file', async () => {
    const { service } = build();
    await expect(service.uploadUserPhoto('user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uploads a profile photo onto the active store and returns a public path', async () => {
    const { service, prisma, images } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      activeStoreId: 'store-1',
      activeStore: {
        id: 'store-1',
        ownerPhotoUrl: null,
      },
      stores: [{ id: 'store-1', ownerPhotoUrl: null }],
      staffMembership: null,
    });

    const path = await service.uploadUserPhoto('user-1', png);

    expect(path).toMatch(/^\/profile-media\/users\/user-1\/photo-.+\.png$/);
    expect(images.save).toHaveBeenCalled();
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { ownerPhotoUrl: path },
    });
  });

  it('uploads a store logo onto the active store', async () => {
    const { service, prisma, images, storeAccess } = build();
    prisma.store.findUnique.mockResolvedValue({
      id: 'store-1',
      logoUrl: null,
    });

    const path = await service.uploadStoreLogo('user-1', {
      ...png,
      originalname: 'logo.png',
    });

    expect(storeAccess.requireOwner).toHaveBeenCalledWith('user-1');
    expect(path).toMatch(/^\/profile-media\/stores\/store-1\/logo-.+\.png$/);
    expect(images.save).toHaveBeenCalled();
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { logoUrl: path },
    });
  });

  it('rejects path-traversal file names when streaming', async () => {
    const { service } = build();
    await expect(
      service.streamUserPhoto('user-1', '../secret.png', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('uploads an owner-managed staff photo only within the active store', async () => {
    const { service, prisma, images } = build();
    prisma.staffMember.findFirst.mockResolvedValue({
      id: 'staff-1',
      userId: 'staff-user',
      photoUrl: null,
    });
    const path = await service.uploadStaffPhoto('owner', 'staff-1', png);
    expect(prisma.staffMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'staff-1', storeId: 'store-1' } }),
    );
    expect(path).toMatch(/^\/profile-media\/users\/staff-user\/photo-.+\.png$/);
    expect(images.save).toHaveBeenCalledTimes(1);
  });

  it('rejects another store staff photo before storing a file', async () => {
    const { service, prisma, images } = build();
    prisma.staffMember.findFirst.mockResolvedValue(null);
    await expect(
      service.uploadStaffPhoto('owner', 'other-staff', png),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(images.save).not.toHaveBeenCalled();
  });

  it('removes the new upload if the staff database update fails', async () => {
    const { service, prisma, images } = build();
    prisma.staffMember.findFirst.mockResolvedValue({
      id: 'staff-1',
      userId: 'staff-user',
      photoUrl: null,
    });
    prisma.staffMember.update.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      service.uploadStaffPhoto('owner', 'staff-1', png),
    ).rejects.toThrow('database unavailable');
    expect(images.remove).toHaveBeenCalledWith(images.save.mock.calls[0][0]);
  });
  it('never deletes another user photo referenced by a legacy photo URL', async () => {
    const { service, prisma, images } = build();
    prisma.staffMember.findFirst.mockResolvedValue({
      id: 'staff-1',
      userId: 'staff-user',
      photoUrl:
        '/profile-media/users/another-user/photo-14a3a49b-2d65-45cd-b467-8ae3e6f59142.png',
    });
    await service.uploadStaffPhoto('owner', 'staff-1', png);
    expect(images.remove).not.toHaveBeenCalled();
  });
});
