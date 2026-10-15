import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/** Sao chép văn bản vào clipboard; `copied` bật 2 giây để đổi biểu tượng. Lỗi → toast hướng dẫn sao chép tay. */
export function useCopyToClipboard(successMessage?: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (successMessage) toast.success(successMessage);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Không sao chép được, hãy chọn và sao chép thủ công');
      }
    },
    [successMessage],
  );
  return { copied, copy };
}
