<script setup lang="ts">
/**
 * Phase 20.2 — Co-op Boss / World Boss Party Contribution panel.
 *
 * Render lifecycle states cho 1 party co-op boss run:
 *   - No party / no run: leader thấy form chọn boss + create button.
 *   - LOBBY (leader): start trigger qua "send first contribution"
 *     (auto-promote IN_PROGRESS) hoặc cancel.
 *   - LOBBY (member): join button.
 *   - IN_PROGRESS: list participant + contribution form (damage /
 *     support / survival) + live tier preview. Leader thấy finish
 *     cleared / failed.
 *   - CLEARED: hiển thị run result + reward claim (tier-based).
 *   - FAILED / CANCELED: read-only summary.
 *
 * Server-authoritative invariants. FE chỉ catch error code → i18n
 * `coopBoss.errors.*`. KHÔNG tự cộng linhThach / tienNgoc / exp /
 * item — reward grant qua `claim-reward` endpoint (CAS PENDING →
 * CLAIMED). Contribution self-report → server clamp per
 * `COOP_BOSS_LIMITS` + ghi anomaly log nếu vượt cap.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import {
  cancelCoopBossRun,
  claimCoopBossReward,
  createCoopBossRun,
  finishCoopBossRun,
  getMyCoopBossRun,
  joinCoopBossRun,
  leaveCoopBossRun,
  recordCoopBossContribution,
} from '@/api/coopBoss';
import {
  BOSSES,
  COOP_BOSS_LIMITS,
  classifyContributionTier,
  computeCoopBossRewardTier,
  type CoopBossContributionDto,
  type CoopBossParticipantDto,
  type CoopBossRewardClaimDto,
  type CoopBossRewardPreview,
  type CoopBossRunDto,
  type MyCoopBossRunResponse,
  type WsFrame,
} from '@xuantoi/shared';
import { on as wsOn } from '@/ws/client';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t } = useI18n();
const toast = useToastStore();
const auth = useAuthStore();

const loading = ref(true);
const errorMsg = ref('');

const run = ref<CoopBossRunDto | null>(null);
const participants = ref<CoopBossParticipantDto[]>([]);
const myContribution = ref<CoopBossContributionDto | null>(null);
const myReward = ref<CoopBossRewardClaimDto | null>(null);
const myRewardPreview = ref<CoopBossRewardPreview | null>(null);

const selectedBossKey = ref<string>(BOSSES[0]?.key ?? '');

const contribForm = reactive({
  damageDone: 0,
  supportScore: 0,
  survivalSeconds: 0,
});

const busy = reactive({
  create: false,
  join: false,
  leave: false,
  contribute: false,
  finish: false,
  cancel: false,
  claim: false,
});

const confirmOpen = ref(false);
type ConfirmKind = 'finishClear' | 'finishFail' | 'cancel';
const confirmKind = ref<ConfirmKind | null>(null);

const myUserId = computed<string | null>(() => auth.user?.id ?? null);

const myParticipant = computed<CoopBossParticipantDto | null>(() => {
  const uid = myUserId.value;
  if (!uid) return null;
  return participants.value.find((p) => p.userId === uid) ?? null;
});

const isParticipant = computed(() => !!myParticipant.value);

const bossOptions = computed(() =>
  BOSSES.map((b) => ({ key: b.key, name: b.name })),
);

const currentBossDef = computed(() => {
  if (!run.value) return null;
  return BOSSES.find((b) => b.key === run.value!.bossKey) ?? null;
});

const liveTier = computed(() => {
  if (!myContribution.value || !myParticipant.value) return null;
  const survivalOk =
    myContribution.value.survivalSeconds >=
    COOP_BOSS_LIMITS.minSurvivalSeconds;
  const stillIn = myParticipant.value.leftAt === null;
  return classifyContributionTier({
    contributionScore: myContribution.value.contributionScore,
    eligibleForReward: stillIn && survivalOk,
    isMvpCandidate: false,
  });
});

const livePreview = computed<CoopBossRewardPreview | null>(() => {
  if (myRewardPreview.value) return myRewardPreview.value;
  if (!liveTier.value) return null;
  return computeCoopBossRewardTier({ tier: liveTier.value });
});

const mvpUserId = computed<string | null>(() => {
  const summary = run.value?.resultSummaryJson;
  if (!summary || typeof summary !== 'object') return null;
  const m = (summary as { mvpUserId?: unknown }).mvpUserId;
  return typeof m === 'string' ? m : null;
});

function characterNameOf(userId: string): string {
  const p = participants.value.find((q) => q.userId === userId);
  return p?.characterName ?? userId.slice(0, 6);
}

function errMsg(e: unknown): string {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const key = `coopBoss.errors.${code}`;
  const fallback = t('coopBoss.errors.UNKNOWN');
  const msg = t(key);
  return msg === key ? fallback : msg;
}

function applyResponse(res: MyCoopBossRunResponse): void {
  run.value = res.run;
  participants.value = res.participants;
  myContribution.value = res.myContribution;
  myReward.value = res.myReward;
  myRewardPreview.value = res.myRewardPreview;
}

async function refresh(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await getMyCoopBossRun();
    applyResponse(res);
  } catch (e) {
    errorMsg.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (busy.create) return;
  const key = selectedBossKey.value;
  if (!key) {
    toast.push({
      type: 'error',
      text: t('coopBoss.errors.INVALID_BOSS_KEY'),
    });
    return;
  }
  busy.create = true;
  try {
    const res = await createCoopBossRun({ bossKey: key });
    applyResponse(res);
    toast.push({ type: 'success', text: t('coopBoss.toast.created') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.create = false;
  }
}

async function onJoin(): Promise<void> {
  if (busy.join || !run.value) return;
  busy.join = true;
  try {
    const res = await joinCoopBossRun(run.value.id);
    applyResponse(res);
    toast.push({ type: 'success', text: t('coopBoss.toast.joined') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.join = false;
  }
}

async function onLeave(): Promise<void> {
  if (busy.leave || !run.value) return;
  busy.leave = true;
  try {
    const res = await leaveCoopBossRun(run.value.id);
    applyResponse(res);
    toast.push({ type: 'success', text: t('coopBoss.toast.left') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.leave = false;
  }
}

async function onSubmitContribution(): Promise<void> {
  if (busy.contribute || !run.value) return;
  busy.contribute = true;
  try {
    await recordCoopBossContribution({
      runId: run.value.id,
      damageDone: Math.max(0, Math.floor(contribForm.damageDone)),
      supportScore: Math.max(0, Math.floor(contribForm.supportScore)),
      survivalSeconds: Math.max(0, Math.floor(contribForm.survivalSeconds)),
    });
    contribForm.damageDone = 0;
    contribForm.supportScore = 0;
    contribForm.survivalSeconds = 0;
    await refresh();
    toast.push({ type: 'success', text: t('coopBoss.toast.contributed') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.contribute = false;
  }
}

function openConfirm(kind: ConfirmKind): void {
  confirmKind.value = kind;
  confirmOpen.value = true;
}

async function onConfirm(): Promise<void> {
  const kind = confirmKind.value;
  confirmOpen.value = false;
  confirmKind.value = null;
  if (!kind || !run.value) return;
  if (kind === 'finishClear') return doFinish('CLEARED');
  if (kind === 'finishFail') return doFinish('FAILED');
  if (kind === 'cancel') return doCancel();
}

async function doFinish(result: 'CLEARED' | 'FAILED'): Promise<void> {
  if (busy.finish || !run.value) return;
  busy.finish = true;
  try {
    const res = await finishCoopBossRun(run.value.id, result);
    applyResponse(res);
    toast.push({ type: 'success', text: t('coopBoss.toast.finished') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.finish = false;
  }
}

async function doCancel(): Promise<void> {
  if (busy.cancel || !run.value) return;
  busy.cancel = true;
  try {
    const res = await cancelCoopBossRun(run.value.id);
    applyResponse(res);
    toast.push({ type: 'success', text: t('coopBoss.toast.canceled') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.cancel = false;
  }
}

async function onClaim(): Promise<void> {
  if (busy.claim || !run.value) return;
  busy.claim = true;
  try {
    const { claim } = await claimCoopBossReward(run.value.id);
    myReward.value = claim;
    toast.push({ type: 'success', text: t('coopBoss.toast.claimed') });
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.claim = false;
  }
}

const confirmTitle = computed(() => {
  const k = confirmKind.value;
  if (k === 'finishClear') return t('coopBoss.confirm.finishClearTitle');
  if (k === 'finishFail') return t('coopBoss.confirm.finishFailTitle');
  if (k === 'cancel') return t('coopBoss.confirm.cancelTitle');
  return '';
});

const confirmBody = computed(() => {
  const k = confirmKind.value;
  if (k === 'finishClear') return t('coopBoss.confirm.finishClearBody');
  if (k === 'finishFail') return t('coopBoss.confirm.finishFailBody');
  if (k === 'cancel') return t('coopBoss.confirm.cancelBody');
  return '';
});

const wsUnsubs: Array<() => void> = [];

function subscribeWs(): void {
  const onEvent = (_frame: WsFrame): void => {
    void refresh();
  };
  wsUnsubs.push(wsOn('coop-boss:run-updated', onEvent));
  wsUnsubs.push(wsOn('coop-boss:contribution-updated', onEvent));
  wsUnsubs.push(wsOn('coop-boss:finished', onEvent));
  wsUnsubs.push(wsOn('coop-boss:reward-available', onEvent));
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
  <div class="space-y-4" data-testid="coop-boss-panel">
    <header class="space-y-1">
      <h3 class="text-sm uppercase tracking-widest text-amber-200">
        {{ t('coopBoss.title') }}
      </h3>
      <p class="text-xs text-ink-300/80">{{ t('coopBoss.subtitle') }}</p>
    </header>

    <!-- Loading -->
    <div
      v-if="loading"
      class="text-xs text-ink-300/80"
      data-testid="coop-boss-loading"
    >
      …
    </div>

    <!-- Error -->
    <div
      v-else-if="errorMsg"
      class="text-xs text-red-300"
      data-testid="coop-boss-error"
    >
      {{ errorMsg }}
    </div>

    <!-- No run: leader creates -->
    <div
      v-else-if="!run"
      class="space-y-3 rounded border border-ink-300/30 bg-ink-900/60 p-4"
      data-testid="coop-boss-empty"
    >
      <p class="text-xs text-ink-300/80">
        {{ t('coopBoss.empty.subtitle') }}
      </p>

      <form
        class="flex flex-col gap-2 sm:flex-row"
        data-testid="coop-boss-create-form"
        @submit.prevent="onCreate"
      >
        <select
          v-model="selectedBossKey"
          class="flex-1 rounded border border-ink-300/40 bg-ink-900/50 px-2 py-1 text-sm"
          data-testid="coop-boss-select"
        >
          <option v-for="b in bossOptions" :key="b.key" :value="b.key">
            {{ b.name }}
          </option>
        </select>
        <button
          type="submit"
          class="rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
          :disabled="busy.create || !selectedBossKey"
          data-testid="coop-boss-create-submit"
        >
          {{ t('coopBoss.actions.create') }}
        </button>
      </form>
      <p class="text-[10px] text-ink-300/60">
        {{
          t('coopBoss.empty.leaderHint', {
            max: COOP_BOSS_LIMITS.maxMembers,
          })
        }}
      </p>
    </div>

    <!-- Active run -->
    <div
      v-else
      class="space-y-3 rounded border border-ink-300/30 bg-ink-900/60 p-4"
      data-testid="coop-boss-run"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm tracking-widest text-amber-200">
              {{ currentBossDef?.name ?? run.bossKey }}
            </span>
            <span
              class="rounded border border-ink-300/40 px-1.5 py-0.5 text-[10px] uppercase text-ink-300/80"
              data-testid="coop-boss-status"
            >
              {{ t(`coopBoss.status.${run.status}`) }}
            </span>
          </div>
          <p class="text-[11px] text-ink-300/70">
            {{
              t('coopBoss.run.summary', {
                count: participants.length,
                boss: currentBossDef?.name ?? run.bossKey,
              })
            }}
          </p>
          <p
            v-if="run.status === 'CLEARED' && mvpUserId"
            class="text-[11px] text-amber-200/80"
            data-testid="coop-boss-mvp"
          >
            {{ t('coopBoss.run.mvp', { name: characterNameOf(mvpUserId) }) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-1">
          <button
            v-if="run.status === 'LOBBY' && !isParticipant"
            type="button"
            class="rounded border border-ink-300/40 px-2 py-1 text-[11px] uppercase tracking-widest text-ink-200 disabled:opacity-50"
            :disabled="busy.join"
            data-testid="coop-boss-join"
            @click="onJoin"
          >
            {{ t('coopBoss.actions.join') }}
          </button>
          <button
            v-if="
              (run.status === 'LOBBY' || run.status === 'IN_PROGRESS') &&
                isParticipant
            "
            type="button"
            class="rounded border border-ink-300/40 px-2 py-1 text-[11px] uppercase tracking-widest text-ink-200 disabled:opacity-50"
            :disabled="busy.leave"
            data-testid="coop-boss-leave"
            @click="onLeave"
          >
            {{ t('coopBoss.actions.leave') }}
          </button>
        </div>
      </div>

      <!-- Participant list -->
      <ul
        class="grid grid-cols-1 gap-1 sm:grid-cols-2"
        data-testid="coop-boss-participants"
      >
        <li
          v-for="p in participants"
          :key="p.id"
          class="flex items-center justify-between rounded border border-ink-300/20 bg-ink-900/40 px-2 py-1 text-[11px]"
          :data-testid="`coop-boss-participant-${p.userId}`"
        >
          <span class="truncate">
            {{ p.characterName ?? p.userId.slice(0, 6) }}
            <span
              v-if="p.leftAt"
              class="ml-1 text-red-300/80"
              :data-testid="`coop-boss-left-${p.userId}`"
            >
              · {{ t('coopBoss.participants.leftEarly') }}
            </span>
          </span>
          <span class="shrink-0 text-ink-300/70">
            {{
              t('coopBoss.participants.score', {
                score: p.finalContributionScore ?? '—',
              })
            }}
          </span>
        </li>
      </ul>

      <!-- Contribution form (active runs only, participant only) -->
      <div
        v-if="
          (run.status === 'LOBBY' || run.status === 'IN_PROGRESS') &&
            isParticipant
        "
        class="space-y-2 rounded border border-ink-300/20 bg-ink-900/40 p-3"
        data-testid="coop-boss-contribution"
      >
        <h4 class="text-[11px] uppercase tracking-widest text-amber-200">
          {{ t('coopBoss.contribution.title') }}
        </h4>
        <dl
          v-if="myContribution"
          class="grid grid-cols-3 gap-2 text-[11px] text-ink-300/80"
        >
          <div>
            {{
              t('coopBoss.contribution.damage', {
                value: myContribution.damageDone,
              })
            }}
          </div>
          <div>
            {{
              t('coopBoss.contribution.support', {
                value: myContribution.supportScore,
              })
            }}
          </div>
          <div>
            {{
              t('coopBoss.contribution.survival', {
                value: myContribution.survivalSeconds,
              })
            }}
          </div>
        </dl>
        <div
          v-if="liveTier"
          class="text-[11px] text-amber-200/80"
          data-testid="coop-boss-live-tier"
        >
          {{
            t('coopBoss.participants.tierLabel', {
              tier: t(`coopBoss.tier.${liveTier}`),
            })
          }}
        </div>
        <form
          class="grid grid-cols-1 gap-2 sm:grid-cols-4"
          data-testid="coop-boss-contribution-form"
          @submit.prevent="onSubmitContribution"
        >
          <input
            v-model.number="contribForm.damageDone"
            type="number"
            min="0"
            class="rounded border border-ink-300/40 bg-ink-900/50 px-2 py-1 text-sm"
            :placeholder="t('coopBoss.contribution.damagePlaceholder')"
            data-testid="coop-boss-damage-input"
          />
          <input
            v-model.number="contribForm.supportScore"
            type="number"
            min="0"
            class="rounded border border-ink-300/40 bg-ink-900/50 px-2 py-1 text-sm"
            :placeholder="t('coopBoss.contribution.supportPlaceholder')"
            data-testid="coop-boss-support-input"
          />
          <input
            v-model.number="contribForm.survivalSeconds"
            type="number"
            min="0"
            class="rounded border border-ink-300/40 bg-ink-900/50 px-2 py-1 text-sm"
            :placeholder="t('coopBoss.contribution.survivalPlaceholder')"
            data-testid="coop-boss-survival-input"
          />
          <button
            type="submit"
            class="rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
            :disabled="busy.contribute"
            data-testid="coop-boss-contribute-submit"
          >
            {{ t('coopBoss.contribution.submit') }}
          </button>
        </form>
      </div>

      <!-- Leader actions: finish / cancel -->
      <div
        v-if="
          run.status === 'LOBBY' || run.status === 'IN_PROGRESS'
        "
        class="flex flex-wrap gap-2"
        data-testid="coop-boss-leader-actions"
      >
        <button
          type="button"
          class="rounded border border-emerald-400/60 bg-emerald-900/40 px-3 py-1 text-xs uppercase tracking-widest text-emerald-100 disabled:opacity-50"
          :disabled="busy.finish"
          data-testid="coop-boss-finish-clear"
          @click="openConfirm('finishClear')"
        >
          {{ t('coopBoss.actions.finishClear') }}
        </button>
        <button
          type="button"
          class="rounded border border-red-400/60 bg-red-900/40 px-3 py-1 text-xs uppercase tracking-widest text-red-100 disabled:opacity-50"
          :disabled="busy.finish"
          data-testid="coop-boss-finish-fail"
          @click="openConfirm('finishFail')"
        >
          {{ t('coopBoss.actions.finishFail') }}
        </button>
        <button
          v-if="run.status === 'LOBBY'"
          type="button"
          class="rounded border border-ink-300/40 px-3 py-1 text-xs uppercase tracking-widest text-ink-200 disabled:opacity-50"
          :disabled="busy.cancel"
          data-testid="coop-boss-cancel"
          @click="openConfirm('cancel')"
        >
          {{ t('coopBoss.actions.cancel') }}
        </button>
      </div>

      <!-- Reward block: CLEARED with claim row, else preview if live -->
      <div
        v-if="run.status === 'CLEARED' && myReward"
        class="space-y-2 rounded border border-amber-400/40 bg-amber-900/20 p-3"
        data-testid="coop-boss-reward"
      >
        <h4 class="text-[11px] uppercase tracking-widest text-amber-200">
          {{ t('coopBoss.reward.title') }}
        </h4>
        <p class="text-[11px] text-amber-100/90">
          {{
            t('coopBoss.reward.previewLabel', {
              tier: t(`coopBoss.tier.${myReward.rewardTier}`),
            })
          }}
        </p>
        <dl
          v-if="myReward.rewardJson"
          class="grid grid-cols-3 gap-2 text-[11px] text-amber-100/80"
        >
          <div>
            {{ t('coopBoss.reward.linhThach') }}:
            {{ myReward.rewardJson.linhThach ?? 0 }}
          </div>
          <div>
            {{ t('coopBoss.reward.tienNgoc') }}:
            {{ myReward.rewardJson.tienNgoc ?? 0 }}
          </div>
          <div>
            {{ t('coopBoss.reward.exp') }}:
            {{ myReward.rewardJson.exp ?? 0 }}
          </div>
        </dl>
        <p
          class="text-[11px] uppercase tracking-widest text-ink-200"
          data-testid="coop-boss-reward-status"
        >
          {{ t(`coopBoss.reward.statusLabel.${myReward.status}`) }}
        </p>
        <button
          v-if="myReward.status === 'PENDING'"
          type="button"
          class="rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-100 disabled:opacity-50"
          :disabled="busy.claim"
          data-testid="coop-boss-claim"
          @click="onClaim"
        >
          {{ t('coopBoss.actions.claim') }}
        </button>
      </div>

      <!-- Live reward preview when active and contributed -->
      <div
        v-else-if="
          (run.status === 'LOBBY' || run.status === 'IN_PROGRESS') &&
            livePreview
        "
        class="rounded border border-ink-300/20 bg-ink-900/40 p-3 text-[11px] text-ink-300/80"
        data-testid="coop-boss-reward-preview"
      >
        <p>
          {{
            t('coopBoss.reward.previewLabel', {
              tier: t(`coopBoss.tier.${livePreview.tier}`),
            })
          }}
        </p>
        <dl class="mt-1 grid grid-cols-3 gap-2">
          <div>
            {{ t('coopBoss.reward.linhThach') }}:
            {{ livePreview.linhThach ?? 0 }}
          </div>
          <div>
            {{ t('coopBoss.reward.tienNgoc') }}:
            {{ livePreview.tienNgoc ?? 0 }}
          </div>
          <div>
            {{ t('coopBoss.reward.exp') }}:
            {{ livePreview.exp ?? 0 }}
          </div>
        </dl>
      </div>

      <!-- No reward row for caller when CLEARED -->
      <p
        v-else-if="run.status === 'CLEARED' && !myReward"
        class="text-[11px] text-ink-300/70"
        data-testid="coop-boss-no-reward"
      >
        {{ t('coopBoss.reward.noneForCaller') }}
      </p>
    </div>

    <ConfirmModal
      :open="confirmOpen"
      :title="confirmTitle"
      :message="confirmBody"
      test-id="coop-boss-confirm"
      @confirm="onConfirm"
      @cancel="
        confirmOpen = false;
        confirmKind = null;
      "
    />
  </div>
</template>
