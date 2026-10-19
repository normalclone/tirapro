import { issueUrl } from '@/lib/copyText';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

/**
 * Sao chép mã (`TIRA-12`) và liên kết chuẩn (`issueUrl`) của một công việc — dùng chung cho trang chi tiết,
 * panel xem nhanh và mọi nơi có nút sao chép. `keyCopied`/`linkCopied` bật 1,2 giây để nút đổi sang ✓.
 */
export function useIssueCopy(key: string) {
  const k = useCopyToClipboard();
  const l = useCopyToClipboard();
  return {
    keyCopied: k.copied,
    linkCopied: l.copied,
    copyKey: () => void k.copy(key, `Đã sao chép mã ${key}`),
    copyLink: () => void l.copy(issueUrl(key), 'Đã sao chép liên kết'),
  };
}
