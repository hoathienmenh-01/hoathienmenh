/**
 * Phase 18.3 — Security alert shared catalog tests.
 *
 * Coverage:
 *   - `classifySecurityEventForAlert(...)` map đúng severity/type/source
 *     cho mọi `SecurityEventType` đã biết.
 *   - Unknown event type → fail-soft `OTHER`/`INFO`/`OTHER`.
 *   - `REFRESH_TOKEN_REUSED` luôn CRITICAL bất kể caller truyền hint.
 *   - `IP_BLOCKED`/`USER_BLOCKED` luôn CRITICAL bất kể hint.
 *   - `shouldCreateAlertForClassification(...)` đúng quy tắc:
 *     CRITICAL/WARN → true, INFO → false.
 *   - `sanitizeSecurityAlertNote(...)` strip control char, truncate.
 *   - Type guard `isSecurityAlertSeverity` / `Status` / `Source` /
 *     `Type` chỉ chấp nhận giá trị enum.
 */
import { describe, expect, it } from 'vitest';
import {
  SECURITY_ALERT_SEVERITIES,
  SECURITY_ALERT_STATUSES,
  SECURITY_ALERT_SOURCES,
  SECURITY_ALERT_TYPES,
  SECURITY_ALERT_RESOLUTION_NOTE_MAX_LENGTH,
  classifySecurityEventForAlert,
  isSecurityAlertSeverity,
  isSecurityAlertStatus,
  isSecurityAlertSource,
  isSecurityAlertType,
  sanitizeSecurityAlertNote,
  shouldCreateAlertForClassification,
} from './security-alerts';

describe('security-alerts: enums', () => {
  it('SECURITY_ALERT_SEVERITIES có đúng 3 phần tử ordered', () => {
    expect([...SECURITY_ALERT_SEVERITIES]).toEqual([
      'INFO',
      'WARN',
      'CRITICAL',
    ]);
  });

  it('SECURITY_ALERT_STATUSES có đúng 3 phần tử lifecycle', () => {
    expect([...SECURITY_ALERT_STATUSES]).toEqual([
      'OPEN',
      'ACKNOWLEDGED',
      'RESOLVED',
    ]);
  });

  it('SECURITY_ALERT_SOURCES bao phủ mọi loại event 18.1/18.2', () => {
    expect([...SECURITY_ALERT_SOURCES]).toEqual([
      'RATE_LIMIT',
      'AUTH',
      'SESSION',
      'ADMIN',
      'BLOCK',
      'OTHER',
    ]);
  });

  it('SECURITY_ALERT_TYPES bao gồm OTHER fallback', () => {
    expect(SECURITY_ALERT_TYPES.includes('OTHER')).toBe(true);
  });
});

describe('security-alerts: type guards', () => {
  it('isSecurityAlertSeverity chấp nhận INFO/WARN/CRITICAL', () => {
    expect(isSecurityAlertSeverity('INFO')).toBe(true);
    expect(isSecurityAlertSeverity('WARN')).toBe(true);
    expect(isSecurityAlertSeverity('CRITICAL')).toBe(true);
  });

  it('isSecurityAlertSeverity reject khác', () => {
    expect(isSecurityAlertSeverity('LOW')).toBe(false);
    expect(isSecurityAlertSeverity('')).toBe(false);
    expect(isSecurityAlertSeverity(null)).toBe(false);
    expect(isSecurityAlertSeverity(undefined)).toBe(false);
    expect(isSecurityAlertSeverity(1)).toBe(false);
  });

  it('isSecurityAlertStatus chấp nhận đủ 3 status', () => {
    expect(isSecurityAlertStatus('OPEN')).toBe(true);
    expect(isSecurityAlertStatus('ACKNOWLEDGED')).toBe(true);
    expect(isSecurityAlertStatus('RESOLVED')).toBe(true);
    expect(isSecurityAlertStatus('CLOSED')).toBe(false);
  });

  it('isSecurityAlertSource bao phủ enum source', () => {
    expect(isSecurityAlertSource('RATE_LIMIT')).toBe(true);
    expect(isSecurityAlertSource('SESSION')).toBe(true);
    expect(isSecurityAlertSource('UNKNOWN')).toBe(false);
  });

  it('isSecurityAlertType reject string không nằm trong enum', () => {
    expect(isSecurityAlertType('REFRESH_TOKEN_REUSED')).toBe(true);
    expect(isSecurityAlertType('OTHER')).toBe(true);
    expect(isSecurityAlertType('FOO')).toBe(false);
  });
});

