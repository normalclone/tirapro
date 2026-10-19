import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearWikiDraft,
  buildCreateInput,
  draftOffer,
  isNewDraftKey,
  isWikiDirty,
  loadWikiDraft,
  newDraftKey,
  pendingNewFor,
  saveWikiDraft,
  wikiDraftKey,
} from './wikiDraft';

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}
const page = { title: 'Họp', body: 'nội dung' };

describe('wiki draft (WO-I1)', () => {
  it('dirty khi tiêu đề hoặc nội dung khác trang đang lưu', () => {
    expect(isWikiDirty(page, page)).toBe(false);
    expect(isWikiDirty({ ...page, body: 'khác' }, page)).toBe(true);
    expect(isWikiDirty({ ...page, title: 'khác' }, page)).toBe(true);
    expect(isWikiDirty(page, undefined)).toBe(false);
  });
  it('lưu rồi nạp lại đúng theo pageId; xoá thì hết', () => {
    const s = memStore();
    saveWikiDraft('p1', { title: 'A', body: 'B', baseVersion: 3 }, 111, s);
    expect(loadWikiDraft('p1', s)).toEqual({ title: 'A', body: 'B', baseVersion: 3, savedAt: 111 });
    expect(loadWikiDraft('p2', s)).toBeNull();
    clearWikiDraft('p1', s);
    expect(loadWikiDraft('p1', s)).toBeNull();
  });
  it('dữ liệu hỏng / storage ném lỗi / không có storage → không vỡ', () => {
    expect(loadWikiDraft('p1', memStore({ [wikiDraftKey('p1')]: '{không phải json' }))).toBeNull();
    expect(loadWikiDraft('p1', memStore({ [wikiDraftKey('p1')]: '{"title":1}' }))).toBeNull();
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadWikiDraft('p1', boom)).toBeNull();
    expect(() =>
      saveWikiDraft('p1', { title: 'a', body: 'b', baseVersion: 1 }, 1, boom),
    ).not.toThrow();
    expect(() => clearWikiDraft('p1', boom)).not.toThrow();
    expect(loadWikiDraft('p1', null)).toBeNull();
  });
  it('chỉ đề nghị khôi phục khi nháp khác trang hiện tại', () => {
    const d = { title: 'Họp', body: 'nháp', baseVersion: 1, savedAt: 1 };
    expect(draftOffer(d, page)).toEqual(d);
    expect(draftOffer({ ...d, body: 'nội dung' }, page)).toBeNull();
    expect(draftOffer(null, page)).toBeNull();
  });
});

