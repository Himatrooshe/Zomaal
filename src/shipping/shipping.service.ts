import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForceLogClient } from './forcelog.client';
import { ForceLogConnectionService } from './forcelog-connection.service';
import type { ConnectForceLogDto } from './dto/forcelog-connection.dto';
import type {
  ForceLogParcelDto,
  ForceLogRelaunchDto,
  ForceLogRelaunchZoneDto,
} from './dto/forcelog-parcel.dto';
import type { ForceLogPickupDto } from './dto/forcelog-pickup.dto';
import type { ForceLogProductDto } from './dto/forcelog-product.dto';
import type { ForceLogReturnRequestDto } from './dto/forcelog-return.dto';
import type {
  ForceLogShipmentQueryDto,
  ForceLogSyncQueryDto,
} from './dto/forcelog-shipment-query.dto';
import type { ForceLogOverviewQueryDto } from './dto/forcelog-overview-query.dto';
import { ForceLogShipmentService } from './forcelog-shipment.service';
import { ForceLogOverviewService } from './forcelog-overview.service';
import { OzoneExpressClient } from './ozoneexpress.client';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';
import type { ConnectOzoneExpressDto } from './dto/ozoneexpress-connection.dto';
import type {
  OzoneExpressDeliveryNoteParcelsDto,
  OzoneExpressParcelDto,
} from './dto/ozoneexpress-parcel.dto';
import type {
  OzoneExpressShipmentQueryDto,
  OzoneExpressSyncQueryDto,
} from './dto/ozoneexpress-shipment-query.dto';
import type { OzoneExpressOverviewQueryDto } from './dto/ozoneexpress-overview-query.dto';
import { OzoneExpressShipmentService } from './ozoneexpress-shipment.service';
import { OzoneExpressOverviewService } from './ozoneexpress-overview.service';
import { QuickLivraisonClient } from './quicklivraison.client';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { QuickLivraisonShipmentService } from './quicklivraison-shipment.service';
import { QuickLivraisonSyncService } from './quicklivraison-sync.service';
import { QuickLivraisonOverviewService } from './quicklivraison-overview.service';
import type { ConnectQuickLivraisonDto } from './dto/quicklivraison-connection.dto';
import type { QuickLivraisonBulkDeliveryDto } from './dto/quicklivraison-bulk-delivery.dto';
import type { QuickLivraisonDeliveryDto } from './dto/quicklivraison-delivery.dto';
import type { QuickLivraisonShipmentQueryDto } from './dto/quicklivraison-shipment-query.dto';
import type { QuickLivraisonOverviewQueryDto } from './dto/quicklivraison-overview-query.dto';
import { SenditClient } from './sendit.client';
import { SenditConnectionService } from './sendit-connection.service';
import { SenditShipmentService } from './sendit-shipment.service';
import { SenditSyncService } from './sendit-sync.service';
import { SenditOverviewService } from './sendit-overview.service';
import type { SenditDeliveryDto } from './dto/sendit-delivery.dto';
import type { SenditDistrictQueryDto } from './dto/sendit-district-query.dto';
import type { SenditLabelsDto } from './dto/sendit-labels.dto';
import type { SenditListQueryDto } from './dto/sendit-list-query.dto';
import type { SenditShipmentQueryDto } from './dto/sendit-shipment-query.dto';
import type { SenditSyncQueryDto } from './dto/sendit-sync-query.dto';
import type { SenditOverviewQueryDto } from './dto/sendit-overview-query.dto';
import type {
  SenditPickupDto,
  SenditUpdatePickupDto,
} from './dto/sendit-pickup.dto';
import type {
  SenditReturnDto,
  SenditUpdateReturnDto,
} from './dto/sendit-return.dto';

@Injectable()
export class ShippingService {
  private latestQuickLivraisonWebhook: {
    receivedAt: string;
    headers: Record<string, string | string[] | undefined>;
    payload: unknown;
  } | null = null;

