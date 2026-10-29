import { describe, expect, it, vi } from 'vitest';
import type { Block } from './blocks';
import { detectIntent } from './intents';
import { confirmDraft, respond, MAX_ROWS, suggestionChips } from './respond';
import { ENV, issue, makeDeps, ok } from './fixtures';

const run = (text: string, env = ENV, deps = makeDeps()) => respond(detectIntent(text), env, deps);
const find = <T extends Block['type']>(bs: Block[], t: T) =>
  bs.find((b): b is Extract<Block, { type: T }> => b.type === t);
const allText = (bs: Block[]) => bs.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');

describe('tạo task: nháp → xác nhận', () => {
  it('"tạo task …" chỉ dựng thẻ nháp pending và chỉ ĐỌC dữ liệu (không có lời gọi ghi nào)', async () => {
    const deps = makeDeps();
    const out = await run('tạo task Sửa lỗi login !high @an', ENV, deps);
    const d = find(out, 'draft')!;
    expect(d.status).toBe('pending');
    expect(d.draft.summary).toBe('Sửa lỗi login');
    expect(d.draft.projectKey).toBe('DEMO');
    // Mọi thứ respond đã gọi đều là hàm đọc (AssistantDeps không có hàm tạo/ghi — kiểu dữ liệu bảo đảm).
    expect([...new Set(deps.calls)].sort()).toEqual([
      'canCreate',
      'getMeta',
      'getSprints',
      'getUsers',
    ]);
    expect(allText(out)).toContain('chưa có gì được tạo');
  });
  it('chỉ confirmDraft mới tạo việc, đúng payload của thẻ', async () => {
    const d = find(await run('tạo task Viết test !high ~5'), 'draft')!.draft;
    const create = vi.fn(() => Promise.resolve({ id: 'new1', key: 'DEMO-TASK-9' }));
    const r = await confirmDraft(d, create, String);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(d.input);
    expect(r).toEqual({ ok: true, id: 'new1', key: 'DEMO-TASK-9' });
  });
  it('tạo thất bại → ok:false kèm thông báo, không ném', async () => {
    const d = find(await run('tạo task X'), 'draft')!.draft;
    const r = await confirmDraft(
      d,
      () => Promise.reject(new Error('boom')),
      (e) => `Lỗi: ${(e as Error).message}`,
    );
    expect(r).toEqual({ ok: false, error: 'Lỗi: boom' });
  });
  it('tiêu đề trống thì confirmDraft không gọi tạo', async () => {
    const d = find(await run('tạo task X'), 'draft')!.draft;
    const create = vi.fn();
    const r = await confirmDraft({ ...d, input: { ...d.input, summary: '  ' } }, create, String);
    expect(create).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
  it('thêm bug → thẻ loại Bug', async () => {
    expect(find(await run('thêm bug Nút lưu hỏng'), 'draft')!.draft.typeName).toBe('Bug');
  });
  it('chỉ có lệnh, chưa có tiêu đề → hỏi lại, không có thẻ nháp, không gọi API', async () => {
    const deps = makeDeps();
    const out = await run('tạo task', ENV, deps);
    expect(find(out, 'draft')).toBeUndefined();
    expect(allText(out)).toContain('Bạn muốn tạo việc gì');
    expect(deps.calls).toContain('canCreate');
    expect(deps.calls).not.toContain('getMeta');
  });
  it('chỉ toàn token (tiêu đề trống) → báo, không dựng thẻ', async () => {
    const out = await run('tạo task !high @an');
    expect(find(out, 'draft')).toBeUndefined();
    expect(allText(out)).toContain('Tiêu đề đang trống');
  });
  it('ngoài dự án: hỏi chọn dự án, chip dự án gần dùng đứng đầu, chip mang lại câu lệnh + projectKey', async () => {
    const deps = makeDeps();
    const out = await run('tạo task Dọn kho', { ...ENV, project: null, pathname: '/' }, deps);
    expect(find(out, 'draft')).toBeUndefined();
    const chips = find(out, 'chips')!.chips;
    expect(chips.map((c) => c.projectKey)).toEqual(['ALPHA', 'DEMO']);
    expect(chips[0]!.text).toBe('tạo việc Dọn kho');
    // Chip gửi lại đúng câu lệnh → vẫn là lệnh tạo việc với cùng tiêu đề.
    expect(detectIntent(chips[0]!.text)).toEqual({
      kind: 'create',
      typeHint: null,
      text: 'Dọn kho',
    });
    expect(deps.calls).toEqual([]);
  });
  it('chọn dự án bằng chip (forceProjectKey) → thẻ nháp ở đúng dự án đó', async () => {
    const deps = makeDeps();
    const out = await run(
      'tạo task Dọn kho',
      { ...ENV, project: null, forceProjectKey: 'alpha' },
      deps,
    );
    expect(find(out, 'draft')!.draft.projectKey).toBe('ALPHA');
    expect(deps.calls).toContain('canCreate');
  });
  it('không có quyền tạo → báo rõ, không dựng thẻ', async () => {
    const deps = makeDeps({ canCreate: ok(false) });
    const out = await run('tạo task Dọn kho', ENV, deps);
    expect(find(out, 'draft')).toBeUndefined();
    expect(allText(out)).toContain('không có quyền tạo việc trong dự án DEMO');
  });
  it('quyền chưa biết (đang tải) → vẫn soạn nháp, API sẽ kiểm khi tạo', async () => {
    const out = await run('tạo task Dọn kho', ENV, makeDeps({ canCreate: ok(undefined) }));
    expect(find(out, 'draft')).toBeDefined();
  });
  it('dự án hiện tại đã lưu trữ (không nằm trong danh sách hoạt động) → hỏi chọn dự án khác', async () => {
    const out = await run('tạo task X', { ...ENV, project: { id: 'old', key: 'OLD', name: 'Cũ' } });
    expect(allText(out)).toContain('OLD không còn hoạt động');
    expect(find(out, 'chips')!.chips.length).toBe(2);
  });
  it('không có dự án nào → báo', async () => {
    const out = await run('tạo task X', { ...ENV, project: null, projects: [] });
    expect(allText(out)).toContain('Chưa có dự án nào');
  });
});

describe('hỏi dữ liệu hệ thống', () => {
  const items = Array.from({ length: 8 }, (_, i) =>
    issue({ id: `i${i}`, key: `DEMO-TASK-${i + 1}`, summary: `Việc ${i + 1}` }),
  );
  it('"việc quá hạn": ≤5 dòng, đánh dấu quá hạn, link Xem tất cả với JQL trong dự án', async () => {
    const deps = makeDeps({ searchJql: ok({ items, hasMore: false }) });
    const out = await run('việc quá hạn', ENV, deps);
    const l = find(out, 'issues')!;
    expect(l.rows).toHaveLength(MAX_ROWS);
    expect(l.rows[0]).toMatchObject({
      key: 'DEMO-TASK-1',
      status: 'In Progress',
      due: '25/10/2026',
      overdue: true,
    });
    expect(l.more).toBe(true);
    expect(decodeURIComponent(l.seeAllTo)).toContain('project = "DEMO" AND due < startOfDay()');
    expect(allText(out)).toContain('trong dự án DEMO: 8 việc');
  });
  it('ngoài dự án: toàn workspace, JQL không có project', async () => {
    const out = await run(
      'việc của tôi',
      { ...ENV, project: null, pathname: '/' },
      makeDeps({ searchJql: ok({ items: items.slice(0, 2), hasMore: false }) }),
    );
    expect(allText(out)).toContain('trong toàn bộ workspace');
    expect(decodeURIComponent(find(out, 'issues')!.seeAllTo)).not.toContain('project');
    expect(find(out, 'issues')!.more).toBe(false);
  });
  it('còn trang kế → ghi "hơn N"', async () => {
    const out = await run(
      'việc quá hạn',
      ENV,
      makeDeps({ searchJql: ok({ items, hasMore: true }) }),
    );
    expect(allText(out)).toContain('hơn 8 việc');
  });
  it('không có kết quả → câu thân thiện, không có danh sách', async () => {
    const out = await run('việc đến hạn tuần này');
    expect(find(out, 'issues')).toBeUndefined();
    expect(allText(out)).toContain('Không có việc nào đến hạn trong tuần này');
  });
  it('tìm từ khoá: JQL text ~ nguyên văn', async () => {
    const seen: string[] = [];
    await run(
      'tìm Đăng Nhập',
      ENV,
      makeDeps({
        searchJql: (j) => Promise.resolve((seen.push(j), { items: [], hasMore: false })),
      }),
    );
    expect(seen[0]).toContain('text ~ "Đăng Nhập"');
  });
  it('chữ người dùng/dữ liệu issue chỉ ở dạng text thuần trong khối (không có HTML được dựng)', async () => {
    const evil = issue({ summary: '<img src=x onerror=alert(1)>' });
    const out = await run(
      'việc của tôi',
      ENV,
      makeDeps({ searchJql: ok({ items: [evil], hasMore: false }) }),
    );
    expect(find(out, 'issues')!.rows[0]!.summary).toBe('<img src=x onerror=alert(1)>');
  });
  it('mã việc: tóm tắt trạng thái/người/hạn/ưu tiên/việc con/bình luận + link mở', async () => {
    const out = await run('BUG-12');
    const f = find(out, 'facts')!;
    const row = (l: string) => f.rows.find((r) => r.label === l)?.value;
    expect(row('Trạng thái')).toBe('In Progress');
    expect(row('Người phụ trách')).toBe('An Nguyễn');
    expect(row('Ưu tiên')).toBe('High');
    expect(row('Hạn')).toContain('25/10/2026 (quá hạn 4 ngày)');
    expect(row('Việc con')).toBe('1');
    expect(row('Bình luận')).toBe('3');
    expect(f.to).toEqual({ label: 'Mở công việc', to: '/issue/DEMO-TASK-1' });
  });
  it('mã không tồn tại / không có quyền → báo', async () => {
    const out = await run('BUG-99', ENV, makeDeps({ getIssue: ok(null) }));
    expect(allText(out)).toContain('Không thấy công việc BUG-99');
  });
  it('"tóm tắt việc này" cần đang ở trang công việc', async () => {
    expect(allText(await run('tóm tắt việc này'))).toContain('Mở một công việc');
    const deps = makeDeps();
    const out = await run(
      'tóm tắt việc này',
      { ...ENV, pathname: '/issue/DEMO-TASK-1', issueKey: 'DEMO-TASK-1' },
      deps,
    );
    expect(find(out, 'facts')).toBeDefined();
    expect(deps.calls).toContain('getIssue');
  });
});

describe('sprint hiện tại', () => {
  it('tên sprint, ngày kết thúc (còn N ngày), số việc theo nhóm trạng thái (từ danh sách việc của dự án)', async () => {
    const stat = (c: string, sprintId: string | null = 's1') =>
      issue({ sprintId, status: { id: c, name: c, category: c } });
    const deps = makeDeps({
      getProjectIssues: ok([
        stat('TODO'),
        stat('TODO'),
        stat('IN_PROGRESS'),
        stat('DONE'),
        stat('TODO', 's2'),
        stat('DONE', null),
      ]),
    });
    const f = find(await run('sprint hiện tại thế nào', ENV, deps), 'facts')!;
    expect(f.title).toBe('Sprint đang chạy: Sprint 7');
    const row = (l: string) => f.rows.find((r) => r.label === l)?.value;
    expect(row('Kết thúc')).toBe('02/11/2026 (còn 4 ngày)');
    expect(row('Số việc')).toBe('4');
    expect(row('Theo trạng thái')).toBe('To Do: 2 · In Progress: 1 · Done: 1');
    expect(row('Mục tiêu')).toBe('Ra mắt bản beta');
    expect(deps.calls).not.toContain('searchJql');
  });
  it('chọn dự án bằng chip cũng áp cho sprint/danh sách (không hỏi lại)', async () => {
    const deps = makeDeps();
    const out = await run(
      'sprint hiện tại thế nào',
      { ...ENV, project: null, pathname: '/', forceProjectKey: 'alpha' },
      deps,
    );
    expect(deps.calls).toContain('getSprints');
    expect(find(out, 'facts')!.title).toContain('Sprint 7');
    const mine = makeDeps();
    await run('việc quá hạn', { ...ENV, project: null, forceProjectKey: 'ALPHA' }, mine);
    expect(mine.calls).toContain('searchJql');
  });
  it('chưa có sprint đang chạy → nói rõ', async () => {
    const out = await run('sprint hiện tại thế nào', ENV, makeDeps({ getSprints: ok([]) }));
    expect(allText(out)).toContain('chưa có sprint nào đang chạy');
  });
  it('ngoài dự án → hỏi chọn dự án', async () => {
    const out = await run('sprint hiện tại thế nào', { ...ENV, project: null, pathname: '/' });
    expect(find(out, 'chips')!.chips.map((c) => c.projectKey)).toEqual(['ALPHA', 'DEMO']);
  });
});

describe('theo màn hình và hướng dẫn', () => {
  it('"màn này dùng để làm gì": mô tả màn + link tài liệu; có tour thì có nút chạy', async () => {
    const out = await run('màn này dùng để làm gì', {
      ...ENV,
      tour: { available: true, title: 'Làm quen Bảng việc', description: '4 bước' },
    });
    expect(allText(out)).toContain('Bảng việc:');
    expect(allText(out)).toContain('Làm quen Bảng việc — 4 bước');
    expect(find(out, 'tour')!.label).toBe('Chạy hướng dẫn từng bước');
    expect(find(out, 'links')!.items[0]!.to).toBe('/documentation#lam-viec-issue');
  });
  it('màn không có tour → không có nút', async () => {
    expect(find(await run('màn này dùng để làm gì'), 'tour')).toBeUndefined();
  });
  it('chip mở panel hợp màn hiện tại (3–4 chip)', () => {
    const board = suggestionChips('/p/DEMO/board').map((c) => c.label);
    expect(board).toContain('Sprint hiện tại thế nào');
    expect(board.length).toBeGreaterThanOrEqual(3);
    expect(board.length).toBeLessThanOrEqual(4);
    expect(suggestionChips('/issue/DEMO-TASK-1').map((c) => c.label)).toContain('Tóm tắt việc này');
    expect(suggestionChips('/zzz/lạ').length).toBeGreaterThanOrEqual(3);
  });
});

describe('hướng dẫn hệ thống (FAQ)', () => {
  it('"làm sao tạo sprint": 1–3 mục, mỗi mục có tóm tắt và link /documentation#anchor', async () => {
    const out = await run('Làm sao tạo sprint?');
    const l = find(out, 'links')!;
    expect(l.items.length).toBeGreaterThanOrEqual(1);
    expect(l.items.length).toBeLessThanOrEqual(3);
    expect(l.items[0]).toMatchObject({
      to: '/documentation#lap-chay-sprint',
      linkLabel: 'Xem hướng dẫn',
    });
    expect(l.items[0]!.summary.length).toBeGreaterThan(20);
  });
  it('"nhập excel ở đâu": trong dự án có nút mở đúng dự án hiện tại; ngoài dự án thì bỏ nút', async () => {
    const inProj = find(await run('nhập excel ở đâu'), 'links')!.items[0]!;
    expect(inProj.extra).toEqual({ label: 'Mở Nhập dữ liệu của dự án', to: '/p/DEMO/config/data' });
    const outProj = find(await run('nhập excel ở đâu', { ...ENV, project: null }), 'links')!
      .items[0]!;
    expect(outProj.extra).toBeUndefined();
  });
  it('mọi link nội bộ (không URL ngoài)', async () => {
    for (const q of ['phím tắt', 'phân quyền thế nào', 'báo lỗi thế nào']) {
      const l = find(await run(q), 'links')!;
      for (const it of l.items) expect(it.to.startsWith('/')).toBe(true);
    }
  });
  it('không khớp → thân thiện + chip câu hỏi phổ biến + nút "Tìm … trong công việc"', async () => {
    const out = await run('zxcv qwer');
    const chips = find(out, 'chips')!.chips;
    expect(allText(out)).toContain('chưa hiểu');
    expect(chips[0]).toEqual({ label: 'Tìm “zxcv qwer” trong công việc', text: 'tìm zxcv qwer' });
    expect(chips.length).toBeGreaterThan(3);
    expect(detectIntent(chips[0]!.text)).toEqual({ kind: 'search', query: 'zxcv qwer' });
  });
});

describe('khác', () => {
  it('lời chào và "bạn làm được gì" có chip gợi ý', async () => {
    expect(find(await run('xin chào'), 'chips')).toBeDefined();
    expect(allText(await run('bạn làm được gì'))).toContain('4 việc');
  });
  it('câu rỗng → không có khối nào', async () => {
    expect(await run('  ')).toEqual([]);
  });
});
