/**
 * Bootstrap script — chạy idempotent khi deploy mới hoặc môi trường dev sạch.
 *
 * Việc làm:
 *   1. Đảm bảo có 1 user ADMIN đầu tiên (đọc từ env `INITIAL_ADMIN_EMAIL` +
 *      `INITIAL_ADMIN_PASSWORD`). Nếu user đã tồn tại:
 *        - **Không** ghi đè passwordHash (tránh khoá admin hiện có — Rule 10).
 *        - Nếu role chưa phải ADMIN, promote.
 *   2. Upsert 3 tông môn mặc định: Thanh Vân Môn / Huyền Thuỷ Cung / Tu La
 *      Điện. Upsert theo `name` (unique) — không ghi đè description nếu đã có.
 *
 * Chạy:
 *   pnpm --filter @xuantoi/api bootstrap
 *
 * Hoặc trực tiếp:
 *   pnpm --filter @xuantoi/api exec ts-node scripts/bootstrap.ts
 *
 * Idempotent: chạy nhiều lần an toàn — không tạo duplicate, không reset password,
 * không xoá dữ liệu.
 */
import { PrismaClient, Role, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
};

export const DEFAULT_SECTS: Array<{ name: string; description: string }> = [
  {
    name: 'Thanh Vân Môn',
    description:
      'Chính phái chính đạo trên núi Thanh Vân, đề cao kiếm tu thanh khiết, môn đệ trọng nghĩa khí.',
  },
  {
    name: 'Huyền Thuỷ Cung',
    description:
      'Tông môn ven biển, tinh thông thuỷ pháp và đan đạo. Lưỡng nghi điều hoà, thiên về phòng ngự và hồi phục.',
  },
  {
    name: 'Tu La Tông',
    description:
      'Tà phái cường thế, tu luyện sát đạo và tinh huyết công pháp. Môn quy hà khắc, sức mạnh là tất cả.',
  },
];

/**
 * Sect name aliases — old name → canonical name. Khi bootstrap chạy lại, nếu
 * thấy một sect ghi tên cũ thì rename sang tên chuẩn để các service mapping
 * (`SECT_NAME_TO_KEY` ở character/combat/cultivation/skill/leaderboard) match
 * đúng. Idempotent — chạy lần 2 sẽ không thấy sect cũ và không làm gì.
 *
 * Lý do: bootstrap trước đây seed `'Tu La Điện'` nhưng tất cả runtime check
 * dùng `'Tu La Tông'` → player sect này bị mất sectKey, mất sect-locked
 * cultivation/skill, mất leaderboard sect mapping. Rename DB row để fix các
 * env hiện hữu.
 */
export const SECT_NAME_ALIASES: Record<string, string> = {
  'Tu La Điện': 'Tu La Tông',
};

export interface BootstrapInput {
  email: string;
  password: string;
  /** Bỏ qua bước tạo/promote admin. Hữu ích cho test chỉ kiểm sect. */
  skipAdmin?: boolean;
  /** Bỏ qua bước seed sect. Hữu ích cho test chỉ kiểm admin. */
  skipSects?: boolean;
}

export interface BootstrapResult {
  admin: {
    userId: string;
    email: string;
    /** `created`: tạo mới. `promoted`: user có sẵn được promote lên ADMIN. `kept`: đã là ADMIN từ trước, không đổi gì. `skipped`: skipAdmin=true. */
    action: 'created' | 'promoted' | 'kept' | 'skipped';
  };
  sects: Array<{ id: string; name: string; created: boolean }>;
}

/**
 * Validate env input. Trả về object hoặc throw nếu thiếu.
 *
 * Tách hàm riêng để test gọi trực tiếp `runBootstrap(prisma, input)`.
 */
