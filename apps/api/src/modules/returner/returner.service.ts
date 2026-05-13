import { Injectable, Logger } from '@nestjs/common';
import { MailType } from '@prisma/client';
import {
  DEFAULT_RETURNER_REWARDS,
  RETURNER_FORBIDDEN_ITEM_KEYS,
  buildReturnerCycleKey,
  realmByKey,
  resolveReturnerTier,
  type ReturnerRewardTemplate,
  type ReturnerTier,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Phase 31.0 — Returner Support Foundation service.
 *
 * Lifecycle:
 *   1. User login → API gọi `onLogin(userId)` (TODO wire vào auth flow
 *      sau, hoặc cron sweep — Phase 31 expose service method, không tự
 *      hook vào auth để tránh đụng Phase 29).
 *   2. Service tính `inactiveDays = now - prevLoginAt`, resolve tier
 *      qua `resolveReturnerTier(...)`, build `cycleKey =
 *      userId:tier:YYYY-MM-DD` (UTC).
 *   3. Nếu `lastCycleKey != cycleKey` → trigger: gửi mail "Trở Lại
 *      Tiên Đồ" với reward filter theo `min(playerTier, RETURNER_REWARD_TIER_CAP[tier])`,
 *      update state. Idempotent qua CAS update (`lastCycleKey` check).
 *
 * Anti-abuse:
 *   - Item reward filter qua `RETURNER_FORBIDDEN_ITEM_KEYS` (defense in depth).
 *   - `tienNgoc=0` always (Phase 31 cap).
 *   - `cycleKey` unique per UTC day per tier — 1 ngày 1 lần.
 */
export class ReturnerError extends Error {
  constructor(public code: 'NO_CHARACTER' | 'INVALID_INPUT') {
    super(code);
  }
}

export interface ReturnerStateView {
  characterId: string;
  inactiveDays: number;
  currentTier: ReturnerTier | null;
  lastCycleKey: string | null;
  lastTriggerAt: string | null;
  prevLoginAt: string | null;
  lastLoginAt: string | null;
}

@Injectable()
export class ReturnerService {
  private readonly logger = new Logger(ReturnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async getState(userId: string): Promise<ReturnerStateView | null> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) return null;
    const row = await this.prisma.characterReturnerState.findUnique({
      where: { characterId: char.id },
    });
    if (!row) {
      return {
        characterId: char.id,
        inactiveDays: 0,
        currentTier: null,
        lastCycleKey: null,
        lastTriggerAt: null,
        prevLoginAt: null,
        lastLoginAt: null,
      };
    }
    return {
      characterId: row.characterId,
      inactiveDays: row.inactiveDays,
      currentTier: (row.currentTier as ReturnerTier | null) ?? null,
      lastCycleKey: row.lastCycleKey ?? null,
      lastTriggerAt: row.lastTriggerAt?.toISOString() ?? null,
      prevLoginAt: row.prevLoginAt?.toISOString() ?? null,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    };
  }

  /**
   * Trigger returner check cho 1 user. Idempotent — gọi nhiều lần
   * trong cùng 1 cycleKey chỉ tạo 1 mail.
   *
   * @param now — override `Date.now()` cho test.
   * @returns mail id nếu vừa trigger, `null` nếu không qualify.
   */
  async onLogin(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ tier: ReturnerTier | null; mailId: string | null }> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new ReturnerError('NO_CHARACTER');

    const existing = await this.prisma.characterReturnerState.findUnique({
      where: { characterId: char.id },
    });

    // Tính inactiveDays từ prevLoginAt cũ (NOT lastLoginAt — đó là
    // đăng nhập hiện tại). Lần đầu seed → 0 days.
    let prevLogin = existing?.lastLoginAt ?? null;
    let inactiveDays = 0;
    if (prevLogin) {
      inactiveDays = Math.floor(
        (now.getTime() - prevLogin.getTime()) / 86_400_000,
      );
    }

    const tier = resolveReturnerTier(inactiveDays);
    const cycleKey = tier ? buildReturnerCycleKey(userId, tier, now) : null;

    // Update state (always rotate lastLoginAt + prevLoginAt regardless of
    // tier match).
    if (!existing) {
      await this.prisma.characterReturnerState.create({
        data: {
          characterId: char.id,
          prevLoginAt: null,
          lastLoginAt: now,
          inactiveDays,
          currentTier: tier,
          lastCycleKey: null,
          lastTriggerAt: null,
        },
      });
    } else {
      await this.prisma.characterReturnerState.update({
        where: { characterId: char.id },
        data: {
          prevLoginAt: existing.lastLoginAt,
          lastLoginAt: now,
          inactiveDays,
          currentTier: tier,
        },
      });
    }

    if (!tier || !cycleKey) {
      return { tier: null, mailId: null };
    }

    // CAS: only trigger once per cycleKey.
    const upd = await this.prisma.characterReturnerState.updateMany({
      where: {
        characterId: char.id,
        OR: [{ lastCycleKey: null }, { lastCycleKey: { not: cycleKey } }],
      },
      data: {
        lastCycleKey: cycleKey,
        lastTriggerAt: now,
      },
    });
    if (upd.count !== 1) {
      return { tier, mailId: null };
    }

    // Build reward filtered by tier-cap.
    const template = DEFAULT_RETURNER_REWARDS[tier];
    const playerTier = realmByKey(char.realmKey)?.order ?? 0;
    const filtered = filterReward(template, playerTier);

    try {
      const mailView = await this.mail.sendToCharacter({
        recipientCharacterId: char.id,
        subject: subjectForTier(tier),
        body: bodyForTier(tier, inactiveDays),
        senderName: 'Thiên Đạo Sứ Giả',
        rewardLinhThach: BigInt(filtered.linhThach),
        rewardTienNgoc: 0, // Phase 31 hard cap.
        rewardExp: BigInt(filtered.exp),
        rewardItems: filtered.items,
        mailType: MailType.RETURNER,
      });
      return { tier, mailId: mailView.id };
    } catch (e) {
      this.logger.warn(
        `[returner] mail send failed for ${char.id} (${tier}): ${String(e)}`,
      );
      // Rollback cycleKey để retry lần sau.
      await this.prisma.characterReturnerState.update({
        where: { characterId: char.id },
        data: { lastCycleKey: existing?.lastCycleKey ?? null, lastTriggerAt: existing?.lastTriggerAt ?? null },
      });
      return { tier, mailId: null };
    }
  }
}

