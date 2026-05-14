/**
 * Phase 45.0 — Remote Config Center V1 — DB-backed service.
 *
 * Mirror `FeatureFlagService` pattern (Phase 15.4):
 *   - 2-tier cache (L1 in-memory map + L2 Redis), TTL 30s, fail-open.
 *   - Read flow: L1 → L2 → DB → default catalog (`getDefaultRemoteConfigValue`).
 *   - Write flow: DB upsert → invalidate L1 + L2.
 *   - Validate qua shared `validateRemoteConfigValue` trước khi persist.
 *
 * Khác feature flag:
 *   - Value đa type (string/number/boolean/json) → raw stored là string,
 *     parse khi đọc.
 *   - Admin update yêu cầu `reason` (do controller enforce; service nhận
 *     adminId + value đã validate).
 *
 * Audit: controller ghi `AdminAuditLog` action `ADMIN_REMOTE_CONFIG_UPDATE`
 * — service KHÔNG ghi audit (giảm coupling).
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
  PUBLIC_REMOTE_CONFIG_KEYS,
  REMOTE_CONFIG_CATALOG,
  REMOTE_CONFIG_KEYS,
  type RemoteConfigAdminView,
  type RemoteConfigDef,
  type RemoteConfigKey,
  type RemoteConfigPublicView,
  type RemoteConfigValue,
  type RemoteConfigViolation,
  getRemoteConfigDef,
  isRemoteConfigKey,
  validateRemoteConfigValue,
} from '@xuantoi/shared';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../common/prisma.service';
import { REDIS_CONNECTION } from '../../common/redis.module';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RemoteConfigInvalidKeyError extends Error {
  constructor(public readonly key: string) {
    super(`Invalid remote config key: ${key}`);
    this.name = 'RemoteConfigInvalidKeyError';
  }
}

export class RemoteConfigValidationError extends Error {
  constructor(
    public readonly key: RemoteConfigKey,
    public readonly violations: ReadonlyArray<RemoteConfigViolation>,
  ) {
    super(
      `Remote config validation failed for ${key}: ${violations
        .map((v) => v.code)
        .join(', ')}`,
    );
    this.name = 'RemoteConfigValidationError';
  }
}

/**
 * Throw HTTP 503 với envelope `CONFIG_DISABLED` — dùng khi caller muốn
 * gate hành vi qua boolean remote-config (vd `market_enabled=false`).
 */
