/**
 * Phase 19.1.B — verify `@RateLimitPolicy()` metadata gắn đúng key trên
 * ChatPrivateController.
 */
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_POLICY_KEY } from '../security/rate-limit-policy.decorator';
import { ChatPrivateController } from './chat-private.controller';

const reflector = new Reflector();

function metadata(method: keyof ChatPrivateController): unknown {
  const proto = ChatPrivateController.prototype as unknown as Record<
    string,
    unknown
  >;
  return reflector.get(RATE_LIMIT_POLICY_KEY, proto[method] as () => unknown);
}

describe('Phase 19.1.B — ChatPrivateController @RateLimitPolicy metadata', () => {
  it('POST /chat/private/threads/:id/messages gắn CHAT_PRIVATE_SEND', () => {
    expect(metadata('sendMessage')).toBe('CHAT_PRIVATE_SEND');
  });

  it('GET / openThread KHÔNG gắn policy', () => {
    expect(metadata('listThreads')).toBeUndefined();
    expect(metadata('openThread')).toBeUndefined();
    expect(metadata('listMessages')).toBeUndefined();
  });
});
