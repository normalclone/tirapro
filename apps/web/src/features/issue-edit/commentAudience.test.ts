import { describe, expect, it } from 'vitest';
import { mentionToken } from '@tirapro/shared';
import { audienceSummary, commentAudience, type AudiencePerson } from './commentAudience';

const P = (id: string, name: string, avatarUrl: string | null = null): AudiencePerson => ({
  id,
  name,
  avatarUrl,
});
const people = [P('me', 'Tôi'), P('an', 'An'), P('binh', 'Bình'), P('chi', 'Chi', '/a/chi.png')];
const base = { draft: '', people, assignee: null, watchers: undefined, meId: 'me' };
const ids = (r: ReturnType<typeof commentAudience>) => r.map((e) => `${e.id}:${e.reason}`);

describe('commentAudience — người được nhắc', () => {
  it('lấy id từ token ∩ people, tên tra từ people (không tin tên trong token)', () => {
    const draft = `chào ${mentionToken('an', 'Quản trị giả mạo')} nhé`;
    const r = commentAudience({ ...base, draft });
    expect(r).toEqual([{ id: 'an', name: 'An', avatarUrl: null, reason: 'mentioned' }]);
  });
  it('bỏ chính mình', () => {
    expect(ids(commentAudience({ ...base, draft: mentionToken('me', 'Tôi') }))).toEqual([]);
  });
  it('RIÊNG TƯ: token tự gõ trỏ tới người ngoài people không hiện (không lộ người không xem được dự án)', () => {
    const draft = '@[Người lạ](user:stranger) và @[Bình](user:binh)';
    expect(ids(commentAudience({ ...base, draft }))).toEqual(['binh:mentioned']);
  });
  it('trùng token chỉ tính một lần; giữ thứ tự gõ', () => {
    const draft = `${mentionToken('chi', 'x')} ${mentionToken('an', 'y')} ${mentionToken('chi', 'x')}`;
    expect(ids(commentAudience({ ...base, draft }))).toEqual(['chi:mentioned', 'an:mentioned']);
  });
  it('avatar lấy từ people', () => {
    expect(commentAudience({ ...base, draft: mentionToken('chi', 'Chi') })[0]?.avatarUrl).toBe(
      '/a/chi.png',
    );
  });
  it('people chưa tải (rỗng) → không ai được nhắc', () => {
    expect(commentAudience({ ...base, people: [], draft: mentionToken('an', 'An') })).toEqual([]);
  });
});

describe('commentAudience — người được giao (phản chiếu máy chủ)', () => {
  const assignee = { id: 'binh', displayName: 'Bình', avatarUrl: null };
  it('có người được giao khác mình → được báo', () => {
    expect(ids(commentAudience({ ...base, assignee }))).toEqual(['binh:assignee']);
  });
  it('người được giao đã bị vô hiệu hoá (DEACTIVATED) → không (không báo được)', () => {
    expect(
      ids(commentAudience({ ...base, assignee: { ...assignee, status: 'DEACTIVATED' } })),
    ).toEqual([]);
  });
  it('người được giao đang hoạt động / không rõ trạng thái → vẫn được báo', () => {
    expect(ids(commentAudience({ ...base, assignee: { ...assignee, status: 'ACTIVE' } }))).toEqual([
      'binh:assignee',
    ]);
  });
  it('người được giao là chính mình (tác giả) → không', () => {
    expect(ids(commentAudience({ ...base, assignee: { ...assignee, id: 'me' } }))).toEqual([]);
  });
  it('đã được nhắc → không báo thêm lần "được giao" (máy chủ bỏ qua)', () => {
    const draft = mentionToken('binh', 'Bình');
    expect(ids(commentAudience({ ...base, assignee, draft }))).toEqual(['binh:mentioned']);
  });
  it('không có người được giao → không', () => {
    expect(ids(commentAudience({ ...base, assignee: null }))).toEqual([]);
  });
  it('tên người được giao ưu tiên tra từ people, thiếu thì dùng tên trong issue', () => {
    const r = commentAudience({
      ...base,
      assignee: { id: 'zed', displayName: 'Zed', avatarUrl: '/z.png' },
    });
    expect(r).toEqual([{ id: 'zed', name: 'Zed', avatarUrl: '/z.png', reason: 'assignee' }]);
  });
});

describe('commentAudience — người theo dõi', () => {
  const w = (id: string, displayName: string) => ({ id, displayName, avatarUrl: null });
  it('thêm watcher, trừ mình và người đã có trong danh sách', () => {
    const r = commentAudience({
      ...base,
      draft: mentionToken('an', 'An'),
      assignee: { id: 'binh', displayName: 'Bình', avatarUrl: null },
      watchers: [w('me', 'Tôi'), w('an', 'An'), w('binh', 'Bình'), w('dung', 'Dũng')],
    });
    expect(ids(r)).toEqual(['an:mentioned', 'binh:assignee', 'dung:watcher']);
  });
  it('watchers chưa tải (undefined) → bỏ qua', () => {
    expect(ids(commentAudience({ ...base, watchers: undefined }))).toEqual([]);
  });
  it('watcher không bị lọc bởi people (máy chủ đã lọc theo quyền xem + trạng thái trước khi trả về)', () => {
    expect(ids(commentAudience({ ...base, watchers: [w('dung', 'Dũng')] }))).toEqual([
      'dung:watcher',
    ]);
  });
  it('watcher trùng nhau chỉ một lần', () => {
    expect(ids(commentAudience({ ...base, watchers: [w('d', 'D'), w('d', 'D')] }))).toEqual([
      'd:watcher',
    ]);
  });
});

describe('audienceSummary — câu cho trình đọc màn hình và title', () => {
  it('nêu tên + lý do, gộp watcher thành số', () => {
    const s = audienceSummary([
      { id: 'an', name: 'An', avatarUrl: null, reason: 'mentioned' },
      { id: 'binh', name: 'Bình', avatarUrl: null, reason: 'assignee' },
      { id: 'w1', name: 'W1', avatarUrl: null, reason: 'watcher' },
      { id: 'w2', name: 'W2', avatarUrl: null, reason: 'watcher' },
      { id: 'w3', name: 'W3', avatarUrl: null, reason: 'watcher' },
    ]);
    expect(s).toBe('Sẽ thông báo cho An (được nhắc), Bình (người được giao) và 3 người theo dõi');
  });
  it('một người', () => {
    expect(audienceSummary([{ id: 'an', name: 'An', avatarUrl: null, reason: 'mentioned' }])).toBe(
      'Sẽ thông báo cho An (được nhắc)',
    );
  });
  it('chỉ watcher', () => {
    expect(audienceSummary([{ id: 'w', name: 'W', avatarUrl: null, reason: 'watcher' }])).toBe(
      'Sẽ thông báo cho 1 người theo dõi',
    );
  });
  it('rỗng → chuỗi rỗng', () => {
    expect(audienceSummary([])).toBe('');
  });
});
