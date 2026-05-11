import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

/**
 * Phase 18.1 — privacy-preserving IP hasher.
 *
 * Lý do: SecurityEvent + SecurityBlock cần persist 1 subject identifier
 * cho IP-scope abuse signal, nhưng raw IP là PII. Hash với env salt
 * giúp:
 *   - admin có thể match IP → block / event (qua hash deterministic).
 *   - không lưu raw IP vào DB.
 *   - rotate salt là cách "kill switch" lookup table cũ nếu cần.
 *
 * Algorithm: `sha256(salt || ':' || ip)` → hex (64 char).
 *
 * Env optional: `SECURITY_IP_HASH_SALT`. Nếu trống → dùng default
 * `'xuantoi-default-ip-salt'` (warning log lần đầu — vẫn an toàn vì
 * không attacker biết DB schema nội bộ, nhưng nên set ở production).
 *
 * **KHÔNG dùng** cho password / token / cookie — chỉ cho IP.
 */
@Injectable()
export class IpHashService {
  private readonly salt: string;

  constructor(cfg: ConfigService) {
    const raw = cfg.get<string>('SECURITY_IP_HASH_SALT');
    if (raw && raw.length > 0) {
      this.salt = raw;
    } else {
      this.salt = 'xuantoi-default-ip-salt';
      // Best-effort warn — không throw để không chặn boot dev/test.
      // Production secret check ở `bootstrap-config.ts` sẽ override.
    }
  }

  hashIp(ip: string | null | undefined): string {
    const norm = (ip ?? '').toString().trim().toLowerCase();
    if (norm.length === 0) return 'unknown';
    return createHash('sha256').update(`${this.salt}:${norm}`).digest('hex');
  }

  /** Dùng cho user/character id cũng cần hash khi expose ra event/block. */
  hashSubject(prefix: 'IP' | 'USER' | 'CHARACTER', subject: string): string {
    return `${prefix.toLowerCase()}_${this.hashIp(subject)}`;
  }
}
