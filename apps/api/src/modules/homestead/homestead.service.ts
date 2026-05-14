import { Injectable } from '@nestjs/common';
import { CurrencyKind, type Prisma } from '@prisma/client';
import {
  HOMESTEAD_CROPS,
  HOMESTEAD_GARDEN_PRODUCTIONS,
  HOMESTEAD_MAX_LEVEL,
  canUseHomesteadTier,
  getHomesteadCropDef,
  getHomesteadGardenProductionDef,
  getHomesteadLevelDef,
  homesteadOfflineRegenEnergy,
  homesteadStorageCap,
  realmMeetsHomesteadRequirement,
  HOMESTEAD_SPIRITUAL_ENERGY_REGEN_PER_HOUR,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RemoteConfigService } from '../remote-config/remote-config.service';
import { WorldCapError, WorldCapService } from '../world-content/world-cap.service';

type HomesteadWithPlots = Prisma.HomesteadGetPayload<{
  include: { fields: true; garden: true };
}>;

@Injectable()
export class HomesteadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly worldCap: WorldCapService,
    private readonly remoteConfig: RemoteConfigService,
  ) {}

  async getOverview(characterId: string, now = new Date()): Promise<HomesteadOverview> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, realmKey: true, linhThach: true },
    });
    if (!character) throw new HomesteadError('CHARACTER_NOT_FOUND');
    const homestead = await this.ensureHomestead(characterId, now);
    await this.syncEnergy(homestead, now, await this.getBalance());
    const fresh = await this.readHomestead(characterId);
    if (!fresh) throw new HomesteadError('HOMESTEAD_NOT_FOUND');
    return this.toOverview(fresh, character.realmKey, character.linhThach, now, await this.getBalance());
  }

  async upgrade(characterId: string, now = new Date()): Promise<HomesteadUpgradeResult> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, realmKey: true, linhThach: true },
    });
    if (!character) throw new HomesteadError('CHARACTER_NOT_FOUND');
    const homestead = await this.ensureHomestead(characterId, now);
    const balance = await this.getBalance();
    const synced = await this.syncEnergy(homestead, now, balance);
    if (synced.level >= HOMESTEAD_MAX_LEVEL) throw new HomesteadError('MAX_LEVEL');
    const currentDef = getHomesteadLevelDef(synced.level);
    const nextDef = getHomesteadLevelDef(synced.level + 1);
    if (!currentDef || !nextDef) throw new HomesteadError('CONFIG_NOT_FOUND');
    const linhThachCost = scaleInt(currentDef.upgradeCostLinhThach, balance.upgradeCostMultiplier);
    const energyCost = scaleInt(currentDef.upgradeCostSpiritualEnergy, balance.upgradeCostMultiplier);
    if (!realmMeetsHomesteadRequirement(character.realmKey, nextDef.requiredRealmKey)) {
      throw new HomesteadError('REALM_TOO_LOW');
    }
    if (character.linhThach < BigInt(linhThachCost)) {
      throw new HomesteadError('INSUFFICIENT_FUNDS');
    }
    if (synced.spiritualEnergy < energyCost) {
      throw new HomesteadError('INSUFFICIENT_SPIRITUAL_ENERGY');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.homestead.findUnique({
        where: { id: synced.id },
        select: { id: true, level: true, spiritualEnergy: true },
      });
      if (!row || row.level !== synced.level) throw new HomesteadError('STATE_CHANGED');
      if (row.spiritualEnergy < energyCost) {
        throw new HomesteadError('INSUFFICIENT_SPIRITUAL_ENERGY');
      }
      await this.currency.applyTx(tx, {
        characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: BigInt(-linhThachCost),
        reason: 'HOMESTEAD_UPGRADE',
        refType: 'Homestead',
        refId: row.id,
      });
      const updated = await tx.homestead.update({
        where: { id: row.id },
        data: {
          level: { increment: 1 },
          spiritualEnergy: { decrement: energyCost },
          spiritualEnergyUpdatedAt: now,
        },
      });
      return updated;
    });

    return {
      fromLevel: synced.level,
      toLevel: result.level,
      linhThachConsumed: linhThachCost,
      spiritualEnergyConsumed: energyCost,
      homestead: this.toHomesteadView(result, character.realmKey, BigInt(0), now, balance).homestead,
    };
  }

  async listFields(characterId: string, now = new Date()): Promise<HomesteadFieldsResponse> {
    const overview = await this.getOverview(characterId, now);
    return {
      homestead: overview.homestead,
      slots: overview.fields,
      cropCatalog: overview.cropCatalog,
      caps: overview.caps,
    };
  }

  async plantField(
    characterId: string,
    input: { slotIndex: number; cropKey: string },
    now = new Date(),
  ): Promise<HomesteadFieldSlotView> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, realmKey: true },
    });
    if (!character) throw new HomesteadError('CHARACTER_NOT_FOUND');
    const crop = getHomesteadCropDef(input.cropKey);
    if (!crop) throw new HomesteadError('CROP_NOT_FOUND');
    const balance = await this.getBalance();
    const homestead = await this.ensureHomestead(characterId, now);
    const synced = await this.syncEnergy(homestead, now, balance);
    const levelDef = getHomesteadLevelDef(synced.level);
    if (!levelDef) throw new HomesteadError('CONFIG_NOT_FOUND');
    if (!Number.isInteger(input.slotIndex) || input.slotIndex < 0 || input.slotIndex >= levelDef.fieldSlots) {
      throw new HomesteadError('SLOT_LOCKED');
    }
    const tierGate = canUseHomesteadTier(crop.tier, {
      homesteadLevel: synced.level,
      realmKey: character.realmKey,
    });
    if (!tierGate.allowed) {
      throw new HomesteadError(tierGate.reason ?? 'REALM_TOO_LOW');
    }
    if (!realmMeetsHomesteadRequirement(character.realmKey, crop.requiredRealmKey)) {
      throw new HomesteadError('REALM_TOO_LOW');
    }
    if (synced.spiritualEnergy < crop.spiritualEnergyCost) {
      throw new HomesteadError('INSUFFICIENT_SPIRITUAL_ENERGY');
    }
    const active = await this.prisma.homesteadField.findUnique({
      where: {
        homesteadId_slotIndex: { homesteadId: synced.id, slotIndex: input.slotIndex },
      },
      select: { id: true },
    });
    if (active) throw new HomesteadError('SLOT_OCCUPIED');

    const readyAt = new Date(now.getTime() + scaleInt(crop.growthMinutes, balance.fieldGrowthMinutesMultiplier) * 60_000);
    const plot = await this.prisma.$transaction(async (tx) => {
      const row = await tx.homestead.findUnique({
        where: { id: synced.id },
        select: { id: true, spiritualEnergy: true },
      });
      if (!row || row.spiritualEnergy < crop.spiritualEnergyCost) {
        throw new HomesteadError('INSUFFICIENT_SPIRITUAL_ENERGY');
      }
      await tx.homestead.update({
        where: { id: synced.id },
        data: {
          spiritualEnergy: { decrement: crop.spiritualEnergyCost },
          spiritualEnergyUpdatedAt: now,
        },
      });
      return tx.homesteadField.create({
        data: {
          homesteadId: synced.id,
          slotIndex: input.slotIndex,
          cropKey: crop.key,
          outputItemKey: crop.outputItemKey,
          expectedYield: crop.yieldQty,
          plantedAt: now,
          readyAt,
        },
      });
    });
    return this.toFieldSlot(input.slotIndex, plot, now);
  }

  async harvestField(
    characterId: string,
    input: { slotIndex: number },
    now = new Date(),
  ): Promise<HomesteadHarvestResult> {
    const homestead = await this.ensureHomestead(characterId, now);
    const field = await this.prisma.homesteadField.findUnique({
      where: { homesteadId_slotIndex: { homesteadId: homestead.id, slotIndex: input.slotIndex } },
    });
    if (!field) throw new HomesteadError('FIELD_NOT_FOUND');
    if (field.harvestedAt) throw new HomesteadError('ALREADY_CLAIMED');
    if (field.readyAt.getTime() > now.getTime()) throw new HomesteadError('NOT_READY');
    const crop = getHomesteadCropDef(field.cropKey);
    if (!crop) throw new HomesteadError('CROP_NOT_FOUND');
    const balance = await this.getBalance();
    const dailyCapQty = scaleInt(crop.dailyCapQty, balance.dailyCapMultiplier);

    const grant = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.homesteadField.updateMany({
        where: {
          id: field.id,
          harvestedAt: null,
          readyAt: { lte: now },
        },
        data: { harvestedAt: now },
      });
      if (updated.count !== 1) throw new HomesteadError('ALREADY_CLAIMED');
      const cap = await this.worldCap.consumeDailyTx(tx, {
        characterId,
        capKey: `homestead:field:${crop.outputItemKey}`,
        source: 'HOMESTEAD_FIELD',
        limitQty: dailyCapQty,
        qtyDelta: field.expectedYield,
        countDelta: 1,
        now,
      });
      await this.inventory.grantTx(
        tx,
        characterId,
        [{ itemKey: field.outputItemKey, qty: field.expectedYield }],
        {
          reason: 'HOMESTEAD_FIELD_HARVEST',
          refType: 'HomesteadField',
          refId: field.id,
          extra: { cropKey: field.cropKey, slotIndex: field.slotIndex, dayBucket: cap.dayBucket },
        },
      );
      await tx.homesteadField.delete({ where: { id: field.id } });
      return cap;
    });

    return {
      slotIndex: input.slotIndex,
      cropKey: field.cropKey,
      itemKey: field.outputItemKey,
      qty: field.expectedYield,
      dayBucket: grant.dayBucket,
      dailyUsedQty: grant.usedQty,
      dailyLimitQty: dailyCapQty,
    };
  }

  async listGarden(characterId: string, now = new Date()): Promise<HomesteadGardenResponse> {
    const overview = await this.getOverview(characterId, now);
    return {
      homestead: overview.homestead,
      slots: overview.garden,
      productionCatalog: overview.gardenCatalog,
      caps: overview.caps,
    };
  }

  async startGarden(
    characterId: string,
    input: { slotIndex: number; productionKey: string },
    now = new Date(),
  ): Promise<HomesteadGardenSlotView> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, realmKey: true },
    });
    if (!character) throw new HomesteadError('CHARACTER_NOT_FOUND');
    const prod = getHomesteadGardenProductionDef(input.productionKey);
    if (!prod) throw new HomesteadError('PRODUCTION_NOT_FOUND');
    const balance = await this.getBalance();
    const homestead = await this.ensureHomestead(characterId, now);
    const synced = await this.syncEnergy(homestead, now, balance);
    const levelDef = getHomesteadLevelDef(synced.level);
    if (!levelDef) throw new HomesteadError('CONFIG_NOT_FOUND');
    if (!Number.isInteger(input.slotIndex) || input.slotIndex < 0 || input.slotIndex >= levelDef.gardenSlots) {
      throw new HomesteadError('SLOT_LOCKED');
    }
    if (prod.tier > levelDef.maxGardenTier) throw new HomesteadError('HOMESTEAD_LEVEL_TOO_LOW');
    const tierGate = canUseHomesteadTier(prod.tier, {
      homesteadLevel: synced.level,
      realmKey: character.realmKey,
    });
    if (!tierGate.allowed) {
      throw new HomesteadError(tierGate.reason ?? 'REALM_TOO_LOW');
    }
    if (!realmMeetsHomesteadRequirement(character.realmKey, prod.requiredRealmKey)) {
      throw new HomesteadError('REALM_TOO_LOW');
    }
    if (synced.spiritualEnergy < prod.spiritualEnergyCost) {
      throw new HomesteadError('INSUFFICIENT_SPIRITUAL_ENERGY');
    }
    const active = await this.prisma.homesteadGardenPlot.findUnique({
      where: {
        homesteadId_slotIndex: { homesteadId: synced.id, slotIndex: input.slotIndex },
      },
      select: { id: true },
    });
    if (active) throw new HomesteadError('SLOT_OCCUPIED');

    const readyAt = new Date(now.getTime() + scaleInt(prod.durationMinutes, balance.gardenDurationMinutesMultiplier) * 60_000);
    const plot = await this.prisma.$transaction(async (tx) => {
      const row = await tx.homestead.findUnique({
        where: { id: synced.id },
        select: { id: true, spiritualEnergy: true },
      });
      if (!row || row.spiritualEnergy < prod.spiritualEnergyCost) {
        throw new HomesteadError('INSUFFICIENT_SPIRITUAL_ENERGY');
      }
      await tx.homestead.update({
        where: { id: synced.id },
        data: {
          spiritualEnergy: { decrement: prod.spiritualEnergyCost },
          spiritualEnergyUpdatedAt: now,
        },
      });
      return tx.homesteadGardenPlot.create({
        data: {
          homesteadId: synced.id,
          slotIndex: input.slotIndex,
          productionKey: prod.key,
          outputItemKey: prod.outputItemKey,
          expectedYield: prod.yieldQty,
          startedAt: now,
          readyAt,
        },
      });
    });
    return this.toGardenSlot(input.slotIndex, plot, now);
  }

  async claimGarden(
    characterId: string,
    input: { slotIndex: number },
    now = new Date(),
  ): Promise<HomesteadGardenClaimResult> {
    const homestead = await this.ensureHomestead(characterId, now);
    const plot = await this.prisma.homesteadGardenPlot.findUnique({
      where: { homesteadId_slotIndex: { homesteadId: homestead.id, slotIndex: input.slotIndex } },
    });
    if (!plot) throw new HomesteadError('GARDEN_NOT_FOUND');
    if (plot.claimedAt) throw new HomesteadError('ALREADY_CLAIMED');
    if (plot.readyAt.getTime() > now.getTime()) throw new HomesteadError('NOT_READY');
    const prod = getHomesteadGardenProductionDef(plot.productionKey);
    if (!prod) throw new HomesteadError('PRODUCTION_NOT_FOUND');
    const balance = await this.getBalance();
    const dailyCapQty = scaleInt(prod.dailyCapQty, balance.dailyCapMultiplier);

    const grant = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.homesteadGardenPlot.updateMany({
        where: {
          id: plot.id,
          claimedAt: null,
          readyAt: { lte: now },
        },
        data: { claimedAt: now },
      });
      if (updated.count !== 1) throw new HomesteadError('ALREADY_CLAIMED');
      const cap = await this.worldCap.consumeDailyTx(tx, {
        characterId,
        capKey: `homestead:garden:${prod.outputItemKey}`,
        source: 'HOMESTEAD_GARDEN',
        limitQty: dailyCapQty,
        qtyDelta: plot.expectedYield,
        countDelta: 1,
        now,
      });
      await this.inventory.grantTx(
        tx,
        characterId,
        [{ itemKey: plot.outputItemKey, qty: plot.expectedYield }],
        {
          reason: 'HOMESTEAD_GARDEN_CLAIM',
          refType: 'HomesteadGardenPlot',
          refId: plot.id,
          extra: {
            productionKey: plot.productionKey,
            slotIndex: plot.slotIndex,
            dayBucket: cap.dayBucket,
            rare: prod.rare,
          },
        },
      );
      await tx.homesteadGardenPlot.delete({ where: { id: plot.id } });
      return cap;
    });

    return {
      slotIndex: input.slotIndex,
      productionKey: plot.productionKey,
      itemKey: plot.outputItemKey,
      qty: plot.expectedYield,
      dayBucket: grant.dayBucket,
      dailyUsedQty: grant.usedQty,
      dailyLimitQty: dailyCapQty,
    };
  }

  private async ensureHomestead(characterId: string, now: Date): Promise<HomesteadWithPlots> {
    const existing = await this.readHomestead(characterId);
    if (existing) return existing;
    try {
      return await this.prisma.homestead.create({
        data: {
          characterId,
          spiritualEnergyUpdatedAt: now,
        },
        include: { fields: true, garden: true },
      });
    } catch {
      const raced = await this.readHomestead(characterId);
      if (raced) return raced;
      throw new HomesteadError('HOMESTEAD_NOT_FOUND');
    }
  }

  private async readHomestead(characterId: string): Promise<HomesteadWithPlots | null> {
    return this.prisma.homestead.findUnique({
      where: { characterId },
      include: { fields: true, garden: true },
    });
  }

  private async syncEnergy(
    homestead: HomesteadWithPlots,
    now: Date,
    balance: HomesteadBalanceConfig,
  ): Promise<HomesteadWithPlots> {
    const storageCap = homesteadStorageCap(homestead.level);
    const regen = homesteadOfflineRegenEnergy({
      currentEnergy: homestead.spiritualEnergy,
      updatedAt: homestead.spiritualEnergyUpdatedAt,
      now,
      storageCap,
    });
    const baseRegenPerHour = HOMESTEAD_SPIRITUAL_ENERGY_REGEN_PER_HOUR;
    const regenPerHour = Math.max(1, baseRegenPerHour * balance.energyRegenPerHourMultiplier);
    const adjustedEnergy = Math.min(
      storageCap,
      homestead.spiritualEnergy + Math.floor(regen.regenerated * (regenPerHour / baseRegenPerHour)),
    );
    if (adjustedEnergy === homestead.spiritualEnergy && homestead.spiritualEnergyUpdatedAt.getTime() === now.getTime()) {
      return homestead;
    }
    await this.prisma.homestead.update({
      where: { id: homestead.id },
      data: {
        spiritualEnergy: adjustedEnergy,
        spiritualEnergyUpdatedAt: now,
      },
    });
    const fresh = await this.readHomestead(homestead.characterId);
    if (!fresh) throw new HomesteadError('HOMESTEAD_NOT_FOUND');
    return fresh;
  }

  private toOverview(
    homestead: HomesteadWithPlots,
    realmKey: string,
    linhThach: bigint,
    now: Date,
    balance: HomesteadBalanceConfig,
  ): HomesteadOverview {
    const base = this.toHomesteadView(homestead, realmKey, linhThach, now, balance);
    return {
      ...base,
      fields: this.makeFieldSlots(homestead, now),
      garden: this.makeGardenSlots(homestead, now),
      cropCatalog: HOMESTEAD_CROPS.map((crop) => ({
        ...crop,
        growthMinutes: scaleInt(crop.growthMinutes, balance.fieldGrowthMinutesMultiplier),
        dailyCapQty: scaleInt(crop.dailyCapQty, balance.dailyCapMultiplier),
        unlocked: this.cropUnlocked(crop.tier, crop.requiredRealmKey, homestead.level, realmKey),
      })),
      gardenCatalog: HOMESTEAD_GARDEN_PRODUCTIONS.map((prod) => ({
        ...prod,
        durationMinutes: scaleInt(prod.durationMinutes, balance.gardenDurationMinutesMultiplier),
        dailyCapQty: scaleInt(prod.dailyCapQty, balance.dailyCapMultiplier),
        unlocked:
          prod.tier <= (getHomesteadLevelDef(homestead.level)?.maxGardenTier ?? 1) &&
          this.cropUnlocked(prod.tier, prod.requiredRealmKey, homestead.level, realmKey),
      })),
    };
  }

  private toHomesteadView(
    homestead: Pick<HomesteadWithPlots, 'id' | 'level' | 'spiritualEnergy' | 'spiritualEnergyUpdatedAt'>,
    realmKey: string,
    linhThach: bigint,
    now: Date,
    balance: HomesteadBalanceConfig,
  ): Omit<HomesteadOverview, 'fields' | 'garden' | 'cropCatalog' | 'gardenCatalog'> {
    const def = getHomesteadLevelDef(homestead.level);
    if (!def) throw new HomesteadError('CONFIG_NOT_FOUND');
    const nextDef = getHomesteadLevelDef(homestead.level + 1) ?? null;
    const canUpgrade =
      nextDef !== null &&
      linhThach >= BigInt(scaleInt(def.upgradeCostLinhThach, balance.upgradeCostMultiplier)) &&
      homestead.spiritualEnergy >= scaleInt(def.upgradeCostSpiritualEnergy, balance.upgradeCostMultiplier) &&
      realmMeetsHomesteadRequirement(realmKey, nextDef.requiredRealmKey);
    return {
      homestead: {
        id: homestead.id,
        level: homestead.level,
        nameVi: def.nameVi,
        nameEn: def.nameEn,
        spiritualEnergy: homestead.spiritualEnergy,
        storageCap: def.storageCap,
        fieldSlots: def.fieldSlots,
        gardenSlots: def.gardenSlots,
        maxCropTier: def.maxCropTier,
        maxGardenTier: def.maxGardenTier,
        energyUpdatedAt: homestead.spiritualEnergyUpdatedAt.toISOString(),
        serverTime: now.toISOString(),
        offlineCapHours: 8,
      },
      upgrade: {
        available: nextDef !== null,
        canUpgrade,
        toLevel: nextDef?.level ?? null,
        linhThachCost: nextDef ? scaleInt(def.upgradeCostLinhThach, balance.upgradeCostMultiplier) : 0,
        spiritualEnergyCost: nextDef ? scaleInt(def.upgradeCostSpiritualEnergy, balance.upgradeCostMultiplier) : 0,
        requiredRealmKey: nextDef?.requiredRealmKey ?? null,
      },
      caps: {
        storageCap: def.storageCap,
        fieldSlots: def.fieldSlots,
        gardenSlots: def.gardenSlots,
        offlineCapHours: 8,
      },
    };
  }

  private makeFieldSlots(homestead: HomesteadWithPlots, now: Date): HomesteadFieldSlotView[] {
    const def = getHomesteadLevelDef(homestead.level);
    const slots = def?.fieldSlots ?? 0;
    return Array.from({ length: slots }, (_, slotIndex) => {
      const plot = homestead.fields.find((field) => field.slotIndex === slotIndex) ?? null;
      return this.toFieldSlot(slotIndex, plot, now);
    });
  }

  private makeGardenSlots(homestead: HomesteadWithPlots, now: Date): HomesteadGardenSlotView[] {
    const def = getHomesteadLevelDef(homestead.level);
    const slots = def?.gardenSlots ?? 0;
    return Array.from({ length: slots }, (_, slotIndex) => {
      const plot = homestead.garden.find((field) => field.slotIndex === slotIndex) ?? null;
      return this.toGardenSlot(slotIndex, plot, now);
    });
  }

  private toFieldSlot(
    slotIndex: number,
    plot: HomesteadWithPlots['fields'][number] | null,
    now: Date,
  ): HomesteadFieldSlotView {
    if (!plot) return { slotIndex, state: 'EMPTY' };
    return {
      slotIndex,
      state: plot.readyAt.getTime() <= now.getTime() ? 'READY' : 'GROWING',
      cropKey: plot.cropKey,
      outputItemKey: plot.outputItemKey,
      expectedYield: plot.expectedYield,
      plantedAt: plot.plantedAt.toISOString(),
      readyAt: plot.readyAt.toISOString(),
      remainingSeconds: Math.max(0, Math.ceil((plot.readyAt.getTime() - now.getTime()) / 1000)),
    };
  }

  private toGardenSlot(
    slotIndex: number,
    plot: HomesteadWithPlots['garden'][number] | null,
    now: Date,
  ): HomesteadGardenSlotView {
    if (!plot) return { slotIndex, state: 'EMPTY' };
    return {
      slotIndex,
      state: plot.readyAt.getTime() <= now.getTime() ? 'READY' : 'PROCESSING',
      productionKey: plot.productionKey,
      outputItemKey: plot.outputItemKey,
      expectedYield: plot.expectedYield,
      startedAt: plot.startedAt.toISOString(),
      readyAt: plot.readyAt.toISOString(),
      remainingSeconds: Math.max(0, Math.ceil((plot.readyAt.getTime() - now.getTime()) / 1000)),
    };
  }

  private cropUnlocked(
    tier: number,
    requiredRealmKey: string | null,
    homesteadLevel: number,
    realmKey: string,
  ): boolean {
    const gate = canUseHomesteadTier(tier, { homesteadLevel, realmKey });
    return gate.allowed && realmMeetsHomesteadRequirement(realmKey, requiredRealmKey);
  }

  private async getBalance(): Promise<HomesteadBalanceConfig> {
    try {
      return parseHomesteadBalance(await this.remoteConfig.getValue('homestead_balance'));
    } catch {
      return DEFAULT_HOMESTEAD_BALANCE;
    }
  }
}

