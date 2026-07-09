import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ForceLogClient } from './forcelog.client';
import type {
  ForceLogParcelDto,
  ForceLogRelaunchDto,
  ForceLogRelaunchZoneDto,
} from './dto/forcelog-parcel.dto';
import type { ForceLogPickupDto } from './dto/forcelog-pickup.dto';
import type { ForceLogProductDto } from './dto/forcelog-product.dto';
import type { ForceLogReturnRequestDto } from './dto/forcelog-return.dto';
import { OzoneExpressClient } from './ozoneexpress.client';
import type {
  OzoneExpressDeliveryNoteParcelsDto,
  OzoneExpressParcelDto,
} from './dto/ozoneexpress-parcel.dto';
import { QuickLivraisonClient } from './quicklivraison.client';
import type { QuickLivraisonBulkDeliveryDto } from './dto/quicklivraison-bulk-delivery.dto';
import type { QuickLivraisonDeliveryDto } from './dto/quicklivraison-delivery.dto';
import { SenditClient } from './sendit.client';
import type { SenditDeliveryDto } from './dto/sendit-delivery.dto';
import type { SenditDistrictQueryDto } from './dto/sendit-district-query.dto';
import type { SenditLabelsDto } from './dto/sendit-labels.dto';
import type { SenditListQueryDto } from './dto/sendit-list-query.dto';
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
  private latestSenditWebhook: {
    receivedAt: string;
    headers: Record<string, string | string[] | undefined>;
    payload: unknown;
  } | null = null;

  private latestQuickLivraisonWebhook: {
    receivedAt: string;
    headers: Record<string, string | string[] | undefined>;
    payload: unknown;
  } | null = null;

  constructor(
    private readonly senditClient: SenditClient,
    private readonly quickLivraisonClient: QuickLivraisonClient,
    private readonly forceLogClient: ForceLogClient,
    private readonly ozoneExpressClient: OzoneExpressClient,
    private readonly configService: ConfigService,
  ) {}

  checkSenditConnection() {
    return this.senditClient.checkConnection();
  }

  listSenditDeliveries(query: SenditListQueryDto) {
    return this.senditClient.listDeliveries({
      page: query.page,
      querystring: query.querystring,
    });
  }

  createSenditDelivery(payload: SenditDeliveryDto) {
    return this.senditClient.createDelivery(payload);
  }

  getSenditDelivery(code: string) {
    return this.senditClient.getDelivery(code);
  }

  updateSenditDelivery(code: string, payload: SenditDeliveryDto) {
    return this.senditClient.updateDelivery(code, payload);
  }

  deleteSenditDelivery(code: string) {
    return this.senditClient.deleteDelivery(code);
  }

  printSenditDeliveryLabels(payload: SenditLabelsDto) {
    return this.senditClient.printDeliveryLabels(payload);
  }

  listSenditDeliveryStatuses() {
    return this.senditClient.listDeliveryStatuses();
  }

  listSenditDistricts(query: SenditDistrictQueryDto) {
    return this.senditClient.listDistricts({
      page: query.page,
      querystring: query.querystring,
      'pickup-district': query.pickupDistrict,
    });
  }

  listSenditPickupCities() {
    return this.senditClient.listPickupCities();
  }

  getSenditDistrict(id: number) {
    return this.senditClient.getDistrict(id);
  }

  listSenditPickups(query: SenditListQueryDto) {
    return this.senditClient.listPickups({
      page: query.page,
      querystring: query.querystring,
    });
  }

  createSenditPickup(payload: SenditPickupDto) {
    return this.senditClient.createPickup(payload);
  }

  getSenditPickup(code: string) {
    return this.senditClient.getPickup(code);
  }

  updateSenditPickup(code: string, payload: SenditUpdatePickupDto) {
    return this.senditClient.updatePickup(code, payload);
  }

  deleteSenditPickup(code: string) {
    return this.senditClient.deletePickup(code);
  }

  listSenditReturns(query: SenditListQueryDto) {
    return this.senditClient.listReturns({
      page: query.page,
      querystring: query.querystring,
    });
  }

  createSenditReturn(payload: SenditReturnDto) {
    return this.senditClient.createReturn(payload);
  }

  getSenditReturn(code: string) {
    return this.senditClient.getReturn(code);
  }

  updateSenditReturn(code: string, payload: SenditUpdateReturnDto) {
    return this.senditClient.updateReturn(code, payload);
  }

  deleteSenditReturn(code: string) {
    return this.senditClient.deleteReturn(code);
  }

  receiveSenditWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: unknown,
  ) {
    this.latestSenditWebhook = {
      receivedAt: new Date().toISOString(),
      headers: this.sanitizeWebhookHeaders(headers),
      payload,
    };

    return {
      success: true,
      message: 'Sendit webhook received',
    };
  }

  getLatestSenditWebhook() {
    this.assertWebhookDebugEnabled();

    return {
      success: true,
      data: this.latestSenditWebhook,
    };
  }

  checkQuickLivraisonConnection() {
    return this.quickLivraisonClient.checkConnection();
  }

  createQuickLivraisonDelivery(payload: QuickLivraisonDeliveryDto) {
    return this.quickLivraisonClient.createDelivery(payload);
  }

  createQuickLivraisonBulkDeliveries(payload: QuickLivraisonBulkDeliveryDto) {
    return this.quickLivraisonClient.createBulkDeliveries(payload.parcels);
  }

  listQuickLivraisonDeliveries() {
    return this.quickLivraisonClient.listDeliveries();
  }

  trackQuickLivraisonDelivery(trackingNumber: string) {
    return this.quickLivraisonClient.trackDelivery(trackingNumber);
  }

  getQuickLivraisonProducts() {
    return this.quickLivraisonClient.getProducts();
  }

  getQuickLivraisonCities() {
    return this.quickLivraisonClient.getCities();
  }

  getQuickLivraisonCitiesWithFeesAndDelays() {
    return this.quickLivraisonClient.getCitiesWithFeesAndDelays();
  }

  receiveQuickLivraisonWebhook(
    headers: Record<string, string | string[] | undefined>,
    payload: unknown,
    rawBody?: Buffer,
  ) {
    this.verifyQuickLivraisonWebhookSignature(headers, rawBody);

    this.latestQuickLivraisonWebhook = {
      receivedAt: new Date().toISOString(),
      headers: this.sanitizeWebhookHeaders(headers),
      payload,
    };

    return {
      success: true,
      message: 'QuickLivraison webhook received',
    };
  }

  getLatestQuickLivraisonWebhook() {
    this.assertWebhookDebugEnabled();

    return {
      success: true,
      data: this.latestQuickLivraisonWebhook,
    };
  }

  checkForceLogConnection() {
    return this.forceLogClient.checkConnection();
  }

  addForceLogParcel(payload: ForceLogParcelDto) {
    return this.forceLogClient.addParcel(payload);
  }

  getForceLogParcel(code: string) {
    return this.forceLogClient.getParcel(code);
  }

  relaunchForceLogParcel(payload: ForceLogRelaunchDto) {
    return this.forceLogClient.relaunchParcel(payload);
  }

  relaunchForceLogParcelZone(payload: ForceLogRelaunchZoneDto) {
    return this.forceLogClient.relaunchParcelZone(payload);
  }

  deleteForceLogParcel(code: string) {
    return this.forceLogClient.deleteParcel(code);
  }

  getForceLogParcelSticker(code: string) {
    return this.forceLogClient.getParcelSticker(code);
  }

  createForceLogPickup(payload: ForceLogPickupDto) {
    return this.forceLogClient.createPickup(payload);
  }

  getForceLogCities() {
    return this.forceLogClient.getCities();
  }

  getForceLogStock() {
    return this.forceLogClient.getStock();
  }

  addForceLogProduct(payload: ForceLogProductDto) {
    return this.forceLogClient.addProduct(payload);
  }

  getForceLogReturnEligibleParcels() {
    return this.forceLogClient.getReturnEligibleParcels();
  }

  requestForceLogReturn(payload: ForceLogReturnRequestDto) {
    return this.forceLogClient.requestReturn(payload);
  }

  checkOzoneExpressConnection() {
    return this.ozoneExpressClient.checkConnection();
  }

  addOzoneExpressParcel(payload: OzoneExpressParcelDto) {
    return this.ozoneExpressClient.addParcel(payload);
  }

  getOzoneExpressParcelInfo(trackingNumber: string) {
    return this.ozoneExpressClient.getParcelInfo(trackingNumber);
  }

  trackOzoneExpress(trackingNumber: string | string[]) {
    return this.ozoneExpressClient.track(trackingNumber);
  }

  createOzoneExpressDeliveryNote() {
    return this.ozoneExpressClient.createDeliveryNote();
  }

  addOzoneExpressParcelsToDeliveryNote(
    payload: OzoneExpressDeliveryNoteParcelsDto,
  ) {
    return this.ozoneExpressClient.addParcelsToDeliveryNote(payload);
  }

  saveOzoneExpressDeliveryNote(ref: string) {
    return this.ozoneExpressClient.saveDeliveryNote(ref);
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

  private verifyQuickLivraisonWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody?: Buffer,
  ) {
    const secret = this.configService.get<string>(
      'QUICKLIVRAISON_WEBHOOK_SECRET',
    );

    if (!secret) {
      return;
    }

    const signatureHeader = headers['x-webhook-signature'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;

    if (!signature || !rawBody) {
      throw new UnauthorizedException(
        'Missing QuickLivraison webhook signature',
      );
    }

    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      throw new UnauthorizedException(
        'Invalid QuickLivraison webhook signature',
      );
    }
  }
}
