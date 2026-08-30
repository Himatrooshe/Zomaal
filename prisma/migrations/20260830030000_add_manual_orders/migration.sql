-- Adds MANUAL to EcommercePlatform (WhatsApp/phone/in-person orders entered
-- directly in Zomaal, no external platform to sync from) and the
-- manual-order-only customer fields on EcommerceOrder. Shopify/YouCan/
-- Lightfunnels orders intentionally omit customer PII at rest and fetch it
-- live from the platform at dispatch time; a manual order has no such
-- platform to query later, so it is captured here at creation instead.

-- AlterEnum
ALTER TYPE "EcommercePlatform" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "EcommerceOrder" ADD COLUMN     "manualCustomerName" TEXT,
ADD COLUMN     "manualCustomerPhone" TEXT,
ADD COLUMN     "manualShippingAddress" TEXT,
ADD COLUMN     "manualShippingCountry" TEXT,
ADD COLUMN     "manualNotes" TEXT;
