import { AuthService } from './auth.service';

function build() {
  const prisma = { user: { updateMany: jest.fn() } };
  const service = new AuthService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('AuthService.logout', () => {
  it('revokes the refresh token for the current user', async () => {
    const { service, prisma } = build();
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.logout('user-1');

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { hashedRefreshToken: null },
    });
    expect(result).toEqual({ message: 'Logged out successfully' });
  });

  it('is idempotent for a user that no longer exists', async () => {
    const { service, prisma } = build();
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.logout('missing')).resolves.toEqual({
      message: 'Logged out successfully',
    });
  });
});
