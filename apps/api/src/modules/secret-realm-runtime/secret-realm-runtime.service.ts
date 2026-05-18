import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  isSecretRealmCleared,
  realmByKey,
  SECRET_REALM_REWARD_CAPS,
  SECRET_REALMS,
  secretRealmByKey,
  secretRealmGateStatusFor,
  type SecretRealmDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';

/**
 * Phase 44.1 — UTC date key cho daily-limit window. Đồng nhất 1 ngày =
 * 1 UTC day để tránh tz drift trên multi-region.
 */
function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Phase 34.2 — Secret Realm / Bí Cảnh Runtime Service.
 *
 * Lifecycle:
 *   1. `enter(realmKey)` — gate by realm-order + story flags + cooldown.
 *      Inserts a new run row (ENTERED).
 *   2. `progress(runId, objKey, delta)` — increment objective progress
 *      (clamped to target).
 *   3. `complete(runId)` — CAS ENTERED → CLEARED when all objectives done.
 *   4. `claim(runId)` — atomic CAS CLEARED → CLAIMED, grant capped reward
 *      via `CurrencyService.applyTx('SECRET_REALM_CLAIM')`.
 *
 * Reward path: linhThach + exp only. Caps re-enforced at claim time.
 * **NEVER** mint tienNgoc, **NEVER** grant endgame items.
 */

export const SECRET_REALM_RUN_STATUSES = [
  'ENTERED',
  'CLEARED',
  'CLAIMED',
  'EXPIRED',
] as const;
export type SecretRealmRunStatus = (typeof SECRET_REALM_RUN_STATUSES)[number];

export interface SecretRealmListEntry {
  key: string;
  nameVi: string;
  nameEn: string;
  status: 'LOCKED' | 'AVAILABLE' | 'ENTERED' | 'CLEARED' | 'CLAIMED';
  requiredRealmOrder: number;
  cooldownHours: number;
  rewardProfile: { linhThach: number; exp: number };
  activeRunId: string | null;
  /**
   * Phase 44.1 — UI hint fields. UI dùng để hiển thị panel điều kiện vào
   * bí cảnh trước khi nhấn `Enter`. Không thay đổi runtime gate logic.
   */
  realmOrderOk: boolean;
  cooldownRemainingMs: number;
  runsToday: number;
  dailyRunsRemaining: number;
  entryTicketItemKey: string | null;
  rewardCaps: { linhThachMax: number; expMax: number };
}

export interface SecretRealmRunView {
  id: string;
  secretRealmKey: string;
  status: SecretRealmRunStatus;
  startedAt: string;
  clearedAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  objectiveProgress: Record<string, number>;
  linhThachGranted: number;
  expGranted: number;
}

export interface SecretRealmClaimResult {
  claimed: boolean;
  linhThachGranted: number;
  expGranted: number;
  run: SecretRealmRunView;
}

export class SecretRealmError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'SecretRealmError';
  }
}