export function readBootstrapEnv(env: NodeJS.ProcessEnv = process.env): BootstrapInput {
  const email = env.INITIAL_ADMIN_EMAIL?.trim();
  const password = env.INITIAL_ADMIN_PASSWORD;
  if (!email) {
    throw new Error('INITIAL_ADMIN_EMAIL chưa được set trong env.');
  }
  if (!password || password.length < 8) {
    throw new Error('INITIAL_ADMIN_PASSWORD chưa được set hoặc < 8 ký tự.');
  }
  return { email, password };
}

async function ensureAdmin(
  prisma: Pick<PrismaClient, 'user'>,
  input: BootstrapInput,
): Promise<BootstrapResult['admin']> {
  if (input.skipAdmin) {
    return { userId: '', email: input.email, action: 'skipped' };
  }
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    if (existing.role === Role.ADMIN) {
      return { userId: existing.id, email: existing.email, action: 'kept' };
    }
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { role: Role.ADMIN, banned: false },
    });
    return { userId: updated.id, email: updated.email, action: 'promoted' };
  }
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTS);
  const created = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: Role.ADMIN,
    },
  });
  return { userId: created.id, email: created.email, action: 'created' };
}

async function renameSectAliases(prisma: Pick<PrismaClient, 'sect'>): Promise<void> {
  for (const [oldName, newName] of Object.entries(SECT_NAME_ALIASES)) {
    const old = await prisma.sect.findUnique({ where: { name: oldName } });
    if (!old) continue;
    const collision = await prisma.sect.findUnique({ where: { name: newName } });
    if (collision) {
      // Cả tên cũ và tên mới cùng tồn tại — không tự merge để tránh data loss.
      // Caller (ops) cần thủ công xử lý character đang trỏ sectId cũ.
      // Idempotent path: bỏ qua, ensureSects() bên dưới sẽ giữ row tên mới.
      continue;
    }
    await prisma.sect.update({ where: { id: old.id }, data: { name: newName } });
  }
}

async function ensureSects(
  prisma: Pick<PrismaClient, 'sect'>,
  input: BootstrapInput,
): Promise<BootstrapResult['sects']> {
  if (input.skipSects) return [];
  await renameSectAliases(prisma);
  const out: BootstrapResult['sects'] = [];
  for (const seed of DEFAULT_SECTS) {
    const existing = await prisma.sect.findUnique({ where: { name: seed.name } });
    if (existing) {
      out.push({ id: existing.id, name: existing.name, created: false });
      continue;
    }
    const created = await prisma.sect.create({
      data: {
        name: seed.name,
        description: seed.description,
      } satisfies Prisma.SectCreateInput,
    });
    out.push({ id: created.id, name: created.name, created: true });
  }
  return out;
}

/**
 * Chạy bootstrap. Trả về kết quả để caller log / test assert.
 * Caller chịu trách nhiệm `prisma.$disconnect()` sau khi xong.
 */
export async function runBootstrap(
  prisma: PrismaClient,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const admin = await ensureAdmin(prisma, input);
  const sects = await ensureSects(prisma, input);
  return { admin, sects };
}

async function main(): Promise<void> {
  const input = readBootstrapEnv();
  const prisma = new PrismaClient();
  try {
    const result = await runBootstrap(prisma, input);
    const adminLog =
      result.admin.action === 'created'
        ? `created admin ${result.admin.email}`
        : result.admin.action === 'promoted'
          ? `promoted ${result.admin.email} → ADMIN`
          : result.admin.action === 'kept'
            ? `admin ${result.admin.email} đã có, giữ nguyên`
            : `bỏ qua admin`;
    const sectLog = result.sects
      .map((s) => `${s.name}${s.created ? ' (mới)' : ' (giữ)'}`)
      .join(', ');
    console.log(`[bootstrap] ${adminLog}.`);
    console.log(`[bootstrap] sects: ${sectLog || '(skipped)'}.`);
  } finally {
    await prisma.$disconnect();
  }
}

// Chỉ chạy khi gọi trực tiếp, không chạy khi import từ test.
if (require.main === module) {
  main().catch((e: unknown) => {
    console.error('[bootstrap] FAILED:', e);
    process.exit(1);
  });
}
