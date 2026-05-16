<script setup lang="ts">
/**
 * Phase 29.0 — Player PvP View.
 *
 * Hiển thị:
 *   - Defense Profile panel: load current, label, "Lưu thế trận" (rebuild
 *     snapshot từ stats hiện tại).
 *   - Challenge panel: input defenderCharacterId, chọn mode (DUEL hoặc
 *     FRIENDLY_SPARRING), submit → hiển thị kết quả.
 *   - Battle log list: 20 trận gần nhất, filter mode.
 *
 * KHÔNG include ARENA — dùng `ArenaView.vue` riêng.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  challengePvp,
  getDefenseProfile,
  getPvpPolicy,
  listBattleLogs,
  upsertDefenseProfile,
  type PvpBattleSummary,
  type PvpChallengeResult,
} from '@/api/pvp';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import MButton from '@/components/ui/MButton.vue';
import type {
  PvpBalancePolicy,
  PvpDefenseProfileDef,
  PvpMode,
} from '@xuantoi/shared';

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(false);
const policy = ref<PvpBalancePolicy | null>(null);
const defense = ref<PvpDefenseProfileDef | null>(null);
const defenseLabel = ref('');

const challengeForm = ref({
  defenderCharacterId: '',
  mode: 'DUEL' as 'DUEL' | 'FRIENDLY_SPARRING',
});
const lastResult = ref<PvpChallengeResult | null>(null);

const logs = ref<PvpBattleSummary[]>([]);
const logFilter = ref<PvpMode | ''>('');

const submittingDefense = ref(false);
const submittingChallenge = ref(false);

async function refresh() {
  loading.value = true;
  try {
    const [pol, def, logsResp] = await Promise.all([
      getPvpPolicy(),
      getDefenseProfile(),
      listBattleLogs({ limit: 20 }),
    ]);
    policy.value = pol;
    defense.value = def;
    defenseLabel.value = def?.label ?? '';
    logs.value = logsResp.logs;
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, 'pvp.errors.load') });
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
});

async function saveDefense() {
  if (submittingDefense.value) return;
  submittingDefense.value = true;
  try {
    defense.value = await upsertDefenseProfile({
      label: defenseLabel.value || null,
    });
    toast.push({ type: 'success', text: t('pvp.toast.defenseSaved') });
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, 'pvp.errors.defenseSave') });
  } finally {
    submittingDefense.value = false;
  }
}

async function submitChallenge() {
  if (submittingChallenge.value) return;
  if (!challengeForm.value.defenderCharacterId.trim()) {
    toast.push({ type: 'error', text: t('pvp.errors.targetRequired') });
    return;
  }
  submittingChallenge.value = true;
  try {
    lastResult.value = await challengePvp({
      defenderCharacterId: challengeForm.value.defenderCharacterId.trim(),
      mode: challengeForm.value.mode,
      idempotencyKey: `client-${Date.now()}`,
    });
    toast.push({
      type: 'success',
      text: t('pvp.toast.challengeResolved', { result: lastResult.value.result }),
    });
    // Refresh logs sau khi challenge.
    const logsResp = await listBattleLogs({ limit: 20 });
    logs.value = logsResp.logs;
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, 'pvp.errors.challenge') });
  } finally {
    submittingChallenge.value = false;
  }
}

async function applyFilter() {
  try {
    const logsResp = await listBattleLogs({
      limit: 20,
      mode: logFilter.value || undefined,
    });
    logs.value = logsResp.logs;
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, 'pvp.errors.load') });
  }
}

const policyHints = computed(() => {
  if (!policy.value) return [];
  return [
    {
      key: 'maxDailyChallenge',
      value: policy.value.maxDailyChallenge,
    },
    {
      key: 'sameTargetCooldownMinutes',
      value: policy.value.sameTargetCooldownMinutes,
    },
    {
      key: 'powerGapWarning',
      value: policy.value.powerGapWarningThreshold.toFixed(2) + 'x',
    },
    {
      key: 'powerGapBlock',
      value: policy.value.powerGapMatchBlockThreshold.toFixed(2) + 'x',
    },
  ];
});
</script>

<template>
  <AppShell>
    <section data-test="pvp-view" class="pvp-view">
      <XTSealFrame
        tone="seal"
        corner-ornaments="◆✦◆✦"
        watermark-letter="C"
        rounded="xl"
        inset="tight"
        test-id="pvp-view-seal-frame"
        aria-label="Sát Phạt Tranh Hung hero frame"
      >
        <header class="pvp-view__header">
          <XTPageEyebrow caps="SÁT PHẠT TRANH HUNG" label="Sát Phạt Tranh Hung" />
          <h1>{{ t('pvp.title') }}</h1>
          <p class="pvp-view__intro">{{ t('pvp.intro') }}</p>
        </header>
      </XTSealFrame>

      <div v-if="loading && !policy" class="pvp-view__loading" data-test="pvp-loading">
        {{ t('pvp.loading') }}
      </div>

      <!-- Policy hints -->
      <section v-if="policy" class="pvp-view__panel" data-test="pvp-policy">
        <h2>{{ t('pvp.policy.title') }}</h2>
        <ul class="pvp-view__hints">
          <li v-for="h in policyHints" :key="h.key">
            <strong>{{ t(`pvp.policy.${h.key}`) }}:</strong> {{ h.value }}
          </li>
        </ul>
      </section>

      <!-- Defense profile -->
      <section class="pvp-view__panel" data-test="pvp-defense">
        <h2>{{ t('pvp.defense.title') }}</h2>
        <p class="pvp-view__hint">{{ t('pvp.defense.hint') }}</p>
        <div v-if="defense" class="pvp-view__defense-summary">
          <div>
            <strong>{{ t('pvp.defense.snapshotPower') }}:</strong>
            {{ defense.snapshot.totalPower }}
          </div>
          <div>
            <strong>{{ t('pvp.defense.snapshotRealm') }}:</strong>
            {{ defense.snapshot.realmKey ?? '—' }}
            <span v-if="defense.snapshot.realmStage"
            >stage {{ defense.snapshot.realmStage }}</span
            >
          </div>
          <div>
            <strong>{{ t('pvp.defense.updatedAt') }}:</strong>
            {{ new Date(defense.updatedAt).toLocaleString() }}
          </div>
        </div>
        <div v-else class="pvp-view__empty" data-test="pvp-defense-empty">
          {{ t('pvp.defense.empty') }}
        </div>
        <div class="pvp-view__form-row">
          <label for="pvp-defense-label">{{ t('pvp.defense.label') }}</label>
          <input
            id="pvp-defense-label"
            v-model="defenseLabel"
            type="text"
            maxlength="60"
            :placeholder="t('pvp.defense.labelPlaceholder')"
          />
          <MButton
            data-test="pvp-defense-save"
            :disabled="submittingDefense"
            @click="saveDefense"
          >
            {{ t('pvp.defense.save') }}
          </MButton>
        </div>
      </section>

      <!-- Challenge -->
      <section class="pvp-view__panel" data-test="pvp-challenge">
        <h2>{{ t('pvp.challenge.title') }}</h2>
        <p class="pvp-view__hint">{{ t('pvp.challenge.hint') }}</p>
        <div class="pvp-view__form-row">
          <label for="pvp-challenge-target">{{ t('pvp.challenge.target') }}</label>
          <input
            id="pvp-challenge-target"
            v-model="challengeForm.defenderCharacterId"
            type="text"
            :placeholder="t('pvp.challenge.targetPlaceholder')"
          />
        </div>
        <div class="pvp-view__form-row">
          <label for="pvp-challenge-mode">{{ t('pvp.challenge.mode') }}</label>
          <select id="pvp-challenge-mode" v-model="challengeForm.mode">
            <option value="DUEL">{{ t('pvp.modes.DUEL') }}</option>
            <option value="FRIENDLY_SPARRING">{{ t('pvp.modes.FRIENDLY_SPARRING') }}</option>
          </select>
          <MButton
            data-test="pvp-challenge-submit"
            :disabled="submittingChallenge"
            @click="submitChallenge"
          >
            {{ t('pvp.challenge.submit') }}
          </MButton>
        </div>
        <div
          v-if="lastResult"
          class="pvp-view__result"
          data-test="pvp-challenge-result"
        >
          <h3>{{ t('pvp.challenge.lastResult') }}</h3>
          <ul>
            <li>
              <strong>{{ t('pvp.challenge.result') }}:</strong>
              {{ lastResult.result }}
            </li>
            <li>
              <strong>{{ t('pvp.challenge.powerGap') }}:</strong>
              {{ lastResult.powerGap.toFixed(2) }}x
            </li>
            <li>
              <strong>{{ t('pvp.challenge.rewardGranted') }}:</strong>
              {{ lastResult.rewardGranted ? '✓' : '—' }}
            </li>
            <li v-if="lastResult.ratingChange">
              <strong>{{ t('pvp.challenge.ratingDelta') }}:</strong>
              attacker {{ lastResult.ratingChange.attackerDelta }} / defender
              {{ lastResult.ratingChange.defenderDelta }}
            </li>
          </ul>
        </div>
      </section>

      <!-- Battle logs -->
      <section class="pvp-view__panel" data-test="pvp-logs">
        <h2>{{ t('pvp.logs.title') }}</h2>
        <div class="pvp-view__form-row">
          <label for="pvp-log-filter">{{ t('pvp.logs.filter') }}</label>
          <select id="pvp-log-filter" v-model="logFilter" @change="applyFilter">
            <option value="">{{ t('pvp.logs.all') }}</option>
            <option value="DUEL">DUEL</option>
            <option value="FRIENDLY_SPARRING">FRIENDLY_SPARRING</option>
            <option value="EVENT_PVP">EVENT_PVP</option>
            <option value="SECT_WAR">SECT_WAR</option>
            <option value="TERRITORY_WAR">TERRITORY_WAR</option>
          </select>
        </div>
        <div v-if="logs.length === 0" class="pvp-view__empty" data-test="pvp-logs-empty">
          {{ t('pvp.logs.empty') }}
        </div>
        <table v-else class="pvp-view__table">
          <thead>
            <tr>
              <th>{{ t('pvp.logs.mode') }}</th>
              <th>{{ t('pvp.logs.result') }}</th>
              <th>{{ t('pvp.logs.powerGap') }}</th>
              <th>{{ t('pvp.logs.reward') }}</th>
              <th>{{ t('pvp.logs.createdAt') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id" data-test="pvp-log-row">
              <td>{{ l.mode }}</td>
              <td>{{ l.result ?? '—' }}</td>
              <td>{{ l.powerGap.toFixed(2) }}x</td>
              <td>{{ l.rewardGranted ? '✓' : '—' }}</td>
              <td>{{ new Date(l.createdAt).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </section>
  </AppShell>
</template>

<style scoped>
.pvp-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
}
.pvp-view__header h1 {
  font-size: 24px;
  margin: 0 0 6px;
}
.pvp-view__intro {
  color: #888;
  font-size: 14px;
}
.pvp-view__panel {
  background: #1c1c20;
  padding: 16px;
  border-radius: 8px;
}
.pvp-view__panel h2 {
  font-size: 18px;
  margin: 0 0 8px;
}
.pvp-view__hint {
  color: #aaa;
  font-size: 13px;
  margin-bottom: 8px;
}
.pvp-view__form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  flex-wrap: wrap;
}
.pvp-view__form-row input,
.pvp-view__form-row select {
  flex: 1 1 200px;
  background: #2a2a2e;
  border: 1px solid #444;
  color: #ddd;
  padding: 6px 10px;
  border-radius: 4px;
}
.pvp-view__hints {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 6px;
}
.pvp-view__defense-summary {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
}
.pvp-view__empty {
  color: #888;
  font-style: italic;
  padding: 6px 0;
}
.pvp-view__table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 13px;
}
.pvp-view__table th,
.pvp-view__table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #333;
}
.pvp-view__result {
  margin-top: 8px;
  padding: 8px 12px;
  background: #232328;
  border-radius: 4px;
}
</style>
