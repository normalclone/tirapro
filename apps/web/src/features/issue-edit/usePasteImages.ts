import { useRef, type ClipboardEvent, type RefObject } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import {
  attachmentMarkdown,
  imageFilesFromClipboard,
  insertPlaceholder,
  isTooLarge,
  MAX_PASTE_BYTES,
  pastedImageName,
  replacePlaceholder,
} from './pasteImage';

export interface PastedImageRef {
  name: string;
  /** `attachment:ID` của tệp vừa tải lên. */
  ref: string;
}

/**
 * Xử lý ảnh dán vào ô soạn (mỗi lần gọi MỘT tệp). Trả Promise → tải lên và chèn `![tên](ref)` tại con trỏ
 * (có chữ giữ chỗ trong lúc tải); trả `void` → chế độ gom tệp (form tạo việc/báo lỗi: chưa có mã công việc để tải lên).
 */
export type PasteImagesHandler = (files: File[]) => Promise<PastedImageRef[] | void> | void;

const isThenable = (v: unknown): v is PromiseLike<PastedImageRef[] | void> =>
  !!v && typeof (v as { then?: unknown }).then === 'function';

/**
 * `onPaste` cho textarea của MarkdownEditor (undefined khi không bật). Chỉ can thiệp khi clipboard CÓ ảnh —
 * dán chữ vẫn mặc định; clipboard vừa chữ vừa ảnh (Word/Docs) thì lấy ảnh, bỏ chữ.
 */
export function usePasteImages(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
  onChange: (v: string) => void,
  onPasteImages: PasteImagesHandler | undefined,
) {
  // Các lần thay chữ giữ chỗ chạy bất đồng bộ nên phải đọc giá trị MỚI NHẤT, không phải giá trị lúc dán.
  const latest = useRef(value);
  latest.current = value;
  const seq = useRef(0);
  if (!onPasteImages) return undefined;

  const apply = (v: string) => {
    latest.current = v;
    onChange(v);
  };

  return (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = imageFilesFromClipboard(Array.from(e.clipboardData.files));
    if (images.length === 0) return;
    e.preventDefault();

    const now = new Date();
    const ta = ref.current;
    let caret = ta?.selectionStart ?? latest.current.length;
    let placed = 0;
    images.forEach((original, i) => {
      if (isTooLarge(original)) {
        toast.error(
          `Ảnh dán vượt ${MAX_PASTE_BYTES / 1024 / 1024} MB nên không đính kèm được — hãy thu nhỏ ảnh rồi dán lại`,
        );
        return;
      }
      const file = new File([original], pastedImageName(original, now, i), {
        type: original.type,
      });
      const result = onPasteImages([file]);
      if (!isThenable(result)) return; // chế độ gom tệp: nơi gọi tự giữ file, không cần chữ giữ chỗ

      const id = ++seq.current;
      let v = latest.current;
      if (placed > 0) {
        v = `${v.slice(0, caret)}\n${v.slice(caret)}`;
        caret += 1;
      }
      const ins = insertPlaceholder(v, caret, id);
      caret = ins.caret;
      placed += 1;
      apply(ins.value);

      const finish = (r?: PastedImageRef) =>
        apply(replacePlaceholder(latest.current, id, r ? attachmentMarkdown(r.name, r.ref) : ''));
      result.then(
        (res) => finish(res?.[0]),
        (err: unknown) => {
          finish();
          toast.error(apiErrorMessage(err));
        },
      );
    });
    if (placed > 0 && ta)
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      });
  };
}
