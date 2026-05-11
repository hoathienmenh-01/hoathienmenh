import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RateLimitPolicyKey, RateLimitSeverity } from '@xuantoi/shared';
import { IpHashService } from './ip-hash.service';

/**
 * Phase 18.1 — SecurityAbuseService (Milestone 3: in-memory stub).
 *
 * Phase 18.1 sẽ swap sang Prisma-backed (`SecurityEvent` + `SecurityBlock`)
 * ở milestone 4 — milestone này chỉ cung cấp interface cho RateLimitGuard
 * và logic block in-memory để guard không lỗi NPE.
 *
 * In-memory layer:
 *   - Counter `Map<key, timestamps[]>` cho từng (type, subjectHash,
 *     severity) — sliding window.
 *   - Block `Map<key, { expiresAt, reason }>` cho từng (type, subjectHash).
 *   - Tự cleanup khi check (lazy).
 *
 * Fail-safe: in-memory không persist qua restart — milestone 4 upgrade
 * sang Prisma để giữ qua restart và share giữa instance.
 */

export type SecurityEventType =
  | 'RATE_LIMIT_VIOLATION'
  | 'LOGIN_FAILED'
  | 'REGISTER_SPAM'
  | 'INVALID_TOKEN'
  | 'ADMIN_FORBIDDEN'
  | 'IP_BLOCKED'
  | 'USER_BLOCKED'
  | 'BLOCK_LIFTED';

export interface IsBlockedResult {
  blocked: boolean;
  expiresAt?: Date;
  retryAfterSec?: number;
  reason?: string;
}

export interface RecordRateLimitViolationInput {
  policy: RateLimitPolicyKey;
  ip: string;
  userId: string | null;
  severity: RateLimitSeverity;
}

const ABUSE_THRESHOLD: Record<RateLimitSeverity, number> = {
  LOW: 0,
  MEDIUM: 10,
  HIGH: 5,
};

const ABUSE_WINDOW_SEC: Record<RateLimitSeverity, number> = {
  LOW: 5 * 60,
  MEDIUM: 15 * 60,
  HIGH: 15 * 60,
};

interface BlockEntry {
  id: string;
  type: 'IP' | 'USER';
  subjectHash: string;
  reason: string;
  expiresAt: Date;
  createdAt: Date;
  liftedAt: Date | null;
}

@Injectable()
export class SecurityAbuseService {
  protected readonly enabled: boolean;
  /** key = `${type}:${subjectHash}:${severity}` → timestamps (ms). */
  private readonly counter = new Map<string, number[]>();
  /** key = `${type}:${subjectHash}` → block entry. */
  private readonly blocks = new Map<string, BlockEntry>();
  private blockIdCounter = 0;

  constructor(
    protected readonly ipHash: IpHashService,
    cfg: ConfigService,
  ) {
    this.enabled = cfg.get<string>('ABUSE_BLOCK_ENABLED') !== 'false';
  }

  isAbuseBlockEnabled(): boolean {
    return this.enabled;
  }

  async isBlocked(
    type: 'IP' | 'USER',
    rawSubject: string,
  ): Promise<IsBlockedResult> {
    if (!this.enabled) return { blocked: false };
    const subjectHash =
      type === 'IP' ? this.ipHash.hashIp(rawSubject) : rawSubject;
    const key = `${type}:${subjectHash}`;
    const block = this.blocks.get(key);
    if (!block) return { blocked: false };
    const now = Date.now();
    if (block.liftedAt || block.expiresAt.getTime() <= now) {
      this.blocks.delete(key);
      return { blocked: false };
    }
    return {
      blocked: true,
      expiresAt: block.expiresAt,
      retryAfterSec: Math.max(
        1,
        Math.ceil((block.expiresAt.getTime() - now) / 1000),
      ),
      reason: block.reason,
    };
  }

