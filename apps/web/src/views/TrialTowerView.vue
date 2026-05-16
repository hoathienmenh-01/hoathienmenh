<script setup lang="ts">
/**
 * Phase 26.5 — Trial Tower view (Đăng Tiên Tháp / Linh Khí Tháp / Huyết
 * Thể Tháp).
 *
 * `GET /world/towers` + `POST /world/towers/:towerKey/attempt`. Hiển
 * thị highest floor, milestone, season highest, attempt floor input.
 * Bao trùm 4 state UI MODULE RULE: loading / error+reload / empty / list.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorldContentStore } from '@/stores/worldContent';
import { useToastStore } from '@/stores/toast';
import type { TrialTowerView } from '@/api/worldContent';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';

const { t, locale } = useI18n();
const store = useWorldContentStore();
const toast = useToastStore();

const isLoaded = computed(() => store.loaded['towers'] === true);
const towers = computed(() => store.towers);
const lastResult = computed(() => store.lastTowerResult);
const reloadFailed = ref(false);

const tab = ref<TrialTowerView['towerType']>('DANG_TIEN_THAP');

watch(towers, (list) => {
  if (list.length === 0) return;
  const has = list.find((tw) => tw.towerType === tab.value);
  if (!has) tab.value = list[0]!.towerType;
});

const activeTower = computed<TrialTowerView | null>(
  () => towers.value.find((tw) => tw.towerType === tab.value) ?? null,
);

const floorInput = ref<Record<string, number>>({});

function nextFloor(tower: TrialTowerView): number {
  return Math.max(1, tower.highestFloorCleared + 1);
}

function currentFloor(tower: TrialTowerView): number {
  return floorInput.value[tower.key] ?? nextFloor(tower);
}

function pickName(t1: TrialTowerView): string {
  return locale.value === 'en' ? t1.nameEn : t1.nameVi;
}

function pickDesc(t1: TrialTowerView): string {
  return locale.value === 'en' ? t1.descriptionEn : t1.descriptionVi;
}

async function refresh(): Promise<void> {
  reloadFailed.value = false;
  const err = await store.fetchTowers();
  if (err) reloadFailed.value = true;
}

onMounted(() => {
  if (!isLoaded.value) refresh();
});

async function onAttempt(tower: TrialTowerView): Promise<void> {
  const floor = currentFloor(tower);
  const err = await store.attemptTower(tower.key, floor);
  if (err) {
    const key = `worldContent.errors.${err}`;
    const text = t(key);
    toast.push({ type: 'error', text: text === key ? t('worldContent.errors.UNKNOWN') : text });
    return;
  }
  const r = lastResult.value;
  if (r && r.success) {
    if (r.isFirstClear) {
      toast.push({ type: 'success', text: t('worldContent.tower.firstClear') });
    }
    if (r.milestoneClaimed) {
      toast.push({ type: 'success', text: t('worldContent.tower.milestone') });
    }
  } else if (r) {
    toast.push({ type: 'info', text: t('worldContent.tower.failure') });
  }
}

function attemptBusy(towerKey: string, floor: number): boolean {
  return store.busy(`tower:${towerKey}:${floor}`);
}
</script>

<template>
  <AppShell>
    <section class="trial-tower" data-testid="trial-tower-view">
      <XTLuxHero
        eyebrow="THÍ LUYỆN THÁP"
        label="Thí Luyện Tháp"
        :title="t('worldContent.tower.title')"
        :subtitle="t('worldContent.tower.subtitle')"
        tone="seal"
        watermark-letter="T"
        breadcrumb="Chiến Đạo · Tháp"
        test-id="trial-tower-hero"
      >
        <XTPageEyebrow caps="THÍ LUYỆN THÁP" label="Thí Luyện Tháp" class="sr-only" />
      </XTLuxHero>

      <div
        v-if="reloadFailed && towers.length === 0"
        class="trial-tower__state trial-tower__state--error"
        data-testid="trial-tower-error"
      >
        <p>{{ t('worldContent.reloadError') }}</p>
        <button @click="refresh">{{ t('worldContent.reload') }}</button>
      </div>

      <div
        v-else-if="towers.length === 0 && !isLoaded"
        class="trial-tower__state"
        data-testid="trial-tower-loading"
      >
        {{ t('worldContent.tower.loading') }}
      </div>

      <div
        v-else-if="towers.length === 0"
        class="trial-tower__state"
        data-testid="trial-tower-empty"
      >
        {{ t('worldContent.tower.empty') }}
      </div>

      <template v-else>
        <nav class="trial-tower__tabs">
          <button
            v-for="tw in towers"
            :key="tw.key"
            :class="{ active: tab === tw.towerType }"
            :data-testid="`trial-tower-tab-${tw.towerType}`"
            @click="tab = tw.towerType"
          >
            {{ pickName(tw) }}
          </button>
        </nav>

        <article
          v-if="activeTower"
          class="trial-tower__panel"
          data-testid="trial-tower-list"
        >
          <header>
            <h2>{{ pickName(activeTower) }}</h2>
            <p>{{ pickDesc(activeTower) }}</p>
          </header>

          <dl class="trial-tower__meta">
            <div>
              <dt>{{ t('worldContent.tower.highest') }}</dt>
              <dd>{{ activeTower.highestFloorCleared }}</dd>
            </div>
            <div>
              <dt>{{ t('worldContent.tower.season') }}</dt>
              <dd>{{ activeTower.seasonHighestFloor }}</dd>
            </div>
            <div>
              <dt>{{ t('worldContent.tower.unlockedAt') }}</dt>
              <dd>{{ activeTower.unlockRealmOrder }}</dd>
            </div>
            <div>
              <dt>{{ t('worldContent.tower.maxFloor') }}</dt>
              <dd>
                {{
                  activeTower.infiniteScaling
                    ? t('worldContent.tower.infinite')
                    : activeTower.maxGeneratedFloor
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t('worldContent.tower.dailyAttempts') }}</dt>
              <dd>{{ activeTower.dailyAttempts }}</dd>
            </div>
          </dl>

          <div v-if="!activeTower.unlocked" class="trial-tower__locked">
            {{ t('worldContent.tower.locked') }}
          </div>

          <div v-else class="trial-tower__attempt">
            <label>
              {{ t('worldContent.tower.floor') }}:
              <input
                v-model.number="floorInput[activeTower.key]"
                type="number"
                min="1"
                :max="activeTower.maxGeneratedFloor ?? 100000"
                :placeholder="String(nextFloor(activeTower))"
                :data-testid="`trial-tower-floor-input-${activeTower.key}`"
              />
            </label>
            <button
              :disabled="attemptBusy(activeTower.key, currentFloor(activeTower))"
              :data-testid="`trial-tower-attempt-${activeTower.key}`"
              @click="onAttempt(activeTower)"
            >
              {{ t('worldContent.tower.attempt') }}
            </button>
          </div>

          <section
            v-if="lastResult && lastResult.towerKey === activeTower.key"
            class="trial-tower__result"
            data-testid="trial-tower-last-result"
          >
            <h3>{{ t('worldContent.tower.lastResult') }}</h3>
            <p>
              {{ t('worldContent.tower.floor') }} {{ lastResult.floor }} —
              {{
                lastResult.success
                  ? t('worldContent.tower.success')
                  : t('worldContent.tower.failure')
              }}
            </p>
            <p>
              {{ t('worldContent.tower.requiredPower') }}: {{ lastResult.requiredPower }} ·
              {{ t('worldContent.tower.battlePower') }}: {{ lastResult.battlePower }}
            </p>
            <p v-if="lastResult.isFirstClear">
              {{ t('worldContent.tower.firstClear') }}
            </p>
            <p v-if="lastResult.milestoneClaimed">
              {{ t('worldContent.tower.milestone') }}
            </p>
            <p
              v-if="
                lastResult.reward.linhThach === 0 &&
                  lastResult.reward.exp === 0 &&
                  lastResult.reward.trialPoints === 0 &&
                  lastResult.success &&
                  !lastResult.isFirstClear &&
                  !lastResult.milestoneClaimed
              "
            >
              {{ t('worldContent.tower.noRewardRepeat') }}
            </p>
            <p v-else>
              {{ t('worldContent.tower.rewardLinhThach') }}: {{ lastResult.reward.linhThach }} ·
              {{ t('worldContent.tower.rewardExp') }}: {{ lastResult.reward.exp }} ·
              {{ t('worldContent.tower.rewardTrialPoints') }}: {{ lastResult.reward.trialPoints }}
            </p>
          </section>
        </article>
      </template>
    </section>
  </AppShell>
</template>

<style scoped>
.trial-tower {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.trial-tower__tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.trial-tower__tabs button {
  padding: 6px 12px;
  background: var(--surface, #1c1f24);
  color: var(--fg, #e7e9ee);
  border: 1px solid var(--border, #2c3038);
  border-radius: 6px;
  cursor: pointer;
}
.trial-tower__tabs button.active {
  background: var(--accent, #3a6cf0);
  color: #fff;
}
.trial-tower__state {
  padding: 24px;
  background: var(--surface, #1c1f24);
  border-radius: 8px;
  text-align: center;
}
.trial-tower__state--error {
  border: 1px solid var(--danger, #b94343);
}
.trial-tower__panel {
  background: var(--surface, #1c1f24);
  padding: 16px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.trial-tower__meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
  margin: 0;
}
.trial-tower__meta dt {
  font-size: 0.8em;
  color: var(--muted, #8a90a0);
}
.trial-tower__meta dd {
  margin: 0;
  font-weight: 600;
}
.trial-tower__locked {
  padding: 12px;
  background: var(--muted-bg, #2c3038);
  border-radius: 6px;
  text-align: center;
}
.trial-tower__attempt {
  display: flex;
  gap: 8px;
  align-items: center;
}
.trial-tower__attempt input {
  width: 100px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, #2c3038);
  background: var(--bg, #0e1014);
  color: var(--fg, #e7e9ee);
}
.trial-tower__attempt button {
  padding: 6px 12px;
  background: var(--accent, #3a6cf0);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.trial-tower__attempt button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.trial-tower__result {
  padding: 12px;
  background: var(--bg, #0e1014);
  border-radius: 6px;
}
</style>
