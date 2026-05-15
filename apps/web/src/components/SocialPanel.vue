<script setup lang="ts">
/**
 * Phase 19.1 — Social System Foundation — Friends panel.
 *
 * Render:
 *   - Danh sách bạn bè (online dot).
 *   - Tab Incoming / Outgoing friend requests (accept / decline / cancel).
 *   - Form gửi friend request bằng userId + message ngắn (optional).
 *   - List danh sách block + nút unblock.
 *
 * Server-authoritative invariants enforce (SocialService): không self-friend,
 * không duplicate request, block 2 chiều ngăn gửi/nhận request.
 * FE chỉ catch error code → render i18n message + toast. Confirm modal
 * cho remove/block/unblock (destructive actions).
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import PublicPlayerProfileModal from '@/components/PublicPlayerProfileModal.vue';
import {
  acceptFriendRequest,
  blockUser,
  cancelFriendRequest,
  declineFriendRequest,
  getBlocks,
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  removeFriend,
  sendFriendRequest,
  unblockUser,
} from '@/api/social';
import type {
  FriendRequestRow,
  FriendRow,
  PlayerBlockRow,
  PresenceUpdateBroadcastPayload,
  WsFrame,
} from '@xuantoi/shared';
import { on as wsOn } from '@/ws/client';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

type RequestTab = 'incoming' | 'outgoing';

const { t } = useI18n();
const toast = useToastStore();

const loading = reactive({
  friends: true,
  incoming: true,
  outgoing: true,
  blocks: true,
});
const error = reactive({
  friends: '' as string,
  requests: '' as string,
  blocks: '' as string,
});

const friends = ref<FriendRow[]>([]);
const incoming = ref<FriendRequestRow[]>([]);
const outgoing = ref<FriendRequestRow[]>([]);
const blocks = ref<PlayerBlockRow[]>([]);

const requestTab = ref<RequestTab>('incoming');

// Send friend request form
const sendUserId = ref('');
const sendMessage = ref('');
const sending = ref(false);

// Per-row busy state
const busyRequestId = ref<string | null>(null);
const busyFriendId = ref<string | null>(null);
const busyBlockId = ref<string | null>(null);

// Confirm modal state
type ConfirmTarget =
  | { kind: 'remove-friend'; friendUserId: string }
  | { kind: 'block'; userId: string }
  | { kind: 'unblock'; userId: string };
const confirmOpen = ref(false);
const confirmTarget = ref<ConfirmTarget | null>(null);

const confirmTitle = computed<string>(() => {
  const target = confirmTarget.value;
  if (!target) return '';
  if (target.kind === 'remove-friend') {
    return t('social.confirm.removeFriend.title');
  }
  if (target.kind === 'block') return t('social.confirm.block.title');
  return t('social.confirm.unblock.title');
});
const confirmMessage = computed<string>(() => {
  const target = confirmTarget.value;
  if (!target) return '';
  if (target.kind === 'remove-friend') {
    return t('social.confirm.removeFriend.message', {
      id: target.friendUserId,
    });
  }
  if (target.kind === 'block') {
    return t('social.confirm.block.message', { id: target.userId });
  }
  return t('social.confirm.unblock.message', { id: target.userId });
});

// Phase 19.1.C — public profile modal state.
const profileTargetId = ref<string | null>(null);
const profileOpen = computed(() => profileTargetId.value !== null);

function openProfile(userId: string): void {
  profileTargetId.value = userId;
}

function closeProfile(): void {
  profileTargetId.value = null;
}

async function onProfileChanged(): Promise<void> {
  // Block/unblock from modal can mutate friend / block lists → refresh.
  await refreshAll();
}

defineExpose({ refresh: refreshAll });

const unsubFns: Array<() => void> = [];

onMounted(() => {
  void refreshAll();
  // Phase 19.3 — live presence:update push. Khi friend online/offline,
  // server fanout chuỗi `0↛≥1` connections tới friend list bằng
  // `RealtimeService.emitToUser`. Cập nhật `f.online` tại chỗ để
  // tránh poll REST `/social/friends`.
  unsubFns.push(
    wsOn<PresenceUpdateBroadcastPayload>(
      'presence:update',
      (frame: WsFrame<PresenceUpdateBroadcastPayload>) => {
        const { userId, status } = frame.payload;
        const nextOnline = status === 'ONLINE';
        const idx = friends.value.findIndex(
          (f) => f.friendUserId === userId,
        );
        if (idx < 0) return;
        if (friends.value[idx].online !== nextOnline) {
          friends.value[idx] = { ...friends.value[idx], online: nextOnline };
        }
      },
    ),
  );
});

onBeforeUnmount(() => {
  for (const fn of unsubFns) {
    try {
      fn();
    } catch {
      // ignore unsub failures
    }
  }
  unsubFns.length = 0;
});

async function refreshAll(): Promise<void> {
  await Promise.all([
    refreshFriends(),
    refreshIncoming(),
    refreshOutgoing(),
    refreshBlocks(),
  ]);
}

async function refreshFriends(): Promise<void> {
  loading.friends = true;
  error.friends = '';
  try {
    const res = await getFriends();
    friends.value = [...res.friends];
  } catch (e) {
    error.friends = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.friends = false;
  }
}

async function refreshIncoming(): Promise<void> {
  loading.incoming = true;
  error.requests = '';
  try {
    const res = await getIncomingRequests();
    incoming.value = [...res.requests];
  } catch (e) {
    error.requests = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.incoming = false;
  }
}

async function refreshOutgoing(): Promise<void> {
  loading.outgoing = true;
  try {
    const res = await getOutgoingRequests();
    outgoing.value = [...res.requests];
  } catch (e) {
    error.requests = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.outgoing = false;
  }
}

async function refreshBlocks(): Promise<void> {
  loading.blocks = true;
  error.blocks = '';
  try {
    const res = await getBlocks();
    blocks.value = [...res.blocks];
  } catch (e) {
    error.blocks = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.blocks = false;
  }
}

function tShortError(code: string): string {
  const key = `social.errors.${code}`;
  const v = t(key, '__missing__');
  return v === '__missing__' ? t('social.errors.UNKNOWN') : v;
}

async function onSend(): Promise<void> {
  const receiverUserId = sendUserId.value.trim();
  const message = sendMessage.value.trim() || null;
  if (!receiverUserId) return;
  sending.value = true;
  try {
    await sendFriendRequest(receiverUserId, message);
    toast.push({ type: 'success', text: t('social.toast.requestSent') });
    sendUserId.value = '';
    sendMessage.value = '';
    await refreshOutgoing();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    sending.value = false;
  }
}

async function onAccept(req: FriendRequestRow): Promise<void> {
  if (busyRequestId.value) return;
  busyRequestId.value = req.id;
  try {
    await acceptFriendRequest(req.id);
    toast.push({ type: 'success', text: t('social.toast.accepted') });
    await Promise.all([refreshIncoming(), refreshFriends()]);
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyRequestId.value = null;
  }
}

async function onDecline(req: FriendRequestRow): Promise<void> {
  if (busyRequestId.value) return;
  busyRequestId.value = req.id;
  try {
    await declineFriendRequest(req.id);
    toast.push({ type: 'success', text: t('social.toast.declined') });
    await refreshIncoming();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyRequestId.value = null;
  }
}

async function onCancel(req: FriendRequestRow): Promise<void> {
  if (busyRequestId.value) return;
  busyRequestId.value = req.id;
  try {
    await cancelFriendRequest(req.id);
    toast.push({ type: 'success', text: t('social.toast.cancelled') });
    await refreshOutgoing();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyRequestId.value = null;
  }
}

function askRemoveFriend(friendUserId: string): void {
  confirmTarget.value = { kind: 'remove-friend', friendUserId };
  confirmOpen.value = true;
}

function askBlock(userId: string): void {
  confirmTarget.value = { kind: 'block', userId };
  confirmOpen.value = true;
}

function askUnblock(userId: string): void {
  confirmTarget.value = { kind: 'unblock', userId };
  confirmOpen.value = true;
}

async function onConfirm(): Promise<void> {
  const target = confirmTarget.value;
  if (!target) return;
  try {
    if (target.kind === 'remove-friend') {
      busyFriendId.value = target.friendUserId;
      await removeFriend(target.friendUserId);
      toast.push({ type: 'success', text: t('social.toast.friendRemoved') });
      await refreshFriends();
    } else if (target.kind === 'block') {
      busyBlockId.value = target.userId;
      await blockUser(target.userId);
      toast.push({ type: 'success', text: t('social.toast.blocked') });
      await Promise.all([refreshBlocks(), refreshFriends(), refreshIncoming()]);
    } else {
      busyBlockId.value = target.userId;
      await unblockUser(target.userId);
      toast.push({ type: 'success', text: t('social.toast.unblocked') });
      await refreshBlocks();
    }
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyFriendId.value = null;
    busyBlockId.value = null;
    confirmOpen.value = false;
    confirmTarget.value = null;
  }
}

function onConfirmCancel(): void {
  confirmOpen.value = false;
  confirmTarget.value = null;
}

function displayName(row: { friendDisplayName?: string | null; blockedDisplayName?: string | null }, id: string): string {
  return (
    row.friendDisplayName ?? row.blockedDisplayName ?? id
  );
}

const emit = defineEmits<{
  (e: 'open-private-chat', peerUserId: string): void;
}>();

function onProfileOpenChat(peerUserId: string): void {
  emit('open-private-chat', peerUserId);
}

function senderLabel(req: FriendRequestRow): string {
  return req.senderUserId;
}
function receiverLabel(req: FriendRequestRow): string {
  return req.receiverUserId;
}
</script>

<template>
  <section
    class="border border-ink-300/40 rounded"
    data-testid="social-panel"
  >
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
    >
      {{ t('social.title') }}
    </div>

    <div class="p-4 space-y-4">
      <!-- Send friend request -->
      <form
        class="flex flex-col md:flex-row gap-2"
        data-testid="social-send-form"
        @submit.prevent="onSend"
      >
        <input
          v-model="sendUserId"
          type="text"
          maxlength="64"
          class="flex-1 rounded border border-ink-300/40 bg-ink-800/60 px-3 py-2 text-sm"
          :placeholder="t('social.send.userPlaceholder')"
          data-testid="social-send-userId"
        />
        <input
          v-model="sendMessage"
          type="text"
          maxlength="140"
          class="flex-1 rounded border border-ink-300/40 bg-ink-800/60 px-3 py-2 text-sm"
          :placeholder="t('social.send.messagePlaceholder')"
          data-testid="social-send-message"
        />
        <button
          type="submit"
          class="rounded border border-amber-400/60 px-4 py-2 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
          :disabled="sending || !sendUserId.trim()"
          data-testid="social-send-submit"
        >
          {{ t('social.send.submit') }}
        </button>
      </form>

      <!-- Friends -->
      <div>
        <div
          class="text-xs uppercase tracking-widest text-ink-300 mb-2"
        >
          {{ t('social.friends.header') }}
        </div>
        <div
          v-if="loading.friends"
          class="text-sm text-ink-300"
          data-testid="social-friends-loading"
        >
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="error.friends"
          class="text-sm text-rose-300"
          data-testid="social-friends-error"
        >
          {{ tShortError(error.friends) }}
        </div>
        <div
          v-else-if="friends.length === 0"
          class="text-sm text-ink-300/70"
          data-testid="social-friends-empty"
        >
          {{ t('social.friends.empty') }}
        </div>
        <ul v-else class="space-y-1" data-testid="social-friends-list">
          <li
            v-for="f in friends"
            :key="f.id"
            class="flex items-center justify-between rounded border border-ink-300/30 px-3 py-2 text-sm"
            data-testid="social-friend-row"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="inline-block w-2 h-2 rounded-full"
                :class="f.online ? 'bg-emerald-400' : 'bg-ink-300/40'"
                :title="f.online ? t('social.online') : t('social.offline')"
              />
              <button
                type="button"
                class="truncate text-left hover:underline focus:underline outline-none"
                :title="t('publicProfile.viewProfile')"
                data-testid="social-friend-name"
                @click="openProfile(f.friendUserId)"
              >{{ displayName(f, f.friendUserId) }}</button>
              <span class="text-[10px] text-ink-300/60">{{ f.friendUserId }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="rounded border border-ink-300/40 px-2 py-1 text-xs hover:bg-ink-300/10"
                data-testid="social-friend-view"
                @click="openProfile(f.friendUserId)"
              >
                {{ t('publicProfile.viewProfile') }}
              </button>
              <button
                type="button"
                class="rounded border border-ink-300/40 px-2 py-1 text-xs hover:bg-ink-300/10"
                :disabled="busyFriendId === f.friendUserId"
                data-testid="social-friend-remove"
                @click="askRemoveFriend(f.friendUserId)"
              >
                {{ t('social.actions.removeFriend') }}
              </button>
              <button
                type="button"
                class="rounded border border-rose-400/40 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/10"
                :disabled="busyBlockId === f.friendUserId"
                data-testid="social-friend-block"
                @click="askBlock(f.friendUserId)"
              >
                {{ t('social.actions.block') }}
              </button>
            </div>
          </li>
        </ul>
      </div>

      <!-- Requests -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <button
            type="button"
            class="text-xs uppercase tracking-widest px-2 py-1 rounded border"
            :class="
              requestTab === 'incoming'
                ? 'border-amber-400/60 text-amber-200'
                : 'border-ink-300/30 text-ink-300'
            "
            data-testid="social-tab-incoming"
            @click="requestTab = 'incoming'"
          >
            {{ t('social.requests.incoming') }} ({{ incoming.length }})
          </button>
          <button
            type="button"
            class="text-xs uppercase tracking-widest px-2 py-1 rounded border"
            :class="
              requestTab === 'outgoing'
                ? 'border-amber-400/60 text-amber-200'
                : 'border-ink-300/30 text-ink-300'
            "
            data-testid="social-tab-outgoing"
            @click="requestTab = 'outgoing'"
          >
            {{ t('social.requests.outgoing') }} ({{ outgoing.length }})
          </button>
        </div>

        <div v-if="error.requests" class="text-sm text-rose-300" data-testid="social-requests-error">
          {{ tShortError(error.requests) }}
        </div>

        <div v-if="requestTab === 'incoming'">
          <div
            v-if="loading.incoming"
            class="text-sm text-ink-300"
            data-testid="social-incoming-loading"
          >
            {{ t('common.loading') }}
          </div>
          <div
            v-else-if="incoming.length === 0"
            class="text-sm text-ink-300/70"
            data-testid="social-incoming-empty"
          >
            {{ t('social.requests.emptyIncoming') }}
          </div>
          <ul v-else class="space-y-1" data-testid="social-incoming-list">
            <li
              v-for="req in incoming"
              :key="req.id"
              class="flex items-center justify-between rounded border border-ink-300/30 px-3 py-2 text-sm"
              data-testid="social-incoming-row"
            >
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  class="truncate font-medium text-left hover:underline focus:underline outline-none"
                  :title="t('publicProfile.viewProfile')"
                  data-testid="social-incoming-name"
                  @click="openProfile(req.senderUserId)"
                >{{ senderLabel(req) }}</button>
                <div v-if="req.message" class="text-xs text-ink-300/80">
                  {{ req.message }}
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  class="rounded border border-emerald-400/40 px-2 py-1 text-xs text-emerald-200 hover:bg-[var(--xt-jade-soft)] disabled:opacity-50"
                  :disabled="busyRequestId === req.id"
                  data-testid="social-incoming-accept"
                  @click="onAccept(req)"
                >
                  {{ t('social.actions.accept') }}
                </button>
                <button
                  type="button"
                  class="rounded border border-ink-300/40 px-2 py-1 text-xs hover:bg-ink-300/10 disabled:opacity-50"
                  :disabled="busyRequestId === req.id"
                  data-testid="social-incoming-decline"
                  @click="onDecline(req)"
                >
                  {{ t('social.actions.decline') }}
                </button>
              </div>
            </li>
          </ul>
        </div>

        <div v-else>
          <div
            v-if="loading.outgoing"
            class="text-sm text-ink-300"
            data-testid="social-outgoing-loading"
          >
            {{ t('common.loading') }}
          </div>
          <div
            v-else-if="outgoing.length === 0"
            class="text-sm text-ink-300/70"
            data-testid="social-outgoing-empty"
          >
            {{ t('social.requests.emptyOutgoing') }}
          </div>
          <ul v-else class="space-y-1" data-testid="social-outgoing-list">
            <li
              v-for="req in outgoing"
              :key="req.id"
              class="flex items-center justify-between rounded border border-ink-300/30 px-3 py-2 text-sm"
              data-testid="social-outgoing-row"
            >
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  class="truncate font-medium text-left hover:underline focus:underline outline-none"
                  :title="t('publicProfile.viewProfile')"
                  data-testid="social-outgoing-name"
                  @click="openProfile(req.receiverUserId)"
                >{{ receiverLabel(req) }}</button>
                <div v-if="req.message" class="text-xs text-ink-300/80">
                  {{ req.message }}
                </div>
              </div>
              <button
                type="button"
                class="rounded border border-ink-300/40 px-2 py-1 text-xs hover:bg-ink-300/10 disabled:opacity-50"
                :disabled="busyRequestId === req.id"
                data-testid="social-outgoing-cancel"
                @click="onCancel(req)"
              >
                {{ t('social.actions.cancel') }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <!-- Blocks -->
      <div>
        <div
          class="text-xs uppercase tracking-widest text-ink-300 mb-2"
        >
          {{ t('social.blocks.header') }}
        </div>
        <div
          v-if="loading.blocks"
          class="text-sm text-ink-300"
          data-testid="social-blocks-loading"
        >
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="error.blocks"
          class="text-sm text-rose-300"
          data-testid="social-blocks-error"
        >
          {{ tShortError(error.blocks) }}
        </div>
        <div
          v-else-if="blocks.length === 0"
          class="text-sm text-ink-300/70"
          data-testid="social-blocks-empty"
        >
          {{ t('social.blocks.empty') }}
        </div>
        <ul v-else class="space-y-1" data-testid="social-blocks-list">
          <li
            v-for="b in blocks"
            :key="b.id"
            class="flex items-center justify-between rounded border border-ink-300/30 px-3 py-2 text-sm"
            data-testid="social-block-row"
          >
            <div class="flex items-center gap-2 min-w-0">
              <button
                type="button"
                class="truncate text-left hover:underline focus:underline outline-none"
                :title="t('publicProfile.viewProfile')"
                data-testid="social-block-name"
                @click="openProfile(b.blockedUserId)"
              >{{ displayName(b, b.blockedUserId) }}</button>
              <span class="text-[10px] text-ink-300/60">{{ b.blockedUserId }}</span>
            </div>
            <button
              type="button"
              class="rounded border border-ink-300/40 px-2 py-1 text-xs hover:bg-ink-300/10"
              :disabled="busyBlockId === b.blockedUserId"
              data-testid="social-block-unblock"
              @click="askUnblock(b.blockedUserId)"
            >
              {{ t('social.actions.unblock') }}
            </button>
          </li>
        </ul>
      </div>
    </div>

    <ConfirmModal
      :open="confirmOpen"
      :title="confirmTitle"
      :message="confirmMessage"
      danger
      test-id="social-confirm"
      @confirm="onConfirm"
      @cancel="onConfirmCancel"
    />

    <PublicPlayerProfileModal
      :open="profileOpen"
      :user-id="profileTargetId"
      @close="closeProfile"
      @open-private-chat="onProfileOpenChat"
      @changed="onProfileChanged"
    />
  </section>
</template>
