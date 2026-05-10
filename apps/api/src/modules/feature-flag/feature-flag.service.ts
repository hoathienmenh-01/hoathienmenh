/**
 * Phase 15.4 — Feature Flag DB-backed service.
 *
 * Provides:
 *   - `isEnabled(key)` — runtime gate, cache 30s, fail-open default.
 *   - `getFlag(key)` / `listFlags()` — admin view full metadata.
 *   - `getPublicFlags()` — whitelist subset cho `GET /feature-flags/public`.
 *   - `setFlag(adminId, key, enabled)` — admin update DB + invalidate cache.
 *   - `ensureDefaultFlags()` — lazy upsert tất cả catalog keys với
 *     `defaultEnabled` (idempotent) — phục vụ admin "Refresh defaults".
 *   - `clearCache()` — admin force flush cache.
 *   - `requireEnabled(key)` — runtime guard helper, throw
 *     `FeatureFlagDisabledError` khi flag off.
 *
 * Cache design (2-tier):
 *   - **L1 in-memory** (Map<key, {value, expiresAt}>) — TTL 30s, per-pod.
 *   - **L2 Redis** (key `feature-flag:<KEY>`, TTL 30s) — chia sẻ giữa pod.
 *   - Read flow: L1 → L2 → DB → default catalog.
 *   - Write flow: DB upsert → invalidate L1 + L2 (DEL).
 *   - Fallback: nếu Redis lỗi (timeout/connection refused), bỏ qua L2 và
 *     dùng L1 (per-pod) — không crash request, log warn.
 *
 * Server-authoritative gate:
 *   - Runtime guard luôn dùng `isEnabled` qua service (không cache local
 *     trong module khác). Cache TTL 30s đảm bảo admin tắt flag → tất cả
 *     pod nhận trong ≤ 30s mà không cần restart.
 *   - Default fail-open (Phase 15.4 default `true` cho mọi flag) — nếu
 *     DB+Redis cùng lỗi, gameplay không bị block. Production có thể đảo
 *     sang fail-closed cho `SAFETY` flag bằng `defaultEnabled=false` ở
 *     catalog (chưa có flag SAFETY Phase 15.4).
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_KEYS,
  PUBLIC_FEATURE_FLAG_KEYS,
  type FeatureFlagAdminView,
  type FeatureFlagDef,
  type FeatureFlagKey,
  type FeatureFlagPublicView,
  getDefaultFeatureFlagEnabled,
  getFeatureFlagDef,
  isFeatureFlagKey,
} from '@xuantoi/shared';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../common/prisma.service';
import { REDIS_CONNECTION } from '../../common/redis.module';
import { ConfigVersionService } from '../config-version/config-version.service';

/**
 * Phase 15.6 — Snapshot for ConfigVersion persistence (Feature Flag).
 * KHÔNG include id/createdAt/updatedAt; chỉ ghi semantically-meaningful fields.
 */
