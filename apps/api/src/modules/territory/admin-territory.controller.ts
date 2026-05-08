import {
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  isTerritoryPeriodKey,
  previousTerritoryPeriodKey,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { TerritoryError } from './territory.service';
import { TerritorySettlementService } from './territory-settlement.service';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const PeriodKeyQuery = z
  .object({
    periodKey: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * Phase 14.0.B — Admin endpoints cho Territory Settlement.
 *
 * Mounted dưới `/admin/territory`, gated bằng `AdminGuard` (cookie auth)
 * + `@RequireAdmin()` ở mỗi route (chỉ ADMIN, MOD reject với
 * `ADMIN_ONLY` 403). Settlement có ảnh hưởng tới region buff (Phase
 * 14.0.C) nên phải ADMIN-only — MOD không được trigger.
 *
 * Endpoints:
 *   - `POST /admin/territory/settle?periodKey=...` — settle MỌI region
 *     cho period. Idempotent: gọi lại cùng `periodKey` không sinh duplicate.
 *     `periodKey` optional → fallback `previousTerritoryPeriodKey()`
 *     (tuần trước theo UTC ISO).
 *   - `POST /admin/territory/regions/:regionKey/settle?periodKey=...` —
 *     settle 1 region riêng lẻ. Cùng idempotency rule.
 *
 * Lỗi:
 *   - `UNAUTHENTICATED` 401 — chưa login.
 *   - `ADMIN_ONLY` 403 — login MOD (không phải ADMIN).
 *   - `REGION_INVALID` 404 — `regionKey` không thuộc `MAP_REGIONS`.
 *   - `PERIOD_INVALID` 400 — `periodKey` không match ISO week | manual_*.
 */
@UseGuards(AdminGuard)
@Controller('admin/territory')
export class AdminTerritoryController {
  constructor(
    private readonly settlement: TerritorySettlementService,
  ) {}

  @Post('settle')
  @RequireAdmin()
  async settleAll(
    @Query() raw: Record<string, string>,
    @Req() req: Request & { userId?: string },
  ) {
    const parsed = PeriodKeyQuery.safeParse(raw);
    if (!parsed.success) {
      fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    }
    const periodKey = parsed.data.periodKey ?? previousTerritoryPeriodKey();
    if (!isTerritoryPeriodKey(periodKey)) {
      fail('PERIOD_INVALID', HttpStatus.BAD_REQUEST);
    }
    try {
      const data = await this.settlement.settleAllRegions(periodKey, {
        settledBy: req.userId ?? null,
      });
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('regions/:regionKey/settle')
  @RequireAdmin()
  async settleOne(
    @Param('regionKey') regionKey: string,
    @Query() raw: Record<string, string>,
    @Req() req: Request & { userId?: string },
  ) {
    const parsed = PeriodKeyQuery.safeParse(raw);
    if (!parsed.success) {
      fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    }
    const periodKey = parsed.data.periodKey ?? previousTerritoryPeriodKey();
    if (!isTerritoryPeriodKey(periodKey)) {
      fail('PERIOD_INVALID', HttpStatus.BAD_REQUEST);
    }
    try {
      const res = await this.settlement.settleRegion(regionKey, periodKey, {
        settledBy: req.userId ?? null,
      });
      return {
        ok: true,
        data: {
          regionKey,
          periodKey,
          skipped: res.skipped,
          snapshot: res.snapshot,
        },
      };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof TerritoryError) {
      switch (e.code) {
        case 'REGION_INVALID':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'PERIOD_INVALID':
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'NO_CHARACTER':
          fail(e.code, HttpStatus.NOT_FOUND);
      }
    }
    throw e;
  }
}
