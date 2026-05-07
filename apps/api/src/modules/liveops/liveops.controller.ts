import { Controller, Get } from '@nestjs/common';
import { LiveOpsService, type LiveOpsTodayResponse } from './liveops.service';

/**
 * Phase 13.0 §D — `/liveops/today` retention dashboard endpoint.
 *
 * Public (no auth) — pure aggregation từ static catalog + boss schedule
 * snapshot. Caller có thể cache (vd ETag/Cache-Control) — nhưng response
 * compute < 1ms nên chưa cần.
 */
@Controller('liveops')
export class LiveOpsController {
  constructor(private readonly svc: LiveOpsService) {}

  @Get('today')
  today(): { ok: true; data: LiveOpsTodayResponse } {
    return { ok: true, data: this.svc.today() };
  }
}
