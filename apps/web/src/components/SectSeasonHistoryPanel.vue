<script setup lang="ts">
/**
 * Phase 13.2.C — Sect Season History + Hall of Fame panel.
 *
 * 2 subviews trong cùng 1 panel (toggle bằng nội bộ ref):
 *   - List view: lịch sử mọi season đã chốt + summary champion + mvp.
 *   - Detail view: full leaderboard + top members của 1 season được chọn.
 *   - Hall of Fame section luôn ở cuối — aggregate honor qua mọi season.
 *
 * Empty states:
 *   - Chưa có snapshot nào → list "Chưa có mùa giải nào kết thúc" + HoF
 *     "Chưa có mùa nào được vinh danh".
 *   - Detail view: nếu API throw SNAPSHOT_NOT_FOUND → fallback i18n message.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getSectSeasonHallOfFame,
  getSectSeasonHistory,
  getSectSeasonHistoryDetail,
  type SectHallOfFameView,
  type SectSeasonHistoryListView,
  type SectSeasonHistoryView,
} from '@/api/sectSeason';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t } = useI18n();

const list = ref<SectSeasonHistoryListView | null>(null);
const hof = ref<SectHallOfFameView | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const detail = ref<SectSeasonHistoryView | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const selectedSeasonKey = ref<string | null>(null);

function seasonLabel(seasonKey: string): string {
  const parts = seasonKey.split('_');
  const suffix = parts[parts.length - 1] ?? seasonKey;
  return t(
    `sectSeason.season.names.${suffix}`,
    t('sectSeason.season.fallbackLabel', { k: seasonKey }),
  );
}

function fmt(at: string): string {
  try {
    return new Date(at).toLocaleDateString();
  } catch {
    return at;
  }
}

onMounted(async () => {
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [a, b] = await Promise.all([
      getSectSeasonHistory(),
      getSectSeasonHallOfFame(),
    ]);
    list.value = a;
    hof.value = b;
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

async function viewDetail(seasonKey: string): Promise<void> {
  selectedSeasonKey.value = seasonKey;
  detail.value = null;
  detailLoading.value = true;
  detailError.value = null;
  try {
    detail.value = await getSectSeasonHistoryDetail(seasonKey);
  } catch (e) {
    detailError.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    detailLoading.value = false;
  }
}

function backToList(): void {
  selectedSeasonKey.value = null;
  detail.value = null;
  detailError.value = null;
}

</script>

<template>
  <div data-test="sect-season-history-panel" class="space-y-4">
    <div
      v-if="loading"
      class="text-ink-300 text-sm"
      data-test="sect-season-history-loading"
    >
      {{ t('sectSeason.history.loading') }}
    </div>
    <div
      v-else-if="error"
      class="text-rose-300 text-sm"
      data-test="sect-season-history-error"
    >
      {{ t(`sectSeason.history.errors.${error}`, t('sectSeason.history.errors.UNKNOWN')) }}
    </div>

    <template v-else>
      <!-- List view -->
      <section
        v-if="!selectedSeasonKey"
        class="rounded border border-ink-300/40 bg-ink-700/20 p-4"
        data-test="sect-season-history-list"
      >
        <h3 class="text-sm tracking-widest uppercase text-amber-200 mb-2">
          {{ t('sectSeason.history.title') }}
        </h3>
        <div
          v-if="!list || list.seasons.length === 0"
          class="text-ink-300 text-sm"
          data-test="sect-season-history-empty"
        >
          {{ t('sectSeason.history.empty') }}
        </div>
        <ul
          v-else
          class="divide-y divide-ink-300/20"
          data-test="sect-season-history-list-rows"
        >
          <li
            v-for="s in list.seasons"
            :key="s.seasonKey"
            class="py-3 flex flex-wrap items-start gap-3 justify-between"
            :data-test="`sect-season-history-row-${s.seasonKey}`"
          >
            <div class="space-y-1">
              <div class="text-amber-200 text-sm tracking-widest uppercase">
                {{ seasonLabel(s.seasonKey) }}
              </div>
              <div class="text-xs text-ink-300/80">
                {{ s.seasonKey }} ·
                {{ t('sectSeason.history.finalizedAt', { at: fmt(s.finalizedAt) }) }}
              </div>
              <div class="text-xs text-ink-300/80">
                {{ t('sectSeason.history.totalsLine', {
                  sects: s.totalSects,
                  contributors: s.totalContributors,
                  points: s.totalPoints.toLocaleString(),
                }) }}
              </div>
            </div>
            <div class="text-xs text-right space-y-1 min-w-[12rem]">
              <div class="text-ink-300/70 uppercase">
                {{ t('sectSeason.history.championLabel') }}
              </div>
              <div
                class="text-amber-200"
                :data-test="`sect-season-history-champion-${s.seasonKey}`"
              >
                {{ s.champion ? `${s.champion.sectName} · ${s.champion.points.toLocaleString()}` : t('sectSeason.history.noChampion') }}
              </div>
              <div class="text-ink-300/70 uppercase">
                {{ t('sectSeason.history.mvpLabel') }}
              </div>
              <div
                class="text-ink-100"
                :data-test="`sect-season-history-mvp-${s.seasonKey}`"
              >
                {{ s.mvp ? `${s.mvp.characterName} · ${s.mvp.points.toLocaleString()}` : t('sectSeason.history.noMvp') }}
              </div>
              <button
                type="button"
                class="text-amber-200 underline"
                :data-test="`sect-season-history-detail-btn-${s.seasonKey}`"
                @click="viewDetail(s.seasonKey)"
              >
                {{ t('sectSeason.history.viewDetail') }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Detail view -->
      <section
        v-else
        class="rounded border border-amber-300/30 bg-ink-700/20 p-4 space-y-3"
        data-test="sect-season-history-detail"
      >
        <button
          type="button"
          class="text-xs text-amber-200 underline"
          data-test="sect-season-history-back"
          @click="backToList"
        >
          {{ t('sectSeason.history.back') }}
        </button>
        <h3
          class="text-sm tracking-widest uppercase text-amber-200"
          data-test="sect-season-history-detail-title"
        >
          {{ seasonLabel(selectedSeasonKey) }}
          <span class="text-ink-300/70 normal-case ml-2 text-xs">{{ selectedSeasonKey }}</span>
        </h3>
        <div
          v-if="detailLoading"
          class="text-ink-300 text-sm"
          data-test="sect-season-history-detail-loading"
        >
          {{ t('sectSeason.history.loading') }}
        </div>
        <div
          v-else-if="detailError"
          class="text-rose-300 text-sm"
          data-test="sect-season-history-detail-error"
        >
          {{ t(`sectSeason.history.errors.${detailError}`, t('sectSeason.history.errors.UNKNOWN')) }}
        </div>
        <div v-else-if="detail" class="space-y-3" data-test="sect-season-history-detail-content">
          <div class="text-xs text-ink-300/80">
            {{ t('sectSeason.history.finalizedAt', { at: fmt(detail.finalizedAt) }) }} ·
            {{ t('sectSeason.history.totalsLine', {
              sects: detail.totalSects,
              contributors: detail.totalContributors,
              points: detail.totalPoints.toLocaleString(),
            }) }}
          </div>

          <div data-test="sect-season-history-detail-sects">
            <h4 class="text-xs tracking-widest uppercase text-ink-300 mb-1">
              {{ t('sectSeason.history.detail.sectsTitle') }}
            </h4>
            <div
              v-if="detail.sects.length === 0"
              class="text-ink-300 text-sm"
              data-test="sect-season-history-detail-sects-empty"
            >
              {{ t('sectSeason.history.detail.emptySects') }}
            </div>
            <table v-else class="w-full text-sm">
              <thead class="text-xs text-ink-300/70 uppercase">
                <tr>
                  <th class="text-left py-1">{{ t('sectSeason.leaderboard.col.rank') }}</th>
                  <th class="text-left py-1">{{ t('sectSeason.leaderboard.col.sect') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.leaderboard.col.points') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.leaderboard.col.contributors') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.leaderboard.col.weeks') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in detail.sects"
                  :key="row.sectId"
                  data-test="sect-season-history-detail-sect-row"
                >
                  <td class="py-1 text-ink-200">#{{ row.rank }}</td>
                  <td class="py-1 text-ink-100">{{ row.sectName }}</td>
                  <td class="py-1 text-right text-amber-200">{{ row.points.toLocaleString() }}</td>
                  <td class="py-1 text-right text-ink-200">{{ row.contributors }}</td>
                  <td class="py-1 text-right text-ink-200">{{ row.weeksContributed }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div data-test="sect-season-history-detail-members">
            <h4 class="text-xs tracking-widest uppercase text-ink-300 mb-1">
              {{ t('sectSeason.history.detail.membersTitle') }}
            </h4>
            <div
              v-if="detail.topMembers.length === 0"
              class="text-ink-300 text-sm"
              data-test="sect-season-history-detail-members-empty"
            >
              {{ t('sectSeason.history.detail.emptyMembers') }}
            </div>
            <table v-else class="w-full text-sm">
              <thead class="text-xs text-ink-300/70 uppercase">
                <tr>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.rank') }}</th>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.member') }}</th>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.latestSect') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.leaderboard.col.points') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="m in detail.topMembers"
                  :key="m.characterId"
                  data-test="sect-season-history-detail-member-row"
                >
                  <td class="py-1 text-ink-200">#{{ m.rank }}</td>
                  <td class="py-1 text-ink-100">{{ m.characterName }}</td>
                  <td class="py-1 text-ink-300">{{ m.sectName ?? t('sectSeason.history.detail.noSect') }}</td>
                  <td class="py-1 text-right text-amber-200">{{ m.points.toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Hall of Fame -->
      <section
        class="rounded border border-ink-300/40 bg-ink-700/20 p-4 space-y-3"
        data-test="sect-season-hall-of-fame"
      >
        <header>
          <h3 class="text-sm tracking-widest uppercase text-amber-200">
            {{ t('sectSeason.hallOfFame.title') }}
          </h3>
          <p class="text-xs text-ink-300/80 mt-1">
            {{ t('sectSeason.hallOfFame.subtitle') }}
          </p>
          <p class="text-xs text-ink-300/70 mt-1" data-test="sect-season-hall-of-fame-totals">
            {{ t('sectSeason.hallOfFame.totalsLine', { seasons: hof?.totalSeasonsFinalized ?? 0 }) }}
          </p>
        </header>

        <div
          v-if="!hof || (hof.sects.length === 0 && hof.members.length === 0)"
          class="text-ink-300 text-sm"
          data-test="sect-season-hall-of-fame-empty"
        >
          {{ t('sectSeason.hallOfFame.empty') }}
        </div>

        <div v-else class="space-y-3">
          <div data-test="sect-season-hall-of-fame-sects">
            <h4 class="text-xs tracking-widest uppercase text-ink-300 mb-1">
              {{ t('sectSeason.hallOfFame.sectsTitle') }}
            </h4>
            <table class="w-full text-sm">
              <thead class="text-xs text-ink-300/70 uppercase">
                <tr>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.rank') }}</th>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.sect') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.championships') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.podiums') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.appearances') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.bestRank') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.totalPoints') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(s, i) in hof.sects"
                  :key="s.sectId"
                  data-test="sect-season-hall-of-fame-sect-row"
                >
                  <td class="py-1 text-ink-200">#{{ i + 1 }}</td>
                  <td class="py-1 text-ink-100">{{ s.sectName }}</td>
                  <td class="py-1 text-right text-amber-200">{{ s.championships }}</td>
                  <td class="py-1 text-right text-ink-200">{{ s.podiums }}</td>
                  <td class="py-1 text-right text-ink-200">{{ s.appearances }}</td>
                  <td class="py-1 text-right text-ink-200">#{{ s.bestRank }}</td>
                  <td class="py-1 text-right text-ink-200">{{ s.totalPoints.toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div data-test="sect-season-hall-of-fame-members">
            <h4 class="text-xs tracking-widest uppercase text-ink-300 mb-1">
              {{ t('sectSeason.hallOfFame.membersTitle') }}
            </h4>
            <table class="w-full text-sm">
              <thead class="text-xs text-ink-300/70 uppercase">
                <tr>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.rank') }}</th>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.member') }}</th>
                  <th class="text-left py-1">{{ t('sectSeason.hallOfFame.col.latestSect') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.mvps') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.podiums') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.appearances') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.bestRank') }}</th>
                  <th class="text-right py-1">{{ t('sectSeason.hallOfFame.col.totalPoints') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(m, i) in hof.members"
                  :key="m.characterId"
                  data-test="sect-season-hall-of-fame-member-row"
                >
                  <td class="py-1 text-ink-200">#{{ i + 1 }}</td>
                  <td class="py-1 text-ink-100">{{ m.characterName }}</td>
                  <td class="py-1 text-ink-300">{{ m.latestSectName ?? t('sectSeason.hallOfFame.noLatestSect') }}</td>
                  <td class="py-1 text-right text-amber-200">{{ m.mvps }}</td>
                  <td class="py-1 text-right text-ink-200">{{ m.podiums }}</td>
                  <td class="py-1 text-right text-ink-200">{{ m.appearances }}</td>
                  <td class="py-1 text-right text-ink-200">#{{ m.bestRank }}</td>
                  <td class="py-1 text-right text-ink-200">{{ m.totalPoints.toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
