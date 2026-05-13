import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  isContentStatusType,
  validateContentStatus,
  type ContentStatusSpec,
  type ContentStatusType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 27.6 — ContentStatusService.
 *
 * Per-content (contentType, contentKey) enable/pause/disableReward/
 * disableClaim flag. Phase 27.6 cho admin tắt nguồn lạm phát nhanh
 * (1 farm map xấu → pause) không cần redeploy.
 *
 * Runtime consumer (PR sau): farm-session-service, dungeon-runner,
 * boss-service đọc `ContentStatus.enabled+paused` trước khi cho player
 * tham gia. KHÔNG cộng reward khi `disableReward=true`.
 */
@Injectable()
export class ContentStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters?: {
    contentType?: ContentStatusType;
    enabled?: boolean;
    paused?: boolean;
  }): Promise<ContentStatusSpec[]> {
    const rows = await this.prisma.contentStatus.findMany({
      where: {
        contentType: filters?.contentType,
        enabled: filters?.enabled,
        paused: filters?.paused,
      },
      orderBy: [{ contentType: 'asc' }, { contentKey: 'asc' }],
      take: 500,
    });
    return rows.map((r) => this.toSpec(r));
  }

  async findByKey(
    contentType: ContentStatusType,
    contentKey: string,
  ): Promise<ContentStatusSpec | null> {
    const row = await this.prisma.contentStatus.findUnique({
      where: { contentType_contentKey: { contentType, contentKey } },
    });
    return row ? this.toSpec(row) : null;
  }

  async upsert(
    spec: ContentStatusSpec,
    adminUserId: string,
  ): Promise<ContentStatusSpec> {
    if (!isContentStatusType(spec.contentType)) {
      throw new HttpException(
        { ok: false, error: { code: 'CONTENT_STATUS_TYPE_INVALID' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const issues = validateContentStatus(spec);
    if (issues.length > 0) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'CONTENT_STATUS_INVALID',
            message: 'CONTENT_STATUS_INVALID',
            meta: { issues },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const row = await this.prisma.contentStatus.upsert({
      where: {
        contentType_contentKey: {
          contentType: spec.contentType,
          contentKey: spec.contentKey,
        },
      },
      create: {
        contentType: spec.contentType,
        contentKey: spec.contentKey,
        enabled: spec.enabled,
        paused: spec.paused,
        disableReward: spec.disableReward,
        disableClaim: spec.disableClaim,
        message: spec.message ?? null,
        updatedByAdminId: adminUserId,
      },
      update: {
        enabled: spec.enabled,
        paused: spec.paused,
        disableReward: spec.disableReward,
        disableClaim: spec.disableClaim,
        message: spec.message ?? null,
        updatedByAdminId: adminUserId,
      },
    });
    return this.toSpec(row);
  }

  private toSpec(row: {
    contentType: string;
    contentKey: string;
    enabled: boolean;
    paused: boolean;
    disableReward: boolean;
    disableClaim: boolean;
    message: string | null;
  }): ContentStatusSpec {
    return {
      contentType: row.contentType as ContentStatusType,
      contentKey: row.contentKey,
      enabled: row.enabled,
      paused: row.paused,
      disableReward: row.disableReward,
      disableClaim: row.disableClaim,
      message: row.message ?? undefined,
    };
  }
}
