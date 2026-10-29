-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "stripeCheckoutPlanId" TEXT,
ADD COLUMN     "stripeCheckoutRequestId" TEXT,
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "BillingInvoice" ADD COLUMN     "stripeInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "StripeWebhookReceipt" (
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookReceipt_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCheckoutSessionId_key" ON "Subscription"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_stripeInvoiceId_key" ON "BillingInvoice"("stripeInvoiceId");
