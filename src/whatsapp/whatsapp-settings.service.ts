import { BadRequestException, Injectable } from '@nestjs/common';
import { StoreAccessService } from '../access/store-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireWhatsAppOwner } from './whatsapp-access.util';
import {
  MAX_DELAY_MINUTES,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TRIGGERS,
  WhatsAppTemplateStatus,
  isWhatsAppTrigger,
  type WhatsAppLanguage,
} from './whatsapp.constants';

export const TEMPLATE_VARIABLES = [
  'customer_name',
  'order_number',
  'store_name',
] as const;

@Injectable()
export class WhatsAppSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async listStatusSettings(userId: string) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const [settings, connection, templates] = await Promise.all([
      this.prisma.whatsAppStatusSetting.findMany({
        where: { storeId: access.storeId },
      }),
      this.prisma.whatsAppConnection.findUnique({
        where: { storeId: access.storeId },
        select: { language: true },
      }),
      this.prisma.whatsAppTemplate.findMany({
        where: { storeId: access.storeId },
        select: { name: true, language: true, status: true },
      }),
    ]);
    const language = (connection?.language ?? 'fr') as WhatsAppLanguage;
    const settingByTrigger = new Map(settings.map((s) => [s.trigger, s]));
    const statusByKey = new Map(
      templates.map((t) => [`${t.name}:${t.language}`, t.status]),
    );

    return {
      language,
      variables: TEMPLATE_VARIABLES,
      data: WHATSAPP_TRIGGERS.map((trigger) => {
        const setting = settingByTrigger.get(trigger);
        const template = WHATSAPP_TEMPLATES[trigger];
        return {
          trigger,
          enabled: setting?.enabled ?? false,
          delayMinutes: setting?.delayMinutes ?? 0,
          templateName: template.name,
          templateStatus:
            statusByKey.get(`${template.name}:${language}`) ??
            WhatsAppTemplateStatus.NOT_SUBMITTED,
          body: template.bodies[language],
        };
      }),
    };
  }

  async updateStatusSetting(
    userId: string,
    trigger: string,
    input: { enabled?: boolean; delayMinutes?: number },
  ) {
    if (!isWhatsAppTrigger(trigger)) {
      throw new BadRequestException(
        `trigger must be one of ${WHATSAPP_TRIGGERS.join(', ')}`,
      );
    }
    if (
      input.delayMinutes !== undefined &&
      (!Number.isInteger(input.delayMinutes) ||
        input.delayMinutes < 0 ||
        input.delayMinutes > MAX_DELAY_MINUTES)
    ) {
      throw new BadRequestException(
        `delayMinutes must be a whole number between 0 and ${MAX_DELAY_MINUTES}`,
      );
    }
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const data = {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.delayMinutes !== undefined
        ? { delayMinutes: input.delayMinutes }
        : {}),
    };
    await this.prisma.whatsAppStatusSetting.upsert({
      where: { storeId_trigger: { storeId: access.storeId, trigger } },
      create: { storeId: access.storeId, trigger, ...data },
      update: data,
    });
    const all = await this.listStatusSettings(userId);
    return all.data.find((s) => s.trigger === trigger)!;
  }

  async listTemplates(userId: string) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const rows = await this.prisma.whatsAppTemplate.findMany({
      where: { storeId: access.storeId },
    });
    const byKey = new Map(rows.map((r) => [`${r.name}:${r.language}`, r]));

    return {
      variables: TEMPLATE_VARIABLES,
      data: WHATSAPP_TRIGGERS.flatMap((trigger) => {
        const template = WHATSAPP_TEMPLATES[trigger];
        return WHATSAPP_LANGUAGES.map((language) => {
          const row = byKey.get(`${template.name}:${language}`);
          return {
            trigger,
            name: template.name,
            language,
            body: template.bodies[language],
            status: row?.status ?? WhatsAppTemplateStatus.NOT_SUBMITTED,
            rejectedReason: row?.rejectedReason ?? null,
            updatedAt: row?.updatedAt.toISOString() ?? null,
          };
        });
      }),
    };
  }
}
