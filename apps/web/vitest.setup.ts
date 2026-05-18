/**
 * Vitest global setup — register stubs cho router component để dập
 * `[Vue warn]: Failed to resolve component: router-link` khi test mount
 * view nhưng KHÔNG `app.use(router)` (default cho unit test pattern).
 *
 * Per-test `vi.mock('vue-router', () => ({ RouterLink: {...} }))` chỉ stub
 * named export (cho `import { RouterLink } from 'vue-router'` pattern) —
 * KHÔNG register Vue component global cho `<router-link>` template tag.
 * Setup này dùng `@vue/test-utils` `config.global.stubs` để register cả 2
 * casing (`RouterLink` PascalCase + `router-link` kebab-case) làm anchor
 * stub render `<slot />` trong `<a>` — đủ cho `find('a')` / `text()`
 * assertion.
 */
import { config } from '@vue/test-utils';

const RouterLinkStub = {
  name: 'RouterLinkStub',
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : (to?.path ?? \'#\')"><slot /></a>',
};

config.global.stubs = {
  ...config.global.stubs,
  RouterLink: RouterLinkStub,
  'router-link': RouterLinkStub,
};

/**
 * Locale-stable Intl.NumberFormat — Node.js sandbox thiếu full ICU data
 * cho `vi-VN` nên `.toLocaleString()` fallback về locale khác. Mock
 * `Number.prototype.toLocaleString` để dùng `en-US` khi gọi không có
 * locale arg (component templates dùng `.toLocaleString()` không arg),
 * nhưng giữ nguyên behavior khi caller truyền locale tường minh
 * (xianxiaFormat.ts dùng `Intl.NumberFormat('vi-VN')`).
 */
const _origToLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
  locales?: string | string[],
  options?: Intl.NumberFormatOptions,
) {
  // Nếu caller không truyền locale → force en-US cho consistent test output
  // Nếu caller truyền locale tường minh → giữ nguyên (xianxiaFormat test)
  if (locales === undefined) {
    return _origToLocaleString.call(this, 'en-US', options);
  }
  return _origToLocaleString.call(this, locales, options);
};