describe('classifySecurityEventForAlert: known mappings', () => {
  it('RATE_LIMIT_VIOLATION → RATE_LIMIT_ABUSE/INFO/RATE_LIMIT', () => {
    const c = classifySecurityEventForAlert('RATE_LIMIT_VIOLATION');
    expect(c.alertType).toBe('RATE_LIMIT_ABUSE');
    expect(c.severity).toBe('INFO');
    expect(c.source).toBe('RATE_LIMIT');
  });

  it('RATE_LIMIT_VIOLATION với hint CRITICAL → giữ CRITICAL', () => {
    const c = classifySecurityEventForAlert(
      'RATE_LIMIT_VIOLATION',
      'CRITICAL',
    );
    expect(c.severity).toBe('CRITICAL');
  });

  it('LOGIN_FAILED → LOGIN_ABUSE/WARN/AUTH', () => {
    const c = classifySecurityEventForAlert('LOGIN_FAILED');
    expect(c).toEqual({
      alertType: 'LOGIN_ABUSE',
      severity: 'WARN',
      source: 'AUTH',
    });
  });

  it('REGISTER_SPAM → LOGIN_ABUSE/AUTH', () => {
    const c = classifySecurityEventForAlert('REGISTER_SPAM');
    expect(c.alertType).toBe('LOGIN_ABUSE');
    expect(c.source).toBe('AUTH');
  });

  it('INVALID_TOKEN → INVALID_TOKEN/AUTH', () => {
    const c = classifySecurityEventForAlert('INVALID_TOKEN');
    expect(c.alertType).toBe('INVALID_TOKEN');
    expect(c.source).toBe('AUTH');
  });

  it('ADMIN_FORBIDDEN → ADMIN_FORBIDDEN/ADMIN', () => {
    const c = classifySecurityEventForAlert('ADMIN_FORBIDDEN');
    expect(c.alertType).toBe('ADMIN_FORBIDDEN');
    expect(c.source).toBe('ADMIN');
  });

  it('IP_BLOCKED → SUBJECT_BLOCKED/CRITICAL/BLOCK (forced CRITICAL)', () => {
    const c = classifySecurityEventForAlert('IP_BLOCKED', 'INFO');
    expect(c).toEqual({
      alertType: 'SUBJECT_BLOCKED',
      severity: 'CRITICAL',
      source: 'BLOCK',
    });
  });

  it('USER_BLOCKED → SUBJECT_BLOCKED/CRITICAL/BLOCK (forced CRITICAL)', () => {
    const c = classifySecurityEventForAlert('USER_BLOCKED', 'WARN');
    expect(c.severity).toBe('CRITICAL');
    expect(c.alertType).toBe('SUBJECT_BLOCKED');
  });

  it('BLOCK_LIFTED → BLOCK_LIFTED/INFO/BLOCK', () => {
    const c = classifySecurityEventForAlert('BLOCK_LIFTED');
    expect(c.alertType).toBe('BLOCK_LIFTED');
    expect(c.severity).toBe('INFO');
    expect(c.source).toBe('BLOCK');
  });

  it('SESSION_CREATED → SESSION_CREATED/INFO/SESSION', () => {
    const c = classifySecurityEventForAlert('SESSION_CREATED');
    expect(c.alertType).toBe('SESSION_CREATED');
    expect(c.source).toBe('SESSION');
  });

  it('SESSION_REVOKED → SESSION_REVOKED/INFO/SESSION', () => {
    const c = classifySecurityEventForAlert('SESSION_REVOKED');
    expect(c.alertType).toBe('SESSION_REVOKED');
    expect(c.source).toBe('SESSION');
  });

  it('REFRESH_TOKEN_REUSED → CRITICAL bất kể hint', () => {
    const c1 = classifySecurityEventForAlert('REFRESH_TOKEN_REUSED');
    expect(c1.severity).toBe('CRITICAL');
    expect(c1.alertType).toBe('REFRESH_TOKEN_REUSED');
    expect(c1.source).toBe('SESSION');
    const c2 = classifySecurityEventForAlert('REFRESH_TOKEN_REUSED', 'INFO');
    expect(c2.severity).toBe('CRITICAL');
  });

  it('SESSION_SUSPICIOUS → SESSION_SUSPICIOUS/WARN/SESSION', () => {
    const c = classifySecurityEventForAlert('SESSION_SUSPICIOUS');
    expect(c.alertType).toBe('SESSION_SUSPICIOUS');
    expect(c.severity).toBe('WARN');
    expect(c.source).toBe('SESSION');
  });
});

