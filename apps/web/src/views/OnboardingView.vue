<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { getCharacter, onboard, type OnboardInput } from '@/api/character';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import { extractApiErrorCode } from '@/lib/apiError';

const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();
const { t, tm, rt } = useI18n();

function lines(key: string): string[] {
  const arr = tm(key) as unknown;
  if (!Array.isArray(arr)) return [];
  return (arr as unknown[]).map((x) => rt(x as string));
}

const step = ref<1 | 2 | 3 | 4>(1);
const name = ref('');
const sectKey = ref<OnboardInput['sectKey']>('thanh_van');
const submitting = ref(false);

const NAME_RE = /^[A-Za-zÀ-ỹ0-9._]+$/;

const nameError = computed<string | null>(() => {
  const v = name.value.trim();
  if (!v) return null;
  if (v.length < 3) return t('onboarding.step2.errors.tooShort');
  if (v.length > 16) return t('onboarding.step2.errors.tooLong');
  if (!NAME_RE.test(v)) return t('onboarding.step2.errors.invalid');
  return null;
});

const SECTS: Array<OnboardInput['sectKey']> = ['thanh_van', 'huyen_thuy', 'tu_la'];

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  const char = await getCharacter().catch(() => null);
  if (char) router.replace('/home');
});

function nextStep(): void {
  if (step.value === 2 && (nameError.value || !name.value.trim())) return;
  if (step.value < 4) step.value = (step.value + 1) as typeof step.value;
}
function prevStep(): void {
  if (step.value > 1) step.value = (step.value - 1) as typeof step.value;
}

async function finish(): Promise<void> {
  submitting.value = true;
  try {
    await onboard({ name: name.value.trim(), sectKey: sectKey.value });
    toast.push({ type: 'success', text: t('auth.register.success') });
    router.replace('/home');
  } catch (e) {
    const code = extractApiErrorCode(e);
    if (code === 'NAME_TAKEN') {
      toast.push({ type: 'error', text: t('onboarding.step2.errors.taken') });
      step.value = 2;
    } else {
      toast.push({ type: 'error', text: t('auth.errors.UNKNOWN') });
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="min-h-screen w-full flex items-center justify-center p-4"
    style="background: radial-gradient(ellipse at top, #2a1f10 0%, #1b150a 60%, #0e0a04 100%)"
  >
    <div
      class="w-full max-w-xl border-2 border-ink-300/60 rounded-md bg-ink-700/40 backdrop-blur-md p-6 shadow-2xl"
    >
      <XTPageEyebrow caps="CỬU THIÊN MỘNG CẢNH" label="Cửu Thiên Mộng Cảnh" />
      <header class="flex items-center gap-3 border-b border-ink-300/40 pb-3 mb-4 mt-2">
        <div
          class="w-12 h-12 rounded-full bg-ink-300/20 border-2 border-ink-300 flex items-center justify-center text-2xl"
          aria-hidden="true"
        >
          ❀
        </div>
        <div>
          <div class="text-ink-100 font-bold tracking-wide">{{ t('onboarding.alinhName') }}</div>
          <div class="text-xs text-ink-300">{{ t('onboarding.alinhRole') }}</div>
        </div>
        <div class="ml-auto text-xs text-ink-300">{{ step }} / 4</div>
      </header>

      <section v-if="step === 1">
        <h2 class="text-xl text-ink-50 mb-3">{{ t('onboarding.step1.title') }}</h2>
        <p
          v-for="(line, i) in lines('onboarding.step1.lines')"
          :key="i"
          class="text-ink-100 leading-relaxed"
        >
          {{ line }}
        </p>
      </section>

      <section v-else-if="step === 2">
        <h2 class="text-xl text-ink-50 mb-3">{{ t('onboarding.step2.title') }}</h2>
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('onboarding.step2.label') }}</span>
          <input
            v-model="name"
            type="text"
            :placeholder="t('onboarding.step2.placeholder')"
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
            required
          />
        </label>
        <p v-if="nameError" class="text-xs mt-1 text-red-300">{{ nameError }}</p>
      </section>

      <section v-else-if="step === 3">
        <h2 class="text-xl text-ink-50 mb-3">{{ t('onboarding.step3.title') }}</h2>
        <p class="text-ink-100">{{ t('onboarding.step3.lines.0') }}</p>
        <div class="grid gap-3 mt-4">
          <button
            v-for="k in SECTS"
            :key="k"
            type="button"
            class="text-left p-3 rounded border-2 transition"
            :class="
              sectKey === k
                ? 'border-ink-300 bg-ink-700/60'
                : 'border-ink-300/30 bg-ink-900/40 hover:border-ink-300/60'
            "
            @click="sectKey = k"
          >
            <div class="font-bold text-ink-50">{{ t(`onboarding.step3.sects.${k}.name`) }}</div>
            <div class="text-xs text-ink-300 mt-1">
              {{ t(`onboarding.step3.sects.${k}.desc`) }}
            </div>
          </button>
        </div>
      </section>

      <section v-else>
        <h2 class="text-xl text-ink-50 mb-3">{{ t('onboarding.step4.title') }}</h2>
        <p class="text-ink-100 leading-relaxed">
          {{ t('onboarding.step4.lines.0', { name: name.trim() || '…' }) }}
        </p>
        <p class="text-ink-100 leading-relaxed mt-2">{{ t('onboarding.step4.lines.1') }}</p>
        <div class="mt-4 text-xs text-ink-300">
          <div>
            {{ t('onboarding.step3.title') }}:
            <span class="text-ink-50 font-bold">
              {{ t(`onboarding.step3.sects.${sectKey}.name`) }}
            </span>
          </div>
        </div>
      </section>

      <footer class="mt-6 flex items-center justify-between">
        <MButton :disabled="step === 1" @click="prevStep">{{ t('common.prev') }}</MButton>
        <MButton
          v-if="step < 4"
          :disabled="step === 2 && !!nameError"
          @click="nextStep"
        >
          {{ t('common.next') }}
        </MButton>
        <MButton v-else :loading="submitting" @click="finish">
          {{ t('onboarding.step4.submit') }}
        </MButton>
      </footer>
    </div>
  </div>
</template>
