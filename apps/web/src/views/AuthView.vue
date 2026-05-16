<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { randomProverb } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import * as authApi from '@/api/auth';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

type Tab = 'login' | 'register' | 'change';
const tab = ref<Tab>('login');
const proverb = ref(randomProverb());

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const lEmail = ref('');
const lPassword = ref('');
const lRemember = ref(true);

const rEmail = ref('');
const rPassword = ref('');

const cOld = ref('');
const cNew = ref('');

function passwordStrength(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p)) s++;
  if (/[a-z]/.test(p)) s++;
  if (/[0-9]/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 5);
}
const rStrength = computed(() => passwordStrength(rPassword.value));
const rStrengthLabel = computed(() =>
  t(`auth.register.strengthLevels.${rStrength.value}`),
);

function showServerError(code: string): void {
  const key = `auth.errors.${code}`;
  const text = t(key, '__missing__');
  toast.push({ type: 'error', text: text === '__missing__' ? t('auth.errors.UNKNOWN') : text });
}

async function onLogin(): Promise<void> {
  try {
    await auth.login(lEmail.value, lPassword.value, lRemember.value);
    toast.push({ type: 'success', text: t('auth.login.success') });
    router.push('/home');
  } catch (e) {
    showServerError(extractApiErrorCodeOrDefault(e, 'INVALID_CREDENTIALS'));
  }
}

async function onRegister(): Promise<void> {
  try {
    await auth.register(rEmail.value, rPassword.value);
    toast.push({ type: 'success', text: t('auth.register.success') });
    // Sau khi đăng ký, đẩy thẳng vào onboarding A Linh.
    router.push('/onboarding');
  } catch (e) {
    showServerError(extractApiErrorCodeOrDefault(e, 'EMAIL_TAKEN'));
  }
}

async function onChange(): Promise<void> {
  try {
    await authApi.changePassword({ oldPassword: cOld.value, newPassword: cNew.value });
    toast.push({ type: 'success', text: t('auth.change.success') });
    cOld.value = '';
    cNew.value = '';
  } catch (e) {
    showServerError(extractApiErrorCodeOrDefault(e, 'OLD_PASSWORD_WRONG'));
  }
}
</script>

<template>
  <div
    class="min-h-screen w-full flex items-center justify-center p-4 bg-ink-900 bg-cover bg-center"
    style="background-image: url('/background/auth-bg.svg')"
  >
    <div
      class="w-full max-w-md border-2 border-ink-300/60 rounded-md bg-ink-700/40 backdrop-blur-md p-6 shadow-2xl"
    >
      <XTPageEyebrow label="Tiên Sơn Bốc Định" />
      <h1 class="text-3xl text-center text-ink-100 tracking-widest mt-1">{{ t('app.brand') }}</h1>
      <p class="text-center text-ink-300 italic mt-2 text-sm">"{{ proverb }}"</p>

      <div class="flex justify-center gap-1 mt-5 border-b border-ink-300/40">
        <button
          v-for="tk in (['login', 'register', 'change'] as const)"
          :key="tk"
          class="px-3 py-2 text-sm transition"
          :class="tab === tk ? 'text-ink-50 border-b-2 border-ink-300' : 'text-ink-300'"
          @click="tab = tk"
        >
          {{ t(`auth.tab.${tk}`) }}
        </button>
      </div>

      <form v-if="tab === 'login'" class="mt-5 space-y-3" @submit.prevent="onLogin">
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.login.email') }}</span>
          <input
            v-model="lEmail"
            type="email"
            required
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.login.password') }}</span>
          <input
            v-model="lPassword"
            type="password"
            required
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <div class="flex items-center justify-between text-xs">
          <label class="flex items-center gap-2 text-ink-300">
            <input v-model="lRemember" type="checkbox" /> {{ t('auth.login.remember') }}
          </label>
          <router-link
            to="/auth/forgot-password"
            class="text-ink-300 underline hover:text-ink-50"
            data-testid="auth-forgot-link"
          >
            {{ t('auth.forgot.title') }}
          </router-link>
        </div>
        <p class="text-ink-300/70 text-xs">{{ t('auth.login.note') }}</p>
        <MButton type="submit" :loading="auth.loading" class="w-full">
          {{ t('auth.login.submit') }}
        </MButton>
      </form>

      <form v-else-if="tab === 'register'" class="mt-5 space-y-3" @submit.prevent="onRegister">
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.login.email') }}</span>
          <input
            v-model="rEmail"
            type="email"
            required
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.login.password') }}</span>
          <input
            v-model="rPassword"
            type="password"
            required
            minlength="8"
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <div class="text-xs text-ink-300">
          {{ t('auth.register.strength') }}
          <span class="font-bold text-ink-50">{{ rStrengthLabel }}</span>
          <div class="h-1 mt-1 rounded bg-ink-900/60 overflow-hidden">
            <div
              class="h-full bg-ink-300 transition-all"
              :style="{ width: (rStrength * 20) + '%' }"
            />
          </div>
        </div>
        <MButton type="submit" :loading="auth.loading" class="w-full">
          {{ t('auth.register.submit') }}
        </MButton>
      </form>

      <form v-else class="mt-5 space-y-3" @submit.prevent="onChange">
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.change.old') }}</span>
          <input
            v-model="cOld"
            type="password"
            required
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <label class="block">
          <span class="text-ink-300 text-sm">{{ t('auth.change.new') }}</span>
          <input
            v-model="cNew"
            type="password"
            required
            minlength="8"
            class="mt-1 w-full bg-ink-900/60 border border-ink-300/40 rounded px-3 py-2 text-ink-50"
          />
        </label>
        <MButton type="submit" class="w-full">{{ t('auth.change.submit') }}</MButton>
      </form>
    </div>
  </div>
</template>
