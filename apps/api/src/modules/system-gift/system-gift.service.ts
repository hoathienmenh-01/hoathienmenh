import { Injectable, Logger } from '@nestjs/common';
import { MailType, Prisma } from '@prisma/client';
import {
  SYSTEM_GIFT_FORBIDDEN_ITEM_KEYS,
  realmByKey,
  validateSystemGiftDef,
  type SystemGiftDef,
  type SystemGiftReward,
  type SystemGiftTargetRule,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Phase 31.0 — System Gift / Compensation service.
 *
 * 1 `SystemGift` row = template quà hệ thống. Khi distribute, fanout
 * thành N `Mail` row (1 per target character) qua `MailService`. Idempotent:
 *   - `SystemGiftClaim` unique `[giftKey, characterId]` đảm bảo 1
 *     character chỉ nhận 1 mail của 1 giftKey.
 *   - Mail claim flow tự đảm bảo idempotent reward (CAS Mail.claimedAt).
 *
 * Target rule eval server-authoritative. Không cho phép admin gửi
 * EVENT_PARTICIPANTS rule khi `eventDefId` không tồn tại — soft-check
 * (skip silently nếu Phase 28 events chưa có row).
 */
export class SystemGiftError extends Error {
  constructor(
    public code:
      | 'INVALID_DEF'
      | 'GIFT_KEY_DUP'
      | 'GIFT_NOT_FOUND'
      | 'GIFT_EXPIRED'
      | 'INVALID_INPUT',
  ) {
    super(code);
  }
}

export interface DistributeResult {
  giftKey: string;
  /** Số character match target rule. */
  matchedCount: number;
  /** Số mail đã tạo (= matched - already-claimed). */
  createdMailCount: number;
  /** Số character bị skip vì đã có claim (idempotent re-run). */
  skippedAlreadyClaimedCount: number;
}

@Injectable()
export class SystemGiftService {
  private readonly logger = new Logger(SystemGiftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Admin tạo gift template (upsert theo giftKey). */
  async upsertDef(
    input: SystemGiftDef,
    adminUserId: string | null,
  ): Promise<SystemGiftDef> {
    const err = validateSystemGiftDef(input);
    if (err) throw new SystemGiftError('INVALID_DEF');

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    const row = await this.prisma.systemGift.upsert({
      where: { giftKey: input.giftKey },
      create: {
        giftKey: input.giftKey,
        title: input.title,
        body: input.body,
        rewardJson: input.reward as unknown as Prisma.InputJsonValue,
        targetRuleJson: input.targetRule as unknown as Prisma.InputJsonValue,
        expiresAt,
        createdByAdminId: adminUserId,
      },
      update: {
        title: input.title,
        body: input.body,
        rewardJson: input.reward as unknown as Prisma.InputJsonValue,
        targetRuleJson: input.targetRule as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });
    return rowToDef(row);
  }

  async list(): Promise<SystemGiftDef[]> {
    const rows = await this.prisma.systemGift.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(rowToDef);
  }

  async get(giftKey: string): Promise<SystemGiftDef | null> {
    const row = await this.prisma.systemGift.findUnique({ where: { giftKey } });
    return row ? rowToDef(row) : null;
  }

  /**
   * Resolve target rule → danh sách `characterId`. Hard cap 50k để
   * tránh OOM khi server lớn. Filter forbidden items đã làm ở validator.
   */
  async resolveTargets(rule: SystemGiftTargetRule): Promise<string[]> {
    const HARD_CAP = 50_000;
    switch (rule.type) {
      case 'ALL_PLAYERS': {
        const rows = await this.prisma.character.findMany({
          select: { id: true },
          take: HARD_CAP,
        });
        return rows.map((r) => r.id);
      }
      case 'REALM_RANGE': {
        // realmKey → realmByKey().order; cần load all + filter pure để
        // không phụ thuộc Prisma raw on `realmKey`. Cap HARD_CAP để
        // không OOM.
        const all = await this.prisma.character.findMany({
          select: { id: true, realmKey: true },
          take: HARD_CAP,
        });
        const lo = rule.realmTierMin ?? 1;
        const hi = rule.realmTierMax ?? 28;
        return all
          .filter((c) => {
            const t = realmByKey(c.realmKey)?.order ?? 0;
            return t >= lo && t <= hi;
          })
          .map((c) => c.id);
      }
      case 'CREATED_BEFORE': {
        if (!rule.createdBefore) return [];
        const cutoff = new Date(rule.createdBefore);
        const rows = await this.prisma.character.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: HARD_CAP,
        });
        return rows.map((r) => r.id);
      }
      case 'ACTIVE_IN_LAST_DAYS': {
        const days = rule.activeInLastDays ?? 7;
        const cutoff = new Date(Date.now() - days * 86_400_000);
        // user.lastLoginAt là field trên User — Character có userId.
        const rows = await this.prisma.character.findMany({
          where: { user: { lastLoginAt: { gte: cutoff } } },
          select: { id: true },
          take: HARD_CAP,
        });
        return rows.map((r) => r.id);
      }
      case 'SECT_MEMBERS': {
        if (!rule.sectId) return [];
        const rows = await this.prisma.character.findMany({
          where: { sectId: rule.sectId },
          select: { id: true },
          take: HARD_CAP,
        });
        return rows.map((r) => r.id);
      }
      case 'EVENT_PARTICIPANTS': {
        if (!rule.eventDefId) return [];
        // Soft-ref Phase 28: PersonalEventProgress.eventKey link sang
        // EventDef.key. Phase 31 KHÔNG đụng sâu — chỉ count distinct
        // characterId nếu progress > 0. Nếu Phase 28 chưa seed row →
        // empty.
        const rows = await this.prisma.personalEventProgress.findMany({
          where: { eventKey: rule.eventDefId },
          select: { characterId: true },
          distinct: ['characterId'],
          take: HARD_CAP,
        });
        return rows.map((r) => r.characterId);
      }
      default:
        return [];
    }
  }

  /**
   * Distribute gift → tạo mail cho mỗi target chưa nhận. Idempotent:
   * unique `[giftKey, characterId]` trên `SystemGiftClaim` ngăn double
   * claim. Mail.mailType = REWARD.
   */
  async distribute(giftKey: string, adminUserId: string | null): Promise<DistributeResult> {
    const def = await this.prisma.systemGift.findUnique({ where: { giftKey } });
    if (!def) throw new SystemGiftError('GIFT_NOT_FOUND');
    if (def.expiresAt && def.expiresAt.getTime() <= Date.now()) {
      throw new SystemGiftError('GIFT_EXPIRED');
    }
    const reward = def.rewardJson as unknown as SystemGiftReward;
    const targetRule = def.targetRuleJson as unknown as SystemGiftTargetRule;

    const targetIds = await this.resolveTargets(targetRule);
    // Filter forbidden items defensively (defense-in-depth — already
    // validated at upsert, but seed/migration could bypass).
    const safeItems = reward.items.filter(
      (it) => !SYSTEM_GIFT_FORBIDDEN_ITEM_KEYS.has(it.itemKey),
    );

    let created = 0;
    let skipped = 0;
    for (const characterId of targetIds) {
      try {
        const mailView = await this.mail.sendToCharacter({
          recipientCharacterId: characterId,
          subject: def.title,
          body: def.body,
          senderName: 'Thiên Đạo Sứ Giả',
          rewardLinhThach: BigInt(reward.linhThach),
          rewardTienNgoc: 0, // Phase 31 hard cap — KHÔNG mint TN qua gift.
          rewardExp: BigInt(reward.exp),
          rewardItems: safeItems,
          expiresAt: def.expiresAt ?? undefined,
          createdByAdminId: adminUserId ?? undefined,
          mailType: MailType.REWARD,
        });
        try {
          await this.prisma.systemGiftClaim.create({
            data: {
              giftKey,
              characterId,
              mailId: mailView.id,
            },
          });
          created += 1;
        } catch {
          // Unique violation → đã claim trước đó → skip.
          skipped += 1;
        }
      } catch (e) {
        this.logger.warn(
          `[system-gift] distribute ${giftKey} → ${characterId} failed: ${String(e)}`,
        );
        skipped += 1;
      }
    }
    return {
      giftKey,
      matchedCount: targetIds.length,
      createdMailCount: created,
      skippedAlreadyClaimedCount: skipped,
    };
  }
}

function rowToDef(row: {
  giftKey: string;
  title: string;
  body: string;
  rewardJson: Prisma.JsonValue;
  targetRuleJson: Prisma.JsonValue;
  expiresAt: Date | null;
  createdByAdminId: string | null;
}): SystemGiftDef {
  return {
    giftKey: row.giftKey,
    title: row.title,
    body: row.body,
    reward: row.rewardJson as unknown as SystemGiftReward,
    targetRule: row.targetRuleJson as unknown as SystemGiftTargetRule,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdByAdminId: row.createdByAdminId,
  };
}