interface HomesteadBalanceConfig {
  energyRegenPerHourMultiplier: number;
  fieldGrowthMinutesMultiplier: number;
  gardenDurationMinutesMultiplier: number;
  dailyCapMultiplier: number;
  upgradeCostMultiplier: number;
}

const DEFAULT_HOMESTEAD_BALANCE: HomesteadBalanceConfig = {
  energyRegenPerHourMultiplier: 1,
  fieldGrowthMinutesMultiplier: 1,
  gardenDurationMinutesMultiplier: 1,
  dailyCapMultiplier: 1,
  upgradeCostMultiplier: 1,
};

function parseHomesteadBalance(value: unknown): HomesteadBalanceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_HOMESTEAD_BALANCE;
  const obj = value as Record<string, unknown>;
  return {
    energyRegenPerHourMultiplier: clampMultiplier(obj.energyRegenPerHourMultiplier),
    fieldGrowthMinutesMultiplier: clampMultiplier(obj.fieldGrowthMinutesMultiplier),
    gardenDurationMinutesMultiplier: clampMultiplier(obj.gardenDurationMinutesMultiplier),
    dailyCapMultiplier: clampMultiplier(obj.dailyCapMultiplier),
    upgradeCostMultiplier: clampMultiplier(obj.upgradeCostMultiplier),
  };
}

