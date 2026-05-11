/**
 * Phase 19.1.B — verify `@RateLimitPolicy()` metadata gắn đúng key trên
 * ChatGroupController.
 */
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_POLICY_KEY } from '../security/rate-limit-policy.decorator';
import { ChatGroupController } from './chat-group.controller';

const reflector = new Reflector();

function metadata(method: keyof ChatGroupController): unknown {
  const proto = ChatGroupController.prototype as unknown as Record<
    string,
    unknown
  >;
  return reflector.get(RATE_LIMIT_POLICY_KEY, proto[method] as () => unknown);
}

describe('Phase 19.1.B — ChatGroupController @RateLimitPolicy metadata', () => {
  it('POST /chat/groups (create group) gắn CHAT_GROUP_CREATE', () => {
    expect(metadata('createGroup')).toBe('CHAT_GROUP_CREATE');
  });

  it('POST /chat/groups/:id/members gắn CHAT_GROUP_MEMBER_ADD', () => {
    expect(metadata('addMember')).toBe('CHAT_GROUP_MEMBER_ADD');
  });

  it('POST /chat/groups/:id/messages gắn CHAT_GROUP_SEND', () => {
    expect(metadata('sendMessage')).toBe('CHAT_GROUP_SEND');
  });

  it('GET / DELETE remove member KHÔNG gắn policy', () => {
    expect(metadata('listGroups')).toBeUndefined();
    expect(metadata('listMessages')).toBeUndefined();
    expect(metadata('removeMember')).toBeUndefined();
  });
});
