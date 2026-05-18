import { Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import { clampLiveOpsMultiplier } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { LiveOpsEventSchedulerService } from '../liveops-event-scheduler/liveops-event-scheduler.service';
import { getMissionResetTz } from '../mission/mission.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';
import { SectWarService } from '../sect-war/sect-war.service';

export class DailyLoginError extends Error {
  constructor(public code: 'NO_CHARACTER') {
    super(code);
  }
}

/** Cố định: 100 linh thạch / lần claim. Giữ đơn giản cho closed beta —
 *  có thể mở rộng theo `streakAtClaim` (vd 500 LT mỗi 7 ngày liên tiếp) sau. */
export const DAILY_LOGIN_LINH_THACH = 100n;

export interface DailyLoginStatus {
  /** YYYY-MM-DD theo `MISSION_RESET_TZ`, vd "2026-04-29". */
  todayDateLocal: string;
  /** True khi character chưa claim ngày `todayDateLocal`. */
  canClaimToday: boolean;
  /** Streak trước khi claim hôm nay (= streak hiện tại). 0 nếu chưa từng claim. */
  currentStreak: number;
  /** Tiền thưởng cho lần claim tiếp theo (linh thạch). */
  nextRewardLinhThach: string;
}

export interface DailyLoginClaimResult {
  /** True = vừa cộng tiền lần đầu hôm nay. False = đã claim trước đó (idempotent). */
  claimed: boolean;
  /** Số linh thạch trao trong lần claim này (0 nếu idempotent). Đã tính cả bonus. */
  linhThachDelta: string;
  /** Phase 15.3.A — base linh thạch trước khi apply LiveOps bonus. */
  baseLinhThach: string;
  /** Phase 15.3.A — LiveOps bonus info, `null` nếu không có event. */
  liveOpsBonus: {
    multiplier: number;
    bonusLinhThach: string;
    eventKey: string;
  } | null;
  /** Streak sau khi claim (đã bao gồm hôm nay nếu claimed=true). */
  newStreak: number;
  /** YYYY-MM-DD đã claim. */
  claimDateLocal: string;
}

/** Trả về YYYY-MM-DD trong timezone `tz` cho thời điểm `now`.
 *  Dùng en-CA → format luôn YYYY-MM-DD bất kể locale env. */
export function getLocalDateString(now: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

/** Cộng 1 ngày local theo `tz` cho YYYY-MM-DD. Dùng để compute "yesterday". */
export function addDaysLocal(dateLocal: string, days: number): string {
  const [y, m, d] = dateLocal.split('-').map((s) => parseInt(s, 10));
  const utc = Date.UTC(y, m - 1, d + days);
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

@Injectable()
export class DailyLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    @Optional() private readonly sectWar?: SectWarService,
    @Optional()
    private readonly liveOpsEvents?: LiveOpsEventSchedulerService,
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  private async getCharacterIdByUser(userId: string): Promise<string> {
    const ch = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ch) throw new DailyLoginError('NO_CHARACTER');
    return ch.id;
  }

  /** Trạng thái daily login cho user. Không thay đổi DB. */
  async status(userId: string, now: Date = new Date()): Promise<DailyLoginStatus> {
    const characterId = await this.getCharacterIdByUser(userId);
    const tz = getMissionResetTz();
    const todayDateLocal = getLocalDateString(now, tz);

    const last = await this.prisma.dailyLoginClaim.findFirst({
      where: { characterId },
      orderBy: { claimDateLocal: 'desc' },
      select: { claimDateLocal: true, streakAtClaim: true },
    });

    let canClaimToday = true;
    let currentStreak = 0;
    if (last) {
      if (last.claimDateLocal === todayDateLocal) {
        canClaimToday = false;
        currentStreak = last.streakAtClaim;
      } else if (last.claimDateLocal === addDaysLocal(todayDateLocal, -1)) {
        currentStreak = last.streakAtClaim;
      } else {
        currentStreak = 0;
      }
    }

    return {
      todayDateLocal,
      canClaimToday,
      currentStreak,
      nextRewardLinhThach: DAILY_LOGIN_LINH_THACH.toString(),
    };
  }

  /** Claim phần thưởng hôm nay. Idempotent: gọi nhiều lần cùng 1 ngày → trả về
   *  `{ claimed: false }` lần thứ 2 trở đi (không cộng tiền thêm).
   *
   *  Phase 15.3.A — LiveOps `DAILY_LOGIN_BONUS`:
   *  - Read `getActiveMultiplier('DAILY_LOGIN_BONUS', now)`, max-only compose.
   *  - Cap clamp ≤ 2.0 (= x2). Nếu m=1 (no event), `bonus = 0n`.
   *  - Bonus delta = `floor(BASE * (m - 1))`. Total grant = `BASE + bonus`.
   *  - One-claim-per-day guard đã có (UNIQUE (characterId,claimDateLocal))
   *    — retry không double bonus.
   *  - Daily Reward Cap KHÔNG áp dụng cho `DAILY_LOGIN` (xem `daily-reward
   *    -cap.ts` REWARD_SOURCES = ['CULTIVATION', 'DUNGEON', 'MISSION']).
   *  - Fail-soft LiveOps service → bonus 0, claim tiếp tục (player không
   *    thấy event nhưng không bị mất base reward).
   */
  async claim(userId: string, now: Date = new Date()): Promise<DailyLoginClaimResult> {
    const characterId = await this.getCharacterIdByUser(userId);
    const tz = getMissionResetTz();
    const todayDateLocal = getLocalDateString(now, tz);
    const yesterdayLocal = addDaysLocal(todayDateLocal, -1);

    // Tính streak mới: nếu hôm qua đã claim → +1; nếu không → reset về 1.
    const yesterday = await this.prisma.dailyLoginClaim.findUnique({
      where: {
        characterId_claimDateLocal: { characterId, claimDateLocal: yesterdayLocal },
      },
      select: { streakAtClaim: true },
    });
    const newStreak = yesterday ? yesterday.streakAtClaim + 1 : 1;

    // Phase 15.3.A — read LiveOps `DAILY_LOGIN_BONUS` modifier (max-only).
    let liveOpsBonus: {
      multiplier: number;
      bonusLinhThach: string;
      eventKey: string;
    } | null = null;
    let bonusDelta = 0n;
    try {
      if (this.liveOpsEvents) {
        const modifiers = await this.liveOpsEvents.getRuntimeModifiers(now);
        let bestMul = 1.0;
        let bestKey: string | null = null;
        for (const m of modifiers) {
          if (m.type !== 'DAILY_LOGIN_BONUS') continue;
          const clamped = clampLiveOpsMultiplier('DAILY_LOGIN_BONUS', m.multiplier);
          if (clamped > bestMul) {
            bestMul = clamped;
            bestKey = m.eventKey;
          }
        }
        if (bestMul > 1.0 && bestKey) {
          // bonus = floor(BASE * (mul - 1)); ví dụ mul=1.5, base=100 → 50.
          const baseN = Number(DAILY_LOGIN_LINH_THACH);
          const bonusN = Math.floor(baseN * (bestMul - 1));
          bonusDelta = BigInt(bonusN);
          liveOpsBonus = {
            multiplier: bestMul,
            bonusLinhThach: bonusDelta.toString(),
            eventKey: bestKey,
          };
        }
      }
    } catch {
      bonusDelta = 0n;
      liveOpsBonus = null;
    }
    const totalDelta = DAILY_LOGIN_LINH_THACH + bonusDelta;

    try {
      await this.prisma.$transaction(async (tx) => {
        // INSERT trước — nếu trùng (characterId, today) sẽ throw P2002 và rollback.
        await tx.dailyLoginClaim.create({
          data: {
            characterId,
            claimDateLocal: todayDateLocal,
            linhThachDelta: totalDelta,
            streakAtClaim: newStreak,
          },
        });
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: totalDelta,
          reason: 'DAILY_LOGIN',
          refType: 'DailyLoginClaim',
          refId: todayDateLocal,
          meta: {
            streakAtClaim: newStreak,
            baseLinhThach: DAILY_LOGIN_LINH_THACH.toString(),
            liveOpsBonus,
          },
        });
        // Phase 13.1.A — Sect War contribution hook. Idempotent qua
        // (weekKey, characterId, activityKey, sourceType, sourceId)
        // với sourceId = todayDateLocal — re-claim cùng ngày không double.
        // Fail-soft: daily login đã grant currency, sect war chỉ là cosmetic.
        if (this.sectWar) {
          try {
            await this.sectWar.addContributionTx(tx, {
              characterId,
              activityKey: 'daily_login',
              sourceId: todayDateLocal,
              now,
            });
          } catch {
            // swallow — sect-war không phá flow.
          }
        }
      });
      // Phase 44.1 — onboarding auto-track. Fire-and-forget.
      if (this.onboarding) {
        void this.onboarding.notifyAction(characterId, 'DAILY_LOGIN_CLAIM');
      }
      return {
        claimed: true,
        linhThachDelta: totalDelta.toString(),
        baseLinhThach: DAILY_LOGIN_LINH_THACH.toString(),
        liveOpsBonus,
        newStreak,
        claimDateLocal: todayDateLocal,
      };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.dailyLoginClaim.findUnique({
          where: {
            characterId_claimDateLocal: { characterId, claimDateLocal: todayDateLocal },
          },
          select: { streakAtClaim: true },
        });
        return {
          claimed: false,
          linhThachDelta: '0',
          baseLinhThach: DAILY_LOGIN_LINH_THACH.toString(),
          liveOpsBonus: null,
          newStreak: existing?.streakAtClaim ?? newStreak,
          claimDateLocal: todayDateLocal,
        };
      }
      throw e;
    }
  }
}
