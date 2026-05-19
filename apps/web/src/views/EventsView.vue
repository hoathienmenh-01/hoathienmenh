<script setup lang="ts">
/**
 * Phase 28.0 — Player Events View (Event Builder & Tier-Balanced
 * LiveOps Event System V2).
 *
 * Hiển thị:
 *   - tab "Tất cả": danh sách event đang active/scheduled (public summary
 *     + bracket của player + rewardTier effective).
 *   - tab "Cá nhân": personal milestone events (auto-trigger trên realm
 *     breakthrough). Player có thể claim nếu completed.
 *
 * Detail của 1 event mở dialog inline với 3 sub-section:
 *   - Mission list + progress + claim
 *   - Shop list (chỉ liệt kê — purchase wire qua PurchaseView future PR)
 *   - Ranking leaderboard (top 100 per bracket player thuộc về)
 *
 * Loading / error / empty state đầy đủ. KHÔNG mutation kinh tế trực tiếp
 * — claim / purchase đi qua server-authoritative endpoint.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  playerClaimMission,
  playerClaimPersonal,
  playerGetEvent,
  playerLeaderboard,
  playerListEvents,
  playerListMissions,
  playerListPersonal,
} from '@/api/eventBuilder';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import type {
  PublicEventSummary,
  EventBracketDef,
  EventMissionDef,
} from '@xuantoi/shared';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();

type Tab = 'all' | 'personal';
const tab = ref<Tab>('all');

const loading = ref(false);
const events = ref<PublicEventSummary[]>([]);
const characterId = ref<string>('');

const selectedKey = ref<string | null>(null);
const selected = ref<{
  event: PublicEventSummary;
  brackets: readonly EventBracketDef[];
  playerCtx: {
    bracket: EventBracketDef | null;
    bracketTier: number | null;
    rewardTier: number;
    tokenMultiplier: number;
    rankingEligible: boolean;
  };
} | null>(null);

const missionsByEvent = ref<
  Record<
    string,
    {
      defs: readonly EventMissionDef[];
      progress: ReadonlyArray<{
        missionKey: string;
        progressValue: number;
        targetValue: number;
        completedAt: string | null;
        claimedAt: string | null;
      }>;
    }
  >
>({});
const claimingMission = ref<string | null>(null);

const personalEntries = ref<
  ReadonlyArray<{
    id: string;
    eventKey: string;
    triggerType: string;
    triggerValue: number;
    expiresAt: string;
    claimedAt: string | null;
    completedAt: string | null;
  }>
>([]);
const claimingPersonal = ref<string | null>(null);

const leaderboard = ref<
  ReadonlyArray<{
    characterId: string;
    bracketKey: string | null;
    score: number;
    rank: number | null;
  }>
>([]);

async function refreshAll(): Promise<void> {
  loading.value = true;
  try {
    const data = await playerListEvents();
    events.value = [...data.events];
    characterId.value = data.characterId;
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('events.errors.loadFailed', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  } finally {
    loading.value = false;
  }
}

async function refreshPersonal(): Promise<void> {
  loading.value = true;
  try {
    const data = await playerListPersonal();
    personalEntries.value = data.entries;
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('events.errors.loadFailed', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  } finally {
    loading.value = false;
  }
}

async function openEvent(key: string): Promise<void> {
  selectedKey.value = key;
  try {
    const detail = await playerGetEvent(key);
    selected.value = {
      event: detail.event,
      brackets: detail.brackets,
      playerCtx: detail.playerCtx,
    };
    const m = await playerListMissions(key);
    missionsByEvent.value = {
      ...missionsByEvent.value,
      [key]: { defs: m.definitions, progress: m.progress },
    };
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('events.errors.loadFailed', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
    selectedKey.value = null;
    selected.value = null;
  }
}

function closeEvent(): void {
  selectedKey.value = null;
  selected.value = null;
  leaderboard.value = [];
}

async function claimMission(
  eventKey: string,
  missionKey: string,
): Promise<void> {
  if (claimingMission.value) return;
  claimingMission.value = missionKey;
  try {
    await playerClaimMission(eventKey, missionKey);
    toast.push({ type: 'success', text: t('events.mission.claimed') });
    // refresh progress
    const m = await playerListMissions(eventKey);
    missionsByEvent.value = {
      ...missionsByEvent.value,
      [eventKey]: { defs: m.definitions, progress: m.progress },
    };
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('events.mission.claimFailed', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  } finally {
    claimingMission.value = null;
  }
}

async function claimPersonal(rowId: string): Promise<void> {
  if (claimingPersonal.value) return;
  claimingPersonal.value = rowId;
  try {
    await playerClaimPersonal(rowId);
    toast.push({ type: 'success', text: t('events.personal.claimed') });
    await refreshPersonal();
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('events.personal.claimFailed', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  } finally {
    claimingPersonal.value = null;
  }
}

async function loadLeaderboard(rankingKey: string): Promise<void> {
  try {
    const data = await playerLeaderboard(
      rankingKey,
      selected.value?.playerCtx.bracket?.key,
    );
    leaderboard.value = data.entries;
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('events.errors.loadFailed', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  }
}

function fmtMs(ms: number): string {
  if (ms <= 0) return t('events.endedShort');
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await refreshAll();
});

const currentMissions = computed(() => {
  if (!selectedKey.value) return null;
  return missionsByEvent.value[selectedKey.value] ?? null;
});

function progressFor(missionKey: string): {
  progressValue: number;
  targetValue: number;
  completedAt: string | null;
  claimedAt: string | null;
} {
  const m = currentMissions.value?.progress.find(
    (p) => p.missionKey === missionKey,
  );
  return (
    m ?? {
      progressValue: 0,
      targetValue: 0,
      completedAt: null,
      claimedAt: null,
    }
  );
}
</script>

<template>
  <AppShell>
    <div class="events-view">
      <XTLuxHero
        eyebrow="SỰ KIỆN LIVEOPS"
        label="Sự Kiện"
        :title="t('events.title')"
        :subtitle="t('events.subtitle')"
        tone="seal"
        watermark-letter="S"
        breadcrumb="Sự Kiện"
        test-id="events-hero"
        class="mb-4"
      />

      <div class="space-y-2 mb-4" data-testid="events-role-section">
        <p class="text-xs text-ink-300 leading-relaxed" data-testid="events-role-hint">
          {{ t('events.roleHint') }}
        </p>
        <div class="flex flex-wrap gap-2 text-xs" data-testid="events-cross-nav">
          <router-link to="/missions" class="px-2 py-1 rounded bg-seal-900/40 text-seal-200 hover:bg-seal-800/50 transition">
            {{ t('events.crossNav.missions') }} — {{ t('events.crossNav.missionsDesc') }}
          </router-link>
          <router-link to="/leaderboard" class="px-2 py-1 rounded bg-seal-900/40 text-seal-200 hover:bg-seal-800/50 transition">
            {{ t('events.crossNav.leaderboard') }} — {{ t('events.crossNav.leaderboardDesc') }}
          </router-link>
        </div>
      </div>

      <nav class="tabs">
        <button
          :class="['tab', { active: tab === 'all' }]"
          @click="
            tab = 'all';
            void refreshAll();
          "
        >
          {{ t('events.tab.all') }}
        </button>
        <button
          :class="['tab', { active: tab === 'personal' }]"
          @click="
            tab = 'personal';
            void refreshPersonal();
          "
        >
          {{ t('events.tab.personal') }}
        </button>
      </nav>

      <!-- TAB ALL -->
      <section v-if="tab === 'all'" class="events-list">
        <div v-if="loading" class="muted">{{ t('events.loading') }}</div>
        <div v-else-if="events.length === 0" class="muted">
          {{ t('events.empty') }}
        </div>
        <div v-else class="cards">
          <article
            v-for="e in events"
            :key="e.key"
            class="card"
            @click="openEvent(e.key)"
          >
            <h3>{{ e.name }}</h3>
            <p class="muted small">{{ e.description }}</p>
            <div class="meta">
              <span :class="['badge', e.status.toLowerCase()]">
                {{ e.status }}
              </span>
              <span class="muted small">
                {{ t('events.eventType') }}: {{ e.eventType }}
              </span>
              <span class="muted small">
                {{ t('events.remaining') }}: {{ fmtMs(e.msRemaining) }}
              </span>
            </div>
            <div v-if="e.myBracketKey" class="meta">
              <span class="muted small">
                {{ t('events.myBracket') }}: {{ e.myBracketKey }}
              </span>
              <span v-if="e.myEffectiveRewardTier" class="muted small">
                {{ t('events.myRewardTier') }}: {{ e.myEffectiveRewardTier }}
              </span>
            </div>
          </article>
        </div>
      </section>

      <!-- TAB PERSONAL -->
      <section v-if="tab === 'personal'" class="events-list">
        <div v-if="loading" class="muted">{{ t('events.loading') }}</div>
        <div v-else-if="personalEntries.length === 0" class="muted">
          {{ t('events.personal.empty') }}
        </div>
        <div v-else class="cards">
          <article v-for="p in personalEntries" :key="p.id" class="card">
            <h3>{{ p.eventKey }}</h3>
            <p class="muted small">
              {{ t('events.personal.trigger', { type: p.triggerType }) }}:
              {{ p.triggerValue }}
            </p>
            <p class="muted small">
              {{ t('events.personal.expiresAt') }}:
              {{ new Date(p.expiresAt).toLocaleString() }}
            </p>
            <div class="actions">
              <MButton
                :disabled="
                  claimingPersonal === p.id ||
                    !p.completedAt ||
                    p.claimedAt !== null
                "
                @click="claimPersonal(p.id)"
              >
                <template v-if="p.claimedAt">
                  {{ t('events.personal.alreadyClaimed') }}
                </template>
                <template v-else-if="!p.completedAt">
                  {{ t('events.personal.notCompleted') }}
                </template>
                <template v-else>
                  {{ t('events.personal.claim') }}
                </template>
              </MButton>
            </div>
          </article>
        </div>
      </section>

      <!-- DETAIL MODAL -->
      <div v-if="selected" class="modal">
        <div class="modal-body">
          <header class="modal-header">
            <h2>{{ selected.event.name }}</h2>
            <button class="close" @click="closeEvent">×</button>
          </header>
          <p class="muted">{{ selected.event.description }}</p>

          <section v-if="selected.playerCtx.bracket" class="bracket-info">
            <strong>{{ t('events.detail.yourBracket') }}:</strong>
            {{ selected.playerCtx.bracket.name }}
            ({{ t('events.detail.tier') }} {{ selected.playerCtx.bracketTier }})
            — {{ t('events.detail.rewardTier') }}
            {{ selected.playerCtx.rewardTier }}
            — {{ t('events.detail.tokenMul') }}
            ×{{ selected.playerCtx.tokenMultiplier.toFixed(2) }}
            <MButton
              v-if="selected.event.eventShopKey"
              @click="loadLeaderboard(selected.event.eventShopKey)"
            >
              {{ t('events.detail.loadLeaderboard') }}
            </MButton>
          </section>

          <section class="missions">
            <h3>{{ t('events.detail.missions') }}</h3>
            <div
              v-if="!currentMissions || currentMissions.defs.length === 0"
              class="muted"
            >
              {{ t('events.detail.noMissions') }}
            </div>
            <ul v-else class="mission-list">
              <li v-for="m in currentMissions.defs" :key="m.key">
                <strong>{{ m.name }}</strong>
                <span class="muted small"> ({{ m.missionType }})</span>
                <div class="muted small">{{ m.description }}</div>
                <div class="progress">
                  {{ progressFor(m.key).progressValue }} /
                  {{ m.targetValue }}
                </div>
                <MButton
                  :disabled="
                    claimingMission === m.key ||
                      !progressFor(m.key).completedAt ||
                      progressFor(m.key).claimedAt !== null
                  "
                  @click="claimMission(selected.event.key, m.key)"
                >
                  <template v-if="progressFor(m.key).claimedAt">
                    {{ t('events.mission.alreadyClaimed') }}
                  </template>
                  <template v-else-if="!progressFor(m.key).completedAt">
                    {{ t('events.mission.inProgress') }}
                  </template>
                  <template v-else>
                    {{ t('events.mission.claim') }}
                  </template>
                </MButton>
              </li>
            </ul>
          </section>

          <section v-if="leaderboard.length > 0" class="leaderboard">
            <h3>{{ t('events.detail.leaderboard') }}</h3>
            <ol>
              <li v-for="e in leaderboard" :key="e.characterId">
                <span class="rank">#{{ e.rank ?? '-' }}</span>
                <span class="cid muted small">{{ e.characterId }}</span>
                <span class="score">{{ e.score }}</span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.events-view {
  padding: 1rem;
  max-width: 1100px;
  margin: 0 auto;
}
.events-header h1 {
  margin: 0 0 0.25rem;
}
.muted {
  color: var(--text-muted, #8a8a8a);
}
.small {
  font-size: 0.875em;
}
.tabs {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
.tab {
  background: transparent;
  border: 1px solid var(--border, #ccc);
  color: inherit;
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  cursor: pointer;
}
.tab.active {
  background: var(--accent, #4f46e5);
  color: #fff;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}
.card {
  background: var(--surface, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
}
.card h3 {
  margin: 0 0 0.5rem;
}
.meta {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}
.badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.75em;
  background: #555;
  color: #fff;
}
.badge.active {
  background: #22c55e;
}
.badge.scheduled {
  background: #3b82f6;
}
.badge.paused {
  background: #f59e0b;
}
.badge.ended,
.badge.finalized,
.badge.archived {
  background: #6b7280;
}
.actions {
  margin-top: 0.6rem;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: 50;
}
.modal-body {
  background: var(--surface, #1a1a1a);
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 720px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.close {
  background: transparent;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: inherit;
}
.mission-list {
  list-style: none;
  padding: 0;
}
.mission-list li {
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  padding: 0.6rem;
  margin: 0.5rem 0;
}
.progress {
  font-weight: 600;
  margin: 0.3rem 0;
}
.bracket-info {
  margin: 0.8rem 0;
  padding: 0.6rem;
  background: var(--surface-alt, #222);
  border-radius: 4px;
}
.leaderboard ol {
  list-style: none;
  padding: 0;
}
.leaderboard li {
  display: flex;
  gap: 1rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border, #333);
}
.rank {
  font-weight: 700;
  width: 3rem;
}
.score {
  margin-left: auto;
  font-weight: 600;
}
</style>
