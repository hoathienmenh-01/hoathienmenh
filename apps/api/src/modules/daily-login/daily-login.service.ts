import { Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { getMissionResetTz } from '../mission/mission.service';
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
  /** Số linh thạch trao trong lần claim này (0 nếu idempotent). */
  linhThachDelta: string;
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
   *  `{ claimed: false }` lần thứ 2 trở đi (không cộng tiền thêm). */
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

    try {
      await this.prisma.$transaction(async (tx) => {
        // INSERT trước — nếu trùng (characterId, today) sẽ throw P2002 và rollback.
        await tx.dailyLoginClaim.create({
          data: {
            characterId,
            claimDateLocal: todayDateLocal,
            linhThachDelta: DAILY_LOGIN_LINH_THACH,
            streakAtClaim: newStreak,
          },
        });
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: DAILY_LOGIN_LINH_THACH,
          reason: 'DAILY_LOGIN',
          refType: 'DailyLoginClaim',
          refId: todayDateLocal,
          meta: { streakAtClaim: newStreak },
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
      return {
        claimed: true,
        linhThachDelta: DAILY_LOGIN_LINH_THACH.toString(),
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
          newStreak: existing?.streakAtClaim ?? newStreak,
          claimDateLocal: todayDateLocal,
        };
      }
      throw e;
    }
  }
}
