/**
 * Phase 33.0B — Story Quest Dialogue Catalog (Quyển II–IV).
 *
 * Lớp dialogue gắn-trực-tiếp-vào-quest cho catalog `STORY_QUEST_EXPANSION`:
 *
 *   - Mỗi `Phase33QuestDialogueDef` là một dòng thoại `textVi/textEn` thuộc một
 *     phase trong vòng đời quest (INTRO/ACCEPT/IN_PROGRESS/COMPLETE/CLAIMED và
 *     các phase chuyên biệt cho HIDDEN/BRANCH/BOSS).
 *   - File này CỐ Ý tách khỏi `story-dialogues.ts` (Phase 12 cutscene branching
 *     có effects[] persistence) và `dialogues.ts` (Phase 12 NPC quick-accept).
 *     Mục tiêu Phase 33.0B chỉ là **catalog read-only** cho runtime sau (Phase
 *     33.1) consume — không gắn effects, không gắn flag mutator, không phá main
 *     plot. Story flag mutate vẫn đi qua quest reward `storyFlags` như cũ.
 *   - Source priority (file 4 Master > file 1–3 Quyển docx → tự viết khi nguồn
 *     chỉ có tóm tắt sự kiện): các docx nguồn KHÔNG có dialogue chi tiết per
 *     quest, do đó các dòng dưới đây được **viết mới** trong khuôn khổ logic
 *     thế giới (tu tiên cổ phong, không hiện đại, không phá kết quả chương).
 *
 * Coverage core Phase 33.0B (theo spec "Quest Dialogue Writing Rules"):
 *
 *   - MAIN (304 quest)   : INTRO + ACCEPT + IN_PROGRESS + COMPLETE + CLAIMED.
 *   - MAIN boss climax   : thêm BOSS_PRE + BOSS_VICTORY (q05/chap, 19 quest).
 *   - HIDDEN (57 quest)  : HIDDEN_HINT + HIDDEN_TRIGGER + COMPLETE + AFTERMATH.
 *   - BRANCH (114 quest) : INTRO (opening) + AFTERMATH (ending).
 *
 * Side / daily / weekly chưa cover trong file này — sẽ làm stacked sau (PR A
 * future expansion) nếu credit cho phép. Side quest đã có descriptionVi/En
 * đủ ngữ cảnh nhập vai ngắn.
 *
 * Naming convention `dialogueId`: `dlg_<questKey>_<PHASE>` (unique).
 */

import { NPCS } from './npcs';
import { STORY_CHAPTERS_V2 } from './story-chapters-quyen-ii-iv';
import { STORY_QUEST_EXPANSION, type Phase33QuestDef } from './story-quest-expansion';

export type Phase33DialoguePhase =
  | 'INTRO'
  | 'ACCEPT'
  | 'IN_PROGRESS'
  | 'READY_TO_COMPLETE'
  | 'COMPLETE'
  | 'CLAIMED'
  | 'HIDDEN_HINT'
  | 'HIDDEN_TRIGGER'
  | 'BOSS_PRE'
  | 'BOSS_START'
  | 'BOSS_VICTORY'
  | 'AFTERMATH';

export interface Phase33QuestDialogueDef {
  readonly dialogueId: string;
  readonly questKey: string;
  readonly chapterKey: string;
  readonly speakerNpcKey: string;
  readonly phase: Phase33DialoguePhase;
  readonly textVi: string;
  readonly textEn: string;
  /** Optional chain reference (no runtime effect in Phase 33.0B). */
  readonly nextDialogueId: string | null;
  /** Story flag mutate stays inside quest rewards; dialog chỉ ghi nhận để UI hint. */
  readonly setStoryFlags: readonly string[];
}

/* ────────────────────────── chapter context helpers ────────────────────────── */

interface ChapterCtx {
  readonly chapKey: string;
  readonly chapNumber: number;
  readonly realmOrder: number;
  readonly volumeKey: string;
  readonly primaryNpc: string;
  readonly secondaryNpc: string;
  readonly hiddenNpc: string;
  readonly bossKey: string;
  readonly bossName: string;
  readonly dungeonKey: string;
  readonly regionKey: string;
  readonly regionName: string;
  readonly themeVi: string;
  readonly themeEn: string;
  readonly summaryVi: string;
  readonly summaryEn: string;
  readonly tier: 'tien_gioi' | 'thanh_dao' | 'ban_nguyen';
}

