import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  isRewardProfileContentType,
  validateRewardProfile,
  type RewardProfileCapRule,
  type RewardProfileContentType,
  type RewardProfileEntry,
  type RewardProfileSpec,
  type RewardProfileValidationIssue,
} from '@xuantoi/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 27.6 — RewardProfileService.
 *
 * CRUD + validate + activate + rollback cho `RewardProfile` model.
 * Toàn bộ mutation đi qua `validateRewardProfile` ở shared — chặn
 * tier leak, forbidden item, TIEN_NGOC grant, missing weekly cap rare
 * T7+, qty âm/NaN.
 *
 * Activate semantics:
 *   - Tại 1 thời điểm, chỉ 1 profile per `(contentType, contentKey)`
 *     active=true. `activate(key)` set active=true + deactivate những
 *     profile khác cùng (contentType, contentKey).
 *
 * Rollback semantics:
 *   - Service không lưu version history riêng — leverage
 *     `ConfigVersion` Phase 15.6 (PR sau wire entityType
 *     `REWARD_PROFILE`). PR1 hiện hỗ trợ `revert(key, prevSpec)` tự
 *     cấp snapshot trước.
 */
@Injectable()
export class RewardProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters?: {
    contentType?: RewardProfileContentType;
    contentKey?: string;
    active?: boolean;
  }): Promise<RewardProfileSpec[]> {
    const where: Prisma.RewardProfileWhereInput = {};
    if (filters?.contentType) where.contentType = filters.contentType;
    if (filters?.contentKey !== undefined) where.contentKey = filters.contentKey;
    if (filters?.active !== undefined) where.active = filters.active;
    const rows = await this.prisma.rewardProfile.findMany({
      where,
      orderBy: [{ contentType: 'asc' }, { sourceTier: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.toSpec(r));
  }

  async findByKey(key: string): Promise<RewardProfileSpec | null> {
    const row = await this.prisma.rewardProfile.findUnique({ where: { key } });
    return row ? this.toSpec(row) : null;
  }

  validate(spec: RewardProfileSpec): RewardProfileValidationIssue[] {
    return validateRewardProfile(spec);
  }

  async upsert(
    input: Omit<RewardProfileSpec, 'version'> & {
      adminUserId: string;
    },
  ): Promise<RewardProfileSpec> {
    if (!isRewardProfileContentType(input.contentType)) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'REWARD_PROFILE_CONTENT_TYPE_INVALID' },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const issues = validateRewardProfile({ ...input, version: 1 });
    if (issues.length > 0) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'REWARD_PROFILE_INVALID',
            message: 'REWARD_PROFILE_INVALID',
            meta: { issues },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.prisma.rewardProfile.findUnique({
      where: { key: input.key },
    });
    const nextVersion = (existing?.version ?? 0) + 1;
    const data = {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      contentType: input.contentType,
      contentKey: input.contentKey ?? null,
      sourceTier: input.sourceTier,
      rewardsJson: input.rewards as unknown as Prisma.InputJsonValue,
      capRuleJson: (input.cap ?? {}) as unknown as Prisma.InputJsonValue,
      active: input.active,
      version: nextVersion,
      updatedByAdminId: input.adminUserId,
    };
    const row = existing
      ? await this.prisma.rewardProfile.update({
          where: { key: input.key },
          data,
        })
      : await this.prisma.rewardProfile.create({ data });
    return this.toSpec(row);
  }

  /**
   * Activate `key` + deactivate những profile khác cùng (contentType,
   * contentKey). Trả profile vừa activate. Thực hiện trong transaction để
   * đảm bảo chỉ 1 profile active.
   */
  async activate(key: string, adminUserId: string): Promise<RewardProfileSpec> {
    return await this.prisma.$transaction(async (tx) => {
      const target = await tx.rewardProfile.findUnique({ where: { key } });
      if (!target) {
        throw new HttpException(
          { ok: false, error: { code: 'REWARD_PROFILE_NOT_FOUND' } },
          HttpStatus.NOT_FOUND,
        );
      }
      await tx.rewardProfile.updateMany({
        where: {
          contentType: target.contentType,
          contentKey: target.contentKey,
          NOT: { id: target.id },
        },
        data: { active: false },
      });
      const updated = await tx.rewardProfile.update({
        where: { key },
        data: {
          active: true,
          version: target.version + 1,
          updatedByAdminId: adminUserId,
        },
      });
      return this.toSpec(updated);
    });
  }

  async deactivate(key: string, adminUserId: string): Promise<RewardProfileSpec> {
    const row = await this.prisma.rewardProfile.findUnique({ where: { key } });
    if (!row) {
      throw new HttpException(
        { ok: false, error: { code: 'REWARD_PROFILE_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const updated = await this.prisma.rewardProfile.update({
      where: { key },
      data: {
        active: false,
        version: row.version + 1,
        updatedByAdminId: adminUserId,
      },
    });
    return this.toSpec(updated);
  }

  private toSpec(
    row: Prisma.RewardProfileGetPayload<Record<string, never>>,
  ): RewardProfileSpec {
    return {
      key: row.key,
      name: row.name,
      description: row.description ?? undefined,
      contentType: row.contentType as RewardProfileContentType,
      contentKey: row.contentKey ?? undefined,
      sourceTier: row.sourceTier,
      rewards: this.parseRewards(row.rewardsJson),
      cap: this.parseCap(row.capRuleJson),
      active: row.active,
      version: row.version,
    };
  }

  private parseRewards(value: Prisma.JsonValue): readonly RewardProfileEntry[] {
    if (!Array.isArray(value)) return [];
    const out: RewardProfileEntry[] = [];
    for (const v of value) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
      const obj = v as Record<string, unknown>;
      if (
        typeof obj.kind === 'string' &&
        typeof obj.key === 'string' &&
        typeof obj.qty === 'number'
      ) {
        const entry: RewardProfileEntry = {
          kind: obj.kind as RewardProfileEntry['kind'],
          key: obj.key,
          qty: obj.qty,
        };
        if (typeof obj.itemTier === 'number') entry.itemTier = obj.itemTier;
        if (typeof obj.weight === 'number') entry.weight = obj.weight;
        out.push(entry);
      }
    }
    return out;
  }

  private parseCap(value: Prisma.JsonValue): RewardProfileCapRule | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const v = value as Record<string, unknown>;
    const out: RewardProfileCapRule = {};
    if (typeof v.dailyCount === 'number') out.dailyCount = v.dailyCount;
    if (typeof v.dailyQty === 'number') out.dailyQty = v.dailyQty;
    if (typeof v.weeklyCount === 'number') out.weeklyCount = v.weeklyCount;
    if (typeof v.weeklyQty === 'number') out.weeklyQty = v.weeklyQty;
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
