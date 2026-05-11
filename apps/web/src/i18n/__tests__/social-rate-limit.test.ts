/**
 * Phase 19.1.B — verify FE i18n catalog có RATE_LIMITED + ABUSE_BLOCKED
 * cho các namespace social / chatPrivate / chatGroup (cả vi + en) để
 * SocialPanel / PrivateChatPanel / GroupChatPanel hiển thị toast thân
 * thiện khi rate-limit guard (Phase 18.1) reject 429.
 *
 * Pure unit — đọc trực tiếp JSON, không mount component.
 */
import { describe, expect, it } from 'vitest';
import vi from '../vi.json';
import en from '../en.json';

type Json = Record<string, unknown>;

function readPath(obj: Json, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const namespaces = ['social', 'chatPrivate', 'chatGroup'] as const;
const rateLimitCodes = ['RATE_LIMITED', 'ABUSE_BLOCKED'] as const;

describe('Phase 19.1.B — social/chat rate-limit i18n parity', () => {
  for (const ns of namespaces) {
    for (const code of rateLimitCodes) {
      it(`vi.${ns}.errors.${code} là chuỗi non-empty`, () => {
        const v = readPath(vi as Json, [ns, 'errors', code]);
        expect(typeof v).toBe('string');
        expect((v as string).trim().length).toBeGreaterThan(0);
      });

      it(`en.${ns}.errors.${code} là chuỗi non-empty`, () => {
        const v = readPath(en as Json, [ns, 'errors', code]);
        expect(typeof v).toBe('string');
        expect((v as string).trim().length).toBeGreaterThan(0);
      });

      it(`vi.${ns}.errors.${code} khác bản UNKNOWN (toast cụ thể, không fall through)`, () => {
        const v = readPath(vi as Json, [ns, 'errors', code]);
        const unknown = readPath(vi as Json, [ns, 'errors', 'UNKNOWN']);
        expect(v).not.toBe(unknown);
      });

      it(`en.${ns}.errors.${code} khác bản UNKNOWN (toast cụ thể, không fall through)`, () => {
        const v = readPath(en as Json, [ns, 'errors', code]);
        const unknown = readPath(en as Json, [ns, 'errors', 'UNKNOWN']);
        expect(v).not.toBe(unknown);
      });
    }
  }
});
