import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { AdminAuditWriter, AdminAuditValidationError } from './admin-audit-writer.service';

let prisma: PrismaService;
let auditWriter: AdminAuditWriter;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  auditWriter = new AdminAuditWriter(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AdminAuditWriter.write', () => {
  it('writes audit log with valid input', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const result = await auditWriter.write({
      adminUserId: admin.userId,
      adminRole: 'SUPER_ADMIN',
      actionType: 'CURRENCY_ADJUST',
      reason: 'Test audit log',
    });
    expect(result.id).toBeDefined();
    const row = await prisma.adminAuditLog.findUnique({ where: { id: result.id } });
    expect(row).not.toBeNull();
    expect(row!.action).toBe('CURRENCY_ADJUST');
  });

  it('throws ACTION_TYPE_INVALID for unknown action type', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      auditWriter.write({
        adminUserId: admin.userId,
        adminRole: 'SUPER_ADMIN',
        actionType: 'INVALID_ACTION' as any,
        reason: 'Test',
      }),
    ).rejects.toBeInstanceOf(AdminAuditValidationError);
  });

  it('throws REASON_REQUIRED for empty reason', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      auditWriter.write({
        adminUserId: admin.userId,
        adminRole: 'SUPER_ADMIN',
        actionType: 'CURRENCY_ADJUST',
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('throws REASON_TOO_LONG for reason > 2000 chars', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      auditWriter.write({
        adminUserId: admin.userId,
        adminRole: 'SUPER_ADMIN',
        actionType: 'CURRENCY_ADJUST',
        reason: 'x'.repeat(2001),
      }),
    ).rejects.toMatchObject({ code: 'REASON_TOO_LONG' });
  });

  it('stores meta fields in audit log', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const result = await auditWriter.write({
      adminUserId: admin.userId,
      adminRole: 'SUPER_ADMIN',
      actionType: 'ITEM_GRANT',
      reason: 'Grant items',
      targetType: 'User',
      targetId: 'user-123',
      permissionKey: 'ADMIN_GRANT_ITEM',
    });
    const row = await prisma.adminAuditLog.findUnique({ where: { id: result.id } });
    const meta = row!.meta as Record<string, unknown>;
    expect(meta.actionType).toBe('ITEM_GRANT');
    expect(meta.targetType).toBe('User');
    expect(meta.targetId).toBe('user-123');
  });
});
