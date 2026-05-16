import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * OnboardingView smoke tests (session 9j task G / K3.5): cover onMounted
 * routing (unauth redirect + already-has-char redirect), 4-step wizard
 * navigation (prev/next + step counter), name validation (tooShort/tooLong/
 * invalid chars), sect selection (3 sects, default thanh_van), finish flow
 * (success redirect /home + toast, error NAME_TAKEN rolls back to step 2 +
 * toast, unknown error fallback UNKNOWN).
 *
 * OnboardingView quyết định liệu người chơi mới có thể tạo nhân vật — bug
 * sẽ block toàn bộ tân thủ. Test chống regression khi refactor api/character
 * hoặc rename i18n key.
 */

const getCharacterMock = vi.fn();
const onboardMock = vi.fn();

vi.mock('@/api/character', async () => {
  const actual = await vi.importActual<typeof import('@/api/character')>('@/api/character');
  return {
    ...actual,
    getCharacter: (...a: unknown[]) => getCharacterMock(...a),
    onboard: (...a: unknown[]) => onboardMock(...a),
  };
});

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

import OnboardingViewComponent from '@/views/OnboardingView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { prev: 'Trước', next: 'Tiếp' },
      auth: {
        register: { success: 'Tạo nhân vật thành công' },
        errors: { UNKNOWN: 'Có lỗi xảy ra.' },
      },
      onboarding: {
        alinhName: 'A Linh',
        alinhRole: 'Tiểu yêu dẫn đường',
        step1: {
          title: 'Chào đạo hữu',
          lines: ['Dòng 1', 'Dòng 2'],
        },
        step2: {
          title: 'Đặt tên',
          label: 'Danh xưng',
          placeholder: 'Nhập tên…',
          errors: {
            tooShort: 'Tên quá ngắn.',
            tooLong: 'Tên quá dài.',
            invalid: 'Tên không hợp lệ.',
            taken: 'Tên đã có người dùng.',
          },
        },
        step3: {
          title: 'Chọn tông môn',
          lines: ['Hãy chọn tông môn phù hợp'],
          sects: {
            thanh_van: { name: 'Thanh Vân', desc: 'Cân bằng' },
            huyen_thuy: { name: 'Huyền Thủy', desc: 'Thủ thế' },
            tu_la: { name: 'Tu La', desc: 'Tấn công' },
          },
        },
        step4: {
          title: 'Xác nhận',
          lines: ['Đạo hữu {name}, sẵn sàng chưa?', 'Đường tu tiên bắt đầu.'],
          submit: 'Bắt đầu tu tiên',
        },
      },
    },
  },
});

function mountView() {
  return mount(OnboardingViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  getCharacterMock.mockReset();
  onboardMock.mockReset();
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
});

describe('OnboardingView — onMounted routing', () => {
  it('unauth → replace /auth + không gọi getCharacter', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getCharacterMock).not.toHaveBeenCalled();
  });

  it('auth + đã có character → replace /home (skip onboarding)', async () => {
    getCharacterMock.mockResolvedValue({ id: 'c1', name: 'Existing', sectKey: 'thanh_van' });
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/home');
  });

  it('auth + chưa có character → không redirect, hiện step 1', async () => {
    getCharacterMock.mockResolvedValue(null);
    const w = mountView();
    await flushPromises();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('Chào đạo hữu');
    expect(w.text()).toContain('1 / 4');
  });

  it('auth + getCharacter throw → treated as no character (không redirect)', async () => {
    getCharacterMock.mockRejectedValue(new Error('net'));
    const w = mountView();
    await flushPromises();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('1 / 4');
  });
});

describe('OnboardingView — step navigation', () => {
  beforeEach(() => {
    getCharacterMock.mockResolvedValue(null);
  });

  it('step 1 → click next → step 2; prev button disabled ở step 1', async () => {
    const w = mountView();
    await flushPromises();
    const prevBtn = w.findAll('button').find((b) => b.text() === 'Trước')!;
    expect(prevBtn.attributes('disabled')).toBeDefined();

    const nextBtn = w.findAll('button').find((b) => b.text() === 'Tiếp')!;
    await nextBtn.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Đặt tên');
    expect(w.text()).toContain('2 / 4');
  });

  it('step 2: nếu name rỗng → nextStep không advance', async () => {
    const w = mountView();
    await flushPromises();
    const nextBtn = w.findAll('button').find((b) => b.text() === 'Tiếp')!;
    await nextBtn.trigger('click'); // go to step 2
    await flushPromises();
    expect(w.text()).toContain('2 / 4');
    await nextBtn.trigger('click'); // try advance with empty name
    await flushPromises();
    expect(w.text()).toContain('2 / 4'); // stays on step 2
  });

  it('step 2: name hợp lệ → nextStep advance tới step 3', async () => {
    const w = mountView();
    await flushPromises();
    let nextBtn = w.findAll('button').find((b) => b.text() === 'Tiếp')!;
    await nextBtn.trigger('click'); // step 2
    await flushPromises();
    await w.find('input[type="text"]').setValue('DaoHuu');
    await flushPromises();
    nextBtn = w.findAll('button').find((b) => b.text() === 'Tiếp')!;
    await nextBtn.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Chọn tông môn');
    expect(w.text()).toContain('3 / 4');
  });

  it('step 4: prev quay về step 3 + hiển thị submit button', async () => {
    const w = mountView();
    await flushPromises();
    // 1 → 2
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    await w.find('input[type="text"]').setValue('TestName');
    await flushPromises();
    // 2 → 3
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    // 3 → 4
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    expect(w.text()).toContain('4 / 4');
    expect(w.text()).toContain('Bắt đầu tu tiên');
    // prev back to 3
    await (w.findAll('button').find((b) => b.text() === 'Trước')!).trigger('click');
    await flushPromises();
    expect(w.text()).toContain('3 / 4');
  });
});

