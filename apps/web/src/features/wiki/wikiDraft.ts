/** Bản nháp wiki tự lưu vào localStorage theo trang — hàm thuần/IO bọc try/catch (test được không cần DOM). */

export interface WikiDraft {
  title: string;
  body: string;
  /** Phiên bản trang lúc bắt đầu sửa. */
  baseVersion: number | null;
  savedAt: number;
}

export const wikiDraftKey = (pageId: string) => `tirapro:wiki:draft:${pageId}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Có thay đổi so với trang đang lưu không (đang sửa). */
export function isWikiDirty(
  draft: { title: string; body: string },
  page: { title: string; body: string } | undefined,
): boolean {
  return !!page && (draft.title !== page.title || draft.body !== page.body);
}

export function loadWikiDraft(
  pageId: string,
  store: Store | null = defaultStore(),
): WikiDraft | null {
  try {
    const raw = store?.getItem(wikiDraftKey(pageId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<WikiDraft>;
    if (typeof d.title !== 'string' || typeof d.body !== 'string') return null;
    return {
      title: d.title,
      body: d.body,
      baseVersion: typeof d.baseVersion === 'number' ? d.baseVersion : null,
      savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveWikiDraft(
  pageId: string,
  draft: Omit<WikiDraft, 'savedAt'>,
  now = Date.now(),
  store: Store | null = defaultStore(),
): void {
  try {
    store?.setItem(wikiDraftKey(pageId), JSON.stringify({ ...draft, savedAt: now }));
  } catch {
    /* đầy bộ nhớ / chế độ riêng tư: bỏ qua, không làm hỏng việc soạn */
  }
}

export function clearWikiDraft(pageId: string, store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(wikiDraftKey(pageId));
  } catch {
    /* bỏ qua */
  }
}

/** Đề nghị khôi phục khi nháp đã lưu KHÁC nội dung trang hiện tại. */
export function draftOffer(
  stored: WikiDraft | null,
  page: { title: string; body: string },
): WikiDraft | null {
  return stored && isWikiDirty(stored, page) ? stored : null;
}