  constructor(
    private readonly senditClient: SenditClient,
    private readonly senditConnectionService: SenditConnectionService,
    private readonly senditShipments: SenditShipmentService,
    private readonly senditSync: SenditSyncService,
    private readonly senditOverview: SenditOverviewService,
    private readonly quickLivraisonClient: QuickLivraisonClient,
    private readonly quickLivraisonConnectionService: QuickLivraisonConnectionService,
    private readonly quickLivraisonShipments: QuickLivraisonShipmentService,
    private readonly quickLivraisonSync: QuickLivraisonSyncService,
    private readonly quickLivraisonOverview: QuickLivraisonOverviewService,
    private readonly forceLogClient: ForceLogClient,
    private readonly forceLogConnectionService: ForceLogConnectionService,
    private readonly forceLogShipments: ForceLogShipmentService,
    private readonly forceLogOverview: ForceLogOverviewService,
    private readonly ozoneExpressClient: OzoneExpressClient,
    private readonly ozoneExpressConnectionService: OzoneExpressConnectionService,
    private readonly ozoneExpressShipments: OzoneExpressShipmentService,
    private readonly ozoneExpressOverview: OzoneExpressOverviewService,
    private readonly configService: ConfigService,
  ) {}

  connectSendit(
    userId: string,
    payload: import('./dto/sendit-connection.dto').ConnectSenditDto,
  ) {
    return this.senditConnectionService.connect(userId, payload);
  }

  checkSenditConnection(userId: string) {
    return this.senditConnectionService.getStatus(userId);
  }

  disconnectSendit(userId: string) {
    return this.senditConnectionService.disconnect(userId);
  }

  async listSenditDeliveries(userId: string, query: SenditListQueryDto) {
    return this.senditClient.listDeliveries(
      userId,
      await this.credentials(userId),
      {
        page: query.page,
        querystring: query.querystring,
      },
    );
  }

  async createSenditDelivery(userId: string, payload: SenditDeliveryDto) {
    const response = await this.senditClient.createDelivery(
      userId,
      await this.credentials(userId),
      payload,
    );
    await this.senditShipments.persistCreatedDelivery(
      userId,
      payload,
      response,
    );
    return response;
  }

  getStoredSenditShipment(userId: string, providerCode: string) {
    return this.senditShipments.getByProviderCode(userId, providerCode);
  }

  listStoredSenditShipments(userId: string, query: SenditShipmentQueryDto) {
    return this.senditShipments.list(userId, query);
  }

  getStoredSenditTimeline(userId: string, providerCode: string) {
    return this.senditShipments.getTimeline(userId, providerCode);
  }

  syncSenditShipments(userId: string, query: SenditSyncQueryDto) {
    return this.senditSync.sync(userId, query);
  }

  getSenditOverview(userId: string, query: SenditOverviewQueryDto) {
    return this.senditOverview.getOverview(userId, query);
  }

  async getSenditDelivery(userId: string, code: string) {
    return this.senditClient.getDelivery(
      userId,
      await this.credentials(userId),
      code,
    );
  }

  async updateSenditDelivery(
    userId: string,
    code: string,
    payload: SenditDeliveryDto,
  ) {
    return this.senditClient.updateDelivery(
      userId,
      await this.credentials(userId),
      code,
      payload,
    );
  }

  async deleteSenditDelivery(userId: string, code: string) {
    return this.senditClient.deleteDelivery(
      userId,
      await this.credentials(userId),
      code,
    );
  }

  async printSenditDeliveryLabels(userId: string, payload: SenditLabelsDto) {
    return this.senditClient.printDeliveryLabels(
      userId,
      await this.credentials(userId),
      payload,
    );
  }

  async listSenditDeliveryStatuses(userId: string) {
    return this.senditClient.listDeliveryStatuses(
      userId,
      await this.credentials(userId),
    );
  }

  async listSenditDistricts(userId: string, query: SenditDistrictQueryDto) {
    return this.senditClient.listDistricts(
      userId,
      await this.credentials(userId),
      {
        page: query.page,
        querystring: query.querystring,
        'pickup-district': query.pickupDistrict,
      },
    );
  }

  async listSenditPickupCities(userId: string) {
    return this.senditClient.listPickupCities(
      userId,
      await this.credentials(userId),
    );
  }

  async getSenditDistrict(userId: string, id: number) {
    return this.senditClient.getDistrict(
      userId,
      await this.credentials(userId),
      id,
    );
  }

  async listSenditPickups(userId: string, query: SenditListQueryDto) {
    return this.senditClient.listPickups(
      userId,
      await this.credentials(userId),
      {
        page: query.page,
        querystring: query.querystring,
      },
    );
  }

  async createSenditPickup(userId: string, payload: SenditPickupDto) {
    return this.senditClient.createPickup(
      userId,
      await this.credentials(userId),
      payload,
    );
  }