describe('classifySecurityEventForAlert: fail-soft', () => {
  it('unknown event type → OTHER/INFO/OTHER, không throw', () => {
    expect(() =>
      classifySecurityEventForAlert('NEW_EVENT_TYPE_FROM_FUTURE'),
    ).not.toThrow();
    const c = classifySecurityEventForAlert('NEW_EVENT_TYPE_FROM_FUTURE');
    expect(c.alertType).toBe('OTHER');
    expect(c.severity).toBe('INFO');
    expect(c.source).toBe('OTHER');
  });

  it('unknown event type + valid severity hint → giữ severity', () => {
    const c = classifySecurityEventForAlert(
      'NEW_EVENT_TYPE_FROM_FUTURE',
      'CRITICAL',
    );
    expect(c.alertType).toBe('OTHER');
    expect(c.severity).toBe('CRITICAL');
  });

  it('empty string event type → OTHER/INFO', () => {
    const c = classifySecurityEventForAlert('');
    expect(c.alertType).toBe('OTHER');
    expect(c.severity).toBe('INFO');
  });

  it('invalid severity hint → fallback type default', () => {
    const c = classifySecurityEventForAlert('LOGIN_FAILED', 'GARBAGE');
    expect(c.severity).toBe('WARN');
  });
});

describe('shouldCreateAlertForClassification', () => {
  it('CRITICAL → true', () => {
    expect(
      shouldCreateAlertForClassification({
        alertType: 'REFRESH_TOKEN_REUSED',
        severity: 'CRITICAL',
        source: 'SESSION',
      }),
    ).toBe(true);
  });

  it('WARN → true', () => {
    expect(
      shouldCreateAlertForClassification({
        alertType: 'LOGIN_ABUSE',
        severity: 'WARN',
        source: 'AUTH',
      }),
    ).toBe(true);
  });

  it('INFO → false (skip alert creation cho event INFO)', () => {
    expect(
      shouldCreateAlertForClassification({
        alertType: 'SESSION_CREATED',
        severity: 'INFO',
        source: 'SESSION',
      }),
    ).toBe(false);
    expect(
      shouldCreateAlertForClassification({
        alertType: 'BLOCK_LIFTED',
        severity: 'INFO',
        source: 'BLOCK',
      }),
    ).toBe(false);
  });
});

describe('sanitizeSecurityAlertNote', () => {
  it('trả null cho non-string', () => {
    expect(sanitizeSecurityAlertNote(undefined)).toBeNull();
    expect(sanitizeSecurityAlertNote(null)).toBeNull();
    expect(sanitizeSecurityAlertNote(123)).toBeNull();
    expect(sanitizeSecurityAlertNote({})).toBeNull();
  });

  it('trim whitespace + strip control char', () => {
    const raw = '  hello\u0000world\u0007 \u001F  ';
    expect(sanitizeSecurityAlertNote(raw)).toBe('helloworld');
  });

  it('trả null nếu sau strip còn empty', () => {
    expect(sanitizeSecurityAlertNote('   ')).toBeNull();
    expect(sanitizeSecurityAlertNote('\u0000\u0001')).toBeNull();
  });

  it('truncate ở SECURITY_ALERT_RESOLUTION_NOTE_MAX_LENGTH', () => {
    const long = 'a'.repeat(SECURITY_ALERT_RESOLUTION_NOTE_MAX_LENGTH + 100);
    const out = sanitizeSecurityAlertNote(long);
    expect(out).not.toBeNull();
    expect(out?.length).toBe(SECURITY_ALERT_RESOLUTION_NOTE_MAX_LENGTH);
  });

  it('không touch nội dung trong limit', () => {
    expect(sanitizeSecurityAlertNote('Blocked IP after audit.')).toBe(
      'Blocked IP after audit.',
    );
  });
});
