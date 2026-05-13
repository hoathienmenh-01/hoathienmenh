import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  isDropMaterialCategory,
  isDropProfileSourceType,
  simulateDropProfile,
  validateDropProfile,
  type DropMaterialCategory,
  type DropProfileCapRule,
  type DropProfileItemWeight,
  type DropProfileSourceType,
  type DropProfileSpec,
  type DropProfileValidationIssue,
  type DropSimulationResult,
} from '@xuantoi/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 27.6 — DropProfileService.
 *
 * CRUD + validate + simulate + activate cho `DropProfile` model. Tương
 * tự `RewardProfileService` — chỉ 1 profile active=true per
 * `(sourceType, sourceTier)` (KHÔNG bao gồm `materialCategory` để tránh
 * fragment quá nhỏ — caller có thể merge multi-category vào 1 spec).
 */
@Injectable()
export class DropProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters?: {
    sourceType?: DropProfileSourceType;
    sourceTier?: number;
    active?: boolean;
  }): Promise<DropProfileSpec[]> {
    const where: Prisma.DropProfileWhereInput = {};
    if (filters?.sourceType) where.sourceType = filters.sourceType;
    if (filters?.sourceTier !== undefined) where.sourceTier = filters.sourceTier;
    if (filters?.active !== undefined) where.active = filters.active;
    const rows = await this.prisma.dropProfile.findMany({
      where,
      orderBy: [{ sourceType: 'asc' }, { sourceTier: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.toSpec(r));
  }

  async findByKey(key: string): Promise<DropProfileSpec | null> {
    const row = await this.prisma.dropProfile.findUnique({ where: { key } });
    return row ? this.toSpec(row) : null;
  }

  validate(spec: DropProfileSpec): DropProfileValidationIssue[] {
    return validateDropProfile(spec);
  }

  simulate(spec: DropProfileSpec, trials: number, seed = 42): DropSimulationResult {
    const cappedTrials = Math.min(Math.max(trials, 100), 100_000);
    return simulateDropProfile(spec, cappedTrials, seed);
  }

  async upsert(
    input: Omit<DropProfileSpec, 'version'> & { adminUserId: string },
  ): Promise<DropProfileSpec> {
    if (!isDropProfileSourceType(input.sourceType)) {
      throw new HttpException(
        { ok: false, error: { code: 'DROP_PROFILE_SOURCE_TYPE_INVALID' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      input.materialCategory !== undefined &&
      !isDropMaterialCategory(input.materialCategory)
    ) {
      throw new HttpException(
        { ok: false, error: { code: 'DROP_PROFILE_MATERIAL_CATEGORY_INVALID' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const issues = validateDropProfile({ ...input, version: 1 });
    if (issues.length > 0) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'DROP_PROFILE_INVALID',
            message: 'DROP_PROFILE_INVALID',
            meta: { issues },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.prisma.dropProfile.findUnique({
      where: { key: input.key },
    });
    const nextVersion = (existing?.version ?? 0) + 1;
    const data = {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      sourceType: input.sourceType,
      sourceTier: input.sourceTier,
      materialCategory: input.materialCategory ?? null,
      baseRate: input.baseRate,
      rareRate: input.rareRate,
      weightsJson: input.items as unknown as Prisma.InputJsonValue,
      capsJson: (input.cap ?? {}) as unknown as Prisma.InputJsonValue,
      active: input.active,
      version: nextVersion,
      updatedByAdminId: input.adminUserId,
    };
    const row = existing
      ? await this.prisma.dropProfile.update({ where: { key: input.key }, data })
      : await this.prisma.dropProfile.create({ data });
    return this.toSpec(row);
  }

  async activate(key: string, adminUserId: string): Promise<DropProfileSpec> {
    return await this.prisma.$transaction(async (tx) => {
      const target = await tx.dropProfile.findUnique({ where: { key } });
      if (!target) {
        throw new HttpException(
          { ok: false, error: { code: 'DROP_PROFILE_NOT_FOUND' } },
          HttpStatus.NOT_FOUND,
        );
      }
      await tx.dropProfile.updateMany({
        where: {
          sourceType: target.sourceType,
          sourceTier: target.sourceTier,
          materialCategory: target.materialCategory,
          NOT: { id: target.id },
        },
        data: { active: false },
      });
      const updated = await tx.dropProfile.update({
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

  async deactivate(key: string, adminUserId: string): Promise<DropProfileSpec> {
    const row = await this.prisma.dropProfile.findUnique({ where: { key } });
    if (!row) {
      throw new HttpException(
        { ok: false, error: { code: 'DROP_PROFILE_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const updated = await this.prisma.dropProfile.update({
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
    row: Prisma.DropProfileGetPayload<Record<string, never>>,
  ): DropProfileSpec {
    return {
      key: row.key,
      name: row.name,
      description: row.description ?? undefined,
      sourceType: row.sourceType as DropProfileSourceType,
      sourceTier: row.sourceTier,
      materialCategory: (row.materialCategory ?? undefined) as
        | DropMaterialCategory
        | undefined,
      baseRate: row.baseRate,
      rareRate: row.rareRate,
      items: this.parseItems(row.weightsJson),
      cap: this.parseCap(row.capsJson),
      active: row.active,
      version: row.version,
    };
  }

  private parseItems(value: Prisma.JsonValue): readonly DropProfileItemWeight[] {
    if (!Array.isArray(value)) return [];
    const out: DropProfileItemWeight[] = [];
    for (const v of value) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
      const obj = v as Record<string, unknown>;
      if (
        typeof obj.itemKey === 'string' &&
        typeof obj.tier === 'number' &&
        typeof obj.weight === 'number'
      ) {
        const entry: DropProfileItemWeight = {
          itemKey: obj.itemKey,
          tier: obj.tier,
          weight: obj.weight,
        };
        if (typeof obj.rare === 'boolean') entry.rare = obj.rare;
        out.push(entry);
      }
    }
    return out;
  }

  private parseCap(value: Prisma.JsonValue): DropProfileCapRule | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const v = value as Record<string, unknown>;
    const out: DropProfileCapRule = {};
    if (typeof v.dailyRare === 'number') out.dailyRare = v.dailyRare;
    if (typeof v.weeklyRare === 'number') out.weeklyRare = v.weeklyRare;
    if (typeof v.dailyTotal === 'number') out.dailyTotal = v.dailyTotal;
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