  async getSenditPickup(userId: string, code: string) {
    return this.senditClient.getPickup(
      userId,
      await this.credentials(userId),
      code,
    );
  }

  async updateSenditPickup(
    userId: string,
    code: string,
    payload: SenditUpdatePickupDto,
  ) {
    return this.senditClient.updatePickup(
      userId,
      await this.credentials(userId),
      code,
      payload,
    );
  }

  async deleteSenditPickup(userId: string, code: string) {
    return this.senditClient.deletePickup(
      userId,
      await this.credentials(userId),
      code,
    );
  }

  async listSenditReturns(userId: string, query: SenditListQueryDto) {
    return this.senditClient.listReturns(
      userId,
      await this.credentials(userId),
      {
        page: query.page,
        querystring: query.querystring,
      },
    );
  }

  async createSenditReturn(userId: string, payload: SenditReturnDto) {
    return this.senditClient.createReturn(
      userId,
      await this.credentials(userId),
      payload,
    );
  }

  async getSenditReturn(userId: string, code: string) {
    return this.senditClient.getReturn(
      userId,
      await this.credentials(userId),
      code,
    );
  }

  async updateSenditReturn(
    userId: string,
    code: string,
    payload: SenditUpdateReturnDto,
  ) {
    return this.senditClient.updateReturn(
      userId,
      await this.credentials(userId),
      code,
      payload,
    );
  }

  async deleteSenditReturn(userId: string, code: string) {
    return this.senditClient.deleteReturn(
      userId,
      await this.credentials(userId),
      code,
    );
  }

  private credentials(userId: string) {
    return this.senditConnectionService.getCredentials(userId);
  }

  receiveSenditWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: unknown,
    rawBody?: Buffer,
  ) {
    return this.senditShipments.processStatusWebhook(headers, payload, rawBody);
  }

  connectQuickLivraison(userId: string, payload: ConnectQuickLivraisonDto) {
    return this.quickLivraisonConnectionService.connect(userId, payload);
  }

  checkQuickLivraisonConnection(userId: string) {
    return this.quickLivraisonConnectionService.getStatus(userId);
  }

  disconnectQuickLivraison(userId: string) {
    return this.quickLivraisonConnectionService.disconnect(userId);
  }

  async createQuickLivraisonDelivery(
    userId: string,
    payload: QuickLivraisonDeliveryDto,
  ) {
    const response = await this.quickLivraisonClient.createDelivery(
      await this.quickLivraisonConnectionService.getApiKey(userId),
      payload,
    );
    await this.quickLivraisonShipments.persistCreatedDelivery(
      userId,
      payload,
      response,
    );
    return response;
  }

  async createQuickLivraisonBulkDeliveries(
    userId: string,
    payload: QuickLivraisonBulkDeliveryDto,
  ) {
    const response = await this.quickLivraisonClient.createBulkDeliveries(
      await this.quickLivraisonConnectionService.getApiKey(userId),
      payload.parcels,
    );
    await this.quickLivraisonShipments.persistBulkCreatedDeliveries(
      userId,
      payload.parcels,
      response,
    );
    return response;
  }

  getQuickLivraisonShipment(userId: string, trackingNumber: string) {
    return this.quickLivraisonShipments.getByProviderCode(
      userId,
      trackingNumber,
    );
  }

  listQuickLivraisonShipments(
    userId: string,
    query: QuickLivraisonShipmentQueryDto,
  ) {
    return this.quickLivraisonShipments.list(userId, query);
  }

  getQuickLivraisonTimeline(userId: string, trackingNumber: string) {
    return this.quickLivraisonShipments.getTimeline(userId, trackingNumber);
  }

  syncQuickLivraisonShipments(userId: string) {
    return this.quickLivraisonSync.sync(userId);
  }

  getQuickLivraisonOverview(
    userId: string,
    query: QuickLivraisonOverviewQueryDto,
  ) {
    return this.quickLivraisonOverview.getOverview(userId, query);
  }

  async listQuickLivraisonDeliveries(userId: string) {
    return this.quickLivraisonClient.listDeliveries(
      await this.quickLivraisonConnectionService.getApiKey(userId),
    );
  }

  trackQuickLivraisonDelivery(trackingNumber: string) {
    return this.quickLivraisonClient.trackDelivery(trackingNumber);
  }

  async getQuickLivraisonProducts(userId: string) {
    return this.quickLivraisonClient.getProducts(
      await this.quickLivraisonConnectionService.getApiKey(userId),
    );
  }

  getQuickLivraisonCities() {
    return this.quickLivraisonClient.getCities();
  }

  getQuickLivraisonCitiesWithFeesAndDelays() {
    return this.quickLivraisonClient.getCitiesWithFeesAndDelays();
  }

  async receiveQuickLivraisonWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: unknown,
    rawBody?: Buffer,
  ) {
    const result = await this.quickLivraisonShipments.processStatusWebhook(
      headers,
      payload,
      rawBody,
    );

    this.latestQuickLivraisonWebhook = {
      receivedAt: new Date().toISOString(),
      headers: this.sanitizeWebhookHeaders(headers),
      payload,
    };

    return result;
  }

  getLatestQuickLivraisonWebhook() {
    this.assertWebhookDebugEnabled();

    return {
      success: true,
      data: this.latestQuickLivraisonWebhook,
    };
  }

  connectForceLog(userId: string, payload: ConnectForceLogDto) {
    return this.forceLogConnectionService.connect(userId, payload);
  }

  checkForceLogConnection(userId: string) {
    return this.forceLogConnectionService.getStatus(userId);
  }

  disconnectForceLog(userId: string) {
    return this.forceLogConnectionService.disconnect(userId);
  }

  async addForceLogParcel(userId: string, payload: ForceLogParcelDto) {
    const response = await this.forceLogClient.addParcel(
      await this.forceLogConnectionService.getApiKey(userId),
      payload,
    );
    await this.forceLogShipments.persistCreatedParcel(
      userId,
      payload,
      response,
    );
    return response;
  }

  async getForceLogParcel(userId: string, code: string) {
    const response = await this.forceLogClient.getParcel(
      await this.forceLogConnectionService.getApiKey(userId),
      code,
    );
    await this.forceLogShipments.reconcileProviderParcel(
      userId,
      code,
      response,
    );
    return response;
  }

  listForceLogShipments(userId: string, query: ForceLogShipmentQueryDto) {
    return this.forceLogShipments.list(userId, query);
  }

  getForceLogShipment(userId: string, code: string) {
    return this.forceLogShipments.getByProviderCode(userId, code);
  }

  getForceLogTimeline(userId: string, code: string) {
    return this.forceLogShipments.getTimeline(userId, code);
  }

  refreshForceLogShipment(userId: string, code: string) {
    return this.forceLogShipments.refresh(userId, code);
  }

  syncForceLogShipments(userId: string, query: ForceLogSyncQueryDto) {
    return this.forceLogShipments.sync(userId, query);
  }

  getForceLogOverview(userId: string, query: ForceLogOverviewQueryDto) {
    return this.forceLogOverview.getOverview(userId, query);
  }

  async relaunchForceLogParcel(userId: string, payload: ForceLogRelaunchDto) {
    return this.forceLogClient.relaunchParcel(
      await this.forceLogConnectionService.getApiKey(userId),
      payload,
    );
  }

  async relaunchForceLogParcelZone(
    userId: string,
    payload: ForceLogRelaunchZoneDto,
  ) {
    return this.forceLogClient.relaunchParcelZone(
      await this.forceLogConnectionService.getApiKey(userId),
      payload,
    );
  }

  async deleteForceLogParcel(userId: string, code: string) {
    return this.forceLogClient.deleteParcel(
      await this.forceLogConnectionService.getApiKey(userId),
      code,
    );
  }

  async getForceLogParcelSticker(userId: string, code: string) {
    return this.forceLogClient.getParcelSticker(
      await this.forceLogConnectionService.getApiKey(userId),
      code,
    );
  }

  async createForceLogPickup(userId: string, payload: ForceLogPickupDto) {
    return this.forceLogClient.createPickup(
      await this.forceLogConnectionService.getApiKey(userId),
      payload,
    );
  }

  async getForceLogCities(userId: string) {
    return this.forceLogClient.getCities(
      await this.forceLogConnectionService.getApiKey(userId),
    );
  }

  async getForceLogStock(userId: string) {
    return this.forceLogClient.getStock(
      await this.forceLogConnectionService.getApiKey(userId),
    );
  }

  async addForceLogProduct(userId: string, payload: ForceLogProductDto) {
    return this.forceLogClient.addProduct(
      await this.forceLogConnectionService.getApiKey(userId),
      payload,
    );
  }

  async getForceLogReturnEligibleParcels(userId: string) {
    return this.forceLogClient.getReturnEligibleParcels(
      await this.forceLogConnectionService.getApiKey(userId),
    );
  }

  async requestForceLogReturn(
    userId: string,
    payload: ForceLogReturnRequestDto,
  ) {
    return this.forceLogClient.requestReturn(
      await this.forceLogConnectionService.getApiKey(userId),
      payload,
    );
  }

  connectOzoneExpress(userId: string, payload: ConnectOzoneExpressDto) {
    return this.ozoneExpressConnectionService.connect(userId, payload);
  }

  checkOzoneExpressConnection(userId: string) {
    return this.ozoneExpressConnectionService.getStatus(userId);
  }

  disconnectOzoneExpress(userId: string) {
    return this.ozoneExpressConnectionService.disconnect(userId);
  }

  async addOzoneExpressParcel(userId: string, payload: OzoneExpressParcelDto) {
    const response = await this.ozoneExpressClient.addParcel(
      await this.ozoneExpressConnectionService.getCredentials(userId),
      payload,
    );
    await this.ozoneExpressShipments.persistCreatedParcel(
      userId,
      payload,
      response,
    );
    return response;
  }

  async getOzoneExpressParcelInfo(userId: string, trackingNumber: string) {
    const response = await this.ozoneExpressClient.getParcelInfo(
      await this.ozoneExpressConnectionService.getCredentials(userId),
      trackingNumber,
    );
    await this.ozoneExpressShipments.reconcileParcelInfo(
      userId,
      trackingNumber,
      response,
    );
    return response;
  }

  async trackOzoneExpress(userId: string, trackingNumber: string | string[]) {
    const response = await this.ozoneExpressClient.track(
      await this.ozoneExpressConnectionService.getCredentials(userId),
      trackingNumber,
    );
    await this.ozoneExpressShipments.reconcileTracking(userId, response);
    return response;
  }

  listOzoneExpressShipments(
    userId: string,
    query: OzoneExpressShipmentQueryDto,
  ) {
    return this.ozoneExpressShipments.list(userId, query);
  }

  getOzoneExpressShipment(userId: string, trackingNumber: string) {
    return this.ozoneExpressShipments.getByProviderCode(userId, trackingNumber);
  }

  getOzoneExpressTimeline(userId: string, trackingNumber: string) {
    return this.ozoneExpressShipments.getTimeline(userId, trackingNumber);
  }

  refreshOzoneExpressShipment(userId: string, trackingNumber: string) {
    return this.ozoneExpressShipments.refresh(userId, trackingNumber);
  }

  syncOzoneExpressShipments(userId: string, query: OzoneExpressSyncQueryDto) {
    return this.ozoneExpressShipments.sync(userId, query);
  }

  getOzoneExpressOverview(userId: string, query: OzoneExpressOverviewQueryDto) {
    return this.ozoneExpressOverview.getOverview(userId, query);
  }

  async createOzoneExpressDeliveryNote(userId: string) {
    return this.ozoneExpressClient.createDeliveryNote(
      await this.ozoneExpressConnectionService.getCredentials(userId),
    );
  }

  async addOzoneExpressParcelsToDeliveryNote(
    userId: string,
    payload: OzoneExpressDeliveryNoteParcelsDto,
  ) {
    return this.ozoneExpressClient.addParcelsToDeliveryNote(
      await this.ozoneExpressConnectionService.getCredentials(userId),
      payload,
    );
  }

  async saveOzoneExpressDeliveryNote(userId: string, ref: string) {
    return this.ozoneExpressClient.saveDeliveryNote(
      await this.ozoneExpressConnectionService.getCredentials(userId),
      ref,
    );
  }

  getOzoneExpressDeliveryNotePdfLinks(ref: string) {
    return this.ozoneExpressClient.getDeliveryNotePdfLinks(ref);
  }

  getOzoneExpressCities() {
    return this.ozoneExpressClient.getCities();
  }

  private assertWebhookDebugEnabled() {
    if (this.configService.get<string>('WEBHOOK_DEBUG_ENABLED') !== 'true') {
      throw new NotFoundException('Webhook debug endpoint is disabled');
    }
  }

  private sanitizeWebhookHeaders(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const allowedHeaders = [
      'content-type',
      'user-agent',
      'x-webhook-event',
      'x-forwarded-for',
    ];

    return Object.fromEntries(
      Object.entries(headers).filter(([key]) =>
        allowedHeaders.includes(key.toLowerCase()),
      ),
    );
  }
}
