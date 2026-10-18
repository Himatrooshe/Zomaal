import { ShippingShipmentStatus } from '@prisma/client';

export const WHATSAPP_LANGUAGES = ['en', 'ar', 'fr'] as const;
export type WhatsAppLanguage = (typeof WHATSAPP_LANGUAGES)[number];

/** Courier statuses a merchant can automate a customer message for. */
export const WHATSAPP_TRIGGERS = [
  ShippingShipmentStatus.PICKED_UP,
  ShippingShipmentStatus.AT_WAREHOUSE,
  ShippingShipmentStatus.IN_TRANSIT,
  ShippingShipmentStatus.OUT_FOR_DELIVERY,
  ShippingShipmentStatus.POSTPONED,
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ShippingShipmentStatus.DELIVERED,
] as const;
export type WhatsAppTrigger = (typeof WHATSAPP_TRIGGERS)[number];

export function isWhatsAppTrigger(
  status: string | null | undefined,
): status is WhatsAppTrigger {
  return !!status && (WHATSAPP_TRIGGERS as readonly string[]).includes(status);
}

/** Meta's template statuses, plus NOT_SUBMITTED before we create it. */
export const WhatsAppTemplateStatus = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
} as const;

export const MAX_DELAY_MINUTES = 7 * 24 * 60;
export const MAX_SEND_ATTEMPTS = 3;
export const RETRY_DELAY_MINUTES = 5;
export const SENDING_STALE_MINUTES = 10;

export interface WhatsAppTemplateDefinition {
  trigger: WhatsAppTrigger;
  name: string;
  /** Body per language. {{1}} customer name, {{2}} order number, {{3}} store name. */
  bodies: Record<WhatsAppLanguage, string>;
}

/** Used for {{1}} when the order has no customer name. */
export const CUSTOMER_NAME_FALLBACK: Record<WhatsAppLanguage, string> = {
  en: 'there',
  ar: 'عميلنا العزيز',
  fr: 'cher client',
};

export const WHATSAPP_TEMPLATES: Record<
  WhatsAppTrigger,
  WhatsAppTemplateDefinition
