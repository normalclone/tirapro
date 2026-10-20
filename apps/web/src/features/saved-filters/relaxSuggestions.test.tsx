import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { keys } from '@/lib/queryKeys';
import { RELAX_MAX_ROWS, planRelax, shouldRequestRelax, type RelaxCountsDto } from './relaxPlan';
import { RelaxList } from './RelaxList';
import { ResultsTable } from './ResultsTable';

const src = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');
const clause = (text: string, count: number | null) => ({
  text,
  jqlWithout: `không có ${text}`,
  count,
});
const dto = (clauses: RelaxCountsDto['clauses'], remaining = 0): RelaxCountsDto => ({
  clauses,
  remaining,
});

describe('planRelax', () => {
  it('chỉ giữ mệnh đề có count > 0, xếp theo count giảm dần', () => {
    const plan = planRelax(dto([clause('a', 0), clause('b', 3), clause('c', 12), clause('d', 5)]));
    expect(plan.rows.map((r) => [r.text, r.count])).toEqual([
      ['c', 12],
      ['d', 5],
      ['b', 3],
    ]);
  });
  it('count bằng nhau giữ thứ tự gốc (ổn định)', () => {
    const plan = planRelax(dto([clause('x', 2), clause('y', 2), clause('z', 2)]));
    expect(plan.rows.map((r) => r.text)).toEqual(['x', 'y', 'z']);
  });
  it(`tối đa ${RELAX_MAX_ROWS} dòng`, () => {
    const many = Array.from({ length: 8 }, (_, i) => clause(`c${i}`, i + 1));
    const plan = planRelax(dto(many));
    expect(plan.rows).toHaveLength(5);
    expect(plan.rows[0]!.count).toBe(8);
  });
  it('count null = không đếm kịp: không thành dòng, được đếm riêng', () => {
    const plan = planRelax(dto([clause('a', null), clause('b', 4), clause('c', null)]));
    expect(plan.rows.map((r) => r.text)).toEqual(['b']);
    expect(plan.timedOut).toBe(2);
  });
  it('mang theo remaining và số mệnh đề đã đếm', () => {
    const plan = planRelax(dto([clause('a', 1), clause('b', 0)], 3));
    expect(plan.remaining).toBe(3);
    expect(plan.counted).toBe(2);
  });
  it('chưa có dữ liệu → kế hoạch rỗng', () => {
    expect(planRelax(undefined)).toEqual({ rows: [], timedOut: 0, remaining: 0, counted: 0 });
  });
});

describe('shouldRequestRelax — không gọi API khi không có gì để nới', () => {
  it('một mệnh đề → không', () => {
    expect(shouldRequestRelax('status = Done')).toBe(false);
    expect(shouldRequestRelax('status = Done ORDER BY created DESC')).toBe(false);
  });
  it('OR ở gốc / NOT = một mệnh đề → không', () => {
    expect(shouldRequestRelax('status = Done OR priority = High')).toBe(false);
    expect(shouldRequestRelax('NOT (status = Done AND priority = High)')).toBe(false);
  });
  it('JQL rỗng hoặc sai cú pháp → không', () => {
    expect(shouldRequestRelax('')).toBe(false);
    expect(shouldRequestRelax('status = ')).toBe(false);
  });
  it('từ hai mệnh đề AND trở lên → có', () => {
    expect(shouldRequestRelax('status = Done AND priority = High')).toBe(true);
    expect(shouldRequestRelax('a = 1 AND b = 2')).toBe(false); // trường lạ → sai cú pháp
    expect(shouldRequestRelax('project = A AND (status = B OR status = C)')).toBe(true);
  });
});

const view = (data: RelaxCountsDto | undefined, onApply = () => undefined) =>
  renderToStaticMarkup(<RelaxList plan={planRelax(data)} loaded={!!data} onApply={onApply} />);

describe('RelaxList', () => {
  const html = view(dto([clause('status = "Done"', 12), clause('priority = "High"', 1)]));

  it('mỗi dòng là <button type="button"> "Bỏ <điều kiện> → N việc"; tên truy cập có cả điều kiện lẫn số', () => {
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]![0]).toMatch(/type="button"/);
    const names = buttons.map((b) => b[1]!.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'));
    expect(names).toEqual(['Bỏ status = "Done" → 12 việc', 'Bỏ priority = "High" → 1 việc']);
  });
  it('số hiển thị dạng chữ tabular, không phải màu duy nhất', () => {
    expect(html).toMatch(/tabular-nums[^>]*>→ 12 việc/);
  });
  it('điều kiện là TEXT, không bao giờ HTML (không dangerouslySetInnerHTML; thẻ trong điều kiện bị escape)', () => {
    const evil = view(dto([{ text: '<img src=x onerror=alert(1)>', jqlWithout: 'x', count: 3 }]));
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(src('RelaxList.tsx')).not.toContain('dangerouslySetInnerHTML');
  });
  it('có mệnh đề không đếm kịp → ghi chú nhỏ "không đếm kịp", không phải lỗi', () => {
    const h = view(dto([clause('a', 4), clause('b', null), clause('c', null)]));
    expect(h).toContain('2 điều kiện không đếm kịp');
    expect(h).not.toMatch(/role="alert"/);
  });
  it('còn mệnh đề chưa thử → nói số còn lại', () => {
    expect(view(dto([clause('a', 4)], 3))).toContain('Còn 3 điều kiện khác chưa thử');
  });
  it('đếm xong mà mọi mệnh đề đều 0 → nói rõ, không có nút', () => {
    const h = view(dto([clause('a', 0), clause('b', 0)]));
    expect(h).not.toContain('<button');
    expect(h).toContain('Bỏ riêng từng điều kiện vẫn không có việc nào');
  });
  it('chưa có dữ liệu (đang đếm) → dòng nhẹ "Đang thử bỏ từng điều kiện…"', () => {
    const h = renderToStaticMarkup(
      <RelaxList plan={planRelax(undefined)} loaded={false} onApply={() => undefined} />,
    );
    expect(h).toContain('Đang thử bỏ từng điều kiện');
    expect(h).not.toContain('<button');
  });
});