  async recordRateLimitViolation(
    input: RecordRateLimitViolationInput,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    const ipHash = this.ipHash.hashIp(input.ip);
    const threshold = ABUSE_THRESHOLD[input.severity];
    if (threshold === 0) return false;
    const windowMs = ABUSE_WINDOW_SEC[input.severity] * 1000;

    const ipCount = this.bumpCounter(
      `IP:${ipHash}:${input.severity}`,
      windowMs,
    );
    let created = false;
    if (ipCount >= threshold) {
      created =
        (await this.createBlockInternal({
          type: 'IP',
          subjectHash: ipHash,
          reason: `RATE_LIMIT_VIOLATION:${input.policy}:${input.severity}`,
          blockSec: this.severityBlockSec(input.severity),
        })) || created;
    }
    if (input.userId) {
      const userCount = this.bumpCounter(
        `USER:${input.userId}:${input.severity}`,
        windowMs,
      );
      if (userCount >= threshold) {
        created =
          (await this.createBlockInternal({
            type: 'USER',
            subjectHash: input.userId,
            reason: `RATE_LIMIT_VIOLATION:${input.policy}:${input.severity}`,
            blockSec: this.severityBlockSec(input.severity),
          })) || created;
      }
    }
    return created;
  }

  async recordLoginFailed(_input: {
    ip: string;
    email: string;
  }): Promise<boolean> {
    // Will be persisted in milestone 4 alongside Prisma SecurityEvent.
    return false;
  }

  async recordAdminForbidden(_input: {
    ip: string;
    userId: string | null;
    path: string;
  }): Promise<boolean> {
    // Will be persisted in milestone 4.
    return false;
  }

  /**
   * Tạo block subject. Idempotent: nếu đã active → no-op.
   * Return true nếu block mới được tạo.
   */
  async createBlock(input: {
    type: 'IP' | 'USER';
    subjectHash: string;
    reason: string;
    blockSec: number;
  }): Promise<boolean> {
    return this.createBlockInternal(input);
  }

  protected async createBlockInternal(input: {
    type: 'IP' | 'USER';
    subjectHash: string;
    reason: string;
    blockSec: number;
  }): Promise<boolean> {
    const key = `${input.type}:${input.subjectHash}`;
    const now = new Date();
    const existing = this.blocks.get(key);
    if (
      existing &&
      !existing.liftedAt &&
      existing.expiresAt.getTime() > now.getTime()
    ) {
      return false;
    }
    const id = `block_${++this.blockIdCounter}_${now.getTime()}`;
    this.blocks.set(key, {
      id,
      type: input.type,
      subjectHash: input.subjectHash,
      reason: input.reason,
      expiresAt: new Date(now.getTime() + input.blockSec * 1000),
      createdAt: now,
      liftedAt: null,
    });
    return true;
  }

  async liftBlock(blockId: string): Promise<{
    id: string;
    type: 'IP' | 'USER';
    subjectHash: string;
  } | null> {
    for (const [key, block] of this.blocks.entries()) {
      if (block.id === blockId) {
        if (block.liftedAt) return null;
        block.liftedAt = new Date();
        this.blocks.delete(key);
        return {
          id: block.id,
          type: block.type,
          subjectHash: block.subjectHash,
        };
      }
    }
    return null;
  }

  /** TEST-ONLY: snapshot active blocks. */
  __listActiveBlocks(): BlockEntry[] {
    const out: BlockEntry[] = [];
    const now = Date.now();
    for (const b of this.blocks.values()) {
      if (!b.liftedAt && b.expiresAt.getTime() > now) out.push(b);
    }
    return out;
  }

  /** TEST-ONLY: clear in-memory state. */
  __resetForTests(): void {
    this.counter.clear();
    this.blocks.clear();
    this.blockIdCounter = 0;
  }

  protected bumpCounter(key: string, windowMs: number): number {
    const now = Date.now();
    const arr = (this.counter.get(key) ?? []).filter((t) => t > now - windowMs);
    arr.push(now);
    this.counter.set(key, arr);
    return arr.length;
  }

  protected severityBlockSec(severity: RateLimitSeverity): number {
    switch (severity) {
      case 'HIGH':
        return 30 * 60;
      case 'MEDIUM':
        return 15 * 60;
      default:
        return 5 * 60;
    }
  }

  protected toEventSeverity(s: RateLimitSeverity): 'INFO' | 'WARN' | 'CRITICAL' {
    switch (s) {
      case 'HIGH':
        return 'CRITICAL';
      case 'MEDIUM':
        return 'WARN';
      default:
        return 'INFO';
    }
  }
}
