import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 12 Story Dialogue Foundation — FE API client.
 *
 * Wire 2 endpoint:
 *   - `GET  /story/dialogue/:npcKey`        → current branching dialogue node.
 *   - `POST /story/dialogue/:npcKey/choice` → apply choice effects, get next node.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface StoryDialogueChoiceView {
  key: string;
  label: string;
  labelEn?: string;
  available: boolean;
  unavailableReason: string | null;
  nextNodeId: string | null;
  alreadyApplied: boolean;
  /** Phase 12.9 — player đã từng pick exact choice này ở node parent. */
  previouslyChosen: boolean;
}

export interface StoryDialogueNodeView {
  nodeId: string;
  npcKey: string;
  questKey: string | null;
  text: string;
  textEn?: string;
  seen: boolean;
  /** Phase 12.9 — choiceKey đã pick gần nhất ở node này, null nếu chưa. */
  previousChoiceKey: string | null;
  choices: StoryDialogueChoiceView[];
}

export interface StoryDialogueChoiceResult {
  effectsApplied: ReadonlyArray<{ kind: string; [k: string]: unknown }>;
  granted: { linhThach: number; tienNgoc: number; exp: number };
  flags: Record<string, string | number | boolean>;
  seen: ReadonlyArray<string>;
  /** Phase 12.9 — snapshot map nodeId → choiceKey sau apply. */
  choices: Readonly<Record<string, string>>;
  nextNode: StoryDialogueNodeView | null;
}

export async function fetchStoryDialogue(npcKey: string): Promise<StoryDialogueNodeView> {
  const { data } = await apiClient.get<Envelope<{ node: StoryDialogueNodeView }>>(
    `/story/dialogue/${encodeURIComponent(npcKey)}`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('storyDialogue');
  return data.data.node;
}

export async function submitStoryDialogueChoice(
  npcKey: string,
  nodeId: string,
  choiceKey: string,
): Promise<StoryDialogueChoiceResult> {
  const { data } = await apiClient.post<Envelope<StoryDialogueChoiceResult>>(
    `/story/dialogue/${encodeURIComponent(npcKey)}/choice`,
    { nodeId, choiceKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('storyDialogue');
  return data.data;
}
