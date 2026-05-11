<script setup lang="ts">
/**
 * Phase 19.4 — Party panel.
 *
 * Render:
 *   - Current party card (name, member count, leader badge, member
 *     list with online/offline indicator).
 *   - Empty state when not in a party + form to create party.
 *   - Send-invite form (when leader).
 *   - Incoming / outgoing invite tabs with accept / decline / cancel.
 *   - Leader actions: kick, transfer leader, disband.
 *   - Confirm modal for destructive actions (leave / kick / transfer /
 *     disband).
 *   - Loading / empty / error states.
 *
 * Server-authoritative invariants enforce ở PartyService. FE chỉ catch
 * error code → render i18n message + toast.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import {
  acceptPartyInvite,
  cancelPartyInvite,
  createParty as apiCreateParty,
  declinePartyInvite,
  disbandParty as apiDisbandParty,
  getMyParty,
  invitePlayerToParty,
  kickPartyMember,
  leaveParty as apiLeaveParty,
  listIncomingPartyInvites,
  listOutgoingPartyInvites,
  transferPartyLeader,
} from '@/api/party';
import {
  PARTY_LIMITS,
  type PartyDto,
  type PartyInviteDto,
  type PartyMemberDto,
  type WsFrame,
} from '@xuantoi/shared';
import { on as wsOn } from '@/ws/client';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

type InviteTab = 'incoming' | 'outgoing';

const { t } = useI18n();
const toast = useToastStore();
const auth = useAuthStore();

const loading = reactive({
  party: true,
  incoming: true,
  outgoing: true,
});
const errorMsg = reactive({
  party: '' as string,
  invites: '' as string,
});

const party = ref<PartyDto | null>(null);
const members = ref<PartyMemberDto[]>([]);
const incoming = ref<PartyInviteDto[]>([]);
const outgoing = ref<PartyInviteDto[]>([]);

const inviteTab = ref<InviteTab>('incoming');

// Create form
const createName = ref('');
const creating = ref(false);

// Send invite form
const inviteUserId = ref('');
const sendingInvite = ref(false);

// Per-row busy
const busyInviteId = ref<string | null>(null);
const busyMemberId = ref<string | null>(null);
const partyBusy = ref(false);

const myUserId = computed<string | null>(() => auth.user?.id ?? null);

const isLeader = computed(
  () =>
    !!party.value &&
    !!myUserId.value &&
    party.value.leaderUserId === myUserId.value,
);

type ConfirmTarget =
  | { kind: 'leave' }
  | { kind: 'disband' }
  | { kind: 'kick'; userId: string; displayName: string }
  | { kind: 'transfer'; userId: string; displayName: string };

const confirmOpen = ref(false);
const confirmTarget = ref<ConfirmTarget | null>(null);
const confirmBusy = ref(false);

function errMsg(e: unknown): string {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const key = `party.errors.${code}`;
  const fallback = t('party.errors.UNKNOWN');
  const msg = t(key);
  return msg === key ? fallback : msg;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function expiresInMinutes(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 60_000));
}

async function refreshParty(): Promise<void> {
  loading.party = true;
  errorMsg.party = '';
  try {
    const res = await getMyParty();
    party.value = res.party;
    members.value = res.members;
  } catch (e) {
    errorMsg.party = errMsg(e);
  } finally {
    loading.party = false;
  }
}

async function refreshIncoming(): Promise<void> {
  loading.incoming = true;
  try {
    const res = await listIncomingPartyInvites();
    incoming.value = res.invites;
  } catch (e) {
    errorMsg.invites = errMsg(e);
  } finally {
    loading.incoming = false;
  }
}

async function refreshOutgoing(): Promise<void> {
  loading.outgoing = true;
  try {
    const res = await listOutgoingPartyInvites();
    outgoing.value = res.invites;
  } catch (e) {
    errorMsg.invites = errMsg(e);
  } finally {
    loading.outgoing = false;
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([refreshParty(), refreshIncoming(), refreshOutgoing()]);
}

async function onCreateParty(): Promise<void> {
  creating.value = true;
  try {
    const name = createName.value.trim();
    const res = await apiCreateParty(name.length === 0 ? null : name);
    party.value = res.party;
    members.value = res.members;
    createName.value = '';
    toast.push({ type: 'success', text: t('party.toast.created') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    creating.value = false;
  }
}

async function onSendInvite(): Promise<void> {
  if (!isLeader.value) return;
  const target = inviteUserId.value.trim();
  if (target.length === 0) {
    toast.push({ type: 'error', text: t('party.errors.INVALID_INPUT') });
    return;
  }
  sendingInvite.value = true;
  try {
    await invitePlayerToParty(target);
    inviteUserId.value = '';
    toast.push({ type: 'success', text: t('party.toast.inviteSent') });
    await refreshOutgoing();
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    sendingInvite.value = false;
  }
}

async function onAcceptInvite(inv: PartyInviteDto): Promise<void> {
  busyInviteId.value = inv.id;
  try {
    const res = await acceptPartyInvite(inv.id);
    party.value = res.party;
    members.value = res.members;
    toast.push({ type: 'success', text: t('party.toast.accepted') });
    await Promise.all([refreshIncoming(), refreshOutgoing()]);
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busyInviteId.value = null;
  }
}

async function onDeclineInvite(inv: PartyInviteDto): Promise<void> {
  busyInviteId.value = inv.id;
  try {
    await declinePartyInvite(inv.id);
    toast.push({ type: 'success', text: t('party.toast.declined') });
    await refreshIncoming();
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busyInviteId.value = null;
  }
}

async function onCancelInvite(inv: PartyInviteDto): Promise<void> {
  busyInviteId.value = inv.id;
  try {
    await cancelPartyInvite(inv.id);
    toast.push({ type: 'success', text: t('party.toast.canceled') });
    await refreshOutgoing();
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busyInviteId.value = null;
  }
}

function askLeave(): void {
  confirmTarget.value = { kind: 'leave' };
  confirmOpen.value = true;
}

function askDisband(): void {
  if (!isLeader.value) return;
  confirmTarget.value = { kind: 'disband' };
  confirmOpen.value = true;
}

function askKick(m: PartyMemberDto): void {
  if (!isLeader.value) return;
  confirmTarget.value = {
    kind: 'kick',
    userId: m.userId,
    displayName: m.displayName ?? m.userId,
  };
  confirmOpen.value = true;
}

function askTransfer(m: PartyMemberDto): void {
  if (!isLeader.value) return;
  confirmTarget.value = {
    kind: 'transfer',
    userId: m.userId,
    displayName: m.displayName ?? m.userId,
  };
  confirmOpen.value = true;
}

const confirmTitle = computed(() => {
  const tgt = confirmTarget.value;
  if (!tgt) return '';
  switch (tgt.kind) {
    case 'leave':
      return t('party.confirm.leaveTitle');
    case 'disband':
      return t('party.confirm.disbandTitle');
    case 'kick':
      return t('party.confirm.kickTitle');
    case 'transfer':
      return t('party.confirm.transferTitle');
    default:
      return '';
  }
});

const confirmBody = computed(() => {
  const tgt = confirmTarget.value;
  if (!tgt) return '';
  switch (tgt.kind) {
    case 'leave':
      return t('party.confirm.leaveBody');
    case 'disband':
      return t('party.confirm.disbandBody');
    case 'kick':
      return t('party.confirm.kickBody', { name: tgt.displayName });
    case 'transfer':
      return t('party.confirm.transferBody', { name: tgt.displayName });
    default:
      return '';
  }
});

async function onConfirm(): Promise<void> {
  const tgt = confirmTarget.value;
  if (!tgt) return;
  confirmBusy.value = true;
  try {
    if (tgt.kind === 'leave') {
      partyBusy.value = true;
      await apiLeaveParty();
      party.value = null;
      members.value = [];
      toast.push({ type: 'success', text: t('party.toast.left') });
      await Promise.all([refreshIncoming(), refreshOutgoing()]);
    } else if (tgt.kind === 'disband') {
      partyBusy.value = true;
      await apiDisbandParty();
      party.value = null;
      members.value = [];
      toast.push({ type: 'success', text: t('party.toast.disbanded') });
      await Promise.all([refreshIncoming(), refreshOutgoing()]);
    } else if (tgt.kind === 'kick') {
      busyMemberId.value = tgt.userId;
      const res = await kickPartyMember(tgt.userId);
      party.value = res.party;
      members.value = res.members;
      toast.push({ type: 'success', text: t('party.toast.kicked') });
    } else if (tgt.kind === 'transfer') {
      busyMemberId.value = tgt.userId;
      const res = await transferPartyLeader(tgt.userId);
      party.value = res.party;
      members.value = res.members;
      toast.push({ type: 'success', text: t('party.toast.transferred') });
    }
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    confirmBusy.value = false;
    confirmOpen.value = false;
    confirmTarget.value = null;
    partyBusy.value = false;
    busyMemberId.value = null;
  }
}

function onCancelConfirm(): void {
  confirmOpen.value = false;
  confirmTarget.value = null;
}

// WS subscriptions: refresh on party:* events.
const wsUnsubs: Array<() => void> = [];

function subscribeWs(): void {
  const onParty = (_frame: WsFrame): void => {
    void refreshAll();
  };
  wsUnsubs.push(wsOn('party:updated', onParty));
  wsUnsubs.push(wsOn('party:invite', onParty));
  wsUnsubs.push(wsOn('party:member-joined', onParty));
  wsUnsubs.push(wsOn('party:member-left', onParty));
  wsUnsubs.push(wsOn('party:leader-changed', onParty));
}

onMounted(async () => {
  subscribeWs();
  await refreshAll();
});

onBeforeUnmount(() => {
  for (const off of wsUnsubs) off();
  wsUnsubs.length = 0;
});

defineExpose({ refreshAll });
</script>

<template>
  <div class="space-y-4" data-testid="party-panel">
    <!-- Loading state for initial party fetch -->
    <div
      v-if="loading.party"
      class="text-xs text-ink-300/80"
      data-testid="party-loading"
    >
      …
    </div>

    <!-- Party error state -->
    <div
      v-else-if="errorMsg.party"
      class="text-xs text-red-300"
      data-testid="party-error"
    >
      {{ errorMsg.party }}
    </div>

    <!-- Empty state: no active party -->
    <div
      v-else-if="!party"
      class="space-y-3 rounded border border-ink-300/30 bg-ink-900/60 p-4"
      data-testid="party-empty"
    >
      <div>
        <h3 class="text-sm uppercase tracking-widest text-amber-200">
          {{ t('party.empty.title') }}
        </h3>
        <p class="text-xs text-ink-300/80">
          {{ t('party.empty.subtitle') }}
        </p>
      </div>
      <form
        class="flex flex-col gap-2 sm:flex-row"
        data-testid="party-create-form"
        @submit.prevent="onCreateParty"
      >
        <input
          v-model="createName"
          type="text"
          class="flex-1 rounded border border-ink-300/40 bg-ink-900/50 px-2 py-1 text-sm"
          :placeholder="t('party.create.namePlaceholder')"
          data-testid="party-create-name"
        />
        <button
          type="submit"
          class="rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
          :disabled="creating"
          data-testid="party-create-submit"
        >
          {{ t('party.create.submit') }}
        </button>
      </form>
    </div>

    <!-- Current party card -->
    <div
      v-else
      class="space-y-3 rounded border border-ink-300/30 bg-ink-900/60 p-4"
      data-testid="party-current"
    >
      <div class="flex items-start justify-between gap-2">
        <div>
          <h3 class="text-sm uppercase tracking-widest text-amber-200">
            {{ t('party.current.title') }}
          </h3>
          <p class="text-xs text-ink-300/80">
            {{ party.name || '—' }}
            ·
            {{
              t('party.current.memberCountLabel', {
                count: party.memberCount,
                max: party.maxMembers,
              })
            }}
            ·
            {{ t('party.current.createdAt') }}: {{ fmtTime(party.createdAt) }}
          </p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded border border-ink-300/40 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-50"
            :disabled="partyBusy"
            data-testid="party-leave"
            @click="askLeave"
          >
            {{ t('party.actions.leave') }}
          </button>
          <button
            v-if="isLeader"
            type="button"
            class="rounded border border-red-400/40 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-50"
            :disabled="partyBusy"
            data-testid="party-disband"
            @click="askDisband"
          >
            {{ t('party.actions.disband') }}
          </button>
        </div>
      </div>

      <!-- Member list -->
      <ul class="space-y-1" data-testid="party-members">
        <li
          v-for="m in members"
          :key="m.userId"
          class="flex items-center justify-between gap-2 rounded border border-ink-300/20 bg-ink-900/40 px-2 py-1"
          :data-testid="`party-member-${m.userId}`"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              :class="[
                'inline-block h-2 w-2 rounded-full',
                m.online ? 'bg-emerald-400' : 'bg-ink-300/40',
              ]"
              :title="m.online ? t('party.members.online') : t('party.members.offline')"
              :data-testid="`party-member-online-${m.userId}`"
              :data-online="m.online ? 'true' : 'false'"
            ></span>
            <span class="text-sm truncate">{{ m.displayName }}</span>
            <span
              v-if="m.role === 'LEADER'"
              class="rounded border border-amber-400/60 px-1 py-0.5 text-[10px] uppercase text-amber-200"
            >
              {{ t('party.members.roleLeader') }}
            </span>
            <span
              v-else
              class="text-[10px] uppercase text-ink-300/70"
            >
              {{ t('party.members.roleMember') }}
            </span>
          </div>
          <div v-if="isLeader && m.role !== 'LEADER'" class="flex gap-1">
            <button
              type="button"
              class="rounded border border-amber-400/40 px-2 py-0.5 text-xs text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
              :disabled="busyMemberId === m.userId"
              :data-testid="`party-transfer-${m.userId}`"
              @click="askTransfer(m)"
            >
              {{ t('party.members.transfer') }}
            </button>
            <button
              type="button"
              class="rounded border border-red-400/40 px-2 py-0.5 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-50"
              :disabled="busyMemberId === m.userId"
              :data-testid="`party-kick-${m.userId}`"
              @click="askKick(m)"
            >
              {{ t('party.members.kick') }}
            </button>
          </div>
        </li>
      </ul>

      <!-- Leader: send invite form -->
      <form
        v-if="isLeader"
        class="flex flex-col gap-2 sm:flex-row"
        data-testid="party-invite-form"
        @submit.prevent="onSendInvite"
      >
        <input
          v-model="inviteUserId"
          type="text"
          class="flex-1 rounded border border-ink-300/40 bg-ink-900/50 px-2 py-1 text-sm"
          :placeholder="t('party.invites.sendPlaceholder')"
          data-testid="party-invite-userid"
        />
        <button
          type="submit"
          class="rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
          :disabled="sendingInvite || party.memberCount >= PARTY_LIMITS.maxMembers"
          data-testid="party-invite-submit"
        >
          {{ t('party.invites.sendSubmit') }}
        </button>
      </form>
    </div>

    <!-- Invites section -->
    <div class="space-y-2 rounded border border-ink-300/30 bg-ink-900/60 p-4">
      <nav class="flex flex-wrap gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="inviteTab === 'incoming'"
          class="px-2 py-1 text-xs uppercase tracking-widest rounded border"
          :class="
            inviteTab === 'incoming'
              ? 'border-amber-400/60 text-amber-200'
              : 'border-ink-300/30 text-ink-300'
          "
          data-testid="party-invites-tab-incoming"
          @click="inviteTab = 'incoming'"
        >
          {{ t('party.invites.tabIncoming') }} ({{ incoming.length }})
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="inviteTab === 'outgoing'"
          class="px-2 py-1 text-xs uppercase tracking-widest rounded border"
          :class="
            inviteTab === 'outgoing'
              ? 'border-amber-400/60 text-amber-200'
              : 'border-ink-300/30 text-ink-300'
          "
          data-testid="party-invites-tab-outgoing"
          @click="inviteTab = 'outgoing'"
        >
          {{ t('party.invites.tabOutgoing') }} ({{ outgoing.length }})
        </button>
      </nav>

      <div role="tabpanel">
        <ul
          v-if="inviteTab === 'incoming'"
          class="space-y-1"
          data-testid="party-incoming-list"
        >
          <li
            v-if="incoming.length === 0 && !loading.incoming"
            class="text-xs text-ink-300/70"
          >
            {{ t('party.invites.emptyIncoming') }}
          </li>
          <li
            v-for="inv in incoming"
            :key="inv.id"
            class="flex flex-col gap-1 rounded border border-ink-300/20 bg-ink-900/40 px-2 py-1 sm:flex-row sm:items-center sm:justify-between"
            :data-testid="`party-invite-incoming-${inv.id}`"
          >
            <div class="text-xs text-ink-200">
              {{ t('party.invites.from') }}: {{ inv.inviterDisplayName }}
              <span class="text-ink-300/70">·</span>
              {{ t('party.invites.party') }}: {{ inv.partyName || '—' }}
              <span class="text-ink-300/70">·</span>
              {{ t('party.invites.expiresIn', { mins: expiresInMinutes(inv.expiresAt) }) }}
            </div>
            <div class="flex gap-1">
              <button
                type="button"
                class="rounded border border-emerald-400/60 px-2 py-0.5 text-xs text-emerald-200 disabled:opacity-50"
                :disabled="busyInviteId === inv.id"
                :data-testid="`party-invite-accept-${inv.id}`"
                @click="onAcceptInvite(inv)"
              >
                {{ t('party.invites.accept') }}
              </button>
              <button
                type="button"
                class="rounded border border-red-400/40 px-2 py-0.5 text-xs text-red-200 disabled:opacity-50"
                :disabled="busyInviteId === inv.id"
                :data-testid="`party-invite-decline-${inv.id}`"
                @click="onDeclineInvite(inv)"
              >
                {{ t('party.invites.decline') }}
              </button>
            </div>
          </li>
        </ul>

        <ul
          v-else
          class="space-y-1"
          data-testid="party-outgoing-list"
        >
          <li
            v-if="outgoing.length === 0 && !loading.outgoing"
            class="text-xs text-ink-300/70"
          >
            {{ t('party.invites.emptyOutgoing') }}
          </li>
          <li
            v-for="inv in outgoing"
            :key="inv.id"
            class="flex flex-col gap-1 rounded border border-ink-300/20 bg-ink-900/40 px-2 py-1 sm:flex-row sm:items-center sm:justify-between"
            :data-testid="`party-invite-outgoing-${inv.id}`"
          >
            <div class="text-xs text-ink-200">
              {{ t('party.invites.to') }}: {{ inv.inviteeDisplayName }}
              <span class="text-ink-300/70">·</span>
              {{ inv.status }}
              <span class="text-ink-300/70">·</span>
              {{ t('party.invites.expiresIn', { mins: expiresInMinutes(inv.expiresAt) }) }}
            </div>
            <div class="flex gap-1">
              <button
                v-if="inv.status === 'PENDING'"
                type="button"
                class="rounded border border-red-400/40 px-2 py-0.5 text-xs text-red-200 disabled:opacity-50"
                :disabled="busyInviteId === inv.id"
                :data-testid="`party-invite-cancel-${inv.id}`"
                @click="onCancelInvite(inv)"
              >
                {{ t('party.invites.cancel') }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <ConfirmModal
      :open="confirmOpen"
      :title="confirmTitle"
      :message="confirmBody"
      :loading="confirmBusy"
      :danger="
        confirmTarget?.kind === 'disband' ||
          confirmTarget?.kind === 'kick' ||
          confirmTarget?.kind === 'leave'
      "
      :confirm-text="t('party.confirm.confirm')"
      :cancel-text="t('party.confirm.cancel')"
      test-id="party-confirm"
      @confirm="onConfirm"
      @cancel="onCancelConfirm"
    />
  </div>
</template>
