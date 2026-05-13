/**
 * Phase 12.10.B — NPC Gift Preferences Catalog.
 *
 * Catalog tĩnh `NPC_GIFT_PREFERENCES` định nghĩa per-NPC gift accept rules:
 *   - `acceptedItems[]`: list item key NPC chấp nhận + delta affinity range
 *     (`affinityMin..affinityMax` — server roll uniform random per gift, hoặc
 *     pick midpoint cho test deterministic).
 *   - `dailyLimit`: max số gift / NPC / character / UTC day. 0 = không cho gift.
 *   - `loreNote`: flavor text — FE tooltip giải thích vì sao NPC thích item.
 *
 * Catalog NÀY:
 *   - KHÔNG ghi DB ở đây (runtime persistence ở `CharacterNpcGiftLog`).
 *   - KHÔNG sửa `ITEMS` catalog (gift chỉ consume item đã tồn tại trong inventory).
 *   - Reference 1-1 với `NPC_AFFINITY` (validator pin: mỗi NPC có gift entry
 *     phải tồn tại trong `NPC_AFFINITY` để gain affinity).
 *
 * Design refs:
 *   - `docs/story/PHASE12_STORY_PROGRESS.md` Phase 12.10.B row.
 *   - `docs/BALANCE_MODEL.md` cap reward — gift affinity nhỏ (≤ 8 / gift),
 *     daily limit (≤ 3 / NPC / day) → tối đa 24 affinity / NPC / day, ladder
 *     từ Stranger (0) → Tri Kỷ (100) ≈ 5 ngày tập trung gift, không bypass quá nhanh.
 *
 * Hard cap (validator-enforced):
 *   - `affinityMax` ≤ 8 (mirror dialogue choice cap nhỏ hơn `AFFINITY_DELTA_CAP_PER_CHOICE=20`).
 *   - `dailyLimit` ≤ 5 (anti-grind: ngày chỉ vài gift, không xếp inventory đổi affinity instant).
 */

import { itemByKey } from './items';
import { NPC_AFFINITY, npcAffinityDefForKey } from './npc-affinity';
import { NPCS } from './npcs';

/**
 * Cap delta tuyệt đối / 1 gift (≥ `affinityMax`). Validator enforce
 * `accepted.affinityMax ≤ NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT`.
 */
export const NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT = 8;

/**
 * Cap số gift / NPC / character / UTC day. Validator enforce
 * `def.dailyLimit ≤ NPC_GIFT_DAILY_LIMIT_CAP`.
 */
export const NPC_GIFT_DAILY_LIMIT_CAP = 5;

export interface NpcAcceptedGiftItem {
  /** Match `ITEMS[].key` — invariant test verify reference tồn tại. */
  itemKey: string;
  /** Lower bound affinity gain (inclusive). ≥ 1. */
  affinityMin: number;
  /** Upper bound affinity gain (inclusive). ≤ `NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT`. */
  affinityMax: number;
  /** Flavor — FE tooltip "Mộc Thanh Y thích Linh Thảo Mộc hệ". */
  flavor: string;
  /** Flavor English — FE tooltip i18n. */
  flavorEn: string;
}

export interface NpcGiftPreferenceDef {
  /** Match `NPCS[].key` & `NPC_AFFINITY[].npcKey` — invariant. */
  npcKey: string;
  /** Daily limit / NPC / character. ≥ 1, ≤ `NPC_GIFT_DAILY_LIMIT_CAP`. */
  dailyLimit: number;
  /** Items NPC accept — order theo lore preference (đầu = thích nhất). */
  acceptedItems: readonly NpcAcceptedGiftItem[];
  /** Flavor giới thiệu sở thích NPC chung — FE panel header. */
  loreNote: string;
  loreNoteEn: string;
}