export function snapshotFeatureFlag(input: {
  key: string;
  enabled: boolean;
  category: string;
  description?: string | null;
}): Record<string, unknown> {
  return {
    key: input.key,
    enabled: input.enabled,
    category: input.category,
    description: input.description ?? null,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FeatureFlagDisabledError extends Error {
  constructor(public readonly flag: FeatureFlagKey) {
    super(`Feature disabled: ${flag}`);
    this.name = 'FeatureFlagDisabledError';
  }
}

/**
 * Throw `HttpException` 503 với envelope `FEATURE_DISABLED`. Filter
 * `AllExceptionsFilter` pass-through body envelope, FE nhận:
 *   ```json
 *   { "ok": false, "error": { "code": "FEATURE_DISABLED", "message": "..." } }
 *   ```
 * Sử dụng: `if (!await featureFlags.isEnabled(key)) throwFeatureDisabled(key);`
 * Hoặc gọi `featureFlags.requireEnabled(key)` (alias).
 */
export function throwFeatureDisabled(flag: FeatureFlagKey): never {
  throw new HttpException(
    {
      ok: false,
      error: {
        code: 'FEATURE_DISABLED',
        message: `Feature disabled: ${flag}`,
      },
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

export class FeatureFlagInvalidKeyError extends Error {
  constructor(public readonly key: string) {
    super(`Invalid feature flag key: ${key}`);
    this.name = 'FeatureFlagInvalidKeyError';
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

/** Read default TTL from env, fallback 30s. Cap range [5s, 300s]. */
function readCacheTtlSec(): number {
  const raw = process.env.FEATURE_FLAG_CACHE_TTL_SEC;
  if (!raw) return 30;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 5 || n > 300) return 30;
  return n;
}

const REDIS_KEY_PREFIX = 'feature-flag:';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly l1Cache = new Map<FeatureFlagKey, CacheEntry>();
  private readonly cacheTtlSec: number;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CONNECTION) private readonly redis: Redis | null,
    @Optional() private readonly configVersion?: ConfigVersionService,
  ) {
    this.cacheTtlSec = readCacheTtlSec();
  }

  // -------------------------------------------------------------------------
  // Public read API (gameplay runtime)
  // -------------------------------------------------------------------------

  /**
   * Trả về `enabled` cho flag, dùng L1 → L2 → DB → default catalog.
   *
   * Fail-safe: nếu mọi tầng cùng lỗi (DB down + Redis down), trả về
   * `getDefaultFeatureFlagEnabled(key)` — Phase 15.4 default true cho
   * mọi flag → không block gameplay khi infra suy yếu.
   */
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    if (!isFeatureFlagKey(key)) {
      throw new FeatureFlagInvalidKeyError(key);
    }

    // L1
    const now = Date.now();
    const l1 = this.l1Cache.get(key);
    if (l1 && l1.expiresAt > now) {
      return l1.value;
    }

    // L2 (Redis) — try, fallback DB on error
    if (this.redis) {
      try {
        const cached = await this.redis.get(REDIS_KEY_PREFIX + key);
        if (cached === '1' || cached === '0') {
          const value = cached === '1';
          this.l1Cache.set(key, {
            value,
            expiresAt: now + this.cacheTtlSec * 1000,
          });
          return value;
        }
      } catch (e) {
        this.logger.warn(
          `redis read failed for flag ${key}: ${(e as Error).message}`,
        );
        // fall through to DB
      }
    }

    // DB
    let value: boolean;
    try {
      const row = await this.prisma.featureFlag.findUnique({
        where: { key },
        select: { enabled: true },
      });
      value = row ? row.enabled : getDefaultFeatureFlagEnabled(key);
    } catch (e) {
      this.logger.warn(
        `db read failed for flag ${key}: ${(e as Error).message} — fallback default`,
      );
      value = getDefaultFeatureFlagEnabled(key);
    }

    // Populate caches
    this.l1Cache.set(key, {
      value,
      expiresAt: now + this.cacheTtlSec * 1000,
    });
    if (this.redis) {
      try {
        await this.redis.set(
          REDIS_KEY_PREFIX + key,
          value ? '1' : '0',
          'EX',
          this.cacheTtlSec,
        );
      } catch (e) {
        this.logger.warn(
          `redis write failed for flag ${key}: ${(e as Error).message}`,
        );
      }
    }
    return value;
  }

  /**
   * Trả nhiều flag cùng lúc — tận dụng cache. Không atomic; mỗi key đọc
   * độc lập. Dùng cho `GET /feature-flags/public` + admin panel.
   */
  async getManyFlags(
    keys: readonly FeatureFlagKey[],
  ): Promise<Record<FeatureFlagKey, boolean>> {
    const out = {} as Record<FeatureFlagKey, boolean>;
    await Promise.all(
      keys.map(async (k) => {
        out[k] = await this.isEnabled(k);
      }),
    );
    return out;
  }

  /**
   * Throw `FeatureFlagDisabledError` nếu flag off. Caller (controller /
   * service runtime) bắt error → map HTTP 503 + body `FEATURE_DISABLED`.
   *
   * Pattern khuyến nghị:
   *   ```ts
   *   await this.featureFlags.requireEnabled('ARENA_ENABLED');
   *   // ... arena logic
   *   ```
   */
  async requireEnabled(key: FeatureFlagKey): Promise<void> {
    const enabled = await this.isEnabled(key);
    if (!enabled) {
      throwFeatureDisabled(key);
    }
  }

  // -------------------------------------------------------------------------
  // Public-safe view (frontend gate UI)
  // -------------------------------------------------------------------------

  /**
   * Trả whitelist các flag được expose qua `GET /feature-flags/public`.
   * KHÔNG chứa updatedByAdminId / module / description (giảm fingerprint).
   */
  async getPublicFlags(): Promise<FeatureFlagPublicView[]> {
    const values = await this.getManyFlags(PUBLIC_FEATURE_FLAG_KEYS);
    return PUBLIC_FEATURE_FLAG_KEYS.map((key) => ({
      key,
      enabled: values[key],
    }));
  }

  // -------------------------------------------------------------------------
  // Admin read
  // -------------------------------------------------------------------------

  /**
   * Trả full admin view cho 1 flag (description / category / module /
   * updatedAt). Nếu DB row chưa tồn tại, merge với default catalog
   * (`updatedAt: null`, `enabled: defaultEnabled`).
   */
  async getFlag(key: FeatureFlagKey): Promise<FeatureFlagAdminView> {
    if (!isFeatureFlagKey(key)) {
      throw new FeatureFlagInvalidKeyError(key);
    }
    const def = getFeatureFlagDef(key);
    const row = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: {
        enabled: true,
        updatedByAdminId: true,
        updatedAt: true,
      },
    });
    return mergeAdminView(def, row);
  }

  /**
   * List tất cả catalog keys với DB row merge — admin panel hiển thị
   * mọi flag (kể cả flag chưa có DB row, value = defaultEnabled).
   * Sort theo category rồi key.
   */
  async listFlags(): Promise<FeatureFlagAdminView[]> {
    const rows = await this.prisma.featureFlag.findMany({
      select: {
        key: true,
        enabled: true,
        updatedByAdminId: true,
        updatedAt: true,
      },
    });
    const rowMap = new Map(rows.map((r) => [r.key, r]));
    const out = FEATURE_FLAG_CATALOG.map((def) =>
      mergeAdminView(def, rowMap.get(def.key) ?? null),
    );
    // Sort: category alphabet rồi key alphabet (consistent UI ordering).
    return out.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.key.localeCompare(b.key);
    });
  }

  // -------------------------------------------------------------------------
  // Admin write
  // -------------------------------------------------------------------------

  /**
   * Upsert flag với `enabled` mới + `updatedByAdminId`. Invalidate cả 2
   * tầng cache. Trả về admin view sau update để controller audit log.
   */
  async setFlag(
    adminUserId: string,
    key: FeatureFlagKey,
    enabled: boolean,
  ): Promise<FeatureFlagAdminView> {
    if (!isFeatureFlagKey(key)) {
      throw new FeatureFlagInvalidKeyError(key);
    }
    const def = getFeatureFlagDef(key);
    // Phase 15.6 — có row trước khi upsert để phân biệt CREATE vs UPDATE.
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true, category: true, description: true },
    });
    const row = await this.prisma.featureFlag.upsert({
      where: { key },
      update: {
        enabled,
        updatedByAdminId: adminUserId,
        category: def.category,
        description: def.descriptionVi,
      },
      create: {
        key,
        enabled,
        category: def.category,
        description: def.descriptionVi,
        updatedByAdminId: adminUserId,
      },
      select: {
        enabled: true,
        updatedByAdminId: true,
        updatedAt: true,
      },
    });
    await this.invalidateCache(key);
    await this.recordConfigVersionSafe({
      entityId: key,
      action: existing ? 'UPDATE' : 'CREATE',
      beforeJson: existing
        ? snapshotFeatureFlag({ key, ...existing })
        : null,
      afterJson: snapshotFeatureFlag({
        key,
        enabled: row.enabled,
        category: def.category,
        description: def.descriptionVi,
      }),
      adminId: adminUserId,
    });
    return mergeAdminView(def, row);
  }

  /**
   * Lazy seed mọi catalog keys với `defaultEnabled`. Idempotent — chạy
   * lại không thay đổi gì với row đã tồn tại.
   *
   * Dùng cho:
   *   - First-boot trong test (ensure deterministic state).
   *   - Admin "Refresh defaults" button — chỉ tạo row thiếu, KHÔNG ghi đè
   *     row đã có (admin tắt manually không bị reset).
   */
  async ensureDefaultFlags(): Promise<{ created: number; existing: number }> {
    const existing = await this.prisma.featureFlag.findMany({
      select: { key: true },
    });
    const existingSet = new Set(existing.map((r) => r.key));
    let created = 0;
    for (const def of FEATURE_FLAG_CATALOG) {
      if (existingSet.has(def.key)) continue;
      await this.prisma.featureFlag.create({
        data: {
          key: def.key,
          enabled: def.defaultEnabled,
          category: def.category,
          description: def.descriptionVi,
        },
      });
      created += 1;
      // Phase 15.6 — record CREATE version cho seed row mới.
      await this.recordConfigVersionSafe({
        entityId: def.key,
        action: 'CREATE',
        beforeJson: null,
        afterJson: snapshotFeatureFlag({
          key: def.key,
          enabled: def.defaultEnabled,
          category: def.category,
          description: def.descriptionVi,
        }),
        adminId: null,
      });
    }
    if (created > 0) {
      // Invalidate all (server-side defaults vừa thay đổi semantics — rare).
      await this.clearCache();
    }
    return { created, existing: existing.length };
  }

  /**
   * Phase 15.6 — best-effort ghi ConfigVersion sau khi flag mutation. Khi
   * ConfigVersion ghi fail (DB tạm, configVersion undefined trong unit
   * test), KHÔNG throw — setFlag đã commit row.
   */
  private async recordConfigVersionSafe(args: {
    entityId: string;
    action: 'CREATE' | 'UPDATE' | 'DISABLE' | 'ENABLE';
    beforeJson: Record<string, unknown> | null;
    afterJson: Record<string, unknown>;
    adminId: string | null;
  }): Promise<void> {
    if (!this.configVersion) return;
    try {
      await this.configVersion.recordVersion({
        entityType: 'FEATURE_FLAG',
        entityId: args.entityId,
        action: args.action,
        beforeJson: args.beforeJson,
        afterJson: args.afterJson,
        changedByAdminId: args.adminId,
      });
    } catch (e) {
      this.logger.warn(
        `recordConfigVersion failed for FEATURE_FLAG/${args.entityId}: ${(e as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Cache management
  // -------------------------------------------------------------------------

  async clearCache(): Promise<void> {
    this.l1Cache.clear();
    if (!this.redis) return;
    try {
      // SCAN-DEL pattern thay cho FLUSHDB (tránh xoá keys khác)
      const keys = FEATURE_FLAG_KEYS.map((k) => REDIS_KEY_PREFIX + k);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (e) {
      this.logger.warn(
        `redis clear cache failed: ${(e as Error).message}`,
      );
    }
  }

  private async invalidateCache(key: FeatureFlagKey): Promise<void> {
    this.l1Cache.delete(key);
    if (!this.redis) return;
    try {
      await this.redis.del(REDIS_KEY_PREFIX + key);
    } catch (e) {
      this.logger.warn(
        `redis invalidate failed for ${key}: ${(e as Error).message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeAdminView(
  def: FeatureFlagDef,
  row: {
    enabled: boolean;
    updatedByAdminId: string | null;
    updatedAt: Date;
  } | null,
): FeatureFlagAdminView {
  return {
    key: def.key,
    enabled: row ? row.enabled : def.defaultEnabled,
    category: def.category,
    descriptionVi: def.descriptionVi,
    descriptionEn: def.descriptionEn,
    public: def.public,
    requiresRestart: def.requiresRestart,
    module: def.module,
    defaultEnabled: def.defaultEnabled,
    updatedByAdminId: row?.updatedByAdminId ?? null,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}
