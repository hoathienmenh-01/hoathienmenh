<script setup lang="ts">
/**
 * Phase 20.1 — Party Dungeon / Co-op PvE Foundation panel.
 *
 * Render lifecycle states cho 1 party room:
 *   - No party / no room: empty state hint (cần tạo party trước).
 *   - LOBBY (leader): dungeon picker + create room form.
 *   - LOBBY (member): join room button + ready toggle.
 *   - LOBBY/READY_CHECK: list participant + ready badge + leader actions
 *     (start / cancel). Leader thấy "Start" disable khi NOT_ENOUGH_MEMBERS
 *     hoặc NOT_ALL_READY (gate qua shared helper `canStartPartyDungeon`).
 *   - COMPLETED: hiển thị run result, reward preview + Claim button.
 *   - FAILED / CANCELED: read-only summary + tạo room mới option.
 *
 * Server-authoritative invariants. FE chỉ catch error code → i18n
 * `partyDungeon.errors.*`. KHÔNG tự cộng linhThach / tienNgoc / exp /
 * item — reward grant qua `claim-reward` endpoint.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import {
  cancelPartyDungeonReady,
  cancelPartyDungeonRoom,
  claimPartyDungeonReward,
  createPartyDungeonRoom,
  getMyPartyDungeonRoom,
  joinPartyDungeonRoom,
  setPartyDungeonReady,
  startPartyDungeonRun,
} from '@/api/partyDungeon';
import {
  COOP_DUNGEON_LIMITS,
  DUNGEONS,
  canStartPartyDungeon,
  type MyPartyDungeonRoomResponse,
  type PartyDungeonParticipantDto,
  type PartyDungeonRewardClaimDto,
  type PartyDungeonRoomDto,
  type WsFrame,
} from '@xuantoi/shared';
import { on as wsOn } from '@/ws/client';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t } = useI18n();
const toast = useToastStore();
const auth = useAuthStore();

const loading = ref(true);
const errorMsg = ref('');

const room = ref<PartyDungeonRoomDto | null>(null);
const participants = ref<PartyDungeonParticipantDto[]>([]);
const myReward = ref<PartyDungeonRewardClaimDto | null>(null);

const selectedDungeonKey = ref<string>(DUNGEONS[0]?.key ?? '');

const busy = reactive({
  create: false,
  join: false,
  ready: false,
  start: false,
  cancel: false,
  claim: false,
});

const confirmOpen = ref(false);
type ConfirmKind = 'cancel' | 'start';
const confirmKind = ref<ConfirmKind | null>(null);

const myUserId = computed<string | null>(() => auth.user?.id ?? null);

const isLeader = computed(
  () =>
    !!room.value &&
    !!myUserId.value &&
    room.value.leaderUserId === myUserId.value,
);

const myParticipant = computed<PartyDungeonParticipantDto | null>(() => {
  const uid = myUserId.value;
  if (!uid) return null;
  return participants.value.find((p) => p.userId === uid) ?? null;
});

const isParticipant = computed(() => !!myParticipant.value);

const readyCount = computed(
  () => participants.value.filter((p) => p.readyAt !== null).length,
);

const startGate = computed(() => {
  if (!room.value || !myUserId.value) return null;
  return canStartPartyDungeon({
    callerUserId: myUserId.value,
    leaderUserId: room.value.leaderUserId,
    dungeonKey: room.value.dungeonKey,
    roomStatus: room.value.status,
    participants: participants.value.map((p) => ({
      userId: p.userId,
      readyAt: p.readyAt,
      leftAt: p.leftAt,
    })),
    minMembers: room.value.minMembers,
  });
});

const canStart = computed(() => startGate.value?.ok === true);
const startBlockReason = computed<string>(() => {
  const g = startGate.value;
  if (!g || g.ok) return '';
  return t(`partyDungeon.errors.${g.code}`);
});

const dungeonOptions = computed(() =>
  DUNGEONS.map((d) => ({
    key: d.key,
    name: d.name,
    recommendedRealm: d.recommendedRealm,
  })),
);

const currentDungeonDef = computed(() => {
  if (!room.value) return null;
  return DUNGEONS.find((d) => d.key === room.value!.dungeonKey) ?? null;
});

function errMsg(e: unknown): string {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const key = `partyDungeon.errors.${code}`;
  const fallback = t('partyDungeon.errors.UNKNOWN');
  const msg = t(key);
  return msg === key ? fallback : msg;
}

function applyResponse(res: MyPartyDungeonRoomResponse): void {
  room.value = res.room;
  participants.value = res.participants;
  myReward.value = res.myReward;
}

async function refresh(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await getMyPartyDungeonRoom();
    applyResponse(res);
  } catch (e) {
    errorMsg.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (busy.create) return;
  const key = selectedDungeonKey.value;
  if (!key) {
    toast.push({ type: 'error', text: t('partyDungeon.errors.INVALID_DUNGEON') });
    return;
  }
  busy.create = true;
  try {
    const res = await createPartyDungeonRoom(key);
    applyResponse(res);
    toast.push({ type: 'success', text: t('partyDungeon.toast.roomCreated') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.create = false;
  }
}

async function onJoin(): Promise<void> {
  if (!room.value || busy.join) return;
  busy.join = true;
  try {
    const res = await joinPartyDungeonRoom(room.value.id);
    applyResponse(res);
    toast.push({ type: 'success', text: t('partyDungeon.toast.joined') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.join = false;
  }
}

async function onToggleReady(): Promise<void> {
  if (!room.value || busy.ready) return;
  busy.ready = true;
  try {
    const ready = myParticipant.value?.readyAt !== null;
    const res = ready
      ? await cancelPartyDungeonReady(room.value.id)
      : await setPartyDungeonReady(room.value.id);
    applyResponse(res);
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.ready = false;
  }
}

function askStart(): void {
  if (!canStart.value) return;
  confirmKind.value = 'start';
  confirmOpen.value = true;
}

function askCancel(): void {
  if (!isLeader.value) return;
  confirmKind.value = 'cancel';
  confirmOpen.value = true;
}

async function onConfirm(): Promise<void> {
  if (!room.value) return;
  const kind = confirmKind.value;
  try {
    if (kind === 'start') {
      busy.start = true;
      const res = await startPartyDungeonRun(room.value.id);
      applyResponse(res);
      toast.push({ type: 'success', text: t('partyDungeon.toast.started') });
    } else if (kind === 'cancel') {
      busy.cancel = true;
      const res = await cancelPartyDungeonRoom(room.value.id);
      applyResponse(res);
      toast.push({ type: 'success', text: t('partyDungeon.toast.canceled') });
    }
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.start = false;
    busy.cancel = false;
    confirmOpen.value = false;
    confirmKind.value = null;
  }
}

function onConfirmCancel(): void {
  confirmOpen.value = false;
  confirmKind.value = null;
}

async function onClaim(): Promise<void> {
  if (!myReward.value || busy.claim) return;
  busy.claim = true;
  try {
    const res = await claimPartyDungeonReward(myReward.value.runId);
    myReward.value = res.claim;
    toast.push({ type: 'success', text: t('partyDungeon.toast.claimed') });
    await refresh();
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.claim = false;
  }
}

const confirmTitle = computed(() => {
  const k = confirmKind.value;
  if (k === 'start') return t('partyDungeon.confirm.startTitle');
  if (k === 'cancel') return t('partyDungeon.confirm.cancelTitle');
  return '';
});

const confirmBody = computed(() => {
  const k = confirmKind.value;
  if (k === 'start') return t('partyDungeon.confirm.startBody');
  if (k === 'cancel') return t('partyDungeon.confirm.cancelBody');
  return '';
});

// WS subscriptions: refresh on party-dungeon:* events.
const wsUnsubs: Array<() => void> = [];

function subscribeWs(): void {
  const onEvent = (_frame: WsFrame): void => {
    void refresh();
  };
  wsUnsubs.push(wsOn('party-dungeon:room-updated', onEvent));
  wsUnsubs.push(wsOn('party-dungeon:ready-updated', onEvent));
  wsUnsubs.push(wsOn('party-dungeon:started', onEvent));
  wsUnsubs.push(wsOn('party-dungeon:completed', onEvent));
  wsUnsubs.push(wsOn('party-dungeon:reward-available', onEvent));
}

onMounted(async () => {
  subscribeWs();
  await refresh();
});

onBeforeUnmount(() => {
  for (const off of wsUnsubs) off();
  wsUnsubs.length = 0;
});

defineExpose({ refresh });
</script>

<template>
  <div class="space-y-4" data-testid="party-dungeon-panel">
    <header class="space-y-1">
      <h3 class="text-sm uppercase tracking-widest text-amber-200">
        {{ t('partyDungeon.title') }}
      </h3>
      <p class="text-xs text-ink-300/80">{{ t('partyDungeon.subtitle') }}</p>
    </header>

    <!-- Loading -->
    <div
      v-if="loading"
      class="text-xs text-ink-300/80"
      data-testid="party-dungeon-loading"
    >
      …
    </div>

    <!-- Error -->
    <div
      v-else-if="errorMsg"
      class="text-xs text-red-300"
      data-testid="party-dungeon-error"
    >
      {{ errorMsg }}
    </div>

    <!-- No room: leader creates, member sees hint -->
    <div
      v-else-if="!room"
      class="space-y-3 rounded border border-ink-300/30 bg-ink-900/60 p-4"
      data-testid="party-dungeon-empty"
    >
      <p class="text-xs text-ink-300/80">
        {{ t('partyDungeon.empty.subtitle') }}
      </p>

      <form
        class="flex flex-col gap-2 sm:flex-row"
        data-testid="party-dungeon-create-form"
        @submit.prevent="onCreate"
      >
        <select
          v-model="selectedDungeonKey"
          class="flex-1 rounded border border-ink-300/40 bg-ink-900/50 px-2 py-1 text-sm"
          data-testid="party-dungeon-select"
        >
          <option
            v-for="d in dungeonOptions"
            :key="d.key"
            :value="d.key"
          >
            {{ d.name }} · {{ d.recommendedRealm }}
          </option>
        </select>
        <button
          type="submit"
          class="rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
          :disabled="busy.create || !selectedDungeonKey"
          data-testid="party-dungeon-create-submit"
        >
          {{ t('partyDungeon.actions.create') }}
        </button>
      </form>
      <p class="text-[10px] text-ink-300/60">
        {{
          t('partyDungeon.empty.leaderHint', {
            min: COOP_DUNGEON_LIMITS.minMembers,
            max: COOP_DUNGEON_LIMITS.maxMembers,
          })
        }}
      </p>
    </div>

    <!-- Active room -->
    <div
      v-else
      class="space-y-3 rounded border border-ink-300/30 bg-ink-900/60 p-4"
      data-testid="party-dungeon-room"
    >
      <!-- Header row -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm tracking-widest text-amber-200">{{
              currentDungeonDef?.name ?? room.dungeonKey
            }}</span>
            <span
              class="rounded border border-amber-400/40 px-1 py-0.5 text-[10px] uppercase text-amber-100"
              :data-testid="`party-dungeon-status-${room.status}`"
            >
              {{ t(`partyDungeon.status.${room.status}`) }}
            </span>
          </div>
          <p class="text-xs text-ink-300/80">
            {{
              t('partyDungeon.room.summary', {
                ready: readyCount,
                count: participants.length,
                min: room.minMembers,
                max: room.maxMembers,
              })
            }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            v-if="
              !isParticipant &&
                (room.status === 'LOBBY' || room.status === 'READY_CHECK')
            "
            type="button"
            class="rounded border border-amber-400/60 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
            :disabled="busy.join"
            data-testid="party-dungeon-join"
            @click="onJoin"
          >
            {{ t('partyDungeon.actions.join') }}
          </button>

          <button
            v-if="
              isParticipant &&
                (room.status === 'LOBBY' || room.status === 'READY_CHECK')
            "
            type="button"
            class="rounded border px-2 py-1 text-xs uppercase tracking-widest disabled:opacity-50"
            :class="
              myParticipant?.readyAt
                ? 'border-emerald-400/60 bg-emerald-900/40 text-emerald-100'
                : 'border-ink-300/40 text-ink-200 hover:bg-ink-800'
            "
            :disabled="busy.ready"
            data-testid="party-dungeon-ready-toggle"
            @click="onToggleReady"
          >
            {{
              myParticipant?.readyAt
                ? t('partyDungeon.actions.cancelReady')
                : t('partyDungeon.actions.ready')
            }}
          </button>

          <button
            v-if="
              isLeader &&
                (room.status === 'LOBBY' || room.status === 'READY_CHECK')
            "
            type="button"
            class="rounded border border-amber-400/60 bg-amber-900/40 px-2 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
            :disabled="busy.start || !canStart"
            :title="canStart ? '' : startBlockReason"
            data-testid="party-dungeon-start"
            @click="askStart"
          >
            {{ t('partyDungeon.actions.start') }}
          </button>

          <button
            v-if="
              isLeader &&
                (room.status === 'LOBBY' || room.status === 'READY_CHECK')
            "
            type="button"
            class="rounded border border-red-400/40 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-50"
            :disabled="busy.cancel"
            data-testid="party-dungeon-cancel"
            @click="askCancel"
          >
            {{ t('partyDungeon.actions.cancel') }}
          </button>
        </div>
      </div>

      <!-- Participant list -->
      <ul class="space-y-1" data-testid="party-dungeon-participants">
        <li
          v-for="p in participants"
          :key="p.userId"
          class="flex items-center justify-between gap-2 rounded border border-ink-300/20 bg-ink-900/40 px-2 py-1"
          :data-testid="`party-dungeon-participant-${p.userId}`"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              :class="[
                'inline-block h-2 w-2 rounded-full',
                p.readyAt
                  ? 'bg-emerald-400'
                  : 'bg-ink-300/40',
              ]"
              :title="
                p.readyAt
                  ? t('partyDungeon.participants.ready')
                  : t('partyDungeon.participants.notReady')
              "
              :data-ready="p.readyAt ? 'true' : 'false'"
            ></span>
            <span class="text-sm truncate">{{
              p.characterName ?? p.userId
            }}</span>
            <span
              v-if="p.userId === room.leaderUserId"
              class="rounded border border-amber-400/60 px-1 py-0.5 text-[10px] uppercase text-amber-200"
            >
              {{ t('partyDungeon.participants.leader') }}
            </span>
          </div>
          <span class="text-[10px] text-ink-300/70">
            {{
              p.readyAt
                ? t('partyDungeon.participants.ready')
                : t('partyDungeon.participants.notReady')
            }}
          </span>
        </li>
      </ul>

      <!-- Reward section: visible only when room.status COMPLETED + reward exists -->
      <div
        v-if="
          room.status === 'COMPLETED' &&
            myReward &&
            (myReward.status === 'PENDING' || myReward.status === 'CLAIMED')
        "
        class="space-y-2 rounded border border-amber-400/40 bg-amber-900/20 p-3"
        data-testid="party-dungeon-reward"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="text-xs uppercase tracking-widest text-amber-200">
            {{ t('partyDungeon.reward.title') }}
          </div>
          <span
            class="text-[10px] uppercase tracking-widest"
            :class="
              myReward.status === 'CLAIMED'
                ? 'text-emerald-300'
                : 'text-amber-200'
            "
            :data-testid="`party-dungeon-reward-status-${myReward.status}`"
          >
            {{ t(`partyDungeon.reward.statusLabel.${myReward.status}`) }}
          </span>
        </div>
        <ul class="space-y-0.5 text-xs text-ink-200">
          <li v-if="myReward.rewardJson.linhThach">
            {{ t('partyDungeon.reward.linhThach') }}:
            {{ myReward.rewardJson.linhThach }}
          </li>
          <li v-if="myReward.rewardJson.tienNgoc">
            {{ t('partyDungeon.reward.tienNgoc') }}:
            {{ myReward.rewardJson.tienNgoc }}
          </li>
          <li v-if="myReward.rewardJson.exp">
            {{ t('partyDungeon.reward.exp') }}:
            {{ myReward.rewardJson.exp }}
          </li>
          <li
            v-for="(it, i) in myReward.rewardJson.items ?? []"
            :key="`${it.itemKey}-${i}`"
          >
            {{ it.itemKey }} × {{ it.qty }}
          </li>
        </ul>
        <button
          v-if="myReward.status === 'PENDING'"
          type="button"
          class="rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
          :disabled="busy.claim"
          data-testid="party-dungeon-claim"
          @click="onClaim"
        >
          {{ t('partyDungeon.actions.claim') }}
        </button>
      </div>

      <!-- Completed/canceled but no reward (non-participant viewing detail) -->
      <p
        v-if="
          (room.status === 'COMPLETED' || room.status === 'FAILED') && !myReward
        "
        class="text-xs text-ink-300/80"
      >
        {{ t('partyDungeon.reward.noneForCaller') }}
      </p>
    </div>

    <ConfirmModal
      :open="confirmOpen"
      :title="confirmTitle"
      :message="confirmBody"
      :loading="busy.start || busy.cancel"
      :danger="confirmKind === 'cancel'"
      test-id="party-dungeon-confirm"
      @confirm="onConfirm"
      @cancel="onConfirmCancel"
    />
  </div>
</template>
