import type { Block, DraftStatus } from './blocks';

/**
 * Hội thoại của Trợ lý — CHỈ trong phiên trình duyệt: state React + sessionStorage (bọc try/catch), theo từng người dùng.
 * Không gửi lên máy chủ. Reducer thuần để test (kể cả "thẻ nháp không tự đổi sang đã tạo").
 */
export interface Message {
  id: string;
  role: 'user' | 'bot';
  blocks: Block[];
}

export type ConversationAction =
  | { type: 'add'; message: Message }
  | {
      type: 'patch-draft';
      messageId: string;
      status: DraftStatus;
      createdKey?: string;
      error?: string;
    }
  | { type: 'clear' };

/** Giữ tối đa chừng này tin (cũ nhất bị bỏ) — panel không phình vô hạn trong phiên dài. */
export const MAX_MESSAGES = 60;

export function conversationReducer(state: Message[], a: ConversationAction): Message[] {
  switch (a.type) {
    case 'add':
      return [...state, a.message].slice(-MAX_MESSAGES);
    case 'patch-draft':
      return state.map((m) =>
        m.id !== a.messageId
          ? m
          : {
              ...m,
              blocks: m.blocks.map((b) =>
                b.type === 'draft'
                  ? {
                      ...b,
                      status: a.status,
                      createdKey: a.createdKey ?? b.createdKey,
                      error: a.error,
                    }
                  : b,
              ),
            },
      );
    case 'clear':
      return [];
  }
}

export const storageKey = (userId: string | undefined): string =>
  `tirapro:assistant:v1:${userId ?? 'anon'}`;

const BLOCK_TYPES = new Set(['text', 'links', 'issues', 'facts', 'tour', 'chips', 'draft']);

/**
 * Đọc hội thoại đã lưu; dữ liệu hỏng/bị sửa tay → bỏ phần hỏng, không ném lỗi. Thẻ nháp đang "creating" (tab đóng giữa
 * chừng) quay về "pending" để người dùng tự bấm lại — KHÔNG coi là đã tạo.
 */
export function parseStored(raw: string | null): Message[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: Message[] = [];
    for (const m of data as Partial<Message>[]) {
      if (!m || typeof m.id !== 'string' || (m.role !== 'user' && m.role !== 'bot')) continue;
      if (!Array.isArray(m.blocks)) continue;
      const blocks = m.blocks
        .filter((b): b is Block => !!b && typeof b === 'object' && BLOCK_TYPES.has(b.type))
        .map((b) =>
          b.type === 'draft' && b.status === 'creating' ? { ...b, status: 'pending' as const } : b,
        );
      out.push({ id: m.id, role: m.role, blocks });
    }
    return out.slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function loadConversation(userId: string | undefined): Message[] {
  try {
    return parseStored(sessionStorage.getItem(storageKey(userId)));
  } catch {
    return [];
  }
}

export function saveConversation(userId: string | undefined, messages: Message[]): void {
  try {
    if (messages.length === 0) sessionStorage.removeItem(storageKey(userId));
    else sessionStorage.setItem(storageKey(userId), JSON.stringify(messages));
  } catch {
    /* storage đầy / bị chặn → hội thoại chỉ còn trong state */
  }
}
