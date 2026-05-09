import { Inject, Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, MissionPeriod, Prisma } from '@prisma/client';
import {
  MISSIONS,
  type MissionDef,
  type MissionGoalKind,
  type MissionProgressChange,
  type MissionReward,
  missionByKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { MissionWsEmitter } from './mission-ws.emitter';

export const MISSION_WS_EMITTER = 'MISSION_WS_EMITTER';

export class MissionError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'MISSION_UNKNOWN'
      | 'NOT_READY'
      | 'ALREADY_CLAIMED',
  ) {
    super(code);
  }
}

/**
 * Phase 16.5 — Result trả về từ `MissionService.claim()` sau khi áp daily
 * reward cap. FE render toast nhẹ khi `capped=true`. `granted` luôn là số
 * THỰC ĐÃ vào kho (sau cap), `cappedAmount` chỉ có khi bị cắt.
 */
export interface MissionClaimResult {
  missionKey: string;
  granted: { exp: number; linhThach: number; tienNgoc: number };
  capped: boolean;
  cappedAmount?: { exp: number; linhThach: number };
  dailyCapRemaining: { exp: number; linhThach: number };
}

export interface MissionProgressView {
  key: string;
  name: string;
  description: string;
  period: MissionPeriod;
  goalKind: MissionGoalKind;
  goalAmount: number;
  currentAmount: number;
  claimed: boolean;
  /** currentAmount >= goalAmount AND !claimed → sẵn sàng nhận thưởng. */
  completable: boolean;
  windowEnd: string | null;
  rewards: MissionReward;
  quality: MissionDef['quality'];
}

/**
 * Đọc env `MISSION_RESET_TZ` để xác định timezone của mốc reset DAILY/WEEKLY.
 * Mặc định `Asia/Ho_Chi_Minh` (UTC+07, không DST) — giờ VN là zone player chính.
 * Đặt `UTC` (hoặc bất kỳ IANA tz hợp lệ nào) để override.
 */
