import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from './blocks';
import {
  conversationReducer,
  isInternalPath,
  loadConversation,
  MAX_MESSAGES,
  parseStored,
  saveConversation,
  storageKey,
  type Message,
} from './conversation';
import { META, PROJ, SPRINTS, USERS } from './fixtures';
import { buildDraft } from './draft';

const draftBlock = (): Block => ({
  type: 'draft',
  draft: buildDraft({
    text: 'X',
    typeHint: null,
    project: PROJ,
    meta: META,
    users: USERS,
    sprints: SPRINTS,
  })!,
  status: 'pending',
});
const bot = (id: string, blocks: Block[]): Message => ({ id, role: 'bot', blocks });

describe('conversationReducer', () => {
  it('thêm tin, xoá hội thoại', () => {
    let s: Message[] = [];
    s = conversationReducer(s, {
      type: 'add',
      message: { id: '1', role: 'user', blocks: [{ type: 'text', text: 'hi' }] },
    });
    expect(s).toHaveLength(1);
    expect(conversationReducer(s, { type: 'clear' })).toEqual([]);
  });
  it('giữ tối đa MAX_MESSAGES tin gần nhất', () => {
    let s: Message[] = [];
    for (let i = 0; i < MAX_MESSAGES + 5; i++)
      s = conversationReducer(s, { type: 'add', message: bot(String(i), []) });
    expect(s).toHaveLength(MAX_MESSAGES);
    expect(s[0]!.id).toBe('5');
  });
  it('thêm thẻ nháp KHÔNG đổi trạng thái; chỉ patch-draft mới đổi (đây là bước sau khi bấm Tạo)', () => {
    let s = conversationReducer([], { type: 'add', message: bot('m1', [draftBlock()]) });
    expect(s[0]!.blocks[0]).toMatchObject({ type: 'draft', status: 'pending' });
    s = conversationReducer(s, {
      type: 'patch-draft',
      messageId: 'm1',
      status: 'created',
      createdKey: 'DEMO-TASK-9',
    });
    expect(s[0]!.blocks[0]).toMatchObject({ status: 'created', createdKey: 'DEMO-TASK-9' });
  });
  it('patch-draft chỉ đụng đúng tin, không đụng tin khác', () => {
    let s = conversationReducer([], { type: 'add', message: bot('a', [draftBlock()]) });
    s = conversationReducer(s, { type: 'add', message: bot('b', [draftBlock()]) });
    s = conversationReducer(s, { type: 'patch-draft', messageId: 'a', status: 'cancelled' });
    expect((s[0]!.blocks[0] as { status: string }).status).toBe('cancelled');
    expect((s[1]!.blocks[0] as { status: string }).status).toBe('pending');
  });
  it('lỗi tạo giữ thẻ để bấm lại và lưu thông báo', () => {
    let s = conversationReducer([], { type: 'add', message: bot('a', [draftBlock()]) });
    s = conversationReducer(s, {
      type: 'patch-draft',
      messageId: 'a',
      status: 'failed',
      error: 'Mất mạng',
    });
    expect(s[0]!.blocks[0]).toMatchObject({ status: 'failed', error: 'Mất mạng' });
  });
});

describe('lưu sessionStorage', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('lưu rồi đọc lại theo từng người dùng', () => {
    const m = [bot('1', [{ type: 'text', text: 'chào' }])];
    saveConversation('u1', m);
    expect(loadConversation('u1')).toEqual(m);
    expect(loadConversation('u2')).toEqual([]);
    expect(storageKey('u1')).not.toBe(storageKey('u2'));
  });
  it('rỗng thì xoá khoá', () => {
    saveConversation('u1', [bot('1', [])]);
    saveConversation('u1', []);
    expect(store.size).toBe(0);
  });
  it('storage ném lỗi (chế độ riêng tư/đầy) → không ném, trả rỗng', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => saveConversation('u1', [bot('1', [])])).not.toThrow();
    expect(loadConversation('u1')).toEqual([]);
  });
  it('dữ liệu hỏng / sai hình dạng → bỏ, không ném', () => {
    expect(parseStored('{not json')).toEqual([]);
    expect(parseStored('{"a":1}')).toEqual([]);
    expect(parseStored(null)).toEqual([]);
    const raw = JSON.stringify([
      { id: 1 },
      { id: 'x', role: 'hacker', blocks: [] },
      { id: 'ok', role: 'bot', blocks: [{ type: 'evil' }, { type: 'text', text: 'a' }] },
    ]);
    expect(parseStored(raw)).toEqual([
      { id: 'ok', role: 'bot', blocks: [{ type: 'text', text: 'a' }] },
    ]);
  });
  it('thẻ nháp đang "creating" khi tải lại quay về pending (không coi là đã tạo)', () => {
    const m = bot('a', [
      { ...(draftBlock() as Extract<Block, { type: 'draft' }>), status: 'creating' },
    ]);
    expect((parseStored(JSON.stringify([m]))[0]!.blocks[0] as { status: string }).status).toBe(
      'pending',
    );
  });
});

describe('liên kết trong hội thoại đã lưu', () => {
  it('chỉ nhận đường dẫn nội bộ', () => {
    for (const ok of ['/issue/A-1', '/filters?jql=a%20b', '/documentation#x'])
      expect(isInternalPath(ok)).toBe(true);
    for (const bad of ['//evil.com', 'https://x', 'javascript:alert(1)', '', '/a\\b', 5, null])
      expect(isInternalPath(bad)).toBe(false);
  });
  it('parseStored bỏ liên kết lạ và khối issues có seeAllTo lạ', () => {
    const raw = JSON.stringify([
      {
        id: 'a',
        role: 'bot',
        blocks: [
          {
            type: 'links',
            items: [
              { title: 't', summary: 's', to: 'https://x', linkLabel: 'l' },
              {
                title: 'u',
                summary: 's',
                to: '/documentation#a',
                linkLabel: 'l',
                extra: { label: 'e', to: '//x' },
              },
            ],
          },
          { type: 'issues', rows: [], more: false, seeAllTo: 'javascript:1' },
          { type: 'facts', title: 't', rows: [], to: { label: 'x', to: '//evil' } },
        ],
      },
    ]);
    const [m] = parseStored(raw);
    expect(m!.blocks).toHaveLength(2);
    const links = m!.blocks[0] as Extract<Block, { type: 'links' }>;
    expect(links.items).toHaveLength(1);
    expect(links.items[0]!.extra).toBeUndefined();
    expect((m!.blocks[1] as Extract<Block, { type: 'facts' }>).to).toBeUndefined();
  });
});