export function throwConfigDisabled(key: RemoteConfigKey): never {
  throw new HttpException(
    {
      ok: false,
      error: {
        code: 'CONFIG_DISABLED',
        message: `Config disabled: ${key}`,
      },
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize JS runtime value → string for DB storage. Caller must have
 * passed `validateRemoteConfigValue` first (throws if mismatch).
 */
export function serializeRemoteConfigValue(
  def: RemoteConfigDef,
  value: unknown,
): string {
  switch (def.valueType) {
    case 'string':
      return value as string;
    case 'number':
      return String(value as number);
    case 'boolean':
      return (value as boolean) ? 'true' : 'false';
    case 'json':
      return JSON.stringify(value);
  }
}

/**
 * Parse DB raw string → typed RemoteConfigValue based on def. Best-effort:
 * if DB row corrupt (eg stored "abc" for number key), fallback to default
 * value + log warn.
 */
export function parseRemoteConfigValue(
  def: RemoteConfigDef,
  raw: string,
  logger?: Logger,
): RemoteConfigValue {
  switch (def.valueType) {
    case 'string':
      return { type: 'string', value: raw };
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        logger?.warn(
          `parseRemoteConfigValue: ${def.key} raw "${raw}" not finite → default`,
        );
        return { type: 'number', value: def.defaultValue as number };
      }
      return { type: 'number', value: n };
    }
    case 'boolean': {
      if (raw === 'true') return { type: 'boolean', value: true };
      if (raw === 'false') return { type: 'boolean', value: false };
      logger?.warn(
        `parseRemoteConfigValue: ${def.key} raw "${raw}" not bool → default`,
      );
      return { type: 'boolean', value: def.defaultValue as boolean };
    }
    case 'json': {
      try {
        return { type: 'json', value: JSON.parse(raw) };
      } catch (e) {
        logger?.warn(
          `parseRemoteConfigValue: ${def.key} JSON parse failed (${
            (e as Error).message
          }) → default`,
        );
        return { type: 'json', value: def.defaultValue };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: RemoteConfigValue;
  expiresAt: number;
}

function readCacheTtlSec(): number {
  const raw = process.env.REMOTE_CONFIG_CACHE_TTL_SEC;
  if (!raw) return 30;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 5 || n > 300) return 30;
  return n;
}

const REDIS_KEY_PREFIX = 'remote-config:';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RemoteConfigService {
  private readonly logger = new Logger(RemoteConfigService.name);
  private readonly l1Cache = new Map<RemoteConfigKey, CacheEntry>();
  private readonly cacheTtlSec: number;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CONNECTION) private readonly redis: Redis | null,
  ) {
    this.cacheTtlSec = readCacheTtlSec();
  }

  // -------------------------------------------------------------------------
  // Runtime read
  // -------------------------------------------------------------------------

  /**
   * Trả giá trị typed cho 1 key. Cache L1 → L2 → DB → default catalog.
   * Fail-open: nếu mọi tầng cùng lỗi, trả `defaultValue`.
   */
  async getConfig(key: RemoteConfigKey): Promise<RemoteConfigValue> {
    if (!isRemoteConfigKey(key)) {
      throw new RemoteConfigInvalidKeyError(key);
    }
    const def = getRemoteConfigDef(key);
    const now = Date.now();

    // L1
    const l1 = this.l1Cache.get(key);
    if (l1 && l1.expiresAt > now) {
      return l1.value;
    }

    // L2 (Redis)
    if (this.redis) {
      try {
        const cached = await this.redis.get(REDIS_KEY_PREFIX + key);
        if (cached !== null) {
          const parsed = parseRemoteConfigValue(def, cached, this.logger);
          this.l1Cache.set(key, {
            value: parsed,
            expiresAt: now + this.cacheTtlSec * 1000,
          });
          return parsed;
        }
      } catch (e) {
        this.logger.warn(
          `redis read failed for config ${key}: ${(e as Error).message}`,
        );
      }
    }

    // DB
    let parsed: RemoteConfigValue;
    let rawString: string | null = null;
    try {
      const row = await this.prisma.remoteConfig.findUnique({
        where: { key },
        select: { valueString: true },
      });
      if (row) {
        rawString = row.valueString;
        parsed = parseRemoteConfigValue(def, row.valueString, this.logger);
      } else {
        parsed = this.defaultParsedValue(def);
      }
    } catch (e) {
      this.logger.warn(
        `db read failed for config ${key}: ${(e as Error).message} — fallback default`,
      );
      parsed = this.defaultParsedValue(def);
    }

    this.l1Cache.set(key, {
      value: parsed,
      expiresAt: now + this.cacheTtlSec * 1000,
    });
    if (this.redis && rawString !== null) {
      try {
        await this.redis.set(
          REDIS_KEY_PREFIX + key,
          rawString,
          'EX',
          this.cacheTtlSec,
        );
      } catch (e) {
        this.logger.warn(
          `redis write failed for config ${key}: ${(e as Error).message}`,
        );
      }
    }
    return parsed;
  }

  /** Convenience: get raw unwrapped value (any). Caller types via `as`. */
  async getValue<T = unknown>(key: RemoteConfigKey): Promise<T> {
    const v = await this.getConfig(key);
    return v.value as T;
  }

  /** Bulk read — leverages cache. */
  async getMany(
    keys: readonly RemoteConfigKey[],
  ): Promise<Record<RemoteConfigKey, RemoteConfigValue>> {
    const out = {} as Record<RemoteConfigKey, RemoteConfigValue>;
    await Promise.all(
      keys.map(async (k) => {
        out[k] = await this.getConfig(k);
      }),
    );
    return out;
  }

  // -------------------------------------------------------------------------
  // Public view (frontend)
  // -------------------------------------------------------------------------

  async getPublicConfigs(): Promise<RemoteConfigPublicView[]> {
    const values = await this.getMany(PUBLIC_REMOTE_CONFIG_KEYS);
    return PUBLIC_REMOTE_CONFIG_KEYS.map((key) => {
      const def = getRemoteConfigDef(key);
      const wrapped = values[key];
      return {
        key,
        valueType: def.valueType,
        value: wrapped.value,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Admin read
  // -------------------------------------------------------------------------

  async getConfigAdminView(
    key: RemoteConfigKey,
  ): Promise<RemoteConfigAdminView> {
    if (!isRemoteConfigKey(key)) {
      throw new RemoteConfigInvalidKeyError(key);
    }
    const def = getRemoteConfigDef(key);
    const row = await this.prisma.remoteConfig.findUnique({
      where: { key },
      select: {
        valueString: true,
        updatedByAdminId: true,
        updatedAt: true,
      },
    });
    return mergeAdminView(def, row, this.logger);
  }

  async listConfigs(): Promise<RemoteConfigAdminView[]> {
    const rows = await this.prisma.remoteConfig.findMany({
      select: {
        key: true,
        valueString: true,
        updatedByAdminId: true,
        updatedAt: true,
      },
    });
    const rowMap = new Map(rows.map((r) => [r.key, r]));
    const out = REMOTE_CONFIG_CATALOG.map((def) =>
      mergeAdminView(def, rowMap.get(def.key) ?? null, this.logger),
    );
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  // -------------------------------------------------------------------------
  // Admin write
  // -------------------------------------------------------------------------

  /**
   * Upsert config với value mới + `updatedByAdminId`. Validate qua shared
   * `validateRemoteConfigValue` → throw `RemoteConfigValidationError` nếu
   * vi phạm cap/type/enum. Invalidate cache sau khi commit.
   */
  async setConfig(
    adminUserId: string,
    key: RemoteConfigKey,
    value: unknown,
  ): Promise<RemoteConfigAdminView> {
    if (!isRemoteConfigKey(key)) {
      throw new RemoteConfigInvalidKeyError(key);
    }
    const def = getRemoteConfigDef(key);
    const violations = validateRemoteConfigValue(key, value);
    if (violations.length > 0) {
      throw new RemoteConfigValidationError(key, violations);
    }
    const serialized = serializeRemoteConfigValue(def, value);
    const row = await this.prisma.remoteConfig.upsert({
      where: { key },
      update: {
        valueString: serialized,
        valueType: def.valueType,
        updatedByAdminId: adminUserId,
      },
      create: {
        key,
        valueString: serialized,
        valueType: def.valueType,
        updatedByAdminId: adminUserId,
      },
      select: {
        valueString: true,
        updatedByAdminId: true,
        updatedAt: true,
      },
    });
    await this.invalidateCache(key);
    return mergeAdminView(def, row, this.logger);
  }

  /**
   * Lazy seed catalog (idempotent). Tạo row thiếu với defaultValue serialized.
   */
  async ensureDefaultConfigs(): Promise<{
    created: number;
    existing: number;
  }> {
    const existing = await this.prisma.remoteConfig.findMany({
      select: { key: true },
    });
    const existingSet = new Set(existing.map((r) => r.key));
    let created = 0;
    for (const def of REMOTE_CONFIG_CATALOG) {
      if (existingSet.has(def.key)) continue;
      await this.prisma.remoteConfig.create({
        data: {
          key: def.key,
          valueType: def.valueType,
          valueString: serializeRemoteConfigValue(def, def.defaultValue),
        },
      });
      created += 1;
    }
    if (created > 0) await this.clearCache();
    return { created, existing: existing.length };
  }

  // -------------------------------------------------------------------------
  // Cache mgmt
  // -------------------------------------------------------------------------

  async clearCache(): Promise<void> {
    this.l1Cache.clear();
    if (!this.redis) return;
    try {
      const keys = REMOTE_CONFIG_KEYS.map((k) => REDIS_KEY_PREFIX + k);
      if (keys.length > 0) await this.redis.del(...keys);
    } catch (e) {
      this.logger.warn(
        `redis clear cache failed: ${(e as Error).message}`,
      );
    }
  }

  private async invalidateCache(key: RemoteConfigKey): Promise<void> {
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

  private defaultParsedValue(def: RemoteConfigDef): RemoteConfigValue {
    return parseRemoteConfigValue(
      def,
      serializeRemoteConfigValue(def, def.defaultValue),
      this.logger,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeAdminView(
  def: RemoteConfigDef,
  row: {
    valueString: string;
    updatedByAdminId: string | null;
    updatedAt: Date;
  } | null,
  logger?: Logger,
): RemoteConfigAdminView {
  const parsed = row
    ? parseRemoteConfigValue(def, row.valueString, logger)
    : null;
  return {
    key: def.key,
    valueType: def.valueType,
    value: parsed ? parsed.value : def.defaultValue,
    defaultValue: def.defaultValue,
    descriptionVi: def.descriptionVi,
    descriptionEn: def.descriptionEn,
    public: def.public,
    updatedByAdminId: row?.updatedByAdminId ?? null,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}
