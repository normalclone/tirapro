import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/useConfirm';
import { useLeaveGuard } from '@/lib/useLeaveGuard';
import {
  clearWikiDraft,
  draftOffer,
  isWikiDirty,
  loadWikiDraft,
  saveWikiDraft,
  type WikiDraft,
} from './wikiDraft';

const AUTOSAVE_MS = 500;

/**
 * Không mất bản nháp khi soạn wiki: biết đang có thay đổi chưa lưu (`dirty`), hỏi trước khi bỏ (chuyển trang/Esc/Huỷ/rời
 * trang), tự lưu nháp vào localStorage theo trang và đề nghị khôi phục khi mở lại chế độ sửa.
 */
export function useWikiDraft(opts: {
  editing: boolean;
  /** Trang đang sửa (nội dung đang lưu trên máy chủ). */
  page: { id: string; title: string; body: string } | undefined;
  draftTitle: string;
  draftBody: string;
  baseVersion: number | null;
}) {
  const { editing, page, draftTitle, draftBody, baseVersion } = opts;
  const confirm = useConfirm();
  const [offer, setOffer] = useState<WikiDraft | null>(null);
  const dirty = editing && isWikiDirty({ title: draftTitle, body: draftBody }, page);
  const pageId = page?.id;

  // Điều hướng nội bộ do chính màn Wiki thực hiện (sau khi đã hỏi) không bị chặn lần nữa.
  const internalNav = useRef(false);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const discard = useCallback(() => {
    if (pageIdRef.current) clearWikiDraft(pageIdRef.current);
    setOffer(null);
  }, []);

  useLeaveGuard({
    dirty,
    // Đổi đường dẫn hoặc đổi `?page=` từ ngoài (link wiki trong việc, sidebar…) → hỏi; `open()` nội bộ đã hỏi rồi.
    shouldBlock: ({ currentLocation: a, nextLocation: b }) =>
      !internalNav.current &&
      (a.pathname !== b.pathname ||
        new URLSearchParams(a.search).get('page') !== new URLSearchParams(b.search).get('page')),
    description:
      'Trang wiki có thay đổi chưa lưu. Rời đi bây giờ sẽ mất chúng (bản nháp tự lưu cũng bị xoá).',
    onDiscard: discard,
  });

  // Tự lưu nháp (chỉ khi có thay đổi, và không ghi đè nháp cũ đang được đề nghị khôi phục).
  useEffect(() => {
    if (!dirty || !pageId || offer) return;
    const t = setTimeout(
      () => saveWikiDraft(pageId, { title: draftTitle, body: draftBody, baseVersion }),
      AUTOSAVE_MS,
    );
    return () => clearTimeout(t);
  }, [dirty, pageId, offer, draftTitle, draftBody, baseVersion]);

  /** Gọi khi bắt đầu sửa: có nháp khác nội dung trang → đề nghị khôi phục. */
  const checkOffer = useCallback((pg: { id: string; title: string; body: string }) => {
    setOffer(draftOffer(loadWikiDraft(pg.id), pg));
  }, []);

  /** Có thay đổi chưa lưu thì hỏi "Bỏ thay đổi chưa lưu?"; đồng ý (hoặc không có gì để mất) → true. */
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    const ok = await confirm({
      title: 'Bỏ thay đổi chưa lưu?',
      description: 'Nội dung bạn đang soạn trên trang này sẽ mất.',
      confirmLabel: 'Bỏ thay đổi',
      destructive: true,
    });
    if (ok) discard();
    return ok;
  }, [dirty, confirm, discard]);

  /** Chạy một điều hướng nội bộ mà không bị chặn lại. */
  const runInternalNav = useCallback((fn: () => void) => {
    internalNav.current = true;
    try {
      fn();
    } finally {
      internalNav.current = false;
    }
  }, []);

  return { dirty, offer, setOffer, checkOffer, discard, confirmDiscard, runInternalNav };
}
