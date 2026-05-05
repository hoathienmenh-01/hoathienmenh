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