/**
 * Catalog gift preferences cho NPC trụ cột Hoa Thiên / rival / ma tu.
 *
 * Design rationale per-NPC:
 *   - **Lăng Vân Sinh** (chưởng môn, formal): nhận đan dược nhập môn + ngọc cấp thấp.
 *     Reward affinity 5–7 / gift; daily 3 — pacing main quest progression.
 *   - **Mộc Thanh Y** (đại sư tỷ, mộc alchemist): linh_thao, lien_hoa_truong (mộc-themed).
 *     Affinity range 4–8 (linh_thao thấp vì plentiful, lien_hoa_truong cao vì rare).
 *   - **Hàn Dạ** (rival kiếm tu): so_kiem (vũ khí), tinh_thiet (kim material).
 *     Affinity 3–6 — rival khó tăng affinity nhanh.
 *   - **Tô Nguyệt Ly** (mysterious): thien_linh_ngoc, han_ngoc — vật phẩm hiếm.
 *     Affinity 5–7.
 *   - **Huyết La Sát** (ma tu blood-themed): huyet_tinh, huyet_chi_dan.
 *     Affinity 6–8 — ma tu blood gift critical, dễ chiêu dụ nhưng daily 2 (cấm farm dark).
 */
export const NPC_GIFT_PREFERENCES: readonly NpcGiftPreferenceDef[] = [
  {
    npcKey: 'npc_lang_van_sinh',
    dailyLimit: 3,
    loreNote: 'Chưởng môn ưa lễ vật trang trọng — đan dược nhập môn, ngọc cấp thấp.',
    loreNoteEn: 'The sect master appreciates formal tributes — entry-level pills, modest jade.',
    acceptedItems: [
      {
        itemKey: 'linh_lo_dan',
        affinityMin: 5,
        affinityMax: 7,
        flavor: 'Lăng Vân Sinh gật đầu — Linh Lộ Đan là lễ phẩm đệ tử Hoa Thiên xưa.',
        flavorEn: 'Lăng Vân Sinh nods — Linh Lộ Đan is the traditional disciple offering.',
      },
      {
        itemKey: 'thien_linh_ngoc',
        affinityMin: 6,
        affinityMax: 8,
        flavor: 'Thiên Linh Ngọc — chưởng môn dùng để khắc Hoa Thiên ấn ký.',
        flavorEn: 'Thiên Linh Ngọc — the master uses it to engrave Hoa Thiên seals.',
      },
      {
        itemKey: 'van_linh_dan',
        affinityMin: 5,
        affinityMax: 7,
        flavor: 'Vạn Linh Đan — đan tinh hậu, chưởng môn vui lòng nhận.',
        flavorEn: 'Vạn Linh Đan — refined essence pill, well received.',
      },
    ],
  },
  {
    npcKey: 'npc_moc_thanh_y',
    dailyLimit: 3,
    loreNote: 'Đại sư tỷ luyện đan Mộc — thích linh thảo, hoa cỏ trong cảnh giới thấp.',
    loreNoteEn: 'Senior sister loves wood-element herbs — pleased by spirit grass and lotus motifs.',
    acceptedItems: [
      {
        itemKey: 'linh_thao',
        affinityMin: 4,
        affinityMax: 6,
        flavor: 'Linh Thảo — Mộc Thanh Y mỉm cười, "rất tươi, ta dùng luyện Sinh Cơ Đan".',
        flavorEn: 'Linh Thảo — Mộc Thanh Y smiles, "fresh, perfect for Sinh Cơ Đan".',
      },
      {
        itemKey: 'lien_hoa_truong',
        affinityMin: 6,
        affinityMax: 8,
        flavor: 'Liên Hoa Trượng — mộc-themed weapon, sư tỷ rất thích.',
        flavorEn: 'Liên Hoa Trượng — wood-element staff, senior sister adores it.',
      },
      {
        itemKey: 'sinh_co_dan',
        affinityMin: 5,
        affinityMax: 7,
        flavor: 'Sinh Cơ Đan — chính tay sư tỷ luyện trước đây, gợi ký ức Hoa Thiên.',
        flavorEn: 'Sinh Cơ Đan — once refined by her own hand, evokes Hoa Thiên memories.',
      },
    ],
  },
  {
    npcKey: 'npc_han_da',
    dailyLimit: 2,
    loreNote: 'Rival kiếm tu — chỉ chấp nhận vũ khí và kim hệ vật liệu.',
    loreNoteEn: 'Rival sword cultivator — only accepts weapons and metal-element materials.',
    acceptedItems: [
      {
        itemKey: 'so_kiem',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Sơ Kiếm — Hàn Dạ ngắm nghía, "vũ khí phàm phu nhưng tâm ý đáng nhận".',
        flavorEn: 'Sơ Kiếm — Hàn Dạ examines it: "a mundane blade, but the gesture stands".',
      },
      {
        itemKey: 'tinh_thiet',
        affinityMin: 4,
        affinityMax: 6,
        flavor: 'Tinh Thiết — Hàn Dạ nhận, "đủ luyện ba thanh kiếm phụ".',
        flavorEn: 'Tinh Thiết — Hàn Dạ accepts: "enough to forge three secondary blades".',
      },
      {
        itemKey: 'lanh_phong_kiem',
        affinityMin: 5,
        affinityMax: 7,
        flavor: 'Lãnh Phong Kiếm — kiếm khí lạnh, hợp với phong cách Hàn Dạ.',
        flavorEn: 'Lãnh Phong Kiếm — its cold sword aura suits Hàn Dạ\'s style.',
      },
    ],
  },
  {
    npcKey: 'npc_to_nguyet_ly',
    dailyLimit: 3,
    loreNote: 'Tô Nguyệt Ly tìm di tích Hoa Thiên — quý ngọc và vật hiếm.',
    loreNoteEn: 'Tô Nguyệt Ly seeks Hoa Thiên relics — values jade and rare artefacts.',
    acceptedItems: [
      {
        itemKey: 'thien_linh_ngoc',
        affinityMin: 5,
        affinityMax: 7,
        flavor: 'Thiên Linh Ngọc — Tô Nguyệt Ly nhìn lâu, "chất ngọc giống Hoa Thiên Cổ Mộ".',
        flavorEn: 'Thiên Linh Ngọc — she lingers: "this jade resembles the Ancient Tomb\'s".',
      },
      {
        itemKey: 'han_ngoc',
        affinityMin: 6,
        affinityMax: 8,
        flavor: 'Hàn Ngọc — Tô Nguyệt Ly cảm tạ, "đủ khắc thêm bùa truy tích".',
        flavorEn: 'Hàn Ngọc — she thanks you: "enough to inscribe more tracking talismans".',
      },
      {
        itemKey: 'ngoc_tram',
        affinityMin: 5,
        affinityMax: 7,
        flavor: 'Ngọc Trâm — Tô Nguyệt Ly cài lên tóc, ánh mắt dịu lại.',
        flavorEn: 'Ngọc Trâm — she pins it into her hair, her gaze softening.',
      },
    ],
  },
  {
    npcKey: 'npc_huyet_la_sat',
    dailyLimit: 2,
    loreNote: 'Huyết La Sát ma tu — chỉ chấp nhận huyết vật + ma đan.',
    loreNoteEn: 'Huyết La Sát is a blood demon — only accepts blood relics and demon pills.',
    acceptedItems: [
      {
        itemKey: 'huyet_tinh',
        affinityMin: 6,
        affinityMax: 8,
        flavor: 'Huyết Tinh — Huyết La Sát cười nhạt, "đậm vị tử khí, ngươi hiểu ta".',
        flavorEn: 'Huyết Tinh — Huyết La Sát chuckles: "rich with death qi — you understand me".',
      },
      {
        itemKey: 'huyet_chi_dan',
        affinityMin: 5,
        affinityMax: 7,
        flavor: 'Huyết Chi Đan — đan luyện từ máu yêu thú, hợp khẩu vị Huyết La Sát.',
        flavorEn: 'Huyết Chi Đan — refined from beast blood, fitting to his taste.',
      },
    ],
  },
  {
    npcKey: 'npc_a_linh',
    dailyLimit: 3,
    loreNote: 'A Linh phụ trách tân đệ tử — thích đan dược sơ cấp và vật tiếp tế dễ chia lại.',
    loreNoteEn: 'A Linh guides newcomers — she likes starter pills and supplies she can share.',
    acceptedItems: [
      {
        itemKey: 'linh_lo_dan',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Linh Lộ Đan — A Linh cất vào túi, nói sẽ dùng khi tân đệ tử lạc nhịp thở.',
        flavorEn: 'Linh Lộ Đan — A Linh pockets it for new disciples who lose their breathing rhythm.',
      },
      {
        itemKey: 'huyet_chi_dan',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Huyết Chỉ Đan — nàng cảm ơn vì có thêm thuốc phòng thân cho ngoại môn.',
        flavorEn: 'Huyết Chỉ Đan — she thanks you for extra emergency medicine in the outer court.',
      },
    ],
  },
  {
    npcKey: 'npc_van_kim_nuong',
    dailyLimit: 2,
    loreNote: 'Vạn Kim Nương trọng chữ tín — nhận vật liệu có thể ghi sổ rõ ràng.',
    loreNoteEn: 'Vạn Kim Nương values trust — she accepts materials that can be ledgered cleanly.',
    acceptedItems: [
      {
        itemKey: 'tinh_thiet',
        affinityMin: 4,
        affinityMax: 6,
        flavor: 'Tinh Thiết — nàng cân bằng tay rồi ghi một dòng “khách giữ giá”.',
        flavorEn: 'Tinh Thiết — she weighs it by hand and notes you as a fair customer.',
      },
      {
        itemKey: 'phu_van_ngoc',
        affinityMin: 4,
        affinityMax: 6,
        flavor: 'Phù Vân Ngọc — thương hội luôn cần ngọc sạch để làm tín vật khế ước.',
        flavorEn: 'Phù Vân Ngọc — the guild needs clean jade for contract tokens.',
      },
    ],
  },
  {
    npcKey: 'npc_bach_de_tu',
    dailyLimit: 1,
    loreNote: 'Bạch Đế Tử chỉ nhận lễ vật trang nghiêm; tăng thiện cảm rất chậm.',
    loreNoteEn: 'Bạch Đế Tử accepts only solemn tributes; his affinity rises slowly.',
    acceptedItems: [
      {
        itemKey: 'thien_linh_ngoc',
        affinityMin: 2,
        affinityMax: 4,
        flavor: 'Thiên Linh Ngọc — hắn nhận như đang kiểm tra độ sạch của tiên luật.',
        flavorEn: 'Thiên Linh Ngọc — he accepts it as if testing the purity of immortal law.',
      },
      {
        itemKey: 'tien_kim_sa',
        affinityMin: 2,
        affinityMax: 4,
        flavor: 'Tiên Kim Sa — kim khí hợp Bạch Đế, nhưng ánh mắt hắn vẫn lạnh.',
        flavorEn: 'Tiên Kim Sa — its metal qi suits the White Emperor, though his gaze stays cold.',
      },
    ],
  },
  {
    npcKey: 'npc_tich_linh_su_gia',
    dailyLimit: 1,
    loreNote: 'Tịch Linh Sứ Giả nhận vật lạnh và đan khí sạch như mồi đối thoại nguy hiểm.',
    loreNoteEn: 'The Nether Spirit emissary accepts cold relics and clean qi pills as dangerous conversation bait.',
    acceptedItems: [
      {
        itemKey: 'han_ngoc',
        affinityMin: 2,
        affinityMax: 4,
        flavor: 'Hàn Ngọc — sứ giả để nó tan sương giữa lòng bàn tay, không nói cảm ơn.',
        flavorEn: 'Hàn Ngọc — the emissary lets it mist in their palm without thanks.',
      },
      {
        itemKey: 'linh_lo_dan',
        affinityMin: 1,
        affinityMax: 3,
        flavor: 'Linh Lộ Đan — linh khí trong sạch làm Tịch Linh khí tạm lùi một nhịp.',
        flavorEn: 'Linh Lộ Đan — clean qi pushes the Nether Spirit aura back for a breath.',
      },
    ],
  },
  {
    npcKey: 'npc_huyet_ha_su_gia',
    dailyLimit: 1,
    loreNote: 'Môi giới Huyết Hà chỉ nhận huyết vật, và mọi món quà đều để lại nợ.',
    loreNoteEn: 'The Blood River broker accepts only blood relics, and every gift leaves a debt.',
    acceptedItems: [
      {
        itemKey: 'huyet_tinh',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Huyết Tinh — hắn cười như vừa thấy một khoản nợ dễ thu.',
        flavorEn: 'Huyết Tinh — he smiles as if spotting an easy debt to collect.',
      },
      {
        itemKey: 'huyet_chi_dan',
        affinityMin: 2,
        affinityMax: 4,
        flavor: 'Huyết Chỉ Đan — mùi máu luyện đan khiến khế ước Huyết Hà bớt lạnh.',
        flavorEn: 'Huyết Chỉ Đan — its blood-refined scent softens the Blood River contract.',
      },
    ],
  },
  {
    npcKey: 'npc_hoa_thien_dao_to',
    dailyLimit: 1,
    loreNote: 'Tàn niệm Hoa Thiên Đạo Tổ chỉ nhận lễ vật mang ký ức truyền thừa.',
    loreNoteEn: 'The Hoa Thiên founder remnant accepts only offerings that carry inheritance memory.',
    acceptedItems: [
      {
        itemKey: 'thien_linh_ngoc',
        affinityMin: 4,
        affinityMax: 6,
        flavor: 'Thiên Linh Ngọc — tàn âm tổ sư sáng lên như nhận lại một mảnh đạo thống.',
        flavorEn: 'Thiên Linh Ngọc — the founder echo brightens as if recovering a shard of lineage.',
      },
      {
        itemKey: 'co_thien_dan',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Cổ Thiên Đan — đan hương cũ khiến lời tổ sư rõ hơn một nhịp.',
        flavorEn: 'Cổ Thiên Đan — old pill fragrance makes the founder’s voice clearer for a breath.',
      },
    ],
  },
  {
    npcKey: 'npc_tich_thien_dao_chu',
    dailyLimit: 1,
    loreNote: 'Tịch Thiên Đạo Chủ không nhận quà như bằng hữu; đây chỉ là vật chứng mở lời.',
    loreNoteEn: 'Tịch Thiên Đạo Chủ does not accept gifts as a friend; these are only proofs to begin speech.',
    acceptedItems: [
      {
        itemKey: 'han_ngoc',
        affinityMin: 1,
        affinityMax: 3,
        flavor: 'Hàn Ngọc — đạo âm im lặng lâu hơn, như đang cân nhắc sai lầm của chúng sinh.',
        flavorEn: 'Hàn Ngọc — the Dao echo pauses longer, weighing the errors of living beings.',
      },
      {
        itemKey: 'phu_van_ngoc',
        affinityMin: 1,
        affinityMax: 3,
        flavor: 'Phù Vân Ngọc — phù văn run nhẹ trước câu hỏi “tự do có đáng giá không”.',
        flavorEn: 'Phù Vân Ngọc — the rune trembles before the question of whether freedom is worth its price.',
      },
    ],
  },
  // ─── Phase 33 — Quyển II–IV NPC gift preferences (minimal seed) ───────────
  {
    npcKey: 'npc_luc_binh',
    dailyLimit: 2,
    loreNote: 'Lục Bình trân trọng vật chứng tự do — vật phẩm phá xích tu sĩ phi thăng.',
    loreNoteEn: 'Lục Bình treasures freedom relics — items that break ascension chains.',
    acceptedItems: [
      {
        itemKey: 'linh_lo_dan',
        affinityMin: 4,
        affinityMax: 6,
        flavor: 'Linh Lộ Đan — nàng nghiền nhỏ rắc lên mảnh xích, mong tan chảy.',
        flavorEn: 'Linh Lộ pill — she crushes it onto the chain shard, hoping it will dissolve.',
      },
    ],
  },
  {
    npcKey: 'npc_tich_thien_thanh_su',
    dailyLimit: 1,
    loreNote: 'Thánh Sứ chỉ chấp nhận lễ vật trang nghiêm như khẳng định quan điểm.',
    loreNoteEn: 'The Saint Envoy accepts only solemn tributes as ideological affirmation.',
    acceptedItems: [
      {
        itemKey: 'han_ngoc',
        affinityMin: 2,
        affinityMax: 4,
        flavor: 'Hàn Ngọc — Thánh Sứ ghi nhận, nhưng vẫn không gật đầu.',
        flavorEn: 'Hàn Ngọc — the Saint Envoy notes it, yet still does not nod.',
      },
    ],
  },
  {
    npcKey: 'npc_dao_vuc_chi_tam',
    dailyLimit: 2,
    loreNote: 'Đạo Vực Chi Tâm nhận vật phẩm thể hiện sự bao dung với vạn linh.',
    loreNoteEn: 'The Dao Domain Heart welcomes items that show compassion for all lives.',
    acceptedItems: [
      {
        itemKey: 'linh_lo_dan',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Linh Lộ Đan — vạn linh chia nhau nuốt, ấm cả Đạo Vực.',
        flavorEn: 'Linh Lộ pill — ten thousand lives share it, warming the entire Dao Domain.',
      },
    ],
  },
  {
    npcKey: 'npc_nguyen_linh_nu',
    dailyLimit: 1,
    loreNote: 'Nguyên Linh Nữ thích vật phẩm nguyên thuỷ, không tinh luyện quá tinh xảo.',
    loreNoteEn: 'Nguyên Linh Nữ favors raw, unrefined materials.',
    acceptedItems: [
      {
        itemKey: 'han_ngoc',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Hàn Ngọc — nàng nhúng vào Bản Nguyên Hải, ngọc tan thành sương sớm.',
        flavorEn: 'Hàn Ngọc — she dips it into the Origin Sea, and it dissolves into morning mist.',
      },
    ],
  },
  {
    npcKey: 'npc_huyen_huyen_giam_quan',
    dailyLimit: 1,
    loreNote: 'Giám Quan ghi câu hỏi của ngươi vào bia, lễ vật chỉ là dấu mực.',
    loreNoteEn: 'The Inspector records your question onto the stele; the gift is only ink.',
    acceptedItems: [
      {
        itemKey: 'phu_van_ngoc',
        affinityMin: 2,
        affinityMax: 4,
        flavor: 'Phù Vân Ngọc — bia hấp thụ phù văn, sáng lên một dòng mới.',
        flavorEn: 'Phù Vân Ngọc — the stele absorbs the rune and lights up a new inscription.',
      },
    ],
  },
  {
    npcKey: 'npc_vo_thuy_lao_nhan',
    dailyLimit: 1,
    loreNote: 'Lão nhân thích vật nhỏ liên quan đến khởi đầu — đan cấp thấp, ngọc cũ.',
    loreNoteEn: 'The old man enjoys humble origin-themed gifts — low-tier pills, aged jade.',
    acceptedItems: [
      {
        itemKey: 'linh_lo_dan',
        affinityMin: 3,
        affinityMax: 5,
        flavor: 'Linh Lộ Đan — lão chấm vào nước hồ, đan tan trong tích tắc như ký ức.',
        flavorEn: 'Linh Lộ pill — he dips it into the lake; it dissolves instantly like a memory.',
      },
    ],
  },
  {
    npcKey: 'npc_vo_chung_dong_tu',
    dailyLimit: 1,
    loreNote: 'Đồng tử nhận lễ vật như tem thư gửi cho ngươi-tương-lai.',
    loreNoteEn: 'The boy accepts gifts as postage stamps for future-you.',
    acceptedItems: [
      {
        itemKey: 'phu_van_ngoc',
        affinityMin: 2,
        affinityMax: 4,
        flavor: 'Phù Vân Ngọc — đồng tử dán phù lên thư rồi gửi vào Vô Chung Chi Môn.',
        flavorEn: 'Phù Vân Ngọc — the boy seals the letter with the rune and sends it through the Endless Gate.',
      },
    ],
  },
] as const;

