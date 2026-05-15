<script setup lang="ts">
/**
 * Phase 19.1.C — Public Player Profile (Inspect Player) modal.
 *
 * Render hồ sơ công khai của 1 player khi viewer click vào username
 * trong friend list / request list / chat panels.
 *
 * Server-authoritative (xem `SocialService.getPublicProfile`):
 *   - Server enforce privacy mask (KHÔNG bao giờ trả email / role /
 *     currency / inventory / payment / IP / session).
 *   - Server tính `relationshipStatus` + `actions` atomic; FE chỉ
 *     render — KHÔNG suy luận để tránh race condition.
 *   - `BLOCKED_ME` → endpoint mask 404; FE coi như NOT_FOUND.
 *   - `BLOCKED_BY_ME` → server trả minimal profile (character=null);
 *     FE chỉ render nút "Bỏ chặn".
 *
 * Rate-limit `SOCIAL_PROFILE_VIEW` (60 req / min / user, block 5 min)
 * anti-enumeration scrape. FE chỉ catch error code → toast i18n.
 *
 * Quick actions (gọi back vào API `/social/*` khi user click):
 *   - `canSendFriendRequest` → gửi friend request không message.
 *   - `canMessage` → emit `open-private-chat` để parent panel mở thread.
 *   - `canBlock` → confirm + block.
 *   - `BLOCKED_BY_ME` → unblock.
 *   - (canReport — Phase 19.2 chat report đã có; Phase 19.1.C chỉ
 *     hiển thị placeholder, không wire report user-level.)
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  blockUser,
  fetchPublicProfile,
  sendFriendRequest,
  unblockUser,
} from '@/api/social';
import type {
  PublicPlayerProfileDto,
  RelationshipStatus,
} from '@xuantoi/shared';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

interface Props {
  open: boolean;
  /** User id của target cần inspect. Null → modal đóng. */
  userId: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  userId: null,
});

