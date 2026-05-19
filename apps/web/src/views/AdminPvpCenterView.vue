<script setup lang="ts">
/**
 * Phase 29.0 — Admin PvP Center View.
 *
 * Hiển thị 3 panel:
 *   - Policy (read-only) — current vs default.
 *   - Battle log search + invalidate.
 *   - Anomaly queue + resolve.
 *
 * Tất cả action gọi qua `apps/web/src/api/pvp.ts`. Permission gate ở
 * route level (`requireAdminRoles` → SUPER_ADMIN, OPERATIONS_ADMIN).
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  adminGetPolicy,
  adminInvalidateBattle,
  adminListAnomalies,
  adminListBattleLogs,
  adminResolveAnomaly,
  type PvpAnomalyRow,
  type PvpBattleSummary,
} from '@/api/pvp';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';
import type { PvpBalancePolicy } from '@xuantoi/shared';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const loading = ref(false);
const policyState = ref<{ current: PvpBalancePolicy; default: PvpBalancePolicy } | null>(
  null,
);
const battles = ref<PvpBattleSummary[]>([]);
const anomalies = ref<PvpAnomalyRow[]>([]);

const searchForm = ref({
  mode: '' as '' | 'DUEL' | 'FRIENDLY_SPARRING' | 'SECT_WAR' | 'TERRITORY_WAR' | 'EVENT_PVP',
  characterId: '',
});

const anomalyStatus = ref<'PENDING' | 'RESOLVED' | 'ALL'>('PENDING');

const invalidateModal = ref<{ battleId: string; reason: string } | null>(null);
const resolveModal = ref<
  | {
      anomalyId: string;
      resolution: 'DISMISSED' | 'CONFIRMED' | 'ESCALATED';
      reason: string;
    }
  | null
>(null);

async function refresh() {
  loading.value = true;
  try {
    const [pol, bats, anos] = await Promise.all([
      adminGetPolicy(),
      adminListBattleLogs({ limit: 50 }),
      adminListAnomalies({ status: 'PENDING', limit: 50 }),
    ]);
    policyState.value = pol;
    battles.value = bats;
    anomalies.value = anos;
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'adminPvp.errors.load'),
    });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await auth.hydrate();
  void refresh();
});

async function applyBattleSearch() {
  try {
    battles.value = await adminListBattleLogs({
      mode: (searchForm.value.mode || undefined) as never,
      characterId: searchForm.value.characterId || undefined,
      limit: 50,
    });
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'adminPvp.errors.search'),
    });
  }
}

async function applyAnomalyFilter() {
  try {
    anomalies.value = await adminListAnomalies({
      status: anomalyStatus.value,
      limit: 50,
    });
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'adminPvp.errors.search'),
    });
  }
}

async function confirmInvalidate() {
  if (!invalidateModal.value) return;
  const { battleId, reason } = invalidateModal.value;
  if (!reason.trim() || reason.trim().length < 3) {
    toast.push({ type: 'error', text: t('adminPvp.errors.reasonRequired') });
    return;
  }
  try {
    await adminInvalidateBattle(battleId, reason);
    toast.push({ type: 'success', text: t('adminPvp.toast.invalidated') });
    invalidateModal.value = null;
    await applyBattleSearch();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'adminPvp.errors.invalidate'),
    });
  }
}

async function confirmResolve() {
  if (!resolveModal.value) return;
  const { anomalyId, resolution, reason } = resolveModal.value;
  if (!reason.trim() || reason.trim().length < 3) {
    toast.push({ type: 'error', text: t('adminPvp.errors.reasonRequired') });
    return;
  }
  try {
    await adminResolveAnomaly(anomalyId, resolution, reason);
    toast.push({ type: 'success', text: t('adminPvp.toast.resolved') });
    resolveModal.value = null;
    await applyAnomalyFilter();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'adminPvp.errors.resolve'),
    });
  }
}
</script>

<template>
  <AppShell>
    <section class="admin-pvp" data-test="admin-pvp-view">
      <header class="admin-pvp__header">
        <XTPageEyebrow caps="ĐẤU KHIỂN PHỦ" label="Đấu Khiển Phủ" />
        <h1 class="mt-1">{{ t('adminPvp.title') }}</h1>
        <p>{{ t('adminPvp.intro') }}</p>
      </header>

      <!-- Policy -->
      <section class="admin-pvp__panel" data-test="admin-pvp-policy">
        <h2>{{ t('adminPvp.policy.title') }}</h2>
        <div v-if="policyState" class="admin-pvp__grid">
          <div>
            <strong>{{ t('adminPvp.policy.maxDailyChallenge') }}:</strong>
            {{ policyState.current.maxDailyChallenge }} /
            {{ policyState.default.maxDailyChallenge }}
          </div>
          <div>
            <strong>{{ t('adminPvp.policy.maxDailyPaidChallenge') }}:</strong>
            {{ policyState.current.maxDailyPaidChallenge }} /
            {{ policyState.default.maxDailyPaidChallenge }}
          </div>
          <div>
            <strong>{{ t('adminPvp.policy.sameTargetCooldown') }}:</strong>
            {{ policyState.current.sameTargetCooldownMinutes }}m
          </div>
          <div>
            <strong>{{ t('adminPvp.policy.maxArenaTokenPerDay') }}:</strong>
            {{ policyState.current.maxArenaTokenPerDay }}
          </div>
          <div>
            <strong>{{ t('adminPvp.policy.powerGapBlock') }}:</strong>
            {{ policyState.current.powerGapMatchBlockThreshold.toFixed(2) }}x
          </div>
          <div>
            <strong>{{ t('adminPvp.policy.maxSeasonRewardTierDelta') }}:</strong>
            {{ policyState.current.maxSeasonRewardTierDelta }}
          </div>
        </div>
        <div v-else>{{ t('adminPvp.loading') }}</div>
      </section>

      <!-- Battle search + invalidate -->
      <section class="admin-pvp__panel" data-test="admin-pvp-battles">
        <h2>{{ t('adminPvp.battles.title') }}</h2>
        <div class="admin-pvp__form-row">
          <label>{{ t('adminPvp.battles.modeFilter') }}</label>
          <select v-model="searchForm.mode">
            <option value="">{{ t('adminPvp.battles.allModes') }}</option>
            <option value="DUEL">DUEL</option>
            <option value="FRIENDLY_SPARRING">FRIENDLY_SPARRING</option>
            <option value="EVENT_PVP">EVENT_PVP</option>
            <option value="SECT_WAR">SECT_WAR</option>
            <option value="TERRITORY_WAR">TERRITORY_WAR</option>
          </select>
          <label>{{ t('adminPvp.battles.characterFilter') }}</label>
          <input
            v-model="searchForm.characterId"
            type="text"
            :placeholder="t('adminPvp.battles.characterPlaceholder')"
          />
          <MButton data-test="admin-pvp-search" @click="applyBattleSearch">
            {{ t('adminPvp.battles.search') }}
          </MButton>
        </div>
        <div
          v-if="battles.length === 0"
          class="admin-pvp__empty"
          data-test="admin-pvp-battles-empty"
        >
          {{ t('adminPvp.battles.empty') }}
        </div>
        <table v-else class="admin-pvp__table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Result</th>
              <th>Attacker</th>
              <th>Defender</th>
              <th>Reward</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in battles" :key="b.id">
              <td>{{ b.id.slice(0, 8) }}…</td>
              <td>{{ b.mode }}</td>
              <td>{{ b.status }}</td>
              <td>{{ b.result ?? '—' }}</td>
              <td>{{ b.attackerCharacterId.slice(0, 8) }}…</td>
              <td>{{ b.defenderCharacterId?.slice(0, 8) ?? '—' }}…</td>
              <td>{{ b.rewardGranted ? '✓' : '—' }}</td>
              <td>{{ new Date(b.createdAt).toLocaleString() }}</td>
              <td>
                <MButton
                  v-if="b.status !== 'INVALIDATED'"
                  data-test="admin-pvp-invalidate-btn"
                  size="sm"
                  @click="invalidateModal = { battleId: b.id, reason: '' }"
                >
                  {{ t('adminPvp.battles.invalidate') }}
                </MButton>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Anomalies -->
      <section class="admin-pvp__panel" data-test="admin-pvp-anomalies">
        <h2>{{ t('adminPvp.anomalies.title') }}</h2>
        <div class="admin-pvp__form-row">
          <label>{{ t('adminPvp.anomalies.statusFilter') }}</label>
          <select v-model="anomalyStatus" @change="applyAnomalyFilter">
            <option value="PENDING">PENDING</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="ALL">ALL</option>
          </select>
        </div>
        <div
          v-if="anomalies.length === 0"
          class="admin-pvp__empty"
          data-test="admin-pvp-anomalies-empty"
        >
          {{ t('adminPvp.anomalies.empty') }}
        </div>
        <table v-else class="admin-pvp__table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Severity</th>
              <th>Character</th>
              <th>Block Reward</th>
              <th>Status</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in anomalies" :key="a.id">
              <td>{{ a.anomalyType }}</td>
              <td>{{ a.severity.toFixed(2) }}</td>
              <td>{{ a.characterId?.slice(0, 8) ?? '—' }}</td>
              <td>{{ a.blockedReward ? '✓' : '—' }}</td>
              <td>{{ a.resolution ?? 'PENDING' }}</td>
              <td>{{ new Date(a.createdAt).toLocaleString() }}</td>
              <td>
                <MButton
                  v-if="!a.resolution"
                  size="sm"
                  data-test="admin-pvp-resolve-btn"
                  @click="
                    resolveModal = {
                      anomalyId: a.id,
                      resolution: 'CONFIRMED',
                      reason: '',
                    }
                  "
                >
                  {{ t('adminPvp.anomalies.resolve') }}
                </MButton>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Invalidate modal -->
      <div v-if="invalidateModal" class="admin-pvp__modal" data-test="admin-pvp-modal">
        <div class="admin-pvp__modal-content">
          <h3>{{ t('adminPvp.invalidate.title') }}</h3>
          <p>{{ t('adminPvp.invalidate.warning') }}</p>
          <textarea
            v-model="invalidateModal.reason"
            :placeholder="t('adminPvp.invalidate.reasonPlaceholder')"
            rows="3"
          />
          <div class="admin-pvp__modal-actions">
            <MButton variant="secondary" @click="invalidateModal = null">
              {{ t('common.cancel') }}
            </MButton>
            <MButton @click="confirmInvalidate">
              {{ t('adminPvp.invalidate.confirm') }}
            </MButton>
          </div>
        </div>
      </div>

      <!-- Resolve modal -->
      <div v-if="resolveModal" class="admin-pvp__modal">
        <div class="admin-pvp__modal-content">
          <h3>{{ t('adminPvp.resolve.title') }}</h3>
          <label>{{ t('adminPvp.resolve.resolutionLabel') }}</label>
          <select v-model="resolveModal.resolution">
            <option value="DISMISSED">DISMISSED</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="ESCALATED">ESCALATED</option>
          </select>
          <textarea
            v-model="resolveModal.reason"
            :placeholder="t('adminPvp.resolve.reasonPlaceholder')"
            rows="3"
          />
          <div class="admin-pvp__modal-actions">
            <MButton variant="secondary" @click="resolveModal = null">
              {{ t('common.cancel') }}
            </MButton>
            <MButton @click="confirmResolve">
              {{ t('adminPvp.resolve.confirm') }}
            </MButton>
          </div>
        </div>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
.admin-pvp {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.admin-pvp__panel {
  background: #1c1c20;
  padding: 16px;
  border-radius: 8px;
}
.admin-pvp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 6px;
}
.admin-pvp__form-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 8px;
}
.admin-pvp__form-row input,
.admin-pvp__form-row select {
  background: #2a2a2e;
  border: 1px solid #444;
  color: #ddd;
  padding: 6px 10px;
  border-radius: 4px;
}
.admin-pvp__empty {
  color: #888;
  font-style: italic;
  padding: 6px 0;
}
.admin-pvp__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 8px;
}
.admin-pvp__table th,
.admin-pvp__table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #333;
}
.admin-pvp__modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.admin-pvp__modal-content {
  background: #1c1c20;
  padding: 20px;
  border-radius: 8px;
  min-width: 400px;
  max-width: 90vw;
}
.admin-pvp__modal-content textarea {
  width: 100%;
  background: #2a2a2e;
  border: 1px solid #444;
  color: #ddd;
  padding: 6px 10px;
  border-radius: 4px;
  margin: 8px 0;
}
.admin-pvp__modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