function clampMultiplier(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(0.5, value));
}

function scaleInt(value: number, multiplier: number): number {
  return Math.max(1, Math.ceil(value * multiplier));
}

export type HomesteadErrorCode =
  | 'CHARACTER_NOT_FOUND'
  | 'HOMESTEAD_NOT_FOUND'
  | 'CONFIG_NOT_FOUND'
  | 'MAX_LEVEL'
  | 'REALM_TOO_LOW'
  | 'HOMESTEAD_LEVEL_TOO_LOW'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_SPIRITUAL_ENERGY'
  | 'STATE_CHANGED'
  | 'CROP_NOT_FOUND'
  | 'PRODUCTION_NOT_FOUND'
  | 'SLOT_LOCKED'
  | 'SLOT_OCCUPIED'
  | 'FIELD_NOT_FOUND'
  | 'GARDEN_NOT_FOUND'
  | 'NOT_READY'
  | 'ALREADY_CLAIMED'
  | 'DAILY_CAP_REACHED';

export class HomesteadError extends Error {
  constructor(public readonly code: HomesteadErrorCode) {
    super(code);
  }
}

export function normalizeHomesteadError(e: unknown): HomesteadError {
  if (e instanceof HomesteadError) return e;
  if (e instanceof WorldCapError && e.code === 'DAILY_CAP_REACHED') {
    return new HomesteadError('DAILY_CAP_REACHED');
  }
  throw e;
}

