import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SECT_BOSSES,
  SectBossDef,
  computeSectBossHp,
  getSectBossByKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Phase 13.8 — Sect Boss service.
 *
 * Server-authoritative invariants:
 *   - Boss HP scales with sect level via `computeSectBossHp()`.
 *   - Daily/weekly attempt caps enforced per member and per sect.
 *   - Contribution reward granted to all participants.
 *   - First kill reward granted once per boss per sect.
 *   - Role-aware gating: MEMBER can fight, ELDER/LEADER can spawn.
 */

export type SectBossErrorCode =
  | 'NO_CHARACTER'
  | 'SECT_REQUIRED'
  | 'BOSS_NOT_FOUND'
  | 'BOSS_DISABLED'
  | 'SECT_LEVEL_TOO_LOW'
  | 'DAILY_ATTEMPTS_EXCEEDED'
  | 'WEEKLY_ATTEMPTS_EXCEEDED'
  | 'BOSS_ALREADY_ACTIVE'
  | 'NO_ACTIVE_BOSS'
  | 'BOSS_NOT_DEFEATED'
  | 'ALREADY_CLAIMED'
  | 'NOT_ELDER_OR_LEADER';

export class SectBossError extends Error {
  readonly code: SectBossErrorCode;
  constructor(code: SectBossErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SectBossError';
    this.code = code;
  }
}

export interface SectBossListView {
  key: string;
  nameVi: string;
  nameEn: string;
  category: string;
  requiredSectLevel: number;
  enabled: boolean;
  canSpawn: boolean;
}

export interface SectBossActiveView {
  bossKey: string;
  nameVi: string;
  nameEn: string;
  currentHp: number;
  maxHp: number;
  spawnedAt: string;
  participants: Array<{
    characterId: string;
    characterName: string;
    damage: number;
  }>;
}

export interface SectBossFightResult {
  bossKey: string;
  damage: number;
  currentHp: number;
  maxHp: number;
  defeated: boolean;
}

export interface SectBossClaimResult {
  bossKey: string;
  rewards: {
    linhThach?: number;
    tienNgoc?: number;
    exp?: number;
    items?: Array<{ itemKey: string; qty: number }>;
  };
  contributionGained: number;
}

