import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuickLivraisonBulkDeliveryDto } from './dto/quicklivraison-bulk-delivery.dto';
import { QuickLivraisonDeliveryDto } from './dto/quicklivraison-delivery.dto';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping - QuickLivraison')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping/quicklivraison')
export class QuickLivraisonController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('connection')
  @ApiOperation({ summary: 'Check QuickLivraison account connection' })
  checkConnection() {
    return this.shippingService.checkQuickLivraisonConnection();
  }

  @Post('deliveries')
  @ApiOperation({ summary: 'Create a QuickLivraison delivery' })
  createDelivery(@Body() payload: QuickLivraisonDeliveryDto) {
    return this.shippingService.createQuickLivraisonDelivery(payload);
  }

  @Post('deliveries/bulk')
  @ApiOperation({ summary: 'Create QuickLivraison deliveries in bulk' })
  createBulkDeliveries(@Body() payload: QuickLivraisonBulkDeliveryDto) {
    return this.shippingService.createQuickLivraisonBulkDeliveries(payload);
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'List QuickLivraison deliveries' })
  listDeliveries() {
    return this.shippingService.listQuickLivraisonDeliveries();
  }

  @Get('deliveries/:trackingNumber')
  @ApiOperation({
    summary: 'Track a QuickLivraison delivery by tracking number',
  })
  trackDelivery(@Param('trackingNumber') trackingNumber: string) {
    return this.shippingService.trackQuickLivraisonDelivery(trackingNumber);
  }

  @Get('products')
  @ApiOperation({ summary: 'List QuickLivraison products in stock' })
  getProducts() {
    return this.shippingService.getQuickLivraisonProducts();
  }

  @Get('cities')
  @ApiOperation({ summary: 'List QuickLivraison city IDs' })
  getCities() {
    return this.shippingService.getQuickLivraisonCities();
  }

  @Get('cities/fees-delays')
  @ApiOperation({ summary: 'List QuickLivraison cities with fees and delays' })
  getCitiesWithFeesAndDelays() {
    return this.shippingService.getQuickLivraisonCitiesWithFeesAndDelays();
  }
}
