<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminLiveOpsDryRun,
  type AdminLiveOpsDryRunInput,
  type AdminLiveOpsDryRunResult,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 13.1.D — Admin LiveOps Dry-run panel.
 *
 * Form đơn giản: kind (event|boss), key, regionKey?, level?, reason?.
 * Submit → POST /admin/liveops/dry-run → render result. Backend giả lập
 * không grant reward / spawn boss / mutate DB; chỉ ghi 1 audit row
 * `ADMIN_LIVEOPS_DRY_RUN`.
 */

const { t } = useI18n();
const toast = useToastStore();

const form = ref<{
  kind: 'event' | 'boss';
  key: string;
  regionKey: string;
  level: number;
  reason: string;
}>({
  kind: 'event',
  key: '',
  regionKey: '',
  level: 1,
  reason: '',
});

const submitting = ref(false);
const result = ref<AdminLiveOpsDryRunResult | null>(null);
const error = ref<string | null>(null);

const isBoss = computed(() => form.value.kind === 'boss');

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  const key = form.value.key.trim();
  if (!key) {
    toast.push({
      type: 'error',
      text: t('adminLiveOpsDryRun.errors.KEY_REQUIRED'),
    });
    return;
  }
  submitting.value = true;
  error.value = null;
  try {
    const input: AdminLiveOpsDryRunInput = {
      kind: form.value.kind,
      key,
    };
    if (isBoss.value) {
      const region = form.value.regionKey.trim();
      if (region) input.regionKey = region;
      if (form.value.level && form.value.level > 0) {
        input.level = form.value.level;
      }
    }
    const reason = form.value.reason.trim();
    if (reason) input.reason = reason;

    result.value = await adminLiveOpsDryRun(input);
    toast.push({
      type: 'success',
      text: t('adminLiveOpsDryRun.toast.simulated', { kind: form.value.kind }),
    });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = code;
    toast.push({
      type: 'error',
      text: t(`adminLiveOpsDryRun.errors.${code}`, code),
    });
  } finally {
    submitting.value = false;
  }
}

defineExpose({ onSubmit });
</script>