describe('nối dây', () => {
  it('khoá truy vấn đi qua queryKeys.search.relax(jql)', () => {
    expect(keys.search.relax('a = 1')).toEqual(['search-relax', 'a = 1']);
    expect(src('api.ts')).toMatch(/keys\.search\.relax\(jql\)/);
    expect(src('api.ts')).toMatch(/\/search\/relax-counts/);
  });
  it('ResultsTable: nhánh trống (NoResults) có EmptyState + icon + RelaxSuggestions, chỉ tới sau khi đã chạy và không lỗi', () => {
    const s = src('ResultsTable.tsx');
    const noResults = s.slice(
      s.indexOf('function NoResults'),
      s.indexOf('export function ResultsTable'),
    );
    expect(noResults).toContain('<RelaxSuggestions');
    expect(noResults).toMatch(/icon=\{<SearchX/);
    const use = s.indexOf('return <NoResults');
    expect(use).toBeGreaterThan(s.indexOf('if (!hasRun)'));
    expect(use).toBeGreaterThan(s.indexOf('if (error && !issues) return null'));
  });
  it('RelaxSuggestions chỉ gọi API khi shouldRequestRelax(jql)', () => {
    const s = src('RelaxSuggestions.tsx');
    expect(s).toMatch(/useRelaxCounts\(jql, shouldRequestRelax\(jql\)\)/);
  });
  it('FiltersPage: bấm dòng nạp jqlWithout vào ô JQL và chạy luôn', () => {
    const s = src('FiltersPage.tsx');
    expect(s).toMatch(/onApplyJql=\{applyJql\}/);
    const fn = s.slice(s.indexOf('function applyJql'), s.indexOf('async function handleDelete'));
    expect(fn).toContain('setJqlDraft(jql)');
    expect(fn).toContain("setActive({ kind: 'adhoc', jql })");
    expect(fn).toContain('setAdhocJql(jql)');
  });
});

describe('ResultsTable — trạng thái trống với gợi ý (cache đã có)', () => {
  const JQL = 'status = Done AND priority = High AND labels = x';
  const seeded = (over: {
    issues?: null | [];
    hasRun?: boolean;
    error?: string | null;
    jql?: string;
    apply?: boolean;
  }) => {
    const qc = new QueryClient();
    qc.setQueryData(
      keys.search.relax(JQL),
      dto([
        clause('status = "Done"', 12),
        clause('priority = "High"', 0),
        clause('labels = "x"', 3),
      ]),
    );
    return renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ResultsTable
            issues={over.issues === undefined ? [] : over.issues}
            loading={false}
            hasRun={over.hasRun ?? true}
            error={over.error ?? null}
            page={1}
            onPageChange={() => undefined}
            projectKeyById={new Map()}
            onOpen={() => undefined}
            jql={over.jql ?? JQL}
            onApplyJql={over.apply === false ? undefined : () => undefined}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };
  it('đã chạy, không kết quả, không lỗi → EmptyState có icon + các dòng gợi ý (count > 0, giảm dần)', () => {
    const html = seeded({});
    expect(html).toContain('Không có công việc nào khớp');
    expect(html).toMatch(/<svg[^>]*lucide-search-x/);
    const names = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'),
    );
    expect(names).toEqual(['Bỏ status = "Done" → 12 việc', 'Bỏ labels = "x" → 3 việc']);
  });
  it('chưa chạy → không gợi ý', () => {
    expect(seeded({ hasRun: false })).not.toContain('Bỏ ');
  });
  it('truy vấn lỗi → không hiện gì (lỗi đã ở ô JQL)', () => {
    expect(seeded({ issues: null, error: 'JQL không hợp lệ' })).toBe('');
  });
  it('không truyền onApplyJql → không gợi ý', () => {
    expect(seeded({ apply: false })).not.toContain('<button');
  });
  it('chỉ một điều kiện → không có gì để nới', () => {
    const html = seeded({ jql: 'status = Done' });
    expect(html).toContain('Không có công việc nào khớp');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Đang thử');
  });
});
