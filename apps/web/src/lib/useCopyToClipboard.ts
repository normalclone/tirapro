import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { COPIED_FLASH_MS, writeClipboard } from '@/lib/copyText';

export const COPY_FAILED_MESSAGE = 'Không sao chép được, hãy chọn và sao chép thủ công';

/**
 * Sao chép văn bản vào clipboard; `copied` bật {@link COPIED_FLASH_MS} để nút đổi sang dấu ✓.
 * Thành công → toast ngắn (`message` của lần gọi, hoặc `successMessage` mặc định; không có thì chỉ ✓).
 * Lỗi → toast hướng dẫn sao chép tay. Trả `true/false` cho chỗ cần biết kết quả.
 */
export function useCopyToClipboard(successMessage?: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string, message?: string) => {
      const ok = await writeClipboard(text);
      if (!ok) {
        toast.error(COPY_FAILED_MESSAGE);
        return false;
      }
      setCopied(true);
      const m = message ?? successMessage;
      if (m) toast.success(m);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
      return true;
    },
    [successMessage],
  );
  return { copied, copy };
}
