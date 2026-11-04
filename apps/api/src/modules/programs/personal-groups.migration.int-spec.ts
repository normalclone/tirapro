import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertParityDatabase, parityDatabaseName } from '../../common/testing/parity-db-guard';

/**
 * MIGRATION nhóm dự án CÁ NHÂN TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). Dựng DB nháp ở trạng thái TRƯỚC migration
 * `personal_groups` (áp mọi migration cũ hơn), nạp dữ liệu giống prod (3 nhóm có chủ + 8 liên kết dự án, thêm một nhóm
 * KHÔNG chủ), rồi áp ĐÚNG file migration và kiểm: 3 nhóm giữ nguyên cho chủ của chúng cùng 8 liên kết, nhóm vô chủ bị xoá
 * (kèm liên kết), `ownerId` bắt buộc, tên duy nhất theo từng chủ.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity`.
 * Spec XOÁ SẠCH và dựng lại schema `public` của DB nháp đó — chỉ chạy trên DB nháp (hậu tố `_scratch`/`_parity`/`_w2c`).
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const PSQL = process.env.PSQL ?? 'psql';
const API_DIR = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(API_DIR, 'prisma', 'migrations');
const TARGET = '20261105300000_personal_groups';

describe.skipIf(!DB_URL)('migration nhóm dự án cá nhân ↔ dữ liệu prod', () => {
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

  /** DB mới ở trạng thái ngay TRƯỚC migration + dữ liệu giống prod (Hương 2 nhóm, Phúc 1 nhóm, tổng 8 liên kết). */
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
    const projects = Array.from(
      { length: 8 },
      (_, i) => `('P${i + 1}','wA','P${i + 1}','P${i + 1}',now())`,
    );
    q(`
      INSERT INTO "User"(id,email,"displayName","updatedAt") VALUES
        ('huong','huong@x.t','Huong',now()),('phuc','phuc@x.t','Phuc',now());
      INSERT INTO "Workspace"(id,name,slug,"ownerId","updatedAt") VALUES ('wA','A','a','huong',now());
      INSERT INTO "Program"(id,"workspaceId",name,"ownerId","updatedAt") VALUES
        ('g-kta','wA','KTA tools','huong',now()),
        ('g-psnb','wA','Internal software','huong',now()),
        ('g-th','wA','Thanh Hoa projects','phuc',now());
      INSERT INTO "Project"(id,"workspaceId",key,name,"updatedAt") VALUES ${projects.join(',')};
      INSERT INTO "ProjectProgram"("projectId","programId") VALUES
        ('P1','g-kta'),('P2','g-kta'),('P3','g-psnb'),('P4','g-psnb'),
        ('P5','g-th'),('P6','g-th'),('P7','g-th'),('P8','g-th');
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
      // Thêm nhóm KHÔNG chủ (prod không có) — phải bị xoá cùng liên kết của nó.
      q(`
        INSERT INTO "Program"(id,"workspaceId",name,"updatedAt") VALUES ('g-orphan','wA','No owner',now());
        INSERT INTO "ProjectProgram"("projectId","programId") VALUES ('P1','g-orphan');
      `);
      expect(applyTarget()).toBeNull();
    }, 300_000);

    it('3 nhóm giữ nguyên cho đúng chủ; nhóm không chủ bị xoá', () => {
      expect(rows(`SELECT p.name || '|' || p."ownerId" FROM "Program" p ORDER BY 1`)).toEqual([
        'Internal software|huong',
        'KTA tools|huong',
        'Thanh Hoa projects|phuc',
      ]);
    });

    it('8 liên kết dự án→nhóm của 3 nhóm còn nguyên; liên kết của nhóm vô chủ biến mất; dự án còn đủ', () => {
      expect(q(`SELECT count(*) FROM "ProjectProgram"`)).toBe('8');
      expect(
        rows(
          `SELECT "programId" || ':' || count(*) FROM "ProjectProgram" GROUP BY "programId" ORDER BY 1`,
        ),
      ).toEqual(['g-kta:2', 'g-psnb:2', 'g-th:4']);
      expect(q(`SELECT count(*) FROM "Project"`)).toBe('8');
    });

    it('ownerId bắt buộc; tên duy nhất theo từng chủ (người khác đặt trùng tên được, chính mình thì không)', () => {
      expect(
        q(
          `SELECT is_nullable FROM information_schema.columns WHERE table_name='Program' AND column_name='ownerId'`,
        ),
      ).toBe('NO');
      expect(() =>
        q(
          `INSERT INTO "Program"(id,"workspaceId",name,"updatedAt") VALUES ('x1','wA','Ownerless',now())`,
        ),
      ).toThrow();
      // Phúc đặt trùng tên nhóm của Hương: được
      q(
        `INSERT INTO "Program"(id,"workspaceId",name,"ownerId","updatedAt") VALUES ('g-dup','wA','Internal software','phuc',now())`,
      );
      // Hương đặt trùng tên nhóm của chính mình: bị chặn
      expect(() =>
        q(
          `INSERT INTO "Program"(id,"workspaceId",name,"ownerId","updatedAt") VALUES ('g-dup2','wA','Internal software','huong',now())`,
        ),
      ).toThrow();
      expect(
        rows(
          `SELECT indexname FROM pg_indexes WHERE tablename='Program' AND indexname='Program_workspaceId_name_key'`,
        ),
      ).toEqual([]);
    });

    it('xoá người dùng xoá nhóm riêng của họ (và liên kết); xoá nhóm không xoá dự án', () => {
      q(`DELETE FROM "User" WHERE id='phuc'`);
      expect(rows(`SELECT id FROM "Program" ORDER BY 1`)).toEqual(['g-kta', 'g-psnb']);
      expect(q(`SELECT count(*) FROM "ProjectProgram" WHERE "programId"='g-th'`)).toBe('0');
      expect(q(`SELECT count(*) FROM "Project"`)).toBe('8');
    });
  });
});