> = {
  PICKED_UP: {
    trigger: 'PICKED_UP',
    name: 'zomaal_order_picked_up',
    bodies: {
      en: 'Hello {{1}}, your order {{2}} from {{3}} has been picked up by the courier and is on its way.',
      ar: 'مرحباً {{1}}، تم استلام طلبك {{2}} من {{3}} من طرف شركة التوصيل وهو في الطريق إليك.',
      fr: 'Bonjour {{1}}, votre commande {{2}} de {{3}} a été récupérée par le livreur et elle est en route.',
    },
  },
  AT_WAREHOUSE: {
    trigger: 'AT_WAREHOUSE',
    name: 'zomaal_order_at_warehouse',
    bodies: {
      en: "Hello {{1}}, your order {{2}} from {{3}} has arrived at the courier's warehouse and will be shipped soon.",
      ar: 'مرحباً {{1}}، وصل طلبك {{2}} من {{3}} إلى مستودع شركة التوصيل وسيتم شحنه قريباً.',
      fr: "Bonjour {{1}}, votre commande {{2}} de {{3}} est arrivée à l'entrepôt du transporteur et sera expédiée bientôt.",
    },
  },
  IN_TRANSIT: {
    trigger: 'IN_TRANSIT',
    name: 'zomaal_order_in_transit',
    bodies: {
      en: 'Hello {{1}}, your order {{2}} from {{3}} is in transit to your city.',
      ar: 'مرحباً {{1}}، طلبك {{2}} من {{3}} في الطريق إلى مدينتك.',
      fr: "Bonjour {{1}}, votre commande {{2}} de {{3}} est en cours d'acheminement vers votre ville.",
    },
  },
  OUT_FOR_DELIVERY: {
    trigger: 'OUT_FOR_DELIVERY',
    name: 'zomaal_order_out_for_delivery',
    bodies: {
      en: 'Hello {{1}}, your order {{2}} from {{3}} is out for delivery today. Please keep your phone available for the courier.',
      ar: 'مرحباً {{1}}، طلبك {{2}} من {{3}} خرج للتوصيل اليوم. يرجى إبقاء هاتفك متاحاً لعامل التوصيل.',
      fr: "Bonjour {{1}}, votre commande {{2}} de {{3}} est en cours de livraison aujourd'hui. Merci de rester joignable pour le livreur.",
    },
  },
  POSTPONED: {
    trigger: 'POSTPONED',
    name: 'zomaal_order_postponed',
    bodies: {
      en: 'Hello {{1}}, the delivery of your order {{2}} from {{3}} has been postponed. The courier will contact you to arrange a new time.',
      ar: 'مرحباً {{1}}، تم تأجيل توصيل طلبك {{2}} من {{3}}. سيتواصل معك عامل التوصيل لتحديد موعد جديد.',
      fr: "Bonjour {{1}}, la livraison de votre commande {{2}} de {{3}} a été reportée. Le livreur vous contactera pour convenir d'un nouveau créneau.",
    },
  },
  CANCELLED: {
    trigger: 'CANCELLED',
    name: 'zomaal_order_cancelled',
    bodies: {
      en: 'Hello {{1}}, the delivery of your order {{2}} from {{3}} has been cancelled. Please contact the store if you have any questions.',
      ar: 'مرحباً {{1}}، تم إلغاء توصيل طلبك {{2}} من {{3}}. يرجى التواصل مع المتجر لأي استفسار.',
      fr: 'Bonjour {{1}}, la livraison de votre commande {{2}} de {{3}} a été annulée. Contactez la boutique pour toute question.',
    },
  },
  REFUSED: {
    trigger: 'REFUSED',
    name: 'zomaal_order_refused',
    bodies: {
      en: 'Hello {{1}}, the courier reported that your order {{2}} from {{3}} was refused. If this is a mistake, please contact the store.',
      ar: 'مرحباً {{1}}، أفاد عامل التوصيل بأن طلبك {{2}} من {{3}} قد تم رفضه. إذا كان هذا خطأ، يرجى التواصل مع المتجر.',
      fr: "Bonjour {{1}}, le livreur a signalé que votre commande {{2}} de {{3}} a été refusée. S'il s'agit d'une erreur, merci de contacter la boutique.",
    },
  },
  DELIVERED: {
    trigger: 'DELIVERED',
    name: 'zomaal_order_delivered',
    bodies: {
      en: 'Hello {{1}}, your order {{2}} from {{3}} has been delivered. Thank you for shopping with us!',
      ar: 'مرحباً {{1}}، تم توصيل طلبك {{2}} من {{3}} بنجاح. شكراً لثقتك بنا!',
      fr: 'Bonjour {{1}}, votre commande {{2}} de {{3}} a bien été livrée. Merci pour votre confiance !',
    },
  },
};

/** Sample values Meta requires when a template with variables is submitted. */
export const TEMPLATE_EXAMPLE_VALUES: Record<WhatsAppLanguage, string[]> = {
  en: ['Customer', '#1001', 'Store'],
  ar: ['العميل', '#1001', 'المتجر'],
  fr: ['Client', '#1001', 'Boutique'],
};

export function renderTemplateBody(
  body: string,
  variables: readonly string[],
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, index: string) => {
    const value = variables[Number(index) - 1];
    return value ?? match;
  });
}

/** Stored `WhatsAppMessage.variables` JSON back to the ordered strings. */
export function templateVariables(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v: unknown) =>
    typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v),
  );
}

export function templateDefinitionByName(
  name: string,
): WhatsAppTemplateDefinition | null {
  return (
    Object.values(WHATSAPP_TEMPLATES).find((def) => def.name === name) ?? null
  );
}
