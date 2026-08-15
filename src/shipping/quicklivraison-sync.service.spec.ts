import { QuickLivraisonSyncService } from './quicklivraison-sync.service';

describe('QuickLivraisonSyncService', () => {
  const listDeliveries = jest.fn();
  const getApiKey = jest.fn().mockResolvedValue('api-key');
  const updateSyncHealth = jest.fn();
  const reconcileProviderDeliveries = jest.fn();
  const service = new QuickLivraisonSyncService(
    { listDeliveries } as never,
    { getApiKey, updateSyncHealth } as never,
    { reconcileProviderDeliveries } as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports and reconciles the complete provider list', async () => {
    listDeliveries.mockResolvedValue([{ tracking_number: 'P1' }]);
    reconcileProviderDeliveries.mockResolvedValue({
      processed: 10,
      imported: 8,
      reconciled: 2,
    });

    const result = await service.sync('user-1');

    expect(listDeliveries).toHaveBeenCalledWith('api-key');
    expect(reconcileProviderDeliveries).toHaveBeenCalledWith('user-1', [
      { tracking_number: 'P1' },
    ]);
    expect(result).toMatchObject({
      success: true,
      processed: 10,
      imported: 8,
      reconciled: 2,
    });
    expect(updateSyncHealth).toHaveBeenCalledWith(
      'user-1',
      expect.any(Date),
      null,
    );
  });

  it('stores the latest sync error and preserves the provider failure', async () => {
    listDeliveries.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.sync('user-1')).rejects.toThrow(
      'provider unavailable',
    );
    expect(updateSyncHealth).toHaveBeenCalledWith(
      'user-1',
      null,
      'provider unavailable',
    );
  });
});