export interface HomesteadView {
  id: string;
  level: number;
  nameVi: string;
  nameEn: string;
  spiritualEnergy: number;
  storageCap: number;
  fieldSlots: number;
  gardenSlots: number;
  maxCropTier: number;
  maxGardenTier: number;
  energyUpdatedAt: string;
  serverTime: string;
  offlineCapHours: number;
}

export interface HomesteadUpgradeView {
  available: boolean;
  canUpgrade: boolean;
  toLevel: number | null;
  linhThachCost: number;
  spiritualEnergyCost: number;
  requiredRealmKey: string | null;
}

export interface HomesteadCapsView {
  storageCap: number;
  fieldSlots: number;
  gardenSlots: number;
  offlineCapHours: number;
}

export type HomesteadFieldSlotView =
  | { slotIndex: number; state: 'EMPTY' }
  | {
      slotIndex: number;
      state: 'GROWING' | 'READY';
      cropKey: string;
      outputItemKey: string;
      expectedYield: number;
      plantedAt: string;
      readyAt: string;
      remainingSeconds: number;
    };

export type HomesteadGardenSlotView =
  | { slotIndex: number; state: 'EMPTY' }
  | {
      slotIndex: number;
      state: 'PROCESSING' | 'READY';
      productionKey: string;
      outputItemKey: string;
      expectedYield: number;
      startedAt: string;
      readyAt: string;
      remainingSeconds: number;
    };

