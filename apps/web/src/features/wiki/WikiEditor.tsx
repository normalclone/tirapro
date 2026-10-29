import type { ReactNode } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MarkdownEditor } from '@/features/issue-edit/MarkdownEditor';

/**
 * Khối soạn thảo trang wiki dùng chung cho trang CÓ SẴN (Sửa) và trang MỚI chưa lưu: ô tiêu đề, banner (khôi phục nháp,
 * xung đột…), trình soạn Markdown và hàng nút. `onHistory` bỏ trống (trang mới chưa có lịch sử) thì ẩn nút Lịch sử.
 */
export function WikiEditor({
  title,
  onTitle,
  body,
  onBody,
  banners,
  onSave,
  onCancel,
  onHistory,
  saving,
  saveDisabled,
  saveLabel,
}: {
  title: string;
  onTitle: (v: string) => void;
  body: string;
  onBody: (v: string) => void;
  banners?: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  onHistory?: () => void;
  saving: boolean;
  saveDisabled?: boolean;
  saveLabel: string;
}) {
  return (
    <div className="space-y-3">
      <Input
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="Tiêu đề trang"
        aria-label="Tiêu đề trang"
        autoFocus
        className="h-10 text-lg font-semibold"
      />
      {banners}
      <MarkdownEditor
        value={body}
        onChange={onBody}
        onSubmit={onSave}
        onCancel={onCancel}
        rows={18}
        placeholder="Viết nội dung ở đây. Markdown cơ bản: # tiêu đề, **đậm**, - gạch đầu dòng… Gõ mã công việc (vd DEMO-STORY-3) để liên kết."
      />
      <div className="flex items-center justify-end gap-2">
        <span
          className="mr-auto text-xs text-faint"
          title="Markdown là cách viết chữ đậm, tiêu đề, danh sách bằng ký hiệu — ví dụ **đậm** hoặc # Tiêu đề."
        >
          Markdown cơ bản · Gõ mã công việc (vd DEMO-STORY-3) để liên kết
          <span className="kbd-hint"> · Ctrl/⌘+Enter để lưu · Esc để huỷ</span>
        </span>
        {onHistory && (
          <Button
            size="sm"
            variant="ghost"
            title="Xem các phiên bản cũ của trang này"
            onClick={onHistory}
          >
            <History className="h-4 w-4" /> Lịch sử
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Huỷ
        </Button>
        <Button size="sm" loading={saving} disabled={saveDisabled} onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
