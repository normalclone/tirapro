import { describe, expect, it, vi } from 'vitest';
import {
  buildFulltextQuery,
  FulltextSearcher,
  isMissingColumnError,
  isMissingSearchObject,
} from './fulltext';

/** Gom chuỗi SQL + tham số từ lời gọi tagged template `$queryRaw` (làm phẳng cả Prisma.sql lồng nhau). */
function renderCall(call: unknown[]): { sql: string; values: unknown[] } {
  const first = call[0] as string[] | { strings: readonly string[]; values: unknown[] };
  const strings = Array.isArray(first) ? first : first.strings;
  const vals = Array.isArray(first) ? call.slice(1) : first.values;
  let sql = '';
  const values: unknown[] = [];
  strings.forEach((str, i) => {
    sql += str;
    if (i >= vals.length) return;
    const v = vals[i];
    if (v && typeof v === 'object' && 'strings' in v && 'values' in v) {
      const inner = renderCall([v]);
      sql += inner.sql;
      values.push(...inner.values);
    } else {
      sql += '?';
      values.push(v);
    }
  });
  return { sql, values };
}

function makePrisma(impl: (...args: unknown[]) => unknown) {
  return { $queryRaw: vi.fn(impl) };
}

describe('buildFulltextQuery', () => {
  it('cắt khoảng trắng thừa, bỏ ký tự NUL và giới hạn độ dài', () => {
    expect(buildFulltextQuery('  đăng   nhập \u0000lỗi ')?.q).toBe('đăng nhập lỗi');
    expect(buildFulltextQuery('a'.repeat(500))?.q).toHaveLength(200);
  });

  it('trả null khi rỗng/chỉ khoảng trắng', () => {
    expect(buildFulltextQuery('   ')).toBeNull();
    expect(buildFulltextQuery('\u0000')).toBeNull();
  });

  it('escape ký tự đại diện của ILIKE (% _ \\) trong pattern', () => {
    expect(buildFulltextQuery('50%_off\\')?.like).toBe('%50\\%\\_off\\\\%');
    expect(buildFulltextQuery('50%')?.q).toBe('50%');
  });
});

describe('buildFulltextQuery — bỏ dấu/tiền tố', () => {
  it('tsquery: token chữ/số, mỗi token thêm :* nối bằng &; giữ q/like cũ', () => {
    const b = buildFulltextQuery('  Thanh toán, số 37 ')!;
    expect(b.tsquery).toBe('Thanh:* & toán:* & số:* & 37:*');
    expect(b.q).toBe('Thanh toán, số 37');
  });
  it('likeNorm/qn: đã bỏ dấu + hạ chữ thường + escape ký tự đại diện', () => {
    const b = buildFulltextQuery('Thanh toán 50%')!;
    expect(b.qn).toBe('thanh toan 50%');
    expect(b.likeNorm).toBe('%thanh toan 50\\%%');
  });
  it('chỉ ký tự đặc biệt => tsquery rỗng (câu SQL vẫn chạy bằng nhánh ILIKE)', () => {
    expect(buildFulltextQuery('!!!')!.tsquery).toBe('');
  });
});

