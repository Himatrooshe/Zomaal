import type { SenditClient } from './sendit.client';
import type { SenditConnectionService } from './sendit-connection.service';
import type { SenditProviderPageResult } from './sendit-shipment.service';
import type { SenditShipmentService } from './sendit-shipment.service';
import { SenditSyncService } from './sendit-sync.service';

describe('SenditSyncService', () => {
  const getCredentials = jest.fn().mockResolvedValue({
    publicKey: 'public-key',
    secretKey: 'secret-key',
  });
  const listDeliveries = jest.fn();
  const reconcileProviderPage = jest.fn();
  const service = new SenditSyncService(
    { listDeliveries } as unknown as SenditClient,
    { getCredentials } as unknown as SenditConnectionService,
    { reconcileProviderPage } as unknown as SenditShipmentService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stops at maxPages and returns the continuation page', async () => {
    listDeliveries.mockResolvedValueOnce({ page: 3 }).mockResolvedValueOnce({
      page: 4,
    });
    reconcileProviderPage
      .mockResolvedValueOnce(pageResult(3, 8, 10, 7, 3, 100))
      .mockResolvedValueOnce(pageResult(4, 8, 10, 6, 4, 100));

    const result = await service.sync('user-1', {
      startPage: 3,
      maxPages: 2,
    });

    expect(listDeliveries).toHaveBeenNthCalledWith(
      1,
      'user-1',
      { publicKey: 'public-key', secretKey: 'secret-key' },
      { page: 3 },
    );
    expect(listDeliveries).toHaveBeenNthCalledWith(
      2,
      'user-1',
      { publicKey: 'public-key', secretKey: 'secret-key' },
      { page: 4 },
    );
    expect(result).toMatchObject({
      success: true,
      pagesSynced: 2,
      processed: 20,
      imported: 13,
      reconciled: 7,
      nextPage: 5,
      providerTotal: 100,
    });
  });

  it('returns no continuation after the final provider page', async () => {
    listDeliveries.mockResolvedValue({ page: 1 });
    reconcileProviderPage.mockResolvedValue(pageResult(1, 1, 4, 4, 0, 4));

    const result = await service.sync('user-1', {});

    expect(result).toMatchObject({
      pagesSynced: 1,
      processed: 4,
      imported: 4,
      reconciled: 0,
      nextPage: null,
      providerTotal: 4,
    });
    expect(result.syncedAt).toEqual(expect.any(String));
  });
});

function pageResult(
  currentPage: number,
  lastPage: number,
  processed: number,
  imported: number,
  reconciled: number,
  providerTotal: number,
): SenditProviderPageResult {
  return {
    currentPage,
    lastPage,
    providerTotal,
    hasMore: currentPage < lastPage,
    processed,
    imported,
    reconciled,
  };
}