const NPC_NAME_BY_KEY: Record<string, string> = Object.fromEntries(
  NPCS.map((n) => [n.key, n.name]),
);

function npcName(key: string): string {
  return NPC_NAME_BY_KEY[key] ?? key;
}

/** Strip leading `boss_` / `region_` prefix and titlecase for display. */
function prettifyKey(key: string): string {
  const stripped = key.replace(/^(boss|region|monster|reward_item|item|ch\d{2})_/, '');
  return stripped
    .split('_')
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function chapterTier(realmOrder: number): ChapterCtx['tier'] {
  if (realmOrder <= 16) return 'tien_gioi';
  if (realmOrder <= 21) return 'thanh_dao';
  return 'ban_nguyen';
}

function regionKeyForChapter(chapKey: string): string {
  for (const q of STORY_QUEST_EXPANSION) {
    if (q.chapKey !== chapKey) continue;
    for (const step of q.steps) {
      if (step.targetType === 'region') return step.targetId;
    }
  }
  return `region_${chapKey}`;
}

function buildChapterCtx(): readonly ChapterCtx[] {
  return STORY_CHAPTERS_V2.map((c) => {
    const regionKey = regionKeyForChapter(c.chapKey);
    return {
      chapKey: c.chapKey,
      chapNumber: c.chapNumber,
      realmOrder: c.requiredRealmOrder,
      volumeKey: c.volumeKey,
      primaryNpc: c.mainNpcKeys[0] ?? 'npc_lang_van_sinh',
      secondaryNpc: c.mainNpcKeys[1] ?? c.mainNpcKeys[0] ?? 'npc_lang_van_sinh',
      hiddenNpc: c.mainNpcKeys[2] ?? c.mainNpcKeys[0] ?? 'npc_lang_van_sinh',
      bossKey: c.bossKeys[0] ?? `boss_${c.chapKey}`,
      bossName: prettifyKey(c.bossKeys[0] ?? `boss_${c.chapKey}`),
      dungeonKey: c.storyDungeonKeys[0] ?? c.chapKey,
      regionKey,
      regionName: prettifyKey(regionKey),
      themeVi: c.themeVi,
      themeEn: c.themeEn,
      summaryVi: c.summaryVi,
      summaryEn: c.summaryEn,
      tier: chapterTier(c.requiredRealmOrder),
    };
  });
}

const CHAPTER_CTX: readonly ChapterCtx[] = buildChapterCtx();
const CTX_BY_KEY: Map<string, ChapterCtx> = new Map(CHAPTER_CTX.map((c) => [c.chapKey, c]));

/* ────────────────────── per-tier prefix flavour text ────────────────────── */

interface TierFlavour {
  readonly addressVi: string;
  readonly addressEn: string;
  readonly questGiverTitleVi: string;
  readonly questGiverTitleEn: string;
}

const TIER_FLAVOUR: Record<ChapterCtx['tier'], TierFlavour> = {
  tien_gioi: {
    addressVi: 'đạo hữu',
    addressEn: 'fellow seeker',
    questGiverTitleVi: 'Tiền bối',
    questGiverTitleEn: 'Senior',
  },
  thanh_dao: {
    addressVi: 'đạo hữu',
    addressEn: 'dao companion',
    questGiverTitleVi: 'Thánh sứ',
    questGiverTitleEn: 'Saint envoy',
  },
  ban_nguyen: {
    addressVi: 'đạo hữu',
    addressEn: 'origin-walker',
    questGiverTitleVi: 'Vô thủy giả',
    questGiverTitleEn: 'Beginningless one',
  },
};

/* ────────────────────── MAIN quest dialogue templates ────────────────────── */

/**
 * Mỗi MAIN quest có 5 phase chính. Tone xoay theo `realmOrder` và quest seq.
 * Boss climax (`_main_05`) thêm BOSS_PRE/BOSS_VICTORY ở khối dưới.
 */
function mainPhaseLines(
  q: Phase33QuestDef,
  ctx: ChapterCtx,
  phase: 'INTRO' | 'ACCEPT' | 'IN_PROGRESS' | 'COMPLETE' | 'CLAIMED',
): { vi: string; en: string } {
  const flav = TIER_FLAVOUR[ctx.tier];
  const giverName = npcName(q.giverNpcKey);
  const seq = q.questKey.split('_').pop() ?? '01';
  const seqNum = Number.parseInt(seq, 10) || 1;
  // Variant pool per phase — 5 lines, indexed by quest seq. Mỗi template tham
  // chiếu ít nhất một token chapter-specific (ctx.regionName / ctx.bossName /
  // ctx.themeVi / chapNumber) để đảm bảo per-chapter uniqueness, tránh sinh ra
  // dialogue trùng exact text hàng loạt giữa các chương.
  const VI: Record<typeof phase, readonly string[]> = {
    INTRO: [
      `${giverName} chống tay nhìn ${ctx.regionName}, hạ giọng: "Có chuyện ${ctx.regionName} cần ${flav.addressVi} gánh."`,
      `${giverName} kéo ngươi đứng cạnh, chỉ vào bản đồ: "Tuyến chương ${ctx.chapNumber} mới dấy động ở ${ctx.regionName}."`,
      `${giverName} chậm rãi rót trà: "Chương ${ctx.chapNumber} chưa lớn, nhưng cần ${flav.addressVi} ra mặt sớm — ${ctx.themeVi}"`,
      `${giverName} thở dài: "Lần này ${ctx.regionName} không cho mượn đao — ${flav.addressVi} phải tự cầm."`,
      `${giverName} thu kiếm vào bao: "Một mạch ${ctx.themeVi} đang gãy quanh ${ctx.regionName}. Theo ta."`,
    ],
    ACCEPT: [
      `${giverName}: "Ghi nhận. Ngươi đi trước về ${ctx.regionName}, ta báo cho hậu trận chương ${ctx.chapNumber}."`,
      `${giverName}: "Tốt. Lệnh giao cho ${flav.addressVi}, không qua tay người thứ hai — chương ${ctx.chapNumber} không cho phép trễ."`,
      `${giverName}: "Chấp thuận. Đến ${ctx.regionName} trước hoàng hôn, trước khi ${ctx.themeVi} kịp đổi nhịp."`,
      `${giverName}: "Được, nhưng giữ mạng — chương ${ctx.chapNumber} ta cần ${flav.addressVi} sống đến cuối ${ctx.regionName}."`,
      `${giverName}: "Lệnh truyền đi quanh ${ctx.regionName}. Khoảng cách thiên cơ chỉ vài canh giờ."`,
    ],
    IN_PROGRESS: [
      `${giverName}: "Chưa xong sao? ${flav.addressVi} cứ thẳng đường về ${ctx.regionName} — đừng nhìn lại."`,
      `${giverName}: "Lửa ${ctx.regionName} chưa tắt. Đi tiếp — chương ${ctx.chapNumber} không đợi."`,
      `${giverName}: "Ta đợi tin từ ${ctx.regionName}. Một nhịp chậm là một mạng người."`,
      `${giverName}: "${flav.addressVi} mệt thì ngồi xuống ven ${ctx.regionName}, nhưng chuyện không chờ."`,
      `${giverName}: "Đường ${ctx.regionName} còn dài. Đừng quay đầu giữa chừng."`,
    ],
    COMPLETE: [
      `${giverName} đón ngươi ngay cửa ${ctx.regionName}: "Đã xong. Bụi trên áo cũng đáng giá chương ${ctx.chapNumber}."`,
      `${giverName} gật đầu: "Tốt. Tuyến chương ${ctx.chapNumber} vẫn còn nguyên — nhờ ${flav.addressVi}."`,
      `${giverName}: "Việc ${ctx.regionName} xong rồi. Hớp trà này, ta nói tiếp."`,
      `${giverName}: "Không tệ. Có ${flav.addressVi}, ta đỡ phải tự đi ${ctx.regionName}."`,
      `${giverName}: "Hoàn tất quanh ${ctx.regionName}. Bước kế tiếp của chương ${ctx.chapNumber} ta đã sắp lệnh."`,
    ],
    CLAIMED: [
      `${giverName}: "Phần thưởng chương ${ctx.chapNumber} ngươi nhận đi. Lệnh kế tiếp ta sẽ phát qua truyền tin."`,
      `${giverName}: "Cầm lấy. Đừng để vật này lẫn vào hành lý chiến trường ${ctx.regionName}."`,
      `${giverName}: "Giữ vật, giữ mạng. Chương ${ctx.chapNumber + 1} còn việc nặng hơn."`,
      `${giverName}: "Đây là phần ${flav.addressVi} đáng nhận cho chương ${ctx.chapNumber}. Đừng nhường."`,
      `${giverName}: "Phần thưởng đã trao quanh ${ctx.regionName}. Đường tu tiếp tục."`,
    ],
  };
  const EN: Record<typeof phase, readonly string[]> = {
    INTRO: [
      `${giverName} folds hands over ${ctx.regionName}, voice low: "${ctx.regionName} needs a ${flav.addressEn} to shoulder it."`,
      `${giverName} pulls you beside the map: "The Chapter ${ctx.chapNumber} thread has stirred over ${ctx.regionName}."`,
      `${giverName} pours tea slowly: "Chapter ${ctx.chapNumber} is not yet a calamity, but a ${flav.addressEn} must move early — ${ctx.themeEn}"`,
      `${giverName} sighs: "This time ${ctx.regionName} loans no blade — only the ${flav.addressEn}'s own."`,
      `${giverName} sheathes the sword: "A vein of ${ctx.themeEn} cracks around ${ctx.regionName}. Follow me."`,
    ],
    ACCEPT: [
      `${giverName}: "Acknowledged. Go ahead to ${ctx.regionName} — I shall warn Chapter ${ctx.chapNumber}'s rear."`,
      `${giverName}: "Good. The order rests with this ${flav.addressEn} only — Chapter ${ctx.chapNumber} brooks no delay."`,
      `${giverName}: "Granted. Be at ${ctx.regionName} before dusk, before ${ctx.themeEn} shifts pace."`,
      `${giverName}: "Agreed, but keep your life — Chapter ${ctx.chapNumber} needs this ${flav.addressEn} until the end of ${ctx.regionName}."`,
      `${giverName}: "Word goes out around ${ctx.regionName}. The window for heaven's sign is mere watches."`,
    ],
    IN_PROGRESS: [
      `${giverName}: "Not done yet? Press on toward ${ctx.regionName}, ${flav.addressEn} — never glance back."`,
      `${giverName}: "The fire over ${ctx.regionName} has not died. Move — Chapter ${ctx.chapNumber} will not wait."`,
      `${giverName}: "I am waiting for word from ${ctx.regionName}. A moment lost is a life lost."`,
      `${giverName}: "Sit if you must beside ${ctx.regionName}, but the matter will not wait."`,
      `${giverName}: "The road of ${ctx.regionName} is still long. No turning back midway."`,
    ],
    COMPLETE: [
      `${giverName} meets you at the gate of ${ctx.regionName}: "Done. Even the dust on your robe was worth Chapter ${ctx.chapNumber}."`,
      `${giverName} nods: "Good. The thread of Chapter ${ctx.chapNumber} holds — thanks to this ${flav.addressEn}."`,
      `${giverName}: "The work around ${ctx.regionName} is finished. Drink this cup before I continue."`,
      `${giverName}: "Not bad. With this ${flav.addressEn} here, I need not ride out to ${ctx.regionName}."`,
      `${giverName}: "Complete around ${ctx.regionName}. Chapter ${ctx.chapNumber}'s next step is already drafted."`,
    ],
    CLAIMED: [
      `${giverName}: "Take the Chapter ${ctx.chapNumber} reward. The next order will reach you by relay."`,
      `${giverName}: "Hold it close. Do not let it mix into a battlefield pack at ${ctx.regionName}."`,
      `${giverName}: "Guard the item, guard your life — heavier work waits in Chapter ${ctx.chapNumber + 1}."`,
      `${giverName}: "This is what a ${flav.addressEn} has earned for Chapter ${ctx.chapNumber}. Do not refuse it."`,
      `${giverName}: "Reward delivered around ${ctx.regionName}. Cultivation continues."`,
    ],
  };
  const idx = (seqNum - 1) % VI[phase].length;
  return { vi: VI[phase][idx]!, en: EN[phase][idx]! };
}

/* ────────────────────── BOSS climax (BOSS_PRE / VICTORY) ────────────────────── */

function bossPhaseLines(
  q: Phase33QuestDef,
  ctx: ChapterCtx,
  phase: 'BOSS_PRE' | 'BOSS_VICTORY',
): { vi: string; en: string } {
  const giverName = npcName(q.giverNpcKey);
  const tierAccent = ctx.tier === 'ban_nguyen'
    ? { vi: 'bản nguyên rung động', en: 'origin trembling' }
    : ctx.tier === 'thanh_dao'
      ? { vi: 'thánh quang ép xuống', en: 'saintly light pressing down' }
      : { vi: 'mây tiên cuộn vần', en: 'immortal clouds rolling' };
  if (phase === 'BOSS_PRE') {
    return {
      vi: `${giverName} chắn trước ngươi: "${ctx.bossName} đã hiện — ${tierAccent.vi}. Lùi nửa bước, ta đi đầu, ngươi đỡ cánh."`,
      en: `${giverName} stands before you: "${ctx.bossName} has surfaced — ${tierAccent.en}. Step back half a pace; I lead, you cover the flank."`,
    };
  }
  return {
    vi: `${giverName} lau máu nơi khoé miệng: "${ctx.bossName} ngã. Tuyến chương ${ctx.chapNumber} kết lại — nhưng tiếng vọng còn dài."`,
    en: `${giverName} wipes blood from the corner of his mouth: "${ctx.bossName} has fallen. The Chapter ${ctx.chapNumber} thread closes — but its echo travels far."`,
  };
}

/* ────────────────────── HIDDEN quest dialogue templates ────────────────────── */

function hiddenPhaseLines(
  q: Phase33QuestDef,
  ctx: ChapterCtx,
  phase: 'HIDDEN_HINT' | 'HIDDEN_TRIGGER' | 'COMPLETE' | 'AFTERMATH',
): { vi: string; en: string } {
  const speakerName = npcName(q.giverNpcKey);
  const hiddenSeq = q.questKey.split('_').pop() ?? '01';
  const hiddenIdx = Number.parseInt(hiddenSeq, 10) || 1;
  // 3 variants — h01 default, h02 double-flag-gate, h03 deep gate.
  // 3 variants. Mỗi template nhúng token chapter-specific (ctx.regionName /
  // ctx.themeVi / chapNumber / ctx.bossName) để hidden line khác nhau giữa
  // 19 chương — chống duplicate exact text.
  const VI: Record<typeof phase, readonly string[]> = {
    HIDDEN_HINT: [
      `${speakerName} ngập ngừng, mắt nhìn xa về ${ctx.regionName}: "Có chuyện chương ${ctx.chapNumber} ta không nói được giữa ban ngày... khi nào ${flavAddrVi(ctx)} đủ tin, hỏi lại ta."`,
      `${speakerName} chạm vào vết sẹo cũ: "Phía sau cửa kín ${ctx.regionName} còn một bóng. Ngày ${ctx.themeVi} lặng, ta sẽ chỉ đường."`,
      `${speakerName} cúi đầu: "Có một ký ức chương ${ctx.chapNumber} ta giấu mấy chục năm. Đợi ${flavAddrVi(ctx)} chịu nổi ${ctx.regionName}, ta mới kể."`,
    ],
    HIDDEN_TRIGGER: [
      `${speakerName} đẩy cửa hé về phía ${ctx.regionName}: "Vào đi — đừng khua động. Bóng cũ chương ${ctx.chapNumber} chỉ hiện một lần."`,
      `${speakerName} thắp đèn lưu ly: "Đường dưới ${ctx.regionName} mở rồi — chương ${ctx.chapNumber} cho phép. Bước nhẹ."`,
      `${speakerName} mở rương cũ: "Đoạn ký ức ${ctx.themeVi} này từng giết một người. Ngươi cầm lấy, chịu trách nhiệm."`,
    ],
    COMPLETE: [
      `${speakerName} thì thầm: "Ngươi đã thấy ${ctx.regionName}. Phần nặng nề nhất, ta gửi lại cho ${flavAddrVi(ctx)} giữ."`,
      `${speakerName} khẽ gật: "Chuyện chương ${ctx.chapNumber} dừng tại đây. Không truyền tai người thứ ba."`,
      `${speakerName} im lặng hồi lâu: "Một mảnh quá khứ ${ctx.themeVi} đã được trả về đúng chỗ. Cảm tạ ${flavAddrVi(ctx)}."`,
    ],
    AFTERMATH: [
      `${speakerName} quay đi, giọng nhẹ: "Sau hôm nay ở ${ctx.regionName}, ta nợ ${flavAddrVi(ctx)} một nén nhang."`,
      `${speakerName} ngước nhìn ${ctx.themeVi}: "Có những thứ chỉ ${flavAddrVi(ctx)} mới hiểu — phần còn lại của chương ${ctx.chapNumber} ta giữ."`,
      `${speakerName} đóng rương lại: "Mảnh ký ức ${ctx.regionName} đã ngủ. Ngàn năm nữa cũng vậy."`,
    ],
  };
  const EN: Record<typeof phase, readonly string[]> = {
    HIDDEN_HINT: [
      `${speakerName} hesitates, gaze toward ${ctx.regionName}: "There is a Chapter ${ctx.chapNumber} matter I cannot say in daylight... when this ${flavAddrEn(ctx)} earns trust, ask me again."`,
      `${speakerName} touches an old scar: "Behind the sealed door of ${ctx.regionName} waits a shadow. On a quiet ${ctx.themeEn} night I will point the way."`,
      `${speakerName} bows: "A Chapter ${ctx.chapNumber} memory I have hidden for decades. Only a ${flavAddrEn(ctx)} who can bear ${ctx.regionName} should hear."`,
    ],
    HIDDEN_TRIGGER: [
      `${speakerName} cracks the door toward ${ctx.regionName}: "Step in — do not stir the air. The Chapter ${ctx.chapNumber} shadow shows itself only once."`,
      `${speakerName} lights a glass lamp: "The corridor beneath ${ctx.regionName} has opened — Chapter ${ctx.chapNumber} permits. Walk softly."`,
      `${speakerName} unseals a worn coffer: "This memory of ${ctx.themeEn} once cost a life. Take it, and own the weight."`,
    ],
    COMPLETE: [
      `${speakerName} whispers: "You have seen ${ctx.regionName}. The heaviest piece I entrust to this ${flavAddrEn(ctx)}."`,
      `${speakerName} nods softly: "The Chapter ${ctx.chapNumber} matter stops here. No third tongue will carry it."`,
      `${speakerName} stays silent a long while: "A fragment of ${ctx.themeEn} past has returned to its place. Thanks, ${flavAddrEn(ctx)}."`,
    ],
    AFTERMATH: [
      `${speakerName} turns away, voice gentle: "After today at ${ctx.regionName}, I owe this ${flavAddrEn(ctx)} a stick of incense."`,
      `${speakerName} lifts gaze toward the ${ctx.themeEn}: "Some truths only a ${flavAddrEn(ctx)} can grasp — the rest of Chapter ${ctx.chapNumber} I keep."`,
      `${speakerName} closes the coffer: "The memory of ${ctx.regionName} sleeps. Even after a thousand years it remains so."`,
    ],
  };
  // h01 → idx 0, h02 → idx 1, h03 → idx 2 (clamp to pool size).
  const idx = Math.min(Math.max(hiddenIdx - 1, 0), VI[phase].length - 1);
  return { vi: VI[phase][idx]!, en: EN[phase][idx]! };
}

function flavAddrVi(ctx: ChapterCtx): string {
  return TIER_FLAVOUR[ctx.tier].addressVi;
}
function flavAddrEn(ctx: ChapterCtx): string {
  return TIER_FLAVOUR[ctx.tier].addressEn;
}

/* ────────────────────── BRANCH quest dialogue templates ────────────────────── */

function branchPhaseLines(
  q: Phase33QuestDef,
  ctx: ChapterCtx,
  phase: 'INTRO' | 'AFTERMATH',
): { vi: string; en: string } {
  const speakerName = npcName(q.giverNpcKey);
  const seq = q.questKey.split('_').pop() ?? '01';
  const branchIdx = Number.parseInt(seq, 10) || 1;
  // 6 variants — b01 primary-bond, b02 hidden-mentor, b03 secondary-faction,
  // b04 shop-unlock, b05 choice-echo, b06 side-palace.
  // 6 variants. Tất cả nhúng token chapter-specific để branch line khác biệt
  // giữa 19 chương.
  const VI: Record<typeof phase, readonly string[]> = {
    INTRO: [
      `${speakerName} ghé sát: "${flavAddrVi(ctx)} đã giúp ta lần trước ở ${ctx.regionName} — xin nán lại, có chuyện riêng chương ${ctx.chapNumber} cần thương lượng."`,
      `${speakerName} hạ giọng: "Có một mạch chân truyền chương ${ctx.chapNumber} chưa truyền ra ngoài ${ctx.regionName}. Nếu ${flavAddrVi(ctx)} chịu, ta dẫn đi."`,
      `${speakerName}: "Phe phái thứ hai ở ${ctx.regionName} đang nhìn ${flavAddrVi(ctx)}. Đi gặp họ hay không trong chương ${ctx.chapNumber}, tự quyết."`,
      `${speakerName} mở tay: "Một quầy nhỏ trong ${ctx.regionName} chỉ mở cho người tin tưởng — chương ${ctx.chapNumber} ngươi đủ tiêu chuẩn."`,
      `${speakerName} trầm ngâm: "Lựa chọn cũ của ${flavAddrVi(ctx)} đã vọng tới ${ctx.regionName}. Có người chương ${ctx.chapNumber} muốn gặp."`,
      `${speakerName}: "Trong tịnh thất biệt khu ${ctx.regionName} có người đang chờ chương ${ctx.chapNumber}. Lối nhỏ, không phải ai cũng vào được."`,
    ],
    AFTERMATH: [
      `${speakerName} cười nhẹ: "Mối quan hệ ${ctx.regionName} này coi như buộc chặt. Sau chương ${ctx.chapNumber} có việc, đừng để ta hỏi hai lần."`,
      `${speakerName}: "Truyền thừa chương ${ctx.chapNumber} đã trao tại ${ctx.regionName}. Đừng nói cho ai khác, kể cả sư phụ của ${flavAddrVi(ctx)}."`,
      `${speakerName} gật đầu: "Phe ấy đã ghi nợ ${flavAddrVi(ctx)} hôm nay ở ${ctx.regionName} — một ngày họ sẽ trả."`,
      `${speakerName} đếm chìa khoá: "Quầy nhỏ ${ctx.regionName} giờ là sân nhà của ngươi sau chương ${ctx.chapNumber}. Vào ra tuỳ ý, nhưng giữ miệng."`,
      `${speakerName}: "Tiếng vọng ${ctx.regionName} đã trả lời chương ${ctx.chapNumber}. Lựa chọn cũ của ngươi không vô nghĩa."`,
      `${speakerName} đóng cửa biệt khu ${ctx.regionName}: "Người trong đó nhớ ${flavAddrVi(ctx)}. Lần sau ngươi quay lại chương ${ctx.chapNumber + 1}, sẽ khác."`,
    ],
  };
  const EN: Record<typeof phase, readonly string[]> = {
    INTRO: [
      `${speakerName} steps closer: "This ${flavAddrEn(ctx)} helped me before at ${ctx.regionName} — stay a moment, I have a Chapter ${ctx.chapNumber} matter to discuss."`,
      `${speakerName} lowers his voice: "A Chapter ${ctx.chapNumber} inner-line teaching has never left ${ctx.regionName}. If this ${flavAddrEn(ctx)} agrees, I shall guide."`,
      `${speakerName}: "A second faction in ${ctx.regionName} watches this ${flavAddrEn(ctx)}. Whether to meet them in Chapter ${ctx.chapNumber} is your choice."`,
      `${speakerName} opens his palm: "A small stall in ${ctx.regionName} opens only to the trusted — Chapter ${ctx.chapNumber} qualifies you."`,
      `${speakerName} grows thoughtful: "An old choice of yours echoes through ${ctx.regionName}. A Chapter ${ctx.chapNumber} figure wishes to see this ${flavAddrEn(ctx)}."`,
      `${speakerName}: "A quiet chamber in the side hall of ${ctx.regionName} awaits Chapter ${ctx.chapNumber}. A narrow path — not every visitor may enter."`,
    ],
    AFTERMATH: [
      `${speakerName} smiles faintly: "The ${ctx.regionName} bond is sealed now. When the next Chapter ${ctx.chapNumber} matter comes, do not make me ask twice."`,
      `${speakerName}: "The Chapter ${ctx.chapNumber} teaching is given at ${ctx.regionName}. Speak of it to no one — not even your own master."`,
      `${speakerName} nods: "The faction is in this ${flavAddrEn(ctx)}'s debt at ${ctx.regionName} now. One day, the favor will return."`,
      `${speakerName} counts the keys: "The ${ctx.regionName} stall is your home court after Chapter ${ctx.chapNumber}. Come and go freely, but keep silent."`,
      `${speakerName}: "The ${ctx.regionName} echo has answered Chapter ${ctx.chapNumber}. Your old choice was not meaningless."`,
      `${speakerName} closes the side hall door of ${ctx.regionName}: "Those within remember this ${flavAddrEn(ctx)}. When you return in Chapter ${ctx.chapNumber + 1}, it will be different."`,
    ],
  };
  const idx = Math.min(Math.max(branchIdx - 1, 0), VI[phase].length - 1);
  return { vi: VI[phase][idx]!, en: EN[phase][idx]! };
}

/* ────────────────────── catalog assembly ────────────────────── */

function mkDialogue(
  q: Phase33QuestDef,
  phase: Phase33DialoguePhase,
  text: { vi: string; en: string },
): Phase33QuestDialogueDef {
  return {
    dialogueId: `dlg_${q.questKey}_${phase}`,
    questKey: q.questKey,
    chapterKey: q.chapKey,
    speakerNpcKey: q.giverNpcKey,
    phase,
    textVi: text.vi,
    textEn: text.en,
    nextDialogueId: null,
    setStoryFlags: [],
  };
}

function dialoguesForMain(q: Phase33QuestDef, ctx: ChapterCtx): readonly Phase33QuestDialogueDef[] {
  const out: Phase33QuestDialogueDef[] = [];
  for (const phase of ['INTRO', 'ACCEPT', 'IN_PROGRESS', 'COMPLETE', 'CLAIMED'] as const) {
    out.push(mkDialogue(q, phase, mainPhaseLines(q, ctx, phase)));
  }
  // Add BOSS_PRE + BOSS_VICTORY only if quest has a boss_defeat step.
  const hasBoss = q.steps.some((s) => s.kind === 'boss_defeat');
  if (hasBoss) {
    out.push(mkDialogue(q, 'BOSS_PRE', bossPhaseLines(q, ctx, 'BOSS_PRE')));
    out.push(mkDialogue(q, 'BOSS_VICTORY', bossPhaseLines(q, ctx, 'BOSS_VICTORY')));
  }
  return out;
}

function dialoguesForHidden(q: Phase33QuestDef, ctx: ChapterCtx): readonly Phase33QuestDialogueDef[] {
  const out: Phase33QuestDialogueDef[] = [];
  for (const phase of ['HIDDEN_HINT', 'HIDDEN_TRIGGER', 'COMPLETE', 'AFTERMATH'] as const) {
    out.push(mkDialogue(q, phase, hiddenPhaseLines(q, ctx, phase)));
  }
  return out;
}

function dialoguesForBranch(q: Phase33QuestDef, ctx: ChapterCtx): readonly Phase33QuestDialogueDef[] {
  const out: Phase33QuestDialogueDef[] = [];
  for (const phase of ['INTRO', 'AFTERMATH'] as const) {
    out.push(mkDialogue(q, phase, branchPhaseLines(q, ctx, phase)));
  }
  return out;
}

export const STORY_QUEST_DIALOGUES: readonly Phase33QuestDialogueDef[] = STORY_QUEST_EXPANSION.flatMap((q) => {
  const ctx = CTX_BY_KEY.get(q.chapKey);
  if (!ctx) return [];
  if (q.kind === 'main') return dialoguesForMain(q, ctx);
  if (q.kind === 'hidden') return dialoguesForHidden(q, ctx);
  if (q.kind === 'branch') return dialoguesForBranch(q, ctx);
  return [];
});

/* ────────────────────── lookup helpers ────────────────────── */

export function phase33DialogueById(dialogueId: string): Phase33QuestDialogueDef | undefined {
  return STORY_QUEST_DIALOGUES.find((d) => d.dialogueId === dialogueId);
}

export function phase33DialoguesForQuest(questKey: string): readonly Phase33QuestDialogueDef[] {
  return STORY_QUEST_DIALOGUES.filter((d) => d.questKey === questKey);
}

export function phase33DialoguesForChapter(chapterKey: string): readonly Phase33QuestDialogueDef[] {
  return STORY_QUEST_DIALOGUES.filter((d) => d.chapterKey === chapterKey);
}

export function phase33DialoguesByPhase(phase: Phase33DialoguePhase): readonly Phase33QuestDialogueDef[] {
  return STORY_QUEST_DIALOGUES.filter((d) => d.phase === phase);
}

export function phase33QuestKindHasDialogueCoverage(
  q: Phase33QuestDef,
): boolean {
  const required: Phase33DialoguePhase[] =
    q.kind === 'main'
      ? ['INTRO', 'ACCEPT', 'IN_PROGRESS', 'COMPLETE', 'CLAIMED']
      : q.kind === 'hidden'
        ? ['HIDDEN_HINT', 'HIDDEN_TRIGGER', 'COMPLETE', 'AFTERMATH']
        : q.kind === 'branch'
          ? ['INTRO', 'AFTERMATH']
          : [];
  if (required.length === 0) return true;
  const got = new Set(phase33DialoguesForQuest(q.questKey).map((d) => d.phase));
  return required.every((p) => got.has(p));
}