@Injectable()
export class SectBossService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly currency?: CurrencyService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  /**
   * List all sect bosses with spawn eligibility for viewer.
   */
  async list(userId: string): Promise<SectBossListView[]> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectBossError('NO_CHARACTER');
    if (!char.sectId) throw new SectBossError('SECT_REQUIRED');

    const sect = await this.prisma.sect.findUnique({
      where: { id: char.sectId },
      select: { id: true, level: true },
    });
    if (!sect) throw new SectBossError('SECT_REQUIRED');

    const member = await this.prisma.sectMember.findUnique({
      where: { characterId: char.id },
      select: { role: true },
    });
    const canSpawnRole = member?.role === 'ELDER' || member?.role === 'LEADER';

    return SECT_BOSSES.map((boss) => ({
      key: boss.key,
      nameVi: boss.nameVi,
      nameEn: boss.nameEn,
      category: boss.category,
      requiredSectLevel: boss.requiredSectLevel,
      enabled: boss.enabled,
      canSpawn: boss.enabled && sect.level >= boss.requiredSectLevel && canSpawnRole,
    }));
  }

  /**
   * Get active boss for sect (if any).
   */
  async getActive(userId: string): Promise<SectBossActiveView | null> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectBossError('NO_CHARACTER');
    if (!char.sectId) throw new SectBossError('SECT_REQUIRED');

    const active = await this.prisma.sectBossInstance.findFirst({
      where: { sectId: char.sectId, defeated: false },
      orderBy: { spawnedAt: 'desc' },
    });
    if (!active) return null;

    const boss = getSectBossByKey(active.bossKey);
    if (!boss) return null;

    const participants = await this.prisma.sectBossParticipant.findMany({
      where: { instanceId: active.id },
      include: { character: { select: { id: true, name: true } } },
      orderBy: { damage: 'desc' },
      take: 20,
    });

    return {
      bossKey: active.bossKey,
      nameVi: boss.nameVi,
      nameEn: boss.nameEn,
      currentHp: active.currentHp,
      maxHp: active.maxHp,
      spawnedAt: active.spawnedAt.toISOString(),
      participants: participants.map((p) => ({
        characterId: p.character.id,
        characterName: p.character.name,
        damage: p.damage,
      })),
    };
  }

  /**
   * Spawn a new sect boss (ELDER/LEADER only).
   */
  async spawn(userId: string, bossKey: string): Promise<SectBossActiveView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectBossError('NO_CHARACTER');
    if (!char.sectId) throw new SectBossError('SECT_REQUIRED');

    const member = await this.prisma.sectMember.findUnique({
      where: { characterId: char.id },
      select: { role: true },
    });
    if (member?.role !== 'ELDER' && member?.role !== 'LEADER') {
      throw new SectBossError('NOT_ELDER_OR_LEADER');
    }

    const boss = getSectBossByKey(bossKey);
    if (!boss) throw new SectBossError('BOSS_NOT_FOUND');
    if (!boss.enabled) throw new SectBossError('BOSS_DISABLED');

    const sect = await this.prisma.sect.findUnique({
      where: { id: char.sectId },
      select: { id: true, level: true },
    });
    if (!sect) throw new SectBossError('SECT_REQUIRED');
    if (sect.level < boss.requiredSectLevel) {
      throw new SectBossError('SECT_LEVEL_TOO_LOW');
    }

    // Check for active boss.
    const existing = await this.prisma.sectBossInstance.findFirst({
      where: { sectId: sect.id, defeated: false },
    });
    if (existing) throw new SectBossError('BOSS_ALREADY_ACTIVE');

    // Check weekly sect cap.
    const weekStart = this.getWeekStart();
    const weekCount = await this.prisma.sectBossInstance.count({
      where: {
        sectId: sect.id,
        bossKey,
        spawnedAt: { gte: weekStart },
      },
    });
    if (weekCount >= boss.weeklyAttemptsPerSect) {
      throw new SectBossError('WEEKLY_ATTEMPTS_EXCEEDED');
    }

    const maxHp = computeSectBossHp(boss, sect.level);
    const instance = await this.prisma.sectBossInstance.create({
      data: {
        sectId: sect.id,
        bossKey,
        maxHp,
        currentHp: maxHp,
        spawnedAt: new Date(),
        defeated: false,
      },
    });

    return {
      bossKey: instance.bossKey,
      nameVi: boss.nameVi,
      nameEn: boss.nameEn,
      currentHp: instance.currentHp,
      maxHp: instance.maxHp,
      spawnedAt: instance.spawnedAt.toISOString(),
      participants: [],
    };
  }

  /**
   * Fight active sect boss.
   */
  async fight(userId: string): Promise<SectBossFightResult> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true, power: true },
    });
    if (!char) throw new SectBossError('NO_CHARACTER');
    if (!char.sectId) throw new SectBossError('SECT_REQUIRED');

    const active = await this.prisma.sectBossInstance.findFirst({
      where: { sectId: char.sectId, defeated: false },
      orderBy: { spawnedAt: 'desc' },
    });
    if (!active) throw new SectBossError('NO_ACTIVE_BOSS');

    const boss = getSectBossByKey(active.bossKey);
    if (!boss) throw new SectBossError('BOSS_NOT_FOUND');

    // Check daily member cap.
    const dayStart = this.getDayStart();
    const dayCount = await this.prisma.sectBossParticipant.count({
      where: {
        characterId: char.id,
        instance: { bossKey: boss.key },
        createdAt: { gte: dayStart },
      },
    });
    if (dayCount >= boss.dailyAttemptsPerMember) {
      throw new SectBossError('DAILY_ATTEMPTS_EXCEEDED');
    }

    // Compute damage (simple: 10% of player power).
    const damage = Math.max(1, Math.floor(char.power * 0.1));

    const result = await this.prisma.$transaction(async (tx) => {
      // Upsert participant damage.
      const existing = await tx.sectBossParticipant.findUnique({
        where: {
          instanceId_characterId: {
            instanceId: active.id,
            characterId: char.id,
          },
        },
      });

      if (existing) {
        await tx.sectBossParticipant.update({
          where: { id: existing.id },
          data: { damage: { increment: damage } },
        });
      } else {
        await tx.sectBossParticipant.create({
          data: {
            instanceId: active.id,
            characterId: char.id,
            damage,
          },
        });
      }

      // Update boss HP.
      const newHp = Math.max(0, active.currentHp - damage);
      const defeated = newHp === 0;

      await tx.sectBossInstance.update({
        where: { id: active.id },
        data: { currentHp: newHp, defeated },
      });

      return { currentHp: newHp, defeated };
    });

    return {
      bossKey: active.bossKey,
      damage,
      currentHp: result.currentHp,
      maxHp: active.maxHp,
      defeated: result.defeated,
    };
  }

  /**
   * Claim reward after boss defeated.
   */
  async claim(userId: string): Promise<SectBossClaimResult> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectBossError('NO_CHARACTER');
    if (!char.sectId) throw new SectBossError('SECT_REQUIRED');

    const active = await this.prisma.sectBossInstance.findFirst({
      where: { sectId: char.sectId, defeated: true },
      orderBy: { spawnedAt: 'desc' },
    });
    if (!active) throw new SectBossError('BOSS_NOT_DEFEATED');

    const boss = getSectBossByKey(active.bossKey);
    if (!boss) throw new SectBossError('BOSS_NOT_FOUND');

    const participant = await this.prisma.sectBossParticipant.findUnique({
      where: {
        instanceId_characterId: {
          instanceId: active.id,
          characterId: char.id,
        },
      },
    });
    if (!participant) throw new SectBossError('BOSS_NOT_DEFEATED');
    if (participant.claimed) throw new SectBossError('ALREADY_CLAIMED');

    // Check if first kill for sect.
    const priorKills = await this.prisma.sectBossInstance.count({
      where: {
        sectId: char.sectId,
        bossKey: active.bossKey,
        defeated: true,
        id: { not: active.id },
      },
    });
    const isFirstKill = priorKills === 0;

    const rewards = isFirstKill && boss.firstKillReward
      ? boss.firstKillReward
      : { linhThach: 50, exp: 100 };

    await this.prisma.$transaction(async (tx) => {
      // Grant rewards via currency service.
      if (this.currency && rewards.linhThach) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: 'LINH_THACH',
          delta: BigInt(rewards.linhThach),
          reason: 'BOSS_REWARD',
          refType: 'SectBoss',
          refId: active.id,
        });
      }
      if (this.currency && rewards.tienNgoc) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: 'TIEN_NGOC',
          delta: BigInt(rewards.tienNgoc),
          reason: 'BOSS_REWARD',
          refType: 'SectBoss',
          refId: active.id,
        });
      }
      if (this.currency && rewards.exp) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: 'CULTIVATION_EXP',
          delta: BigInt(rewards.exp),
          reason: 'BOSS_REWARD',
          refType: 'SectBoss',
          refId: active.id,
        });
      }

      // Grant contribution reward.
      await tx.character.update({
        where: { id: char.id },
        data: { congHien: { increment: boss.contributionReward } },
      });

      // Mark claimed.
      await tx.sectBossParticipant.update({
        where: { id: participant.id },
        data: { claimed: true },
      });
    });

    return {
      bossKey: active.bossKey,
      rewards,
      contributionGained: boss.contributionReward,
    };
  }

  private getDayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private getWeekStart(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
}
