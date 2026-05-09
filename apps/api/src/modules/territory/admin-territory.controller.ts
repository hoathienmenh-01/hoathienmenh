import {
  Controller,
  Get,
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
  TERRITORY_DECAY_DEFAULT_BPS,
  TERRITORY_DECAY_MAX_BPS,
  isTerritoryPeriodKey,
  previousTerritoryPeriodKey,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { TerritoryDecayService } from './territory-decay.service';
import { TerritoryError } from './territory.service';
import { TerritorySettlementService } from './territory-settlement.service';
import { TerritoryWarService } from './territory-war.service';

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

const DecayQuery = z
  .object({
    periodKey: z.string().min(1).max(64).optional(),
    decayBps: z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
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
    private readonly decayService: TerritoryDecayService,
    private readonly warService: TerritoryWarService,
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

  /**
   * Phase 14.0.C — Decay influence trigger.
   *
   * `periodKey` optional → fallback `previousTerritoryPeriodKey()` (tuần
   * trước). `decayBps` optional → fallback `TERRITORY_DECAY_DEFAULT_BPS`
   * (2500 = 25%). Idempotent qua UNIQUE `periodKey` ở
   * `SectTerritoryDecayLog` — gọi lại cùng `periodKey` trả `skipped: true`.
   *
   * Lỗi:
   *   - `INVALID_INPUT` 400 — query schema fail.
   *   - `PERIOD_INVALID` 400 — periodKey không match ISO week | manual_*.
   *   - `DECAY_BPS_INVALID` 400 — decayBps out of range (1..5000).
   */
  @Post('decay')
  @RequireAdmin()
  async decay(
    @Query() raw: Record<string, string>,
    @Req() req: Request & { userId?: string },
  ) {
    const parsed = DecayQuery.safeParse(raw);
    if (!parsed.success) {
      fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    }
    const periodKey = parsed.data.periodKey ?? previousTerritoryPeriodKey();
    if (!isTerritoryPeriodKey(periodKey)) {
      fail('PERIOD_INVALID', HttpStatus.BAD_REQUEST);
    }
    const decayBps = parsed.data.decayBps
      ? Number.parseInt(parsed.data.decayBps, 10)
      : TERRITORY_DECAY_DEFAULT_BPS;
    if (
      !Number.isInteger(decayBps) ||
      decayBps <= 0 ||
      decayBps > TERRITORY_DECAY_MAX_BPS
    ) {
      fail('DECAY_BPS_INVALID', HttpStatus.BAD_REQUEST);
    }
    try {
      const data = await this.decayService.decay({
        periodKey,
        decayBps,
        triggeredBy: req.userId ?? null,
      });
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase 14.0.C — Read decay history (recent log entries).
   * Mặc định 20 row mới nhất, tối đa 100.
   */
  @Get('decay/history')
  @RequireAdmin()
  async decayHistory(@Query('limit') limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : 20;
    const data = await this.decayService.getDecayHistory(
      Number.isInteger(n) && n > 0 ? n : 20,
    );
    return { ok: true, data };
  }

  /**
   * Phase 14.0.D — Settle period HIỆN TẠI (cắt sớm — admin trigger /
   * test). Idempotent qua UNIQUE `(regionKey, periodKey)`.
   *
   * Khác `POST /admin/territory/settle` (settle previous period mặc định):
   *   - Endpoint này luôn chốt period hiện tại (`currentTerritoryPeriodKey`).
   *   - Trả thêm `ownersAfter` để FE refresh không cần round-trip.
   *
   * Lỗi:
   *   - `UNAUTHENTICATED` 401 — chưa login.
   *   - `ADMIN_ONLY` 403 — login MOD (không phải ADMIN).
   *   - `PERIOD_INVALID` 400 — defensive (không xảy ra với current).
   */
  @Post('war/settle-current')
  @RequireAdmin()
  async settleWarCurrent(@Req() req: Request & { userId?: string }) {
    try {
      const data = await this.warService.settleCurrentPeriod({
        settledBy: req.userId ?? null,
      });
      return { ok: true, data };
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
        // eslint-disable-next-line no-fallthrough
        case 'DECAY_BPS_INVALID':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
