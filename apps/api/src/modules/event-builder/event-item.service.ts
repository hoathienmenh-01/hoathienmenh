import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  validateEventItem,
  validateEventChestLootTable,
  type EventItemDef,
  type EventItemKind,
  type EventChestLootEntry,
  type EventRewardContext,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — EventItemService.
 *
 * CRUD `EventItemConfig`. Toàn bộ mutation đi qua `validateEventItem` ở
 * shared (chặn Group D top pháp bảo, ITEM_CAP_REQUIRED cho ephemeral kind,
 * tier overflow theo risk group).
 */
@Injectable()
export class EventItemService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventKey?: string): Promise<EventItemDef[]> {
    const rows = await this.prisma.eventItemConfig.findMany({
      where: eventKey ? { eventKey } : undefined,
      orderBy: [{ enabled: 'desc' }, { itemKind: 'asc' }, { key: 'asc' }],
      take: 500,
    });
    return rows.map((r) => this.toShared(r));
  }

  async upsert(input: EventItemDef, _adminUserId: string): Promise<EventItemDef> {
    const v = validateEventItem(input);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'EVENT_ITEM_INVALID', meta: { issues: v.errors } },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const row = await this.prisma.eventItemConfig.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        eventKey: input.eventKey ?? null,
        name: input.name,
        description: input.description ?? '',
        itemKind: input.itemKind,
        itemTier: input.itemTier,
        rarity: input.rarity,
        category: input.category,
        expiresAt: input.expiresAt ?? null,
        tradeable: input.tradeable,
        bindOnPickup: input.bindOnPickup,
        maxStack: input.maxStack,
        dailyGainCap: input.dailyGainCap ?? null,
        weeklyGainCap: input.weeklyGainCap ?? null,
        eventGainCap: input.eventGainCap ?? null,
        allowedSourcesJson: input.allowedSources as unknown as object,
        forbiddenSourcesJson: input.forbiddenSources as unknown as object,
        sourceHint: input.sourceHint ?? null,
        enabled: input.enabled,
      },
      update: {
        eventKey: input.eventKey ?? null,
        name: input.name,
        description: input.description ?? '',
        itemKind: input.itemKind,
        itemTier: input.itemTier,
        rarity: input.rarity,
        category: input.category,
        expiresAt: input.expiresAt ?? null,
        tradeable: input.tradeable,
        bindOnPickup: input.bindOnPickup,
        maxStack: input.maxStack,
        dailyGainCap: input.dailyGainCap ?? null,
        weeklyGainCap: input.weeklyGainCap ?? null,
        eventGainCap: input.eventGainCap ?? null,
        allowedSourcesJson: input.allowedSources as unknown as object,
        forbiddenSourcesJson: input.forbiddenSources as unknown as object,
        sourceHint: input.sourceHint ?? null,
        enabled: input.enabled,
      },
    });
    return this.toShared(row);
  }

  async upsertLootTable(
    itemKey: string,
    loot: readonly EventChestLootEntry[],
    ctx: EventRewardContext,
  ): Promise<{ ok: true }> {
    const v = validateEventChestLootTable(loot, ctx);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'CHEST_LOOT_INVALID', meta: { issues: v.errors } },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.prisma.eventItemConfig.findUnique({
      where: { key: itemKey },
    });
    if (!existing) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_ITEM_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.eventItemConfig.update({
      where: { key: itemKey },
      data: { lootTableJson: loot as unknown as object },
    });
    return { ok: true };
  }

  private toShared(row: {
    key: string;
    eventKey: string | null;
    name: string;
    description: string;
    itemKind: string;
    itemTier: number;
    rarity: string;
    category: string;
    expiresAt: Date | null;
    tradeable: boolean;
    bindOnPickup: boolean;
    maxStack: number;
    dailyGainCap: number | null;
    weeklyGainCap: number | null;
    eventGainCap: number | null;
    allowedSourcesJson: unknown;
    forbiddenSourcesJson: unknown;
    sourceHint: string | null;
    enabled: boolean;
  }): EventItemDef {
    const allowed = Array.isArray(row.allowedSourcesJson)
      ? (row.allowedSourcesJson as string[])
      : [];
    const forbidden = Array.isArray(row.forbiddenSourcesJson)
      ? (row.forbiddenSourcesJson as string[])
      : [];
    return {
      key: row.key,
      name: row.name,
      description: row.description,
      itemKind: row.itemKind as EventItemKind,
      itemTier: row.itemTier,
      rarity: row.rarity as EventItemDef['rarity'],
      category: row.category,
      eventKey: row.eventKey,
      expiresAt: row.expiresAt,
      tradeable: row.tradeable,
      bindOnPickup: row.bindOnPickup,
      maxStack: row.maxStack,
      dailyGainCap: row.dailyGainCap,
      weeklyGainCap: row.weeklyGainCap,
      eventGainCap: row.eventGainCap,
      allowedSources: allowed,
      forbiddenSources: forbidden,
      sourceHint: row.sourceHint,
      enabled: row.enabled,
    };
  }
}
