import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DIALOGUES, NPCS } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { NpcError, NpcService } from './npc.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let npcs: NpcService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  npcs = new NpcService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const NPC_LANG_VAN_SINH = 'npc_lang_van_sinh';
const NPC_MOC_THANH_Y = 'npc_moc_thanh_y';
const NPC_A_LINH = 'npc_a_linh';
const NPC_HAN_DA = 'npc_han_da';
const NPC_TO_NGUYET_LY = 'npc_to_nguyet_ly';
const NPC_VAN_KIM_NUONG = 'npc_van_kim_nuong';
const NPC_TICH_LINH_SU_GIA = 'npc_tich_linh_su_gia';

describe('NpcService.listForUser', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(npcs.listForUser('non-existent-user')).rejects.toThrow(
      new NpcError('NO_CHARACTER'),
    );
  });

  it('character realm phamnhan thấy 3 NPC realmGate=0 including A Linh', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await npcs.listForUser(userId);
    const keys = list.map((n) => n.key).sort();
    expect(keys).toEqual([NPC_A_LINH, NPC_LANG_VAN_SINH, NPC_MOC_THANH_Y].sort());
  });

  it('character realm luyenkhi thấy thêm Hàn Dạ và Vạn Kim Nương', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const list = await npcs.listForUser(userId);
    const keys = list.map((n) => n.key).sort();
    expect(keys).toEqual(
      [NPC_A_LINH, NPC_LANG_VAN_SINH, NPC_MOC_THANH_Y, NPC_HAN_DA, NPC_VAN_KIM_NUONG].sort(),
    );
  });

  it('character realm truc_co thấy thêm Tô Nguyệt Ly và Tịch Linh Sứ Giả', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'truc_co' });
    const list = await npcs.listForUser(userId);
    const keys = list.map((n) => n.key).sort();
    expect(keys).toEqual(
      [NPC_A_LINH, NPC_LANG_VAN_SINH, NPC_MOC_THANH_Y, NPC_HAN_DA, NPC_TO_NGUYET_LY, NPC_VAN_KIM_NUONG, NPC_TICH_LINH_SU_GIA].sort(),
    );
  });

  it('mỗi NPC view có dialogue !== null + questCount khớp catalog', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'truc_co' });
    const list = await npcs.listForUser(userId);
    for (const v of list) {
      const def = NPCS.find((n) => n.key === v.key);
      expect(v.questCount).toBe(def?.questKeys.length ?? -1);
      expect(v.dialogue).not.toBeNull();
      expect(v.dialogue!.choices.length).toBeGreaterThan(0);
    }
  });

  it('Lăng Vân Sinh dialogue ở phamnhan = default; ở truc_co = trúc cơ branch (realm_min ưu tiên hơn always)', async () => {
    const { userId: userPham } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const phamView = (await npcs.listForUser(userPham)).find(
      (n) => n.key === NPC_LANG_VAN_SINH,
    );
    expect(phamView?.dialogue?.dialogueId).toBe('dlg_lang_van_sinh_default');

    const { userId: userTrucCo } = await makeUserChar(prisma, { realmKey: 'truc_co' });
    const trucCoView = (await npcs.listForUser(userTrucCo)).find(
      (n) => n.key === NPC_LANG_VAN_SINH,
    );
    expect(trucCoView?.dialogue?.dialogueId).toBe('dlg_lang_van_sinh_truc_co');
  });

  it('choice có acceptQuestKey kèm acceptQuestStatus = "NOT_STARTED" mặc định', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await npcs.listForUser(userId);
    const lvs = list.find((n) => n.key === NPC_LANG_VAN_SINH);
    const acceptChoice = lvs?.dialogue?.choices.find(
      (c) => c.acceptQuestKey === 'phamnhan_main_01',
    );
    expect(acceptChoice).toBeDefined();
    expect(acceptChoice?.acceptQuestStatus).toBe('NOT_STARTED');
  });

  it('choice acceptQuestStatus = "ACCEPTED" sau khi quest progress đã ACCEPTED', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await prisma.questProgress.create({
      data: {
        characterId,
        questKey: 'phamnhan_main_01',
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        stepProgress: {},
      },
    });
    const list = await npcs.listForUser(userId);
    const lvs = list.find((n) => n.key === NPC_LANG_VAN_SINH);
    const acceptChoice = lvs?.dialogue?.choices.find(
      (c) => c.acceptQuestKey === 'phamnhan_main_01',
    );
    expect(acceptChoice?.acceptQuestStatus).toBe('ACCEPTED');
  });

  it('choice closeDialogue map đúng từ catalog (default false → false; explicit true → true)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await npcs.listForUser(userId);
    const lvs = list.find((n) => n.key === NPC_LANG_VAN_SINH);
    for (const c of lvs?.dialogue?.choices ?? []) {
      // Catalog dlg_lang_van_sinh_default có 2 choice cùng `closeDialogue: true`.
      expect(typeof c.closeDialogue).toBe('boolean');
      expect(c.closeDialogue).toBe(true);
    }
  });
});

describe('NpcService.getDialogueForNpc', () => {
  it('throws NPC_UNKNOWN cho npc key sai format / không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      npcs.getDialogueForNpc(userId, 'npc_xxx_invalid'),
    ).rejects.toThrow(new NpcError('NPC_UNKNOWN'));
  });

  it('throws NO_CHARACTER nếu user không có character', async () => {
    await expect(
      npcs.getDialogueForNpc('non-existent-user', NPC_LANG_VAN_SINH),
    ).rejects.toThrow(new NpcError('NO_CHARACTER'));
  });

  it('throws NPC_LOCKED_REALM cho NPC có realmGate cao hơn character realm', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      npcs.getDialogueForNpc(userId, NPC_HAN_DA),
    ).rejects.toThrow(new NpcError('NPC_LOCKED_REALM'));
  });

  it('Hàn Dạ realmGate=1: phamnhan KHÔNG truy cập, luyenkhi thì OK', async () => {
    const { userId: userLuyen } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const dlg = await npcs.getDialogueForNpc(userLuyen, NPC_HAN_DA);
    expect(dlg.dialogueId).toBe('dlg_han_da_default');
    expect(dlg.choices.find((c) => c.acceptQuestKey === 'luyenkhi_npc_01')).toBeDefined();
  });

  it('catalog integrity: mọi NPC default dialogue id phải tồn tại trong DIALOGUES', () => {
    for (const npc of NPCS) {
      expect(DIALOGUES.find((d) => d.id === npc.defaultDialogueId)).toBeDefined();
    }
  });
});
