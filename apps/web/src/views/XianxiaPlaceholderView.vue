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
const icon = computed(() =>
  typeof route.meta.icon === 'string' ? route.meta.icon : 'cultivation',
);
</script>

<template>
  <AppShell>
    <div class="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center">
      <XianxiaCard accent="violet" class="w-full text-center" data-testid="xianxia-placeholder">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-amber-300/40 bg-[var(--xt-bg-surface)]">
          <GameIcon :name="icon" size="lg" />
        </div>
        <p class="text-xs uppercase tracking-[0.32em] text-[var(--xt-text-jade)]">XT</p>
        <h1 class="mt-2 text-3xl font-black text-[var(--xt-text-primary)]">{{ title }}</h1>
        <p class="mx-auto mt-3 max-w-xl text-sm text-[var(--xt-text-muted)]">{{ description }}</p>
        <div class="mt-6 flex flex-wrap justify-center gap-3">
          <XianxiaBackButton :label="t('common.back')" />
          <RouterLink
            to="/dashboard"
            class="inline-flex min-h-10 items-center rounded-2xl border border-[var(--xt-border-jade)] bg-emerald-100/70 px-4 py-2 text-sm font-semibold text-[var(--xt-text-primary)] transition hover:bg-[var(--xt-jade-soft)] focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
          >
            Quay lại Dashboard
          </RouterLink>
        </div>
      </XianxiaCard>
    </div>
  </AppShell>
</template>
