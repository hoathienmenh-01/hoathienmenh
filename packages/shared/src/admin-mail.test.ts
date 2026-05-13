import { describe, it, expect } from 'vitest';
import {
  ADMIN_MAIL_LIMITS,
  validateAdminMailSendInput,
  type AdminMailSendBulkInput,
  type AdminMailSendGlobalInput,
  type AdminMailSendOneInput,
} from './admin-mail';

const baseReward = {
  linhThach: '1000',
  tienNgoc: 0,
  exp: '0',
  items: [{ itemKey: 'qi_pill_minor', qty: 5 }],
};

describe('Phase 31 — admin-mail validators', () => {
  it('accepts valid SEND_ONE', () => {
    const input: AdminMailSendOneInput = {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      recipientCharacterId: 'char_1',
      subject: 'Test',
      body: 'Hello',
      reward: baseReward,
      expiresAt: null,
      reason: 'support compensation',
    };
    expect(validateAdminMailSendInput(input)).toBeNull();
  });

  it('rejects SEND_ONE without recipient', () => {
    const input: AdminMailSendOneInput = {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      recipientCharacterId: '',
      subject: 'Test',
      body: 'Hello',
      reward: baseReward,
      expiresAt: null,
      reason: 'support',
    };
    expect(validateAdminMailSendInput(input)).toBe('INVALID_RECIPIENT');
  });

  it('rejects SEND_BULK over MAX_BULK_RECIPIENTS', () => {
    const ids = Array.from(
      { length: ADMIN_MAIL_LIMITS.MAX_BULK_RECIPIENTS + 1 },
      (_, i) => `c${i}`,
    );
    const input: AdminMailSendBulkInput = {
      kind: 'SEND_BULK',
      mailType: 'ADMIN',
      recipientCharacterIds: ids,
      subject: 'Bulk',
      body: 'Hello',
      reward: baseReward,
      expiresAt: null,
      reason: 'bulk compensation',
    };
    expect(validateAdminMailSendInput(input)).toBe('BULK_LIMIT_EXCEEDED');
  });

  it('rejects empty SEND_BULK', () => {
    const input: AdminMailSendBulkInput = {
      kind: 'SEND_BULK',
      mailType: 'ADMIN',
      recipientCharacterIds: [],
      subject: 'Bulk',
      body: 'Hello',
      reward: baseReward,
      expiresAt: null,
      reason: 'bulk compensation',
    };
    expect(validateAdminMailSendInput(input)).toBe('INVALID_RECIPIENT');
  });

  it('rejects SEND_GLOBAL without targetRule', () => {
    const input = {
      kind: 'SEND_GLOBAL',
      mailType: 'ADMIN',
      subject: 'Global',
      body: 'Hello',
      reward: baseReward,
      expiresAt: null,
      reason: 'global announcement',
    } as unknown as AdminMailSendGlobalInput;
    expect(validateAdminMailSendInput(input)).toBe('INVALID_TARGET_RULE');
  });

  it('rejects reason that is too short', () => {
    const input: AdminMailSendOneInput = {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      recipientCharacterId: 'char_1',
      subject: 'Test',
      body: 'Hello',
      reward: baseReward,
      expiresAt: null,
      reason: 'no',
    };
    expect(validateAdminMailSendInput(input)).toBe('INVALID_REASON');
  });

  it('rejects tien ngoc reward > 0', () => {
    const input: AdminMailSendOneInput = {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      recipientCharacterId: 'char_1',
      subject: 'Test',
      body: 'Hello',
      reward: { ...baseReward, tienNgoc: 1 },
      expiresAt: null,
      reason: 'compensation',
    };
    expect(validateAdminMailSendInput(input)).toBe('TIEN_NGOC_CAP');
  });

  it('rejects forbidden item', () => {
    const input: AdminMailSendOneInput = {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      recipientCharacterId: 'char_1',
      subject: 'Test',
      body: 'Hello',
      reward: { ...baseReward, items: [{ itemKey: 'than_dan', qty: 1 }] },
      expiresAt: null,
      reason: 'compensation',
    };
    expect(validateAdminMailSendInput(input)).toBe('ITEM_FORBIDDEN');
  });
});