export function getMissionResetTz(): string {
  const v = process.env.MISSION_RESET_TZ?.trim();
  return v && v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

/**
 * Trả về offset của một IANA timezone tại một thời điểm cụ thể, đơn vị phút.
 * UTC → 0, Asia/Ho_Chi_Minh → 420, America/New_York → -240/-300 (DST).
 */
function tzOffsetMinutes(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = fmt.formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  // "GMT+07:00", "GMT-05:00", "GMT" (UTC).
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/**
 * Cửa sổ tiếp theo cho DAILY — 00:00 "local" theo `tz` ngày mai, trả về UTC Date.
 * Xấp xỉ 1 lần (nếu zone đổi DST giữa now và midnight, sai số tối đa ~1h —
 * chấp nhận được vì cron chạy mỗi 10 phút bù trễ).
 */
export function nextDailyWindowEnd(
  now: Date = new Date(),
  tz: string = 'UTC',
): Date {
  const offMs = tzOffsetMinutes(tz, now) * 60_000;
  // "Local" instant: Date có UTC-fields trùng với local-fields ở zone tz.
  const local = new Date(now.getTime() + offMs);
  const tomorrowLocalUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
  );
  return new Date(tomorrowLocalUtc - offMs);
}

/**
 * Cửa sổ tiếp theo cho WEEKLY — 00:00 "local" theo `tz` thứ Hai kế tiếp.
 * Quy ước: tuần bắt đầu vào thứ Hai (ISO 8601). Khi `now` rơi đúng thứ Hai
 * 00:00 trở đi, trả về thứ Hai tuần sau (+7 ngày) — tránh windowEnd <= now
 * ngay lúc tạo.
 */
export function nextWeeklyWindowEnd(
  now: Date = new Date(),
  tz: string = 'UTC',
): Date {
  const offMs = tzOffsetMinutes(tz, now) * 60_000;
  const local = new Date(now.getTime() + offMs);
  const startLocalUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const startLocal = new Date(startLocalUtc);
  const dow = startLocal.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat (theo "local").
  const daysToMonday = dow === 1 ? 7 : (1 - dow + 7) % 7 || 7;
  startLocal.setUTCDate(startLocal.getUTCDate() + daysToMonday);
  return new Date(startLocal.getTime() - offMs);
}

/**
 * Service cho nhiệm vụ hằng ngày / hằng tuần / 1 lần.
 *
 * - `listForUser(userId)`: trả full catalog + tiến độ hiện tại (lazy-create
 *   row nếu chưa có) — FE dùng để render list & disable nút.
 * - `track(characterId, goalKind, amount)`: các service gameplay gọi sau khi
 *   user làm được hành động (tu luyện đủ giây, đánh quái thắng, chat, đóng
 *   góp, v.v.). Tự bỏ qua mission đã claim / đã full.
 * - `claim(userId, missionKey)`: trao thưởng atomic qua `CurrencyService`
 *   (LINH_THACH / TIEN_NGOC có audit trail) + `InventoryService.grantTx`
 *   cho item, + tăng `exp` / `congHien` trực tiếp trên Character.
 * - `resetPeriod(period)`: cron job gọi mỗi 00:00 UTC / đầu tuần để đưa
 *   `currentAmount=0`, `claimed=false` và đẩy `windowEnd` sang cửa sổ mới.
 *   Mission `ONCE` KHÔNG bao giờ reset.
 */
@Injectable()
export class MissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly rewardCap: RewardCapService,
    @Optional()
    @Inject(MISSION_WS_EMITTER)
    private readonly wsEmitter: MissionWsEmitter | null = null,
  ) {}

  async listForUser(userId: string): Promise<MissionProgressView[]> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new MissionError('NO_CHARACTER');
    await this.ensureRows(char.id);
    const rows = await this.prisma.missionProgress.findMany({
      where: { characterId: char.id },
    });
    const byKey = new Map(rows.map((r) => [r.missionKey, r]));
    return MISSIONS.map((def) => {
      const row = byKey.get(def.key);
      const currentAmount = row?.currentAmount ?? 0;
      const claimed = row?.claimed ?? false;
      return {
        key: def.key,
        name: def.name,
        description: def.description,
        period: def.period as MissionPeriod,
        goalKind: def.goalKind,
        goalAmount: def.goalAmount,
        currentAmount,
        claimed,
        completable: currentAmount >= def.goalAmount && !claimed,
        windowEnd: row?.windowEnd?.toISOString() ?? null,
        rewards: def.rewards,
        quality: def.quality,
      };
    });
  }

  /** Tạo đủ row cho mỗi mission trong catalog (idempotent). */
  async ensureRows(characterId: string): Promise<void> {
    const existing = await this.prisma.missionProgress.findMany({
      where: { characterId },
      select: { missionKey: true },
    });
    const have = new Set(existing.map((r) => r.missionKey));
    const now = new Date();
    const tz = getMissionResetTz();
    const toCreate: Prisma.MissionProgressCreateManyInput[] = MISSIONS.filter(
      (m) => !have.has(m.key),
    ).map((m) => ({
      characterId,
      missionKey: m.key,
      period: m.period as MissionPeriod,
      goalAmount: m.goalAmount,
      windowEnd:
        m.period === 'DAILY'
          ? nextDailyWindowEnd(now, tz)
          : m.period === 'WEEKLY'
            ? nextWeeklyWindowEnd(now, tz)
            : null,
    }));
    if (toCreate.length > 0) {
      await this.prisma.missionProgress.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }
  }

  async track(
    characterId: string,
    goalKind: MissionGoalKind,
    amount = 1,
  ): Promise<void> {
    if (amount <= 0) return;
    await this.ensureRows(characterId);
    const matchingKeys = MISSIONS.filter((m) => m.goalKind === goalKind).map(
      (m) => m.key,
    );
    if (matchingKeys.length === 0) return;
    const rows = await this.prisma.missionProgress.findMany({
      where: {
        characterId,
        missionKey: { in: matchingKeys },
        claimed: false,
      },
    });
    const changes: MissionProgressChange[] = [];
    for (const row of rows) {
      if (row.currentAmount >= row.goalAmount) continue;
      const newAmount = Math.min(row.goalAmount, row.currentAmount + amount);
      if (newAmount === row.currentAmount) continue;
      // Atomic guard: chỉ update nếu vẫn còn claimed=false và currentAmount chưa đổi.
      const upd = await this.prisma.missionProgress.updateMany({
        where: {
          id: row.id,
          claimed: false,
          currentAmount: row.currentAmount,
        },
        data: { currentAmount: newAmount },
      });
      if (upd.count === 1) {
        changes.push({
          missionKey: row.missionKey,
          period: row.period,
          currentAmount: newAmount,
          goalAmount: row.goalAmount,
          completable: newAmount >= row.goalAmount,
        });
      }
    }
    if (changes.length > 0 && this.wsEmitter) {
      // Resolve userId từ characterId; KHÔNG fail track nếu character lạ (race).
      const ch = await this.prisma.character.findUnique({
        where: { id: characterId },
        select: { userId: true },
      });
      if (ch?.userId) {
        this.wsEmitter.pushProgress(ch.userId, {
          characterId,
          changes,
        });
      }
    }
  }

  async claim(
    userId: string,
    missionKey: string,
  ): Promise<MissionClaimResult> {
    const def = missionByKey(missionKey);
    if (!def) throw new MissionError('MISSION_UNKNOWN');
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new MissionError('NO_CHARACTER');

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.missionProgress.findUnique({
        where: {
          characterId_missionKey: {
            characterId: char.id,
            missionKey,
          },
        },
      });
      if (!row) throw new MissionError('NOT_READY');
      if (row.claimed) throw new MissionError('ALREADY_CLAIMED');
      if (row.currentAmount < row.goalAmount) {
        throw new MissionError('NOT_READY');
      }

      // CAS: chỉ set claimed=true nếu row vẫn đang claimed=false + đủ goal.
      const upd = await tx.missionProgress.updateMany({
        where: {
          id: row.id,
          claimed: false,
          currentAmount: { gte: row.goalAmount },
        },
        data: { claimed: true, claimedAt: new Date() },
      });
      if (upd.count !== 1) throw new MissionError('ALREADY_CLAIMED');

      const r = def.rewards;

      // Phase 16.5 — Daily Reward Cap. Apply BEFORE granting để cap
      // tổng EXP/linhThach/ngày/source. tienNgoc + congHien + items
      // KHÔNG cap ở phase này (scope giới hạn EXP + linhThach — premium
      // currency tienNgoc và sect-influence congHien đi qua audit khác).
      const reqExp = r.exp && r.exp > 0 ? BigInt(r.exp) : 0n;
      const reqLinh =
        r.linhThach && r.linhThach > 0 ? BigInt(r.linhThach) : 0n;
      const cap = await this.rewardCap.applyCapTx(tx, {
        characterId: char.id,
        source: 'MISSION',
        requestedExp: reqExp,
        requestedLinhThach: reqLinh,
        realmKey: char.realmKey,
        refType: 'MissionProgress',
        refId: row.id,
        meta: { missionKey },
      });

      if (cap.grantedLinhThach > 0n) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: cap.grantedLinhThach,
          reason: 'MISSION_CLAIM',
          refType: 'MISSION',
          refId: missionKey,
        });
      }
      if (r.tienNgoc && r.tienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(r.tienNgoc),
          reason: 'MISSION_CLAIM',
          refType: 'MISSION',
          refId: missionKey,
        });
      }
      if (cap.grantedExp > 0n) {
        await tx.character.update({
          where: { id: char.id },
          data: { exp: { increment: cap.grantedExp } },
        });
      }
      if (r.congHien && r.congHien > 0) {
        await tx.character.update({
          where: { id: char.id },
          data: { congHien: { increment: r.congHien } },
        });
      }
      if (r.items && r.items.length > 0) {
        await this.inventory.grantTx(
          tx,
          char.id,
          r.items.map((it) => ({ itemKey: it.itemKey, qty: it.qty })),
          {
            reason: 'MISSION_CLAIM',
            refType: 'MissionProgress',
            refId: row.id,
            extra: { missionKey },
          },
        );
      }

      return {
        missionKey,
        granted: {
          exp: Number(cap.grantedExp),
          linhThach: Number(cap.grantedLinhThach),
          tienNgoc: r.tienNgoc ?? 0,
        },
        capped: cap.wasCapped,
        cappedAmount: cap.wasCapped
          ? {
              exp: Number(cap.cappedExp),
              linhThach: Number(cap.cappedLinhThach),
            }
          : undefined,
        dailyCapRemaining: {
          exp: Number(cap.remainingExp),
          linhThach: Number(cap.remainingLinhThach),
        },
      };
    });
  }

  /**
   * Reset cho 1 period (DAILY hoặc WEEKLY). Các row có `windowEnd <= now`
   * sẽ được đưa về `currentAmount=0`, `claimed=false`, cập nhật windowEnd
   * cho cửa sổ tiếp theo. Mission ONCE không bao giờ reset.
   */
  async resetPeriod(period: 'DAILY' | 'WEEKLY'): Promise<number> {
    const now = new Date();
    const tz = getMissionResetTz();
    const nextEnd =
      period === 'DAILY'
        ? nextDailyWindowEnd(now, tz)
        : nextWeeklyWindowEnd(now, tz);
    const res = await this.prisma.missionProgress.updateMany({
      where: {
        period: period as MissionPeriod,
        windowEnd: { lte: now },
      },
      data: {
        currentAmount: 0,
        claimed: false,
        claimedAt: null,
        windowEnd: nextEnd,
        startedAt: now,
      },
    });
    return res.count;
  }
}