describe('isMissingColumnError / isMissingSearchObject', () => {
  it('nhận cả 42883 (thiếu hàm immutable_unaccent), cùng một hàm với tên cũ', () => {
    expect(isMissingSearchObject({ code: 'P2010', meta: { code: '42883' } })).toBe(true);
    expect(isMissingSearchObject(new Error('Raw query failed. Code: `42883`. function'))).toBe(
      true,
    );
    expect(isMissingColumnError).toBe(isMissingSearchObject);
  });
  it('nhận mã 42703 ở các dạng lỗi Prisma/pg', () => {
    expect(isMissingColumnError({ code: 'P2010', meta: { code: '42703', message: 'x' } })).toBe(
      true,
    );
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
    expect(
      isMissingColumnError(
        new Error('Raw query failed. Code: `42703`. Message: column "searchVector" does not exist'),
      ),
    ).toBe(true);
  });
  it('không nhận lỗi khác', () => {
    expect(isMissingColumnError(new Error('timeout'))).toBe(false);
    expect(isMissingColumnError({ code: 'P2010', meta: { code: '57014' } })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe('FulltextSearcher.search — SQL bỏ dấu/tiền tố/typo', () => {
  it('dùng to_tsquery tiền tố + immutable_unaccent, so sánh summary/description theo lower(immutable_unaccent(..)), key ILIKE, toán tử <% cho typo; mọi giá trị bind', async () => {
    const prisma = makePrisma(() => Promise.resolve([{ id: 'I1', rank: 1 }]));
    const res = await new FulltextSearcher(prisma as never).search(
      'W1',
      "thanh toan'; DROP TABLE x;--",
    );
    expect(res).toEqual({ ids: ['I1'] });
    const { sql, values } = renderCall(prisma.$queryRaw.mock.calls[0]!);
    expect(sql).toContain("to_tsquery('simple', immutable_unaccent(");
    expect(sql).not.toContain('websearch_to_tsquery');
    expect(sql).toContain('lower(immutable_unaccent(i."summary"))');
    expect(sql).toContain('lower(immutable_unaccent(i."description"))');
    expect(sql).toContain('i."key" ILIKE');
    expect(sql).toContain('<%');
    expect(sql).not.toContain('DROP TABLE');
    expect(values.some((v) => typeof v === 'string' && v.startsWith('thanh:*'))).toBe(true);
    expect(values).toContain('W1');
  });
});

describe('FulltextSearcher.search', () => {
  it('truy vấn tham số hoá (không nối chuỗi) và trả ids theo thứ tự rank', async () => {
    const prisma = makePrisma(() =>
      Promise.resolve([
        { id: 'I2', rank: 0.9 },
        { id: 'I1', rank: 0.1 },
      ]),
    );
    const res = await new FulltextSearcher(prisma as never).search(
      'W1',
      "đăng nhập'; DROP TABLE x;--",
    );
    expect(res).toEqual({ ids: ['I2', 'I1'] });
    const { sql, values } = renderCall(prisma.$queryRaw.mock.calls[0]!);
    expect(sql).toContain("to_tsquery('simple'");
    expect(sql).not.toContain('websearch_to_tsquery');
    expect(sql).toContain('"searchVector"');
    expect(sql).not.toContain('DROP TABLE');
    expect(values.some((v) => typeof v === 'string' && v.startsWith('đăng:* & nhập:*'))).toBe(true);
    expect(values).toContain('W1');
    expect(values.some((v) => typeof v === 'string' && v.startsWith('%') && v.endsWith('%'))).toBe(
      true,
    );
  });

  it('thêm điều kiện projectId (bind) khi có', async () => {
    const prisma = makePrisma(() => Promise.resolve([]));
    await new FulltextSearcher(prisma as never).search('W1', 'abc', { projectId: 'P1' });
    const { sql, values } = renderCall(prisma.$queryRaw.mock.calls[0]!);
    expect(sql).toContain('"projectId"');
    expect(values).toContainEqual(['P1']);
  });

  it('khớp cả summary, description và key; nhận nhiều projectIds (bind, = ANY)', async () => {
    const prisma = makePrisma(() => Promise.resolve([]));
    await new FulltextSearcher(prisma as never).search('W1', 'abc', { projectIds: ['P1', 'P2'] });
    const { sql, values } = renderCall(prisma.$queryRaw.mock.calls[0]!);
    expect(sql).toContain('"description"');
    expect(sql).toContain('"key" ILIKE');
    expect(sql).toMatch(/"projectId" = ANY/);
    expect(values).toContainEqual(['P1', 'P2']);
  });

  it('projectIds rỗng => không chạm DB, ids []', async () => {
    const prisma = makePrisma(() => Promise.resolve([]));
    expect(
      await new FulltextSearcher(prisma as never).search('W1', 'abc', { projectIds: [] }),
    ).toEqual({ ids: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('JOIN Project và lọc dự án đã xoá mềm (id dự án đã xoá không chiếm chỗ trong top)', async () => {
    const prisma = makePrisma(() => Promise.resolve([]));
    await new FulltextSearcher(prisma as never).search('W1', 'abc');
    const { sql } = renderCall(prisma.$queryRaw.mock.calls[0]!);
    expect(sql).toMatch(/JOIN "Project" p ON p\."id" = i\."projectId"/);
    expect(sql).toContain('p."deletedAt" IS NULL');
  });

  it('chuỗi rỗng -> ids [] và không chạm DB', async () => {
    const prisma = makePrisma(() => Promise.resolve([]));
    expect(await new FulltextSearcher(prisma as never).search('W1', '  ')).toEqual({ ids: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('thiếu hàm immutable_unaccent (42883) hoặc cột searchVector (42703) => câu fallback translate(), KHÔNG cần extension, trả ids, cảnh báo một lần', async () => {
    const calls: unknown[][] = [];
    const prisma = {
      $queryRaw: vi.fn((...args: unknown[]) => {
        calls.push(args);
        return calls.length % 2 === 1
          ? Promise.reject(
              Object.assign(new Error('Raw query failed'), {
                code: 'P2010',
                meta: { code: calls.length === 1 ? '42883' : '42703' },
              }),
            )
          : Promise.resolve([{ id: 'F1' }]);
      }),
    };
    const logger = { warn: vi.fn() };
    const s = new FulltextSearcher(prisma as never, logger);
    expect(await s.search('W1', 'thanh toan')).toEqual({ ids: ['F1'] });
    expect(await s.search('W1', 'khac')).toEqual({ ids: ['F1'] });
    const fb = renderCall(calls[1]!);
    expect(fb.sql).toContain('translate(');
    expect(fb.sql).not.toContain('searchVector');
    expect(fb.sql).not.toContain('immutable_unaccent');
    expect(fb.sql).toContain('"deletedAt" IS NULL');
    expect(fb.values).toContain('%thanh toan%');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('db:raw');
  });

  it('fallback vẫn scope project/workspace và ném lại nếu chính câu fallback lỗi lạ', async () => {
    const calls: unknown[][] = [];
    const prisma = {
      $queryRaw: vi.fn((...args: unknown[]) => {
        calls.push(args);
        return Promise.reject(
          calls.length === 1
            ? Object.assign(new Error('x'), { meta: { code: '42703' } })
            : new Error('boom'),
        );
      }),
    };
    const s = new FulltextSearcher(prisma as never, { warn: vi.fn() });
    await expect(s.search('W1', 'abc', { projectIds: ['P1'] })).rejects.toThrow('boom');
    const fb = renderCall(calls[1]!);
    expect(fb.sql).toMatch(/"projectId" = ANY/);
    expect(fb.values).toContainEqual(['P1']);
    expect(fb.values).toContain('W1');
  });

  it('lỗi cú pháp tsquery (42601) => chạy lại chỉ bằng nhánh ILIKE (tsquery rỗng), không 500', async () => {
    const calls: unknown[][] = [];
    const prisma = {
      $queryRaw: vi.fn((...args: unknown[]) => {
        calls.push(args);
        return calls.length === 1
          ? Promise.reject(
              Object.assign(new Error('Raw query failed'), {
                code: 'P2010',
                meta: { code: '42601' },
              }),
            )
          : Promise.resolve([{ id: 'S1', rank: 1 }]);
      }),
    };
    const res = await new FulltextSearcher(prisma as never).search('W1', 'ʼ⑴');
    expect(res).toEqual({ ids: ['S1'] });
    const first = renderCall(calls[0]!);
    const retry = renderCall(calls[1]!);
    expect(first.values).toContain('1:*');
    expect(retry.values).not.toContain('1:*');
    expect(retry.values).toContain('');
    expect(retry.sql).toContain("to_tsquery('simple'");
  });

  it('lỗi DB khác được ném lại (không nuốt)', async () => {
    const prisma = makePrisma(() => Promise.reject(new Error('connection lost')));
    await expect(new FulltextSearcher(prisma as never).search('W1', 'abc')).rejects.toThrow(
      'connection lost',
    );
  });
});