<template>
  <section
    class="border border-ink-300/40 rounded space-y-2"
    data-test="admin-liveops-dryrun-panel"
  >
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
    >
      {{ t('adminLiveOpsDryRun.title') }}
    </div>

    <div class="p-3 space-y-3 text-sm">
      <div class="text-xs text-ink-300/80">
        {{ t('adminLiveOpsDryRun.help') }}
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <label class="flex flex-col gap-0.5">
          <span class="text-ink-300/70">
            {{ t('adminLiveOpsDryRun.kindLabel') }}
          </span>
          <select
            v-model="form.kind"
            class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
            data-test="admin-liveops-dryrun-kind"
          >
            <option value="event">
              {{ t('adminLiveOpsDryRun.kindEvent') }}
            </option>
            <option value="boss">
              {{ t('adminLiveOpsDryRun.kindBoss') }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-0.5">
          <span class="text-ink-300/70">
            {{ t('adminLiveOpsDryRun.keyLabel') }}
          </span>
          <input
            v-model="form.key"
            type="text"
            maxlength="80"
            class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
            :placeholder="t('adminLiveOpsDryRun.keyPlaceholder')"
            data-test="admin-liveops-dryrun-key"
          />
        </label>

        <label v-if="isBoss" class="flex flex-col gap-0.5">
          <span class="text-ink-300/70">
            {{ t('adminLiveOpsDryRun.regionLabel') }}
          </span>
          <input
            v-model="form.regionKey"
            type="text"
            maxlength="80"
            class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
            :placeholder="t('adminLiveOpsDryRun.regionPlaceholder')"
            data-test="admin-liveops-dryrun-region"
          />
        </label>

        <label v-if="isBoss" class="flex flex-col gap-0.5">
          <span class="text-ink-300/70">
            {{ t('adminLiveOpsDryRun.levelLabel') }}
          </span>
          <input
            v-model.number="form.level"
            type="number"
            min="1"
            max="99"
            step="1"
            class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
            data-test="admin-liveops-dryrun-level"
          />
        </label>

        <label class="flex flex-col gap-0.5">
          <span class="text-ink-300/70">
            {{ t('adminLiveOpsDryRun.reasonLabel') }}
          </span>
          <input
            v-model="form.reason"
            type="text"
            maxlength="200"
            class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
            :placeholder="t('adminLiveOpsDryRun.reasonPlaceholder')"
            data-test="admin-liveops-dryrun-reason"
          />
        </label>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1 rounded border border-sky-300/40 text-sky-200 text-xs disabled:opacity-50"
          :disabled="submitting"
          data-test="admin-liveops-dryrun-submit"
          @click="onSubmit"
        >
          {{
            submitting
              ? t('adminLiveOpsDryRun.submitting')
              : t('adminLiveOpsDryRun.submitBtn')
          }}
        </button>
        <span class="text-[10px] text-ink-300/60 italic">
          {{ t('adminLiveOpsDryRun.simulatedHint') }}
        </span>
      </div>

      <div
        v-if="error"
        class="text-xs text-rose-300"
        data-test="admin-liveops-dryrun-error"
      >
        {{
          t(
            `adminLiveOpsDryRun.errors.${error}`,
            t('adminLiveOpsDryRun.errors.UNKNOWN'),
          )
        }}
      </div>

      <!-- Result render. -->
      <section
        v-if="result && result.kind === 'event'"
        class="text-xs space-y-1"
        data-test="admin-liveops-dryrun-result-event"
      >
        <div class="uppercase tracking-widest text-ink-300">
          {{ t('adminLiveOpsDryRun.eventResultHeader') }}
        </div>
        <div>
          <span class="font-medium">{{ result.key }}</span>
          <span class="text-ink-300/60 ml-2">[{{ result.type }}]</span>
        </div>
        <div class="text-ink-300/80">
          {{ t(result.titleI18nKey, result.key) }}
        </div>
        <div class="text-ink-300/70">
          {{
            t('adminLiveOpsDryRun.eventEnabled', {
              effective: String(result.effectiveEnabled),
              catalog: String(result.catalogEnabled),
            })
          }}
        </div>
        <div v-if="result.nextSlotStartIso" class="text-ink-300/70">
          {{
            t('adminLiveOpsDryRun.eventNextSlot', {
              start: result.nextSlotStartIso,
              end: result.nextSlotEndIso ?? '—',
            })
          }}
        </div>
        <div v-if="result.regionKey || result.bossKey" class="text-ink-300/70">
          {{
            t('adminLiveOpsDryRun.eventRegionBoss', {
              region: result.regionKey ?? '—',
              boss: result.bossKey ?? '—',
            })
          }}
        </div>
        <div v-if="result.override" class="text-ink-300/70">
          {{
            t('adminLiveOpsDryRun.eventOverride', {
              enabled: String(result.override.enabled),
              updatedBy: result.override.updatedBy,
              updatedAt: result.override.updatedAt,
            })
          }}
        </div>
        <div class="text-emerald-300/80">
          {{
            t('adminLiveOpsDryRun.simulatedAt', { iso: result.simulatedAt })
          }}
        </div>
      </section>

      <section
        v-else-if="result && result.kind === 'boss'"
        class="text-xs space-y-1"
        data-test="admin-liveops-dryrun-result-boss"
      >
        <div class="uppercase tracking-widest text-ink-300">
          {{ t('adminLiveOpsDryRun.bossResultHeader') }}
        </div>
        <div>
          <span class="font-medium">{{ result.bossName }}</span>
          <span class="text-ink-300/60 ml-2">({{ result.bossKey }})</span>
        </div>
        <div class="text-ink-300/70">
          {{
            t('adminLiveOpsDryRun.bossRegionLevel', {
              region: result.regionKey,
              level: result.level,
              realm: result.recommendedRealm,
            })
          }}
        </div>
        <div class="text-ink-300/70">
          {{
            t('adminLiveOpsDryRun.bossSimulatedHp', {
              hp: result.simulatedMaxHp,
            })
          }}
        </div>
        <div class="text-ink-300/70">
          {{
            t('adminLiveOpsDryRun.bossReward', {
              linhThach: result.simulatedReward.baseLinhThach,
            })
          }}
        </div>
        <ul class="ml-3 space-y-0.5">
          <li>
            <span class="text-amber-300">{{
              t('adminLiveOpsDryRun.bossDropTop')
            }}</span>
            <span class="text-ink-300/70 ml-1">
              {{ result.simulatedReward.topDropPool.join(', ') || '—' }}
            </span>
          </li>
          <li>
            <span class="text-sky-300">{{
              t('adminLiveOpsDryRun.bossDropMid')
            }}</span>
            <span class="text-ink-300/70 ml-1">
              {{ result.simulatedReward.midDropPool.join(', ') || '—' }}
            </span>
          </li>
          <li>
            <span class="text-ink-300/80">{{
              t('adminLiveOpsDryRun.bossDropLow')
            }}</span>
            <span class="text-ink-300/70 ml-1">
              {{ result.simulatedReward.lowDropPool.join(', ') || '—' }}
            </span>
          </li>
        </ul>
        <div class="text-emerald-300/80">
          {{
            t('adminLiveOpsDryRun.simulatedAt', { iso: result.simulatedAt })
          }}
        </div>
      </section>
    </div>
  </section>
</template>