// ============================================================================
// Helpers — pure (không đụng runtime). Service consume.
// ============================================================================

/** Lookup catalog entry theo `npcKey`. */
export function npcGiftPreferenceForKey(
  npcKey: string,
): NpcGiftPreferenceDef | undefined {
  return NPC_GIFT_PREFERENCES.find((g) => g.npcKey === npcKey);
}

/**
 * Lookup accepted item entry. Trả `undefined` nếu NPC không chấp nhận `itemKey`.
 * Caller dùng để validate ITEM_NOT_ACCEPTED trước khi consume.
 */
export function acceptedGiftItemFor(
  npcKey: string,
  itemKey: string,
): NpcAcceptedGiftItem | undefined {
  const def = npcGiftPreferenceForKey(npcKey);
  if (!def) return undefined;
  return def.acceptedItems.find((i) => i.itemKey === itemKey);
}

/**
 * Compute deterministic delta cho 1 gift. Server hiện dùng midpoint
 * `floor((min + max) / 2)` để test predictable + UI hiển thị stable. Future
 * có thể swap sang random uniform với seed (nếu balance designer cần spread
 * — Phase 12.10.C+).
 */
export function computeGiftAffinityDelta(item: NpcAcceptedGiftItem): number {
  return Math.floor((item.affinityMin + item.affinityMax) / 2);
}