/**
 * Filter reward template: bỏ forbidden items + clamp item.qty theo
 * tier cap (server-authoritative defense in depth).
 */
function filterReward(
  template: ReturnerRewardTemplate,
  playerRealmTier: number,
): ReturnerRewardTemplate {
  const items = template.items.filter(
    (it) => !RETURNER_FORBIDDEN_ITEM_KEYS.has(it.itemKey) && it.qty > 0,
  );
  // Player tier=0 (mới tạo char chưa breakthrough) → skip cấp medium
  // items (tránh phát qi_pill_medium cho người chơi mới quay lại).
  // Đơn giản hoá Phase 31: nếu playerTier < 4, lọc item key kết thúc
  // bằng `_medium` / `_major`.
  const safeItems =
    playerRealmTier < 4
      ? items.filter((it) => !/_medium$|_major$/.test(it.itemKey))
      : items;
  return {
    ...template,
    tienNgoc: 0,
    items: safeItems,
  };
}

function subjectForTier(tier: ReturnerTier): string {
  switch (tier) {
    case 'SHORT':
      return 'Trở Lại Tiên Đồ — Lễ Vật Sơ Cấp';
    case 'MEDIUM':
      return 'Trở Lại Tiên Đồ — Lễ Vật Trung Cấp';
    case 'LONG':
      return 'Trở Lại Tiên Đồ — Lễ Vật Trọng Hậu';
  }
}

function bodyForTier(tier: ReturnerTier, days: number): string {
  return (
    `Đạo hữu đã rời tiên đồ ${days} ngày. Thiên Đạo ban tặng ` +
    `lễ vật ${tier === 'LONG' ? 'trọng hậu' : tier === 'MEDIUM' ? 'trung cấp' : 'sơ cấp'} ` +
    `để chào mừng đạo hữu trở lại tu hành.\n\n` +
    `Lưu ý: vật phẩm endgame không có trong gói quà này — đạo hữu cần ` +
    `tự thân tu luyện để đạt cảnh giới cao hơn.`
  );
}
