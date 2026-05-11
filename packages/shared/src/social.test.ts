import { describe, it, expect } from 'vitest';
import {
  CHAT_THREAD_TYPES,
  FRIEND_REQUEST_STATUSES,
  SOCIAL_LIMITS,
  sortUserPair,
  validateChatMessageBody,
  validateFriendRequestMessage,
  validateGroupName,
} from './social';

describe('Phase 19.1 — social shared catalog', () => {
  it('FRIEND_REQUEST_STATUSES có đúng 4 trạng thái cố định', () => {
    expect(FRIEND_REQUEST_STATUSES).toEqual([
      'PENDING',
      'ACCEPTED',
      'DECLINED',
      'CANCELLED',
    ]);
  });

  it('CHAT_THREAD_TYPES có đúng 2 loại cố định', () => {
    expect(CHAT_THREAD_TYPES).toEqual(['PRIVATE', 'GROUP']);
  });

  it('SOCIAL_LIMITS hằng số đúng kỳ vọng', () => {
    expect(SOCIAL_LIMITS.FRIEND_REQUEST_MESSAGE_MAX).toBe(140);
    expect(SOCIAL_LIMITS.PRIVATE_MESSAGE_MAX).toBe(500);
    expect(SOCIAL_LIMITS.GROUP_MESSAGE_MAX).toBe(500);
    expect(SOCIAL_LIMITS.GROUP_NAME_MAX).toBe(60);
    expect(SOCIAL_LIMITS.GROUP_NAME_MIN).toBe(3);
    expect(SOCIAL_LIMITS.GROUP_MEMBER_MAX).toBe(30);
  });
});

describe('sortUserPair', () => {
  it('Trả về null khi 2 userId trùng nhau (self)', () => {
    expect(sortUserPair('u1', 'u1')).toBeNull();
  });

  it('Sắp xếp lexicographic — low/high luôn ổn định', () => {
    expect(sortUserPair('userB', 'userA')).toEqual({
      low: 'userA',
      high: 'userB',
    });
    expect(sortUserPair('userA', 'userB')).toEqual({
      low: 'userA',
      high: 'userB',
    });
  });

  it('Idempotent: gọi 2 chiều cho cùng cặp ra cùng kết quả', () => {
    const a = sortUserPair('clx1', 'clx2');
    const b = sortUserPair('clx2', 'clx1');
    expect(a).toEqual(b);
  });
});

describe('validateFriendRequestMessage', () => {
  it('null/undefined đều coi như không có message → trả null', () => {
    expect(validateFriendRequestMessage(null)).toEqual({
      ok: true,
      value: null,
    });
    expect(validateFriendRequestMessage(undefined)).toEqual({
      ok: true,
      value: null,
    });
  });

  it('Empty (sau trim) coi như không có message', () => {
    expect(validateFriendRequestMessage('   ')).toEqual({
      ok: true,
      value: null,
    });
  });

  it('Trim 2 đầu trước khi lưu', () => {
    expect(validateFriendRequestMessage('  hello  ')).toEqual({
      ok: true,
      value: 'hello',
    });
  });

  it('Quá 140 ký tự (sau trim) → TOO_LONG', () => {
    const long = 'a'.repeat(141);
    const r = validateFriendRequestMessage(long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_LONG');
  });

  it('Đúng 140 ký tự (sau trim) → OK', () => {
    const exact = 'a'.repeat(140);
    expect(validateFriendRequestMessage(exact)).toEqual({
      ok: true,
      value: exact,
    });
  });
});

describe('validateChatMessageBody', () => {
  it('Empty (sau trim) → EMPTY cho cả PRIVATE và GROUP', () => {
    expect(validateChatMessageBody('   ', 'PRIVATE')).toEqual({
      ok: false,
      code: 'EMPTY',
      message: 'message empty',
    });
    expect(validateChatMessageBody('', 'GROUP')).toEqual({
      ok: false,
      code: 'EMPTY',
      message: 'message empty',
    });
  });

  it('Trim 2 đầu trước khi lưu', () => {
    expect(validateChatMessageBody('  ok  ', 'PRIVATE')).toEqual({
      ok: true,
      value: 'ok',
    });
  });

  it('PRIVATE quá 500 → TOO_LONG', () => {
    const r = validateChatMessageBody('a'.repeat(501), 'PRIVATE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_LONG');
  });

  it('GROUP quá 500 → TOO_LONG', () => {
    const r = validateChatMessageBody('a'.repeat(501), 'GROUP');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_LONG');
  });

  it('Đúng 500 ký tự → OK', () => {
    const exact = 'a'.repeat(500);
    expect(validateChatMessageBody(exact, 'PRIVATE')).toEqual({
      ok: true,
      value: exact,
    });
  });
});

describe('validateGroupName', () => {
  it('Empty / chỉ whitespace → EMPTY', () => {
    expect(validateGroupName('   ')).toEqual({
      ok: false,
      code: 'EMPTY',
      message: 'group name empty',
    });
  });

  it('Quá ngắn (< 3 sau trim) → TOO_SHORT', () => {
    expect(validateGroupName('ab').ok).toBe(false);
    const r = validateGroupName('ab');
    if (!r.ok) expect(r.code).toBe('TOO_SHORT');
  });

  it('Quá dài (> 60 sau trim) → TOO_LONG', () => {
    const r = validateGroupName('a'.repeat(61));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_LONG');
  });

  it('Đúng 3 / đúng 60 → OK + trimmed', () => {
    expect(validateGroupName(' abc ')).toEqual({ ok: true, value: 'abc' });
    expect(validateGroupName('a'.repeat(60))).toEqual({
      ok: true,
      value: 'a'.repeat(60),
    });
  });
});
