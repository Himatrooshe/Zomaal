import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Render,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

// Plain server-rendered pages for the Zomaal Shop admin panel (Handlebars
// views under views/**, one vanilla-JS asset at public/app.js — no
// separate frontend project, no build step). These are HTML shells only;
// the actual data comes from the JSON API (shop/, merchants/, platform/,
// activity/, and the auth controllers) fetched
// client-side by public/app.js, since these pages carry no server session
// to render personalized/guarded data at request time. Auth is enforced
// the same way — public/app.js redirects to /login when there's no token,
// and every real read/write goes through the JWT-guarded API regardless.
//
// Intentionally do NOT redirect bare `/` to `/login` — that would advertise
// the admin portal. Operators must open `/login` deliberately.
@ApiExcludeController()
@Controller()
export class SuperAdminViewsController {
  @Get()
  root(): never {
    throw new NotFoundException();
  }

  @Get('login')
  @Render('login')
  login() {
    return {};
  }

  @Get('dashboard')
  @Render('dashboard')
  dashboard() {
    return {};
  }

  @Get('products')
  @Render('products')
  products() {
    return {};
  }

  @Get('categories')
  @Render('categories')
  categories() {
    return {};
  }

  @Get('orders')
  @Render('orders')
  orders() {
    return {};
  }

  @Get('orders/:orderId')
  @Render('order-detail')
  orderDetail(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { orderId };
  }

  @Get('banners')
  @Render('banners')
  banners() {
    return {};
  }

  @Get('promo-codes')
  @Render('promo-codes')
  promoCodes() {
    return {};
  }

  @Get('shop-settings')
  @Render('shop-settings')
  shopSettings() {
    return {};
  }

  @Get('merchants')
  @Render('merchants')
  merchants() {
    return {};
  }

  @Get('merchants/:userId')
  @Render('merchant-detail')
  merchantDetail(@Param('userId', ParseUUIDPipe) userId: string) {
    return { userId };
  }

  @Get('integrations')
  @Render('integrations')
  integrations() {
    return {};
  }

  @Get('blacklist')
  @Render('blacklist')
  blacklist() {
    return {};
  }

  @Get('activity')
  @Render('activity')
  activity() {
    return {};
  }

  @Get('settings')
  @Render('settings')
  settings() {
    return {};
  }
}