@Injectable()
export class SecretRealmRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  private async getCharacter(
    userId: string,
  ): Promise<{ id: string; realmKey: string }> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!c) throw new SecretRealmError('NO_CHARACTER');
    return c;
  }

  /** List every realm in the catalog with the character's view-status. */
  async list(userId: string): Promise<SecretRealmListEntry[]> {
    const char = await this.getCharacter(userId);
    const realmOrder = (realmByKey(char.realmKey)?.order ?? -1) + 1;
    const lastByKey = new Map<string, Date>();
    const activeByKey = new Map<string, string>();
    const todayCountByKey = new Map<string, number>();
    const todayKey = utcDateKey();
    const rows = await this.prisma.characterSecretRealmRun.findMany({
      where: { characterId: char.id },
      orderBy: { startedAt: 'desc' },
    });
    for (const r of rows) {
      if (r.status === 'CLAIMED' || r.status === 'CLEARED') {
        const prev = lastByKey.get(r.secretRealmKey);
        const at = r.claimedAt ?? r.clearedAt;
        if (at && (!prev || prev.getTime() < at.getTime())) {
          lastByKey.set(r.secretRealmKey, at);
        }
      }
      if (
        (r.status === 'ENTERED' || r.status === 'CLEARED') &&
        !activeByKey.has(r.secretRealmKey)
      ) {
        activeByKey.set(r.secretRealmKey, r.id);
      }
      // Daily-limit count: chỉ tính run được tạo trong UTC date hôm nay,
      // bất kể status (kể cả ENTERED đang dở dang).
      if (utcDateKey(r.startedAt) === todayKey) {
        todayCountByKey.set(
          r.secretRealmKey,
          (todayCountByKey.get(r.secretRealmKey) ?? 0) + 1,
        );
      }
    }
    const now = Date.now();
    return SECRET_REALMS.map((def): SecretRealmListEntry => {
      const gate = secretRealmGateStatusFor(def, {
        realmOrder,
        lastClearedAt: lastByKey.get(def.key) ?? null,
      });
      const activeRunId = activeByKey.get(def.key) ?? null;
      let status: SecretRealmListEntry['status'] = gate;
      if (activeRunId) {
        const r = rows.find((rr) => rr.id === activeRunId);
        status = r?.status === 'CLEARED' ? 'CLEARED' : 'ENTERED';
      }
      const lastAt = lastByKey.get(def.key);
      const cooldownRemainingMs = lastAt
        ? Math.max(
            0,
            def.cooldownHours * 60 * 60 * 1000 - (now - lastAt.getTime()),
          )
        : 0;
      const runsToday = todayCountByKey.get(def.key) ?? 0;
      return {
        key: def.key,
        nameVi: def.nameVi,
        nameEn: def.nameEn,
        status,
        requiredRealmOrder: def.requiredRealmOrder,
        cooldownHours: def.cooldownHours,
        rewardProfile: {
          linhThach: def.rewardProfile.linhThach,
          exp: def.rewardProfile.exp,
        },
        activeRunId,
        realmOrderOk: realmOrder >= def.requiredRealmOrder,
        cooldownRemainingMs,
        runsToday,
        dailyRunsRemaining: Math.max(
          0,
          SECRET_REALM_REWARD_CAPS.dailyRunsPerRealm - runsToday,
        ),
        entryTicketItemKey: def.entryTicketItemKey ?? null,
        rewardCaps: {
          linhThachMax: SECRET_REALM_REWARD_CAPS.linhThachMax,
          expMax: SECRET_REALM_REWARD_CAPS.expMax,
        },
      };
    });
  }

  /**
   * Begin a run. Gating order:
   *   1. realmKey exists in catalog.
   *   2. realm-order satisfied.
   *   3. cooldown elapsed since last successful clear/claim.
   *   4. no active (ENTERED/CLEARED) run for the same realm.
   *   5. (Phase 44.1) daily limit cap (`SECRET_REALM_REWARD_CAPS.dailyRunsPerRealm`)
   *      counted per UTC date — guard against farming/spam.
   *
   * Phase 44.1 — Active-run guard moved BEFORE create. Combined với
   * `findFirst({ status: { in: ['ENTERED', 'CLEARED'] } })` đã đủ chống
   * 2 enter song song create 2 runs. Lưu ý: schema không có composite
   * UNIQUE — race-window vẫn tồn tại nếu 2 request đồng thời lọt qua
   * findFirst trước khi create. Để hardening hoàn toàn cần thêm DB
   * partial unique index `(characterId, secretRealmKey) WHERE status IN
   * ('ENTERED','CLEARED')`. Trong PR này chấp nhận window vài ms — Spam
   * test ở suite vẫn cover trường hợp serial submit.
   */
  async enter(userId: string, realmKey: string): Promise<SecretRealmRunView> {
    const def = secretRealmByKey(realmKey);
    if (!def) throw new SecretRealmError('SECRET_REALM_NOT_FOUND');
    const char = await this.getCharacter(userId);
    const realmOrder = (realmByKey(char.realmKey)?.order ?? -1) + 1;
    if (def.requiredRealmOrder > realmOrder) {
      throw new SecretRealmError('SECRET_REALM_REALM_LOCKED');
    }
    const recent = await this.prisma.characterSecretRealmRun.findFirst({
      where: {
        characterId: char.id,
        secretRealmKey: realmKey,
        status: { in: ['CLAIMED', 'CLEARED'] },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (recent) {
      const at = recent.claimedAt ?? recent.clearedAt;
      if (at) {
        const elapsedMs = Date.now() - at.getTime();
        if (elapsedMs < def.cooldownHours * 60 * 60 * 1000) {
          throw new SecretRealmError('SECRET_REALM_COOLDOWN');
        }
      }
    }
    const active = await this.prisma.characterSecretRealmRun.findFirst({
      where: {
        characterId: char.id,
        secretRealmKey: realmKey,
        status: { in: ['ENTERED', 'CLEARED'] },
      },
    });
    if (active) {
      throw new SecretRealmError('SECRET_REALM_RUN_ACTIVE');
    }
    // Phase 44.1 — Daily limit check. Đếm tất cả run được tạo trong UTC
    // date hôm nay cho realm này, bất kể trạng thái (kể cả CLEARED/CLAIMED).
    const todayStart = new Date(`${utcDateKey()}T00:00:00.000Z`);
    const todayCount = await this.prisma.characterSecretRealmRun.count({
      where: {
        characterId: char.id,
        secretRealmKey: realmKey,
        startedAt: { gte: todayStart },
      },
    });
    if (todayCount >= SECRET_REALM_REWARD_CAPS.dailyRunsPerRealm) {
      throw new SecretRealmError('SECRET_REALM_DAILY_LIMIT');
    }
    const initialProgress: Record<string, number> = {};
    for (const o of def.objectives) initialProgress[o.key] = 0;
    let row;
    try {
      row = await this.prisma.characterSecretRealmRun.create({
        data: {
          characterId: char.id,
          secretRealmKey: realmKey,
          status: 'ENTERED',
          objectiveProgressJson: initialProgress as never,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new SecretRealmError('SECRET_REALM_RUN_ACTIVE');
      }
      throw e;
    }
    return this.toRunView(row, def);
  }

  /** Inspect a run. */
  async getRun(userId: string, runId: string): Promise<SecretRealmRunView> {
    const char = await this.getCharacter(userId);
    const row = await this.prisma.characterSecretRealmRun.findUnique({
      where: { id: runId },
    });
    if (!row || row.characterId !== char.id) {
      throw new SecretRealmError('SECRET_REALM_RUN_NOT_FOUND');
    }
    const def = secretRealmByKey(row.secretRealmKey);
    if (!def) throw new SecretRealmError('SECRET_REALM_NOT_FOUND');
    return this.toRunView(row, def);
  }

  /**
   * Increment one objective. `delta` clamped to `[1, objective.target -
   * current]`. Returns the new run view.
   */
  async progress(
    userId: string,
    runId: string,
    objectiveKey: string,
    delta: number,
  ): Promise<SecretRealmRunView> {
    const char = await this.getCharacter(userId);
    const row = await this.prisma.characterSecretRealmRun.findUnique({
      where: { id: runId },
    });
    if (!row || row.characterId !== char.id) {
      throw new SecretRealmError('SECRET_REALM_RUN_NOT_FOUND');
    }
    if (row.status !== 'ENTERED') {
      throw new SecretRealmError('SECRET_REALM_RUN_NOT_ACTIVE');
    }
    const def = secretRealmByKey(row.secretRealmKey);
    if (!def) throw new SecretRealmError('SECRET_REALM_NOT_FOUND');
    const obj = def.objectives.find((o) => o.key === objectiveKey);
    if (!obj) throw new SecretRealmError('SECRET_REALM_OBJECTIVE_INVALID');
    if (!Number.isFinite(delta) || delta < 1) {
      throw new SecretRealmError('SECRET_REALM_DELTA_INVALID');
    }
    const progress = (row.objectiveProgressJson as Record<string, number>) ?? {};
    const current = progress[obj.key] ?? 0;
    const next = Math.min(obj.target, current + delta);
    const newProgress = { ...progress, [obj.key]: next };
    const updated = await this.prisma.characterSecretRealmRun.update({
      where: { id: row.id },
      data: { objectiveProgressJson: newProgress as never },
    });
    return this.toRunView(updated, def);
  }

  /**
   * Mark run CLEARED when all objectives meet target. Idempotent.
   */
  async complete(
    userId: string,
    runId: string,
  ): Promise<SecretRealmRunView> {
    const char = await this.getCharacter(userId);
    const row = await this.prisma.characterSecretRealmRun.findUnique({
      where: { id: runId },
    });
    if (!row || row.characterId !== char.id) {
      throw new SecretRealmError('SECRET_REALM_RUN_NOT_FOUND');
    }
    const def = secretRealmByKey(row.secretRealmKey);
    if (!def) throw new SecretRealmError('SECRET_REALM_NOT_FOUND');
    const progress = (row.objectiveProgressJson as Record<string, number>) ?? {};
    if (!isSecretRealmCleared(def, progress)) {
      throw new SecretRealmError('SECRET_REALM_OBJECTIVES_INCOMPLETE');
    }
    const cas = await this.prisma.characterSecretRealmRun.updateMany({
      where: { id: row.id, status: 'ENTERED' },
      data: { status: 'CLEARED', clearedAt: new Date() },
    });
    void cas;
    const fresh = await this.prisma.characterSecretRealmRun.findUnique({
      where: { id: row.id },
    });
    return this.toRunView(fresh!, def);
  }

  /** Atomic claim. CAS: CLEARED → CLAIMED + currency/exp grant. */
  async claim(userId: string, runId: string): Promise<SecretRealmClaimResult> {
    const char = await this.getCharacter(userId);
    const row = await this.prisma.characterSecretRealmRun.findUnique({
      where: { id: runId },
    });
    if (!row || row.characterId !== char.id) {
      throw new SecretRealmError('SECRET_REALM_RUN_NOT_FOUND');
    }
    const def = secretRealmByKey(row.secretRealmKey);
    if (!def) throw new SecretRealmError('SECRET_REALM_NOT_FOUND');
    const cappedLinhThach = Math.min(
      def.rewardProfile.linhThach,
      SECRET_REALM_REWARD_CAPS.linhThachMax,
    );
    const cappedExp = Math.min(
      def.rewardProfile.exp,
      SECRET_REALM_REWARD_CAPS.expMax,
    );
    const now = new Date();
    let claimed = false;
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.characterSecretRealmRun.updateMany({
        where: { id: row.id, status: 'CLEARED' },
        data: {
          status: 'CLAIMED',
          claimedAt: now,
          linhThachGranted: cappedLinhThach,
          expGranted: cappedExp,
        },
      });
      if (cas.count !== 1) return;
      if (cappedLinhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(cappedLinhThach),
          reason: 'SECRET_REALM_CLAIM',
          refType: 'SecretRealmRun',
          refId: row.id,
          meta: { secretRealmKey: row.secretRealmKey },
        });
      }
      if (cappedExp > 0) {
        await tx.character.update({
          where: { id: char.id },
          data: { exp: { increment: BigInt(cappedExp) } },
        });
      }
      claimed = true;
    });
    const fresh = await this.prisma.characterSecretRealmRun.findUnique({
      where: { id: row.id },
    });
    if (!fresh) throw new SecretRealmError('SECRET_REALM_RUN_NOT_FOUND');
    if (!claimed && fresh.status !== 'CLAIMED') {
      throw new SecretRealmError('SECRET_REALM_NOT_CLEARED');
    }
    return {
      claimed,
      linhThachGranted: fresh.linhThachGranted,
      expGranted: fresh.expGranted,
      run: this.toRunView(fresh, def),
    };
  }

  async history(
    userId: string,
    limit = 30,
  ): Promise<SecretRealmRunView[]> {
    const char = await this.getCharacter(userId);
    const rows = await this.prisma.characterSecretRealmRun.findMany({
      where: { characterId: char.id },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(1, limit), 90),
    });
    const out: SecretRealmRunView[] = [];
    for (const r of rows) {
      const def = secretRealmByKey(r.secretRealmKey);
      if (!def) continue;
      out.push(this.toRunView(r, def));
    }
    return out;
  }

  private toRunView(
    row: {
      id: string;
      secretRealmKey: string;
      status: string;
      startedAt: Date;
      clearedAt: Date | null;
      claimedAt: Date | null;
      expiresAt: Date | null;
      objectiveProgressJson: unknown;
      linhThachGranted: number;
      expGranted: number;
    },
    _def: SecretRealmDef,
  ): SecretRealmRunView {
    return {
      id: row.id,
      secretRealmKey: row.secretRealmKey,
      status: row.status as SecretRealmRunStatus,
      startedAt: row.startedAt.toISOString(),
      clearedAt: row.clearedAt?.toISOString() ?? null,
      claimedAt: row.claimedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      objectiveProgress:
        (row.objectiveProgressJson as Record<string, number>) ?? {},
      linhThachGranted: row.linhThachGranted,
      expGranted: row.expGranted,
    };
  }
}
