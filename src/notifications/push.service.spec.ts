const request = jest.fn();
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: jest.fn().mockResolvedValue({ request }),
  })),
}));

import { PushService } from './push.service';

function build(env: Record<string, string> = {}) {
  const config = {
    get: jest.fn((key: string, fallback?: string) => env[key] ?? fallback),
  };
  const prisma = {
    pushDevice: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'd-1', token: 'tok-1' },
        { id: 'd-2', token: 'tok-2' },
      ]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new PushService(config as never, prisma as never);
  return { service, prisma };
}

const ENABLED = {
  PUSH_NOTIFICATIONS_ENABLED: 'true',
  FCM_PROJECT_ID: 'your-project-id',
};
const MESSAGE = {
  title: 'Item is running low',
  body: '3 items left',
  data: { type: 'LOW_STOCK' },
};

function fcmError(errorCode: string) {
  return Object.assign(new Error('fcm'), {
    response: {
      data: { error: { status: 'NOT_FOUND', details: [{ errorCode }] } },
    },
  });
}

describe('PushService', () => {
  beforeEach(() => request.mockReset());

  it('is a no-op when disabled', async () => {
    const { service, prisma } = build();

    await expect(service.sendToUsers(['u-1'], MESSAGE)).resolves.toBe(0);
    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
  });

  it('sends one FCM v1 message per device', async () => {
    const { service } = build(ENABLED);
    request.mockResolvedValue({ data: {} });

    await expect(service.sendToUsers(['u-1'], MESSAGE)).resolves.toBe(2);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://fcm.googleapis.com/v1/projects/your-project-id/messages:send',
        method: 'POST',
        data: {
          message: {
            token: 'tok-1',
            notification: {
              title: 'Item is running low',
              body: '3 items left',
            },
            data: { type: 'LOW_STOCK' },
          },
        },
      }),
    );
  });

  it('deletes tokens FCM reports as unregistered, keeps the rest', async () => {
    const { service, prisma } = build(ENABLED);
    request
      .mockRejectedValueOnce(fcmError('UNREGISTERED'))
      .mockRejectedValueOnce(fcmError('INTERNAL'));

    await expect(service.sendToUsers(['u-1'], MESSAGE)).resolves.toBe(0);
    expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['d-1'] } },
    });
  });

  it('never deletes tokens on INVALID_ARGUMENT (could be our payload)', async () => {
    const { service, prisma } = build(ENABLED);
    request.mockRejectedValue(fcmError('INVALID_ARGUMENT'));

    await service.sendToUsers(['u-1'], MESSAGE);

    expect(prisma.pushDevice.deleteMany).not.toHaveBeenCalled();
  });
});
