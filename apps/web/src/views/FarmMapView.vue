<script setup lang="ts">
/**
 * Phase 26.5 — Farm Map V2 view.
 *
 * Quản lý farm map lifecycle (server-authoritative, không bypass cap):
 *   - `GET  /world/farm-maps`                – list map đã/chưa unlock.
 *   - `POST /world/farm/:mapKey/start`       – start session.
 *   - `POST /world/farm/sessions/:id/claim`  – claim reward.
 *
 * Bao trùm 4 state UI MODULE RULE: loading / error+reload / empty / list.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorldContentStore } from '@/stores/worldContent';
import { useToastStore } from '@/stores/toast';
import type { FarmMapView } from '@/api/worldContent';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';

const { t, locale } = useI18n();
const store = useWorldContentStore();
const toast = useToastStore();

const isLoaded = computed(() => store.loaded['farmMaps'] === true);
const maps = computed(() => store.farmMaps);
const session = computed(() => store.activeFarmSession);
const lastClaim = computed(() => store.lastFarmClaim);
const reloadFailed = ref(false);

function pickName(m: FarmMapView): string {
  return locale.value === 'en' ? m.nameEn : m.nameVi;
}

async function refresh(): Promise<void> {
  reloadFailed.value = false;
  const err = await store.fetchFarmMaps();
  if (err) reloadFailed.value = true;
}

onMounted(() => {
  if (!isLoaded.value) refresh();
});

async function onStart(map: FarmMapView): Promise<void> {
  const err = await store.startFarm(map.key);
  if (err) {
    const key = `worldContent.errors.${err}`;
    const text = t(key);
    toast.push({ type: 'error', text: text === key ? t('worldContent.errors.UNKNOWN') : text });
  } else {
    toast.push({ type: 'success', text: t('worldContent.farm.active') });
  }
}

async function onClaim(sessionId: string): Promise<void> {
  const err = await store.claimFarm(sessionId);
  if (err) {
    const key = `worldContent.errors.${err}`;
    const text = t(key);
    toast.push({ type: 'error', text: text === key ? t('worldContent.errors.UNKNOWN') : text });
  } else {
    toast.push({ type: 'success', text: t('worldContent.farm.claim') });
  }
}

function startBusy(mapKey: string): boolean {
  return store.busy(`farmStart:${mapKey}`);
}

function claimBusy(sessionId: string): boolean {
  return store.busy(`farmClaim:${sessionId}`);
}
</script>

<template>
  <AppShell>
    <section class="farm-map" data-testid="farm-map-view">
      <XTSealFrame
        tone="jade"
        corner-ornaments="❖❧❖❧"
        watermark-letter="M"
        rounded="xl"
        inset="tight"
        test-id="farm-map-view-seal-frame"
        aria-label="Linh Điền Tồn Dưỡng hero frame"
      >
        <header class="farm-map__header">
          <XTPageEyebrow caps="LINH ĐIỀN TỒN DƯỠNG" label="Linh Điền Tồn Dưỡng" />
          <h1 class="mt-1">{{ t('worldContent.farm.title') }}</h1>
          <p>{{ t('worldContent.farm.subtitle') }}</p>
        </header>
      </XTSealFrame>

      <div
        v-if="reloadFailed && maps.length === 0"
        class="farm-map__state farm-map__state--error"
        data-testid="farm-map-error"
      >
        <p>{{ t('worldContent.reloadError') }}</p>
        <button @click="refresh">{{ t('worldContent.reload') }}</button>
      </div>

      <div
        v-else-if="maps.length === 0 && !isLoaded"
        class="farm-map__state"
        data-testid="farm-map-loading"
      >
        {{ t('worldContent.farm.loading') }}
      </div>

      <div
        v-else-if="maps.length === 0"
        class="farm-map__state"
        data-testid="farm-map-empty"
      >
        {{ t('worldContent.farm.empty') }}
      </div>

      <ul v-else class="farm-map__list" data-testid="farm-map-list">
        <li
          v-for="m in maps"
          :key="m.key"
          class="farm-map__item"
          :data-testid="`farm-map-item-${m.key}`"
        >
          <div class="farm-map__item-head">
            <div>
              <h2>{{ pickName(m) }}</h2>
              <small>
                {{ t('worldContent.farm.sourceTier') }}: {{ m.sourceTier }} ·
                {{ t('worldContent.farm.realm') }} {{ m.unlockRealmOrder }}
              </small>
            </div>
            <span v-if="!m.unlocked" class="farm-map__badge">
              {{ t('worldContent.farm.locked') }}
            </span>
            <span
              v-else-if="session && session.farmMapKey === m.key"
              class="farm-map__badge farm-map__badge--active"
            >
              {{ t('worldContent.farm.active') }}
            </span>
          </div>

          <dl class="farm-map__meta">
            <div>
              <dt>{{ t('worldContent.farm.free') }}</dt>
              <dd>{{ m.freeSessionMinutes }} {{ t('worldContent.farm.minutes') }}</dd>
            </div>
            <div>
              <dt>{{ t('worldContent.farm.session') }}</dt>
              <dd>{{ m.sessionLimitMinutes }} {{ t('worldContent.farm.minutes') }}</dd>
            </div>
            <div>
              <dt>{{ t('worldContent.farm.maxMinutes') }}</dt>
              <dd>{{ m.maxSessionMinutes }} {{ t('worldContent.farm.minutes') }}</dd>
            </div>
            <div>
              <dt>{{ t('worldContent.farm.monster') }}</dt>
              <dd>{{ m.monsterPoolSize }}</dd>
            </div>
            <div>
              <dt>{{ t('worldContent.farm.opportunity') }}</dt>
              <dd>{{ m.opportunityPoolSize }}</dd>
            </div>
          </dl>

          <div class="farm-map__actions">
            <button
              :disabled="
                !m.unlocked ||
                  startBusy(m.key) ||
                  (session !== null && session.farmMapKey === m.key)
              "
              :data-testid="`farm-map-start-${m.key}`"
              @click="onStart(m)"
            >
              {{ t('worldContent.farm.start') }}
            </button>
            <button
              v-if="session && session.farmMapKey === m.key"
              :disabled="claimBusy(session.id)"
              :data-testid="`farm-map-claim-${m.key}`"
              @click="onClaim(session.id)"
            >
              {{ t('worldContent.farm.claim') }}
            </button>
          </div>
        </li>
      </ul>

      <section
        v-if="lastClaim"
        class="farm-map__last-claim"
        data-testid="farm-map-last-claim"
      >
        <h3>{{ t('worldContent.farm.lastClaim') }}</h3>
        <p>
          {{ t('worldContent.farm.lastClaimMinutes', { n: lastClaim.minutesProcessed }) }} ·
          {{ t('worldContent.farm.rewardLinhThach') }} {{ lastClaim.rewards.linhThach }} ·
          {{ t('worldContent.farm.rewardExp') }} {{ lastClaim.rewards.exp }}
        </p>
        <p v-if="lastClaim.capUsage.minutesUsed >= lastClaim.capUsage.dailyLimit">
          {{ t('worldContent.farm.rewardCappedNote') }}
        </p>
      </section>
    </section>
  </AppShell>
</template>

<style scoped>
.farm-map {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.farm-map__state {
  padding: 24px;
  background: var(--surface, #1c1f24);
  border-radius: 8px;
  text-align: center;
}
.farm-map__state--error {
  border: 1px solid var(--danger, #b94343);
}
.farm-map__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.farm-map__item {
  background: var(--surface, #1c1f24);
  padding: 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.farm-map__item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.farm-map__meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  margin: 0;
}
.farm-map__meta dt {
  font-size: 0.8em;
  color: var(--muted, #8a90a0);
}
.farm-map__meta dd {
  margin: 0;
  font-weight: 600;
}
.farm-map__badge {
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--muted-bg, #2c3038);
  font-size: 0.75em;
}
.farm-map__badge--active {
  background: #1f6b3c;
  color: #fff;
}
.farm-map__actions {
  display: flex;
  gap: 8px;
}
.farm-map__actions button {
  padding: 6px 12px;
  background: var(--accent, #3a6cf0);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.farm-map__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.farm-map__last-claim {
  padding: 12px;
  background: var(--surface, #1c1f24);
  border-radius: 8px;
}
</style>
