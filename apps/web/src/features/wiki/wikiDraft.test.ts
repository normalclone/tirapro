import { describe, expect, it } from 'vitest';
import {
  clearWikiDraft,
  draftOffer,
  isWikiDirty,
  loadWikiDraft,
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
