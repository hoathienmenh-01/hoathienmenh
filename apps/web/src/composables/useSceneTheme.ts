import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';
import { playSceneBgm, stopBgm } from '@/lib/bgm';

/**
 * Cửu Thiên Mộng — bind `body[data-scene]` to the current route group so the
 * fixed scene art (style.css `.xt-scene` + `body[data-scene=*]`) updates as
 * the user navigates.
 *
 * Mapping is intentionally coarse — one art per route group, not per page:
 *   /dashboard, /home               → dashboard
 *   /cultivation*, /breakthrough,
 *   /body-cultivation,
 *   /spiritual-root, /mentor        → cultivation
 *   /boss*, /pvp*, /arena*,
 *   /tribulation*,
 *   /sect-war*                       → boss
 *   /dungeon*, /secret-realm*,
 *   /roguelike, /trial-tower,
 *   /territory                      → secret
 *   /sect*, /social, /chat, /mail   → sect
 *   /market*, /shop*, /inventory*,
 *   /loadout, /pets,
 *   /artifact*, /cosmetic           → market
 *
 * All other routes fall back to "default" which uses the night gradient
 * without scene art.
 */
export type SceneKey =
  | 'dashboard'
  | 'cultivation'
  | 'boss'
  | 'secret'
  | 'sect'
  | 'market'
  | 'default';

export type AmbientTone =
  | 'default'
  | 'cultivation'
  | 'boss'
  | 'secret'
  | 'sect'
  | 'market';

const SCENE_RULES: Array<[RegExp, SceneKey]> = [
  [/^\/(dashboard|home)(\/|$)/, 'dashboard'],
  [
    /^\/(cultivation(-method)?(-v2)?|body-cultivation|breakthrough|spiritual-root|mentor|talents?)/,
    'cultivation',
  ],
  [
    /^\/(boss|boss-hub|pvp|arena|tribulation|sect-war|encounter)/,
    'boss',
  ],
  [
    /^\/(dungeon|dungeon-run|dungeon-hub-v2|secret-realm|secret-realms|story-dungeon|story|story-v2|roguelike|trial-tower|territory|farm-map|world-content|world-content-v2)/,
    'secret',
  ],
  [/^\/(sect|sect-content|social|chat|mail|npc|leaderboard|seasons|reputation)/, 'sect'],
  [
    /^\/(market|market-v2|shop|shop-packs|inventory|inventory-auto-sort|loadout|pets|artifact|artifact-v2|cosmetic|title|wallet|topup|monetization|monetization-shop|monetization-dac-quyen|alchemy|skill-book|phap-bao|homestead)/,
    'market',
  ],
];

function resolveScene(path: string): SceneKey {
  for (const [rx, key] of SCENE_RULES) {
    if (rx.test(path)) return key;
  }
  return 'default';
}

function sceneToTone(scene: SceneKey): AmbientTone {
  if (scene === 'dashboard') return 'default';
  return scene;
}

export interface UseSceneThemeResult {
  scene: ComputedRef<SceneKey>;
  tone: ComputedRef<AmbientTone>;
}

export function useSceneTheme(): UseSceneThemeResult {
  const route = useRoute();
  const sceneRef = ref<SceneKey>(resolveScene(route.path));

  function apply(path: string): void {
    const scene = resolveScene(path);
    if (sceneRef.value !== scene) {
      sceneRef.value = scene;
    }
    if (typeof document === 'undefined') return;
    document.body.dataset.scene = scene;
    document.body.classList.add('xt-scene');
    playSceneBgm(scene);
  }

  onMounted(() => {
    apply(route.path);
  });

  watch(
    () => route.path,
    (next) => {
      apply(next);
    },
  );

  onUnmounted(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.remove('xt-scene');
    delete document.body.dataset.scene;
    stopBgm();
  });

  return {
    scene: computed(() => sceneRef.value),
    tone: computed(() => sceneToTone(sceneRef.value)),
  };
}

export const __test__ = { resolveScene, sceneToTone };