export interface HomesteadOverview {
  homestead: HomesteadView;
  upgrade: HomesteadUpgradeView;
  caps: HomesteadCapsView;
  fields: HomesteadFieldSlotView[];
  garden: HomesteadGardenSlotView[];
  cropCatalog: Array<(typeof HOMESTEAD_CROPS)[number] & { unlocked: boolean }>;
  gardenCatalog: Array<(typeof HOMESTEAD_GARDEN_PRODUCTIONS)[number] & { unlocked: boolean }>;
}

export interface HomesteadFieldsResponse {
  homestead: HomesteadView;
  slots: HomesteadFieldSlotView[];
  cropCatalog: HomesteadOverview['cropCatalog'];
  caps: HomesteadCapsView;
}

export interface HomesteadGardenResponse {
  homestead: HomesteadView;
  slots: HomesteadGardenSlotView[];
  productionCatalog: HomesteadOverview['gardenCatalog'];
  caps: HomesteadCapsView;
}

export interface HomesteadUpgradeResult {
  fromLevel: number;
  toLevel: number;
  linhThachConsumed: number;
  spiritualEnergyConsumed: number;
  homestead: HomesteadView;
}

export interface HomesteadHarvestResult {
  slotIndex: number;
  cropKey: string;
  itemKey: string;
  qty: number;
  dayBucket: string;
  dailyUsedQty: number;
  dailyLimitQty: number;
}

export interface HomesteadGardenClaimResult {
  slotIndex: number;
  productionKey: string;
  itemKey: string;
  qty: number;
  dayBucket: string;
  dailyUsedQty: number;
  dailyLimitQty: number;
}
