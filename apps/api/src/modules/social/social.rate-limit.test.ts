/**
 * Phase 19.1.B — verify `@RateLimitPolicy()` metadata gắn đúng key trên
 * SocialController mutation endpoint. Pure-unit (đọc metadata qua
 * Reflect), không cần Nest test module.
 */
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_POLICY_KEY } from '../security/rate-limit-policy.decorator';
import { SocialController } from './social.controller';

const reflector = new Reflector();

function metadata(method: keyof SocialController): unknown {
  const proto = SocialController.prototype as Record<string, unknown>;
  return reflector.get(RATE_LIMIT_POLICY_KEY, proto[method] as () => unknown);
}

describe('Phase 19.1.B — SocialController @RateLimitPolicy metadata', () => {
  it('POST /social/friend-requests gắn SOCIAL_FRIEND_REQUEST', () => {
    expect(metadata('sendFriendRequest')).toBe('SOCIAL_FRIEND_REQUEST');
  });

  it('POST /social/block gắn SOCIAL_BLOCK_TOGGLE', () => {
    expect(metadata('block')).toBe('SOCIAL_BLOCK_TOGGLE');
  });

  it('DELETE /social/block/:userId gắn SOCIAL_BLOCK_TOGGLE', () => {
    expect(metadata('unblock')).toBe('SOCIAL_BLOCK_TOGGLE');
  });

  it('Read-only GET endpoint KHÔNG gắn policy (opt-in)', () => {
    expect(metadata('listFriends')).toBeUndefined();
    expect(metadata('listIncoming')).toBeUndefined();
    expect(metadata('listOutgoing')).toBeUndefined();
    expect(metadata('listBlocks')).toBeUndefined();
  });

  it('accept/decline/cancel friend request KHÔNG gắn policy (state machine, không spam-risk)', () => {
    expect(metadata('accept')).toBeUndefined();
    expect(metadata('decline')).toBeUndefined();
    expect(metadata('cancel')).toBeUndefined();
    expect(metadata('removeFriend')).toBeUndefined();
  });
});
