<script setup lang="ts">
/**
 * Phase 26.5 — Sect Content view.
 *
 * 2 tab: sect dungeon (`GET /world/sect-dungeons`) + sect boss
 * (`GET /world/sect-bosses`). View không crash khi chưa có sect — fetch
 * vẫn lấy được catalog static. Bao trùm 4 state UI MODULE RULE:
 * loading / error+reload / empty / list cho mỗi tab.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorldContentStore } from '@/stores/worldContent';
import type { SectBossView, SectDungeonView } from '@/api/worldContent';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';

const { t, locale } = useI18n();
const store = useWorldContentStore();

const tab = ref<'dungeon' | 'boss'>('dungeon');
const dungeons = computed(() => store.sectDungeons);
const bosses = computed(() => store.sectBosses);
const dungeonLoaded = computed(() => store.loaded['sectDungeons'] === true);
const bossLoaded = computed(() => store.loaded['sectBosses'] === true);
const reloadFailed = ref(false);

function pickName(v: SectDungeonView | SectBossView): string {
  return locale.value === 'en' ? v.nameEn : v.nameVi;
}

async function refresh(): Promise<void> {
  reloadFailed.value = false;
  const [a, b] = await Promise.all([
    store.fetchSectDungeons(),
    store.fetchSectBosses(),
  ]);
  if (a || b) reloadFailed.value = true;
}

onMounted(() => {
  if (!dungeonLoaded.value || !bossLoaded.value) refresh();
});
</script>

<template>
  <AppShell>
    <section class="sect-content" data-testid="sect-content-view">
      <XTLuxHero
        :eyebrow="t('luxHero.sectContent.eyebrow')"
        :label="t('luxHero.sectContent.label')"
        :title="t('worldContent.sect.title')"
        :subtitle="t('worldContent.sect.subtitle')"
        tone="gold"
        watermark-letter="T"
        :breadcrumb="t('luxHero.sectContent.breadcrumb')"
        test-id="sect-content-hero"
      >
        <XTPageEyebrow caps="TÔNG MÔN NỘI VỤ" label="Tông Môn Nội Vụ" class="sr-only" />
      </XTLuxHero>

      <nav class="sect-content__tabs">
        <button
          :class="{ active: tab === 'dungeon' }"
          data-testid="sect-content-tab-dungeon"
          @click="tab = 'dungeon'"
        >
          {{ t('worldContent.sect.dungeonsTab') }}
        </button>
        <button
          :class="{ active: tab === 'boss' }"
          data-testid="sect-content-tab-boss"
          @click="tab = 'boss'"
        >
          {{ t('worldContent.sect.bossesTab') }}
        </button>
      </nav>

      <template v-if="tab === 'dungeon'">
        <div
          v-if="reloadFailed && dungeons.length === 0"
          class="sect-content__state sect-content__state--error"
          data-testid="sect-content-dungeon-error"
        >
          <p>{{ t('worldContent.reloadError') }}</p>
          <button @click="refresh">{{ t('worldContent.reload') }}</button>
        </div>
        <div
          v-else-if="dungeons.length === 0 && !dungeonLoaded"
          class="sect-content__state"
          data-testid="sect-content-dungeon-loading"
        >
          {{ t('worldContent.sect.loading') }}
        </div>
        <div
          v-else-if="dungeons.length === 0"
          class="sect-content__state"
          data-testid="sect-content-dungeon-empty"
        >
          {{ t('worldContent.sect.empty') }}
        </div>
        <ul
          v-else
          class="sect-content__list"
          data-testid="sect-content-dungeon-list"
        >
          <li
            v-for="d in dungeons"
            :key="d.key"
            class="sect-content__item"
            :data-testid="`sect-dungeon-item-${d.key}`"
          >
            <div class="sect-content__item-head">
              <h2>{{ pickName(d) }}</h2>
              <span class="sect-content__chip">{{ d.category }}</span>
            </div>
            <dl>
              <div>
                <dt>{{ t('worldContent.sect.requiredLevel') }}</dt>
                <dd>{{ d.requiredSectLevel }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.sect.dailyAttempts') }}</dt>
                <dd>{{ d.dailyAttemptsPerMember }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.sect.weeklyAttempts') }}</dt>
                <dd>{{ d.weeklyAttemptsPerSect ?? '—' }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.sect.contribution') }}</dt>
                <dd>{{ d.contributionCost }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.sect.sourceTier') }}</dt>
                <dd>{{ d.sourceTier }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </template>

      <template v-else>
        <div
          v-if="reloadFailed && bosses.length === 0"
          class="sect-content__state sect-content__state--error"
          data-testid="sect-content-boss-error"
        >
          <p>{{ t('worldContent.reloadError') }}</p>
          <button @click="refresh">{{ t('worldContent.reload') }}</button>
        </div>
        <div
          v-else-if="bosses.length === 0 && !bossLoaded"
          class="sect-content__state"
          data-testid="sect-content-boss-loading"
        >
          {{ t('worldContent.sect.loading') }}
        </div>
        <div
          v-else-if="bosses.length === 0"
          class="sect-content__state"
          data-testid="sect-content-boss-empty"
        >
          {{ t('worldContent.sect.empty') }}
        </div>
        <ul
          v-else
          class="sect-content__list"
          data-testid="sect-content-boss-list"
        >
          <li
            v-for="b in bosses"
            :key="b.key"
            class="sect-content__item"
            :data-testid="`sect-boss-item-${b.key}`"
          >
            <div class="sect-content__item-head">
              <h2>{{ pickName(b) }}</h2>
              <span class="sect-content__chip">{{ b.category }}</span>
            </div>
            <dl>
              <div>
                <dt>{{ t('worldContent.sect.requiredLevel') }}</dt>
                <dd>{{ b.requiredSectLevel }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.sect.family') }}</dt>
                <dd>{{ b.family }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.sect.sourceTier') }}</dt>
                <dd>{{ b.sourceTier }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </template>
    </section>
  </AppShell>
</template>

<style scoped>
.sect-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.sect-content__tabs {
  display: flex;
  gap: 8px;
}
.sect-content__tabs button {
  padding: 6px 12px;
  background: var(--surface, #1c1f24);
  color: var(--fg, #e7e9ee);
  border: 1px solid var(--border, #2c3038);
  border-radius: 6px;
  cursor: pointer;
}
.sect-content__tabs button.active {
  background: var(--accent, #3a6cf0);
  color: #fff;
}
.sect-content__state {
  padding: 24px;
  background: var(--surface, #1c1f24);
  border-radius: 8px;
  text-align: center;
}
.sect-content__state--error {
  border: 1px solid var(--danger, #b94343);
}
.sect-content__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.sect-content__item {
  background: var(--surface, #1c1f24);
  padding: 12px;
  border-radius: 8px;
}
.sect-content__item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sect-content__chip {
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--muted-bg, #2c3038);
  font-size: 0.75em;
}
.sect-content__item dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 6px;
  margin: 0;
}
.sect-content__item dt {
  font-size: 0.75em;
  color: var(--muted, #8a90a0);
}
.sect-content__item dd {
  margin: 0;
  font-weight: 600;
}
</style>
