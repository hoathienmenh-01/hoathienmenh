<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import GameIcon from '@/components/xianxia/GameIcon.vue';
import XianxiaBackButton from '@/components/xianxia/XianxiaBackButton.vue';
import XianxiaCard from '@/components/xianxia/XianxiaCard.vue';

const route = useRoute();
const { t } = useI18n();

const title = computed(() =>
  typeof route.meta.title === 'string'
    ? route.meta.title
    : t('xianxiaPlaceholder.title'),
);
const description = computed(() =>
  typeof route.meta.description === 'string'
    ? route.meta.description
    : t('xianxiaPlaceholder.description'),
);
</script>

<template>
  <AppShell>
    <div class="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center">
      <XianxiaCard accent="violet" class="w-full text-center" data-testid="xianxia-placeholder">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-violet-200/25 bg-violet-300/10">
          <GameIcon name="cultivation" size="lg" />
        </div>
        <p class="text-xs uppercase tracking-[0.32em] text-cyan-200/70">XT</p>
        <h1 class="mt-2 text-3xl font-black text-slate-50">{{ title }}</h1>
        <p class="mx-auto mt-3 max-w-xl text-sm text-slate-300">{{ description }}</p>
        <div class="mt-6 flex flex-wrap justify-center gap-3">
          <XianxiaBackButton :label="t('common.back')" />
          <RouterLink
            to="/home"
            class="inline-flex min-h-10 items-center rounded-2xl border border-emerald-200/30 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-50 transition hover:bg-emerald-300/20 focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
          >
            {{ t('shell.nav.home') }}
          </RouterLink>
        </div>
      </XianxiaCard>
    </div>
  </AppShell>
</template>