describe('OnboardingView — name validation', () => {
  beforeEach(() => {
    getCharacterMock.mockResolvedValue(null);
  });

  async function gotoStep2(w: ReturnType<typeof mountView>) {
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
  }

  it('name 2 ký tự → tooShort error', async () => {
    const w = mountView();
    await flushPromises();
    await gotoStep2(w);
    await w.find('input[type="text"]').setValue('ab');
    await flushPromises();
    expect(w.text()).toContain('Tên quá ngắn.');
  });

  it('name > 16 ký tự → tooLong error', async () => {
    const w = mountView();
    await flushPromises();
    await gotoStep2(w);
    await w.find('input[type="text"]').setValue('a'.repeat(17));
    await flushPromises();
    expect(w.text()).toContain('Tên quá dài.');
  });

  it('name có ký tự đặc biệt (!@#) → invalid error', async () => {
    const w = mountView();
    await flushPromises();
    await gotoStep2(w);
    await w.find('input[type="text"]').setValue('Bad!Name');
    await flushPromises();
    expect(w.text()).toContain('Tên không hợp lệ.');
  });

  it('name có tiếng Việt có dấu → OK, không error', async () => {
    const w = mountView();
    await flushPromises();
    await gotoStep2(w);
    await w.find('input[type="text"]').setValue('ĐạoHữuXuânTôi');
    await flushPromises();
    expect(w.text()).not.toContain('Tên không hợp lệ.');
    expect(w.text()).not.toContain('Tên quá ngắn.');
    expect(w.text()).not.toContain('Tên quá dài.');
  });
});

describe('OnboardingView — sect selection + finish flow', () => {
  beforeEach(() => {
    getCharacterMock.mockResolvedValue(null);
  });

  async function gotoStep4WithName(w: ReturnType<typeof mountView>, nameVal: string) {
    // step 1 → 2
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    await w.find('input[type="text"]').setValue(nameVal);
    await flushPromises();
    // 2 → 3
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    // 3 → 4
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
  }

  it('finish success: onboard gọi với (name, sectKey=thanh_van default) + toast + router.replace /home', async () => {
    onboardMock.mockResolvedValue({ id: 'c1' });
    const w = mountView();
    await flushPromises();
    await gotoStep4WithName(w, 'DaoHuu');

    const submitBtn = w.findAll('button').find((b) => b.text() === 'Bắt đầu tu tiên')!;
    await submitBtn.trigger('click');
    await flushPromises();

    expect(onboardMock).toHaveBeenCalledWith({ name: 'DaoHuu', sectKey: 'thanh_van' });
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Tạo nhân vật thành công',
    });
    expect(routerReplaceMock).toHaveBeenCalledWith('/home');
  });

  it('finish success sau khi chọn sect tu_la: onboard với sectKey=tu_la', async () => {
    onboardMock.mockResolvedValue({ id: 'c1' });
    const w = mountView();
    await flushPromises();
    // step 1 → 2 → 3
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    await w.find('input[type="text"]').setValue('MoTien');
    await flushPromises();
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    // step 3: click tu_la
    const tuLaBtn = w.findAll('button').find((b) => b.text().includes('Tu La'))!;
    await tuLaBtn.trigger('click');
    await flushPromises();
    // 3 → 4
    await (w.findAll('button').find((b) => b.text() === 'Tiếp')!).trigger('click');
    await flushPromises();
    // submit
    await (w.findAll('button').find((b) => b.text() === 'Bắt đầu tu tiên')!).trigger('click');
    await flushPromises();

    expect(onboardMock).toHaveBeenCalledWith({ name: 'MoTien', sectKey: 'tu_la' });
  });

  it('finish error NAME_TAKEN → toast + rollback về step 2', async () => {
    onboardMock.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'NAME_TAKEN' }),
    );
    const w = mountView();
    await flushPromises();
    await gotoStep4WithName(w, 'TakenName');

    await (w.findAll('button').find((b) => b.text() === 'Bắt đầu tu tiên')!).trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Tên đã có người dùng.',
    });
    expect(w.text()).toContain('2 / 4');
    expect(routerReplaceMock).not.toHaveBeenCalledWith('/home');
  });

  it('finish error code khác → toast fallback auth.errors.UNKNOWN, giữ step 4', async () => {
    onboardMock.mockRejectedValue(
      Object.assign(new Error('server'), { code: 'RATE_LIMITED' }),
    );
    const w = mountView();
    await flushPromises();
    await gotoStep4WithName(w, 'SomeName');

    await (w.findAll('button').find((b) => b.text() === 'Bắt đầu tu tiên')!).trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
    expect(w.text()).toContain('4 / 4');
  });
});

describe('OnboardingView — Cửu Thiên Mộng Phase 3 polish', () => {
  beforeEach(() => {
    getCharacterMock.mockResolvedValue(null);
  });

  it('render XTPageEyebrow với label Cửu Thiên Mộng Cảnh (thuần Việt, không còn chữ Hán)', async () => {
    const w = mountView();
    await flushPromises();
    const eyebrow = w.find('[data-testid="xt-page-eyebrow"]');
    expect(eyebrow.exists()).toBe(true);
    expect(eyebrow.text()).toContain('Cửu Thiên Mộng Cảnh');
    // PR3.5 — bảo đảm không còn ký tự Hán nào trong eyebrow.
    expect(/[\u4e00-\u9fff]/.test(eyebrow.html())).toBe(false);
  });
});