describe('trang mới chưa lưu (R1/A-D3): nháp theo khoá new:<cha>:<phạm vi>', () => {
  it('newDraftKey ổn định theo (cha, phạm vi); gốc/dùng chung có nhãn riêng', () => {
    expect(newDraftKey({ parentId: null, projectId: null })).toBe('new:root:shared');
    expect(newDraftKey({ parentId: 'pg1', projectId: 'pr1' })).toBe('new:pg1:pr1');
    expect(newDraftKey({ parentId: null, projectId: 'pr1' })).not.toBe(
      newDraftKey({ parentId: null, projectId: null }),
    );
  });
  it('isNewDraftKey phân biệt khoá nháp-trang-mới với id thật (cuid không bắt đầu bằng "new:")', () => {
    expect(isNewDraftKey('new:root:shared')).toBe(true);
    expect(isNewDraftKey('cmv9e5dgk004bwg3c41yppvfj')).toBe(false);
  });
  it('nháp trang mới lưu/nạp qua cùng storage, tách khỏi nháp của trang thật', () => {
    const s = memStore();
    const key = newDraftKey({ parentId: null, projectId: null });
    saveWikiDraft(key, { title: 'Quy trình', body: 'abc', baseVersion: null }, 5, s);
    expect(loadWikiDraft(key, s)).toMatchObject({ title: 'Quy trình', body: 'abc' });
    expect(loadWikiDraft('p1', s)).toBeNull();
    // trang mới mốc rỗng: nháp có chữ ⇒ được đề nghị khôi phục; nháp rỗng ⇒ không
    expect(draftOffer(loadWikiDraft(key, s), { title: '', body: '' })).not.toBeNull();
    clearWikiDraft(key, s);
    expect(loadWikiDraft(key, s)).toBeNull();
  });
  it('pendingNewFor: trang gốc theo phạm vi đang chọn; trang con LUÔN theo dự án của cha', () => {
    expect(pendingNewFor(null, 'prX')).toEqual({ parentId: null, projectId: 'prX' });
    expect(pendingNewFor(null, null)).toEqual({ parentId: null, projectId: null });
    expect(pendingNewFor({ id: 'pg1', projectId: 'prP' }, 'prX')).toEqual({
      parentId: 'pg1',
      projectId: 'prP',
    });
    expect(pendingNewFor({ id: 'pg1', projectId: null }, 'prX')).toEqual({
      parentId: 'pg1',
      projectId: null,
    });
  });
  it('buildCreateInput: cắt tiêu đề, giữ nguyên nội dung, gửi cha + phạm vi', () => {
    expect(buildCreateInput({ parentId: 'pg1', projectId: 'prP' }, '  Họp tuần  ', '# n')).toEqual({
      title: 'Họp tuần',
      body: '# n',
      parentId: 'pg1',
      projectId: 'prP',
    });
    expect(buildCreateInput({ parentId: null, projectId: null }, 'A', '')).toEqual({
      title: 'A',
      body: '',
      parentId: null,
      projectId: null,
    });
  });
});

describe('WikiPage: "Tạo trang mới" không gọi máy chủ cho tới lần lưu đầu', () => {
  const src = readFileSync(join(__dirname, 'WikiPage.tsx'), 'utf8');
  const fn = (name: string) => {
    const i = src.indexOf(`async function ${name}(`);
    expect(i, name).toBeGreaterThan(-1);
    const j = src.indexOf('\n  }\n', i);
    return src.slice(i, j);
  };
  it('addPage chỉ đặt pendingNew (không create.mutateAsync)', () => {
    const body = fn('addPage');
    expect(body).not.toMatch(/create\.mutate/);
    expect(body).toMatch(/setPendingNew\(/);
  });
  it('lưu lần đầu: một lần create.mutateAsync(buildCreateInput(...)) rồi bỏ nháp + chuyển sang trang thật', () => {
    const body = fn('saveNew');
    expect(body.match(/create\.mutateAsync/g)).toHaveLength(1);
    expect(body).toMatch(/buildCreateInput\(pendingNew/);
    expect(body).toMatch(/wikiDraft\.discard\(\)/);
    expect(body).toMatch(/runInternalNav\(\(\) => setSelectedId\(created\.id\)\)/);
  });
  it('chỉ có MỘT chỗ gọi create.mutateAsync trong cả trang; hủy/thoát soạn xoá pendingNew', () => {
    expect(src.match(/create\.mutateAsync/g)).toHaveLength(1);
    const stop = src.slice(
      src.indexOf('function stopEditing('),
      src.indexOf('function stopEditing(') + 200,
    );
    expect(stop).toMatch(/setPendingNew\(null\)/);
  });
  it('mọi đường lưu đi qua save() có singleFlight(savingRef): giữ Ctrl+Enter không tạo hai trang', () => {
    expect(src).toMatch(/const savingRef = useRef\(false\)/);
    expect(src).toMatch(
      /singleFlight\(savingRef, \(\) => \(pendingNew \? saveNew\(\) : saveExisting\(opts\)\)\)/,
    );
    // saveNew / saveExisting chỉ được gọi từ save(), không gọi trực tiếp ở nơi khác
    expect(src.match(/saveNew\(\)/g)).toHaveLength(2); // khai báo + một lần trong save()
    expect(src.match(/saveExisting\(/g)).toHaveLength(2);
  });
  it('useWikiDraft nhận trang giả theo newDraftKey khi đang soạn trang mới', () => {
    expect(src).toMatch(/newDraftKey\(pendingNew\)/);
  });
});
