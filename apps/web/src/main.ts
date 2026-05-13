import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';
import { initSentryWeb } from './lib/sentry';
import './design/tokens.css';
import './style.css';
import './style/cosmetics.css';
import './style/visual-effects.css';

const app = createApp(App);
// Phase 17.3 — Sentry init phải sau createApp + trước mount để Vue
// errorHandler attach được. No-op nếu VITE_SENTRY_DSN_WEB trống.
initSentryWeb(app, router);
app.use(createPinia());
app.use(router);
app.use(i18n);
app.mount('#app');
