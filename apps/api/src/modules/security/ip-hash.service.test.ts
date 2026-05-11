/**
 * Phase 18.1 — IpHashService unit tests.
 *
 * Coverage:
 *   - Deterministic: same IP + same salt → same hash.
 *   - Different salt → different hash.
 *   - Different IP → different hash.
 *   - Hex 64 chars.
 *   - Empty/null/undefined → 'unknown'.
 *   - Case-insensitive trim.
 *   - hashSubject prefix.
 *   - Privacy: returned hash KHÔNG chứa raw IP substring.
 */
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { IpHashService } from './ip-hash.service';

function makeSvc(salt?: string): IpHashService {
  const cfg = {
    get: (k: string) =>
      k === 'SECURITY_IP_HASH_SALT' ? salt : undefined,
  } as unknown as ConfigService;
  return new IpHashService(cfg);
}

describe('IpHashService', () => {
  it('deterministic: cùng salt + IP → cùng hash', () => {
    const a = makeSvc('test-salt');
    const b = makeSvc('test-salt');
    expect(a.hashIp('203.0.113.1')).toBe(b.hashIp('203.0.113.1'));
  });

  it('salt khác → hash khác', () => {
    const a = makeSvc('salt-A');
    const b = makeSvc('salt-B');
    expect(a.hashIp('203.0.113.1')).not.toBe(b.hashIp('203.0.113.1'));
  });

  it('IP khác → hash khác', () => {
    const svc = makeSvc('s');
    expect(svc.hashIp('1.1.1.1')).not.toBe(svc.hashIp('2.2.2.2'));
  });

  it('hex 64 chars output', () => {
    const h = makeSvc('s').hashIp('203.0.113.1');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('empty/null/undefined IP → "unknown"', () => {
    const svc = makeSvc('s');
    expect(svc.hashIp('')).toBe('unknown');
    expect(svc.hashIp(null)).toBe('unknown');
    expect(svc.hashIp(undefined)).toBe('unknown');
    expect(svc.hashIp('   ')).toBe('unknown');
  });

  it('case-insensitive + trim', () => {
    const svc = makeSvc('s');
    expect(svc.hashIp('1.2.3.4')).toBe(svc.hashIp('  1.2.3.4  '));
    expect(svc.hashIp('aB::CD')).toBe(svc.hashIp('ab::cd'));
  });

  it('hashSubject prefix bao quanh hash', () => {
    const svc = makeSvc('s');
    const r = svc.hashSubject('IP', '1.1.1.1');
    expect(r.startsWith('ip_')).toBe(true);
    expect(r.length).toBe(3 + 64);
  });

  it('privacy: raw IP KHÔNG xuất hiện trong hash', () => {
    const svc = makeSvc('s');
    const ip = '203.0.113.42';
    const h = svc.hashIp(ip);
    expect(h.includes(ip)).toBe(false);
    expect(h.includes('203')).toBe(false);
  });

  it('default salt khi env trống', () => {
    // Không crash, vẫn produce hash hợp lệ.
    const svc = makeSvc(undefined);
    const h = svc.hashIp('1.1.1.1');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