/**
 * Validate catalog — invariant test pin-down các điểm dễ break:
 *   1. Mọi `npcKey` ∈ `NPCS`.
 *   2. Mọi `npcKey` ∈ `NPC_AFFINITY` (không gift được NPC chưa có affinity catalog).
 *   3. KHÔNG duplicate `npcKey` / `acceptedItems[].itemKey` per NPC.
 *   4. `acceptedItems[].itemKey` ∈ `ITEMS` (catalog).
 *   5. `affinityMin` ≥ 1, `affinityMin` ≤ `affinityMax` ≤ `NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT`.
 *   6. `dailyLimit` ≥ 1, ≤ `NPC_GIFT_DAILY_LIMIT_CAP`.
 *   7. NPC trong `NPC_AFFINITY` mà KHÔNG có gift entry → warning string (cho phép,
 *      vd npc kẻ thù absolute không nhận gift). Ở Phase 12.10.B 5/5 NPC có entry.
 *
 * Trả mảng error string; rỗng = OK.
 */
export function validateNpcGiftCatalog(): string[] {
  const errs: string[] = [];
  const npcKeys = new Set(NPCS.map((n) => n.key));
  const seenNpcs = new Set<string>();

  for (const def of NPC_GIFT_PREFERENCES) {
    if (seenNpcs.has(def.npcKey)) {
      errs.push(`Duplicate gift entry: ${def.npcKey}`);
    }
    seenNpcs.add(def.npcKey);

    if (!npcKeys.has(def.npcKey)) {
      errs.push(`Gift ${def.npcKey} references unknown NPC`);
    }
    if (!npcAffinityDefForKey(def.npcKey)) {
      errs.push(`Gift ${def.npcKey} has no affinity catalog entry (NPC_AFFINITY)`);
    }
    if (def.dailyLimit < 1 || def.dailyLimit > NPC_GIFT_DAILY_LIMIT_CAP) {
      errs.push(
        `Gift ${def.npcKey} dailyLimit ${def.dailyLimit} out of bounds [1,${NPC_GIFT_DAILY_LIMIT_CAP}]`,
      );
    }
    if (def.acceptedItems.length === 0) {
      errs.push(`Gift ${def.npcKey} has zero acceptedItems`);
    }
    const seenItems = new Set<string>();
    for (const it of def.acceptedItems) {
      if (seenItems.has(it.itemKey)) {
        errs.push(`Gift ${def.npcKey} duplicate accepted item ${it.itemKey}`);
      }
      seenItems.add(it.itemKey);
      if (!itemByKey(it.itemKey)) {
        errs.push(`Gift ${def.npcKey} item ${it.itemKey} not in ITEMS catalog`);
      }
      if (it.affinityMin < 1) {
        errs.push(
          `Gift ${def.npcKey} item ${it.itemKey} affinityMin ${it.affinityMin} < 1`,
        );
      }
      if (it.affinityMin > it.affinityMax) {
        errs.push(
          `Gift ${def.npcKey} item ${it.itemKey} affinityMin ${it.affinityMin} > affinityMax ${it.affinityMax}`,
        );
      }
      if (it.affinityMax > NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT) {
        errs.push(
          `Gift ${def.npcKey} item ${it.itemKey} affinityMax ${it.affinityMax} > cap ${NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT}`,
        );
      }
      if (it.flavor.length === 0) {
        errs.push(`Gift ${def.npcKey} item ${it.itemKey} empty flavor`);
      }
    }
  }

  // Cross-check: mọi affinity NPC nên có gift entry (warning, không error).
  for (const aff of NPC_AFFINITY) {
    if (!seenNpcs.has(aff.npcKey)) {
      errs.push(`Affinity NPC ${aff.npcKey} has no gift entry (orphan)`);
    }
  }

  return errs;
}