const emit = defineEmits<{
  (e: 'close'): void;
  /** Parent panel mở private chat với peer này (thường wire vào tab Private). */
  (e: 'open-private-chat', peerUserId: string): void;
  /** Báo cho parent biết profile cập nhật (vd sau block/unblock) để refresh list. */
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const profile = ref<PublicPlayerProfileDto | null>(null);
const loading = ref(false);
const errorCode = ref<string>('');
const busyAction = ref<string>('');

const displayName = computed<string>(() => {
  if (!profile.value) return props.userId ?? '';
  return profile.value.displayName ?? profile.value.userId;
});

const status = computed<RelationshipStatus | null>(() =>
  profile.value ? profile.value.relationshipStatus : null,
);

watch(
  () => [props.open, props.userId] as const,
  async ([open, userId]) => {
    if (!open || !userId) {
      profile.value = null;
      errorCode.value = '';
      busyAction.value = '';
      return;
    }
    await load(userId);
  },
  { immediate: true },
);

async function load(userId: string): Promise<void> {
  loading.value = true;
  errorCode.value = '';
  profile.value = null;
  try {
    profile.value = await fetchPublicProfile(userId);
  } catch (e) {
    errorCode.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

function tShortError(code: string): string {
  const key = `publicProfile.errors.${code}`;
  const v = t(key, '__missing__');
  return v === '__missing__' ? t('publicProfile.errors.UNKNOWN') : v;
}

function tRelationshipLabel(s: RelationshipStatus): string {
  return t(`publicProfile.relationship.${s}`);
}

function onClose(): void {
  if (busyAction.value) return;
  emit('close');
}

async function onSendFriendRequest(): Promise<void> {
  const p = profile.value;
  if (!p) return;
  if (!p.actions.canSendFriendRequest) return;
  busyAction.value = 'friend';
  try {
    await sendFriendRequest(p.userId, null);
    toast.push({ type: 'success', text: t('publicProfile.toast.requestSent') });
    emit('changed');
    await load(p.userId);
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyAction.value = '';
  }
}

function onMessage(): void {
  const p = profile.value;
  if (!p) return;
  if (!p.actions.canMessage) return;
  emit('open-private-chat', p.userId);
  emit('close');
}

async function onBlock(): Promise<void> {
  const p = profile.value;
  if (!p) return;
  if (!p.actions.canBlock) return;
  if (typeof window !== 'undefined') {
    const ok = window.confirm(
      t('publicProfile.confirm.block', { name: displayName.value }),
    );
    if (!ok) return;
  }
  busyAction.value = 'block';
  try {
    await blockUser(p.userId);
    toast.push({ type: 'success', text: t('publicProfile.toast.blocked') });
    emit('changed');
    await load(p.userId);
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyAction.value = '';
  }
}

async function onUnblock(): Promise<void> {
  const p = profile.value;
  if (!p) return;
  if (p.relationshipStatus !== 'BLOCKED_BY_ME') return;
  busyAction.value = 'unblock';
  try {
    await unblockUser(p.userId);
    toast.push({ type: 'success', text: t('publicProfile.toast.unblocked') });
    emit('changed');
    await load(p.userId);
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyAction.value = '';
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="public-profile-modal"
      @click.self="onClose"
    >
      <div
        role="dialog"
        aria-modal="true"
        class="bg-ink-700 border border-ink-300/30 rounded-lg shadow-2xl max-w-md w-[90vw] p-5 space-y-4"
      >
        <header class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2
              class="text-lg font-semibold text-amber-200 truncate"
              data-testid="public-profile-display-name"
            >
              {{ displayName }}
            </h2>
            <div
              v-if="profile"
              class="text-[10px] text-ink-300/60 truncate"
              data-testid="public-profile-user-id"
            >
              {{ profile.userId }}
            </div>
          </div>
          <button
            type="button"
            class="text-xs text-ink-300 hover:text-ink-50 px-2 py-1"
            data-testid="public-profile-close"
            :disabled="!!busyAction"
            @click="onClose"
          >
            ×
          </button>
        </header>

        <div
          v-if="loading"
          class="text-sm text-ink-300"
          data-testid="public-profile-loading"
        >
          {{ t('common.loading') }}
        </div>

        <div
          v-else-if="errorCode"
          class="text-sm text-rose-300"
          data-testid="public-profile-error"
        >
          {{ tShortError(errorCode) }}
        </div>

        <template v-else-if="profile">
          <div class="flex items-center gap-2 text-xs">
            <span
              class="rounded border border-amber-400/40 px-2 py-0.5 text-amber-200 uppercase tracking-widest"
              data-testid="public-profile-relationship"
            >
              {{ tRelationshipLabel(profile.relationshipStatus) }}
            </span>
            <span
              v-if="profile.online"
              class="rounded border border-emerald-400/40 px-2 py-0.5 text-emerald-200 uppercase tracking-widest"
            >
              {{ t('social.online') }}
            </span>
          </div>

          <div v-if="profile.character" class="space-y-2 text-sm">
            <dl class="grid grid-cols-3 gap-1 text-xs">
              <dt class="text-ink-300/70">
                {{ t('publicProfile.fields.realm') }}
              </dt>
              <dd
                class="col-span-2 text-ink-50"
                data-testid="public-profile-realm"
              >
                {{ profile.character.realmFullName }}
              </dd>
              <dt class="text-ink-300/70">
                {{ t('publicProfile.fields.level') }}
              </dt>
              <dd class="col-span-2 text-ink-50">
                {{ profile.character.level }}
              </dd>
              <dt class="text-ink-300/70">
                {{ t('publicProfile.fields.powerScore') }}
              </dt>
              <dd
                class="col-span-2 text-ink-50"
                data-testid="public-profile-power"
              >
                {{ profile.character.powerScore }}
              </dd>
              <dt class="text-ink-300/70">
                {{ t('publicProfile.fields.title') }}
              </dt>
              <dd class="col-span-2 text-ink-50">
                {{
                  profile.character.title ?? t('publicProfile.fields.titleNone')
                }}
              </dd>
              <dt class="text-ink-300/70">
                {{ t('publicProfile.fields.sect') }}
              </dt>
              <dd class="col-span-2 text-ink-50">
                {{
                  profile.character.sectName ??
                    t('publicProfile.fields.sectNone')
                }}
              </dd>
              <dt
                v-if="profile.joinedYearMonth"
                class="text-ink-300/70"
              >
                {{ t('publicProfile.fields.joined') }}
              </dt>
              <dd
                v-if="profile.joinedYearMonth"
                class="col-span-2 text-ink-50"
              >
                {{ profile.joinedYearMonth }}
              </dd>
              <dt
                v-if="profile.mutualFriendCount !== null"
                class="text-ink-300/70"
              >
                {{ t('publicProfile.fields.mutualFriends') }}
              </dt>
              <dd
                v-if="profile.mutualFriendCount !== null"
                class="col-span-2 text-ink-50"
              >
                {{ profile.mutualFriendCount }}
              </dd>
              <dt
                v-if="profile.sameSect"
                class="text-ink-300/70"
              >
                {{ t('publicProfile.fields.sameSect') }}
              </dt>
              <dd
                v-if="profile.sameSect"
                class="col-span-2 text-emerald-300"
                data-testid="public-profile-same-sect"
              >
                {{ t('publicProfile.fields.sameSectYes') }}
              </dd>
            </dl>
          </div>

          <div
            v-else
            class="text-xs text-ink-300/70"
            data-testid="public-profile-no-character"
          >
            {{
              profile.relationshipStatus === 'BLOCKED_BY_ME'
                ? t('publicProfile.blockedByMeNotice')
                : t('publicProfile.noCharacter')
            }}
          </div>

          <div
            class="flex flex-wrap items-center gap-2 pt-2 border-t border-ink-300/20"
            data-testid="public-profile-actions"
          >
            <button
              v-if="profile.actions.canSendFriendRequest"
              type="button"
              class="rounded border border-emerald-400/50 px-3 py-1.5 text-xs uppercase tracking-widest text-emerald-200 hover:bg-[var(--xt-jade-soft)] disabled:opacity-50"
              :disabled="!!busyAction"
              data-testid="public-profile-action-friend"
              @click="onSendFriendRequest"
            >
              {{ t('publicProfile.actions.sendFriendRequest') }}
            </button>
            <button
              v-if="profile.actions.canMessage"
              type="button"
              class="rounded border border-amber-400/50 px-3 py-1.5 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
              :disabled="!!busyAction"
              data-testid="public-profile-action-message"
              @click="onMessage"
            >
              {{ t('publicProfile.actions.message') }}
            </button>
            <button
              v-if="profile.actions.canBlock"
              type="button"
              class="rounded border border-rose-400/40 px-3 py-1.5 text-xs uppercase tracking-widest text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
              :disabled="!!busyAction"
              data-testid="public-profile-action-block"
              @click="onBlock"
            >
              {{ t('publicProfile.actions.block') }}
            </button>
            <button
              v-if="profile.relationshipStatus === 'BLOCKED_BY_ME'"
              type="button"
              class="rounded border border-ink-300/40 px-3 py-1.5 text-xs uppercase tracking-widest text-ink-50 hover:bg-ink-300/10 disabled:opacity-50"
              :disabled="!!busyAction"
              data-testid="public-profile-action-unblock"
              @click="onUnblock"
            >
              {{ t('publicProfile.actions.unblock') }}
            </button>
            <button
              v-if="status === 'SELF'"
              type="button"
              class="text-xs text-ink-300/60 italic"
              disabled
              data-testid="public-profile-action-self"
            >
              {{ t('publicProfile.actions.selfNotice') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
