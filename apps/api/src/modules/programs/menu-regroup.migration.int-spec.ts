/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung DB dựng một lần */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertParityDatabase, parityDatabaseName } from '../../common/testing/parity-db-guard';

/**
 * MIGRATION gộp menu "Danh mục" TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). Dựng DB nháp ở trạng thái TRƯỚC migration
 * `menu_regroup` (áp mọi migration cũ hơn), nạp dữ liệu giống prod (nhóm + dự án gán nhóm, mục tiêu có dự án, quyền
 * client:manage) rồi áp ĐÚNG file migration và kiểm: mọi liên kết dự án→nhóm còn nguyên, cột/bảng cũ biến mất, projectId
 * bắt buộc, và migration DỪNG (không đổi gì) khi gặp mục tiêu/rủi ro/SLA không có dự án hoặc còn khách hàng/hợp đồng.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity`.
 * Spec XOÁ SẠCH và dựng lại schema `public` của DB nháp đó — chỉ chạy trên DB nháp (hậu tố `_scratch`/`_parity`/`_w2c`).
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const PSQL = process.env.PSQL ?? 'psql';
const API_DIR = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(API_DIR, 'prisma', 'migrations');
const TARGET = '20261105200000_menu_regroup';

describe.skipIf(!DB_URL)('migration gộp menu Danh mục ↔ dữ liệu prod + các ca dừng', () => {
  let work = '';
  const conn = () => DB_URL!.replace(/\?.*$/, '');
  const q = (sql: string): string =>
    execFileSync(PSQL, [conn(), '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
      encoding: 'utf8',
    }).trim();
  const rows = (sql: string): string[] => {
    const out = q(sql);
    return out ? out.split('\n') : [];
  };
  /** Áp ĐÚNG file migration trong MỘT transaction (như Prisma); trả lỗi (nếu có) thay vì ném. */
  const applyTarget = (): string | null => {
    try {
      execFileSync(
        PSQL,
        [conn(), '-v', 'ON_ERROR_STOP=1', '-1', '-f', join(MIGRATIONS, TARGET, 'migration.sql')],
        { stdio: 'pipe', encoding: 'utf8' },
      );
      return null;
    } catch (e) {
      return String((e as { stderr?: string }).stderr ?? e);
    }
  };

  /** DB mới ở trạng thái ngay TRƯỚC migration + dữ liệu nền (không có dữ liệu khiến migration dừng). */
  const buildPre = () => {
    expect(parityDatabaseName(DB_URL!)).toMatch(/_scratch$|_parity$|_w2c$/);
    q('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    execFileSync(
      'npx',
      ['prisma', 'migrate', 'deploy', '--schema', join(work, 'prisma', 'schema.prisma')],
      {
        env: { ...process.env, DATABASE_URL: DB_URL!, DIRECT_URL: DB_URL! },
        cwd: API_DIR,
        stdio: 'pipe',
      },
    );
    q(`
      INSERT INTO "User"(id,email,"displayName","updatedAt") VALUES ('u1','u1@x.t','U1',now());
      INSERT INTO "Workspace"(id,name,slug,"ownerId","updatedAt") VALUES ('wA','A','a','u1',now());
      INSERT INTO "Program"(id,"workspaceId",name,color,"updatedAt") VALUES
        ('g1','wA','Group 1','#111',now()),('g2','wA','Group 2',NULL,now()),('g3','wA','Group 3 empty',NULL,now());
      INSERT INTO "Project"(id,"workspaceId",key,name,"programId","archivedAt","isArchived","deletedAt","updatedAt") VALUES
        ('P1','wA','P1','P1','g1',NULL,false,NULL,now()),
        ('P2','wA','P2','P2','g1',NULL,false,NULL,now()),
        ('P3','wA','P3','P3','g2',now(),true,NULL,now()),
        ('P4','wA','P4','P4','g2',NULL,false,now(),now()),
        ('P5','wA','P5','P5',NULL,NULL,false,NULL,now());
      INSERT INTO "Objective"(id,"workspaceId","projectId",name,period,"updatedAt") VALUES
        ('o1','wA','P1','Objective 1','2026-Q4',now()),('o2','wA','P2','Objective 2','2026-Q4',now());
      INSERT INTO "Permission"(id,key,description,scope) VALUES
        ('perm-cli','client:manage','Manage clients','WORKSPACE'),
        ('perm-prg','program:manage','Manage groups','WORKSPACE');
      INSERT INTO "Role"(id,"workspaceId",name,scope,"updatedAt") VALUES ('r1','wA','Role','WORKSPACE',now());
      INSERT INTO "RolePermission"("roleId","permissionId") VALUES ('r1','perm-cli'),('r1','perm-prg');
    `);
  };

  beforeAll(() => {
    // Bản sao migrations CHỈ gồm các migration trước TARGET.
    work = mkdtempSync(join(tmpdir(), 'mig-'));
    cpSync(join(API_DIR, 'prisma'), join(work, 'prisma'), { recursive: true });
    for (const d of readdirSync(join(work, 'prisma', 'migrations'))) {
      if (/^\d/.test(d) && d >= TARGET)
        rmSync(join(work, 'prisma', 'migrations', d), { recursive: true });
    }
  });

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe('dữ liệu giống prod', () => {
    beforeAll(() => {
      buildPre();
      expect(applyTarget()).toBeNull();
    }, 300_000);

    it('mọi liên kết dự án→nhóm được chép nguyên (kể cả dự án lưu trữ / xoá mềm); dự án không nhóm không có dòng', () => {
      expect(
        rows(`SELECT "projectId" || '>' || "programId" FROM "ProjectProgram" ORDER BY 1`),
      ).toEqual(['P1>g1', 'P2>g1', 'P3>g2', 'P4>g2']);
    });

    it('cột/bảng cũ biến mất; nhóm và dự án còn nguyên', () => {
      expect(
        rows(
          `SELECT column_name FROM information_schema.columns WHERE table_name='Project' AND column_name IN ('programId','clientId')`,
        ),
      ).toEqual([]);
      expect(
        rows(
          `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('Client','Contract')`,
        ),
      ).toEqual([]);
      expect(q(`SELECT count(*) FROM "Program"`)).toBe('3');
      expect(q(`SELECT count(*) FROM "Project"`)).toBe('5');
      expect(q(`SELECT count(*) FROM "Objective"`)).toBe('2');
    });

    it('xoá nhóm / dự án gỡ liên kết (cascade), không xoá bên kia', () => {
      q(`DELETE FROM "Program" WHERE id='g2'`);
      expect(rows(`SELECT "projectId" FROM "ProjectProgram" ORDER BY 1`)).toEqual(['P1', 'P2']);
      expect(q(`SELECT count(*) FROM "Project"`)).toBe('5');
      q(`DELETE FROM "Project" WHERE id='P2'`);
      expect(rows(`SELECT "projectId" FROM "ProjectProgram" ORDER BY 1`)).toEqual(['P1']);
      expect(q(`SELECT count(*) FROM "Program"`)).toBe('2');
    });

    it('một dự án thuộc được nhiều nhóm; khoá chính chặn trùng', () => {
      q(`INSERT INTO "ProjectProgram"("projectId","programId") VALUES ('P1','g3')`);
      expect(
        rows(`SELECT "programId" FROM "ProjectProgram" WHERE "projectId"='P1' ORDER BY 1`),
      ).toEqual(['g1', 'g3']);
      expect(() =>
        q(`INSERT INTO "ProjectProgram"("projectId","programId") VALUES ('P1','g3')`),
      ).toThrow();
    });

    it('projectId bắt buộc ở mục tiêu / rủi ro / SLA', () => {
      for (const t of ['Objective', 'RaidItem', 'SlaPolicy'])
        expect(
          q(
            `SELECT is_nullable FROM information_schema.columns WHERE table_name='${t}' AND column_name='projectId'`,
          ),
          t,
        ).toBe('NO');
    });

    it('quyền client:manage bị gỡ khỏi danh mục và khỏi vai trò; quyền khác giữ nguyên', () => {
      expect(
        rows(`SELECT key FROM "Permission" WHERE key IN ('client:manage','program:manage')`),
      ).toEqual(['program:manage']);
      expect(rows(`SELECT "permissionId" FROM "RolePermission" WHERE "roleId"='r1'`)).toEqual([
        'perm-prg',
      ]);
    });
  });

  describe('dừng và không đổi gì khi dữ liệu không đúng giả định', () => {
    const untouched = () => {
      // Migration chạy trong một transaction nên thất bại là trả về y nguyên trạng thái trước.
      expect(q(`SELECT count(*) FROM "Project" WHERE "programId" IS NOT NULL`)).toBe('4');
      expect(
        rows(
          `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('ProjectProgram')`,
        ),
      ).toEqual([]);
    };

    it('mục tiêu không có dự án → dừng, nêu số lượng', () => {
      buildPre();
      q(
        `INSERT INTO "Objective"(id,"workspaceId","projectId",name,period,"updatedAt") VALUES ('o3','wA',NULL,'Không dự án','2026-Q4',now())`,
      );
      const err = applyTarget();
      expect(err).toContain('mục tiêu: 1');
      untouched();
    }, 300_000);

    it('rủi ro không có dự án → dừng', () => {
      buildPre();
      q(
        `INSERT INTO "RaidItem"(id,"workspaceId","projectId",title,"updatedAt") VALUES ('r-x','wA',NULL,'Rủi ro',now())`,
      );
      expect(applyTarget()).toContain('rủi ro: 1');
      untouched();
    }, 300_000);

    it('chính sách SLA cấp tổ chức → dừng', () => {
      buildPre();
      q(
        `INSERT INTO "SlaPolicy"(id,"workspaceId","projectId",name,"responseMins","resolveMins","updatedAt") VALUES ('s-x','wA',NULL,'Mặc định',60,480,now())`,
      );
      expect(applyTarget()).toContain('chính sách SLA: 1');
      untouched();
    }, 300_000);

    it('còn khách hàng hoặc hợp đồng → dừng (không âm thầm xoá dữ liệu)', () => {
      buildPre();
      q(
        `INSERT INTO "Client"(id,"workspaceId",name,"updatedAt") VALUES ('c1','wA','Khách A',now())`,
      );
      expect(applyTarget()).toContain('khách hàng: 1');
      untouched();
      expect(q(`SELECT count(*) FROM "Client"`)).toBe('1');
    }, 300_000);
  });
});
