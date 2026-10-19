import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectDto } from '@tirapro/types';
import { useConfirm } from '@/components/ui/useConfirm';
import { useProjectMembers } from '@/features/members/api';
import { useUpdateProject } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SectionCard } from './SectionCard';

/**
 * Hàng "Quyền xem" của cấu hình dự án: công tắc "Dự án riêng tư". Bật = chỉ thành viên dự án + quản trị không gian
 * làm việc thấy dự án (người khác mở URL nhận "Không tìm thấy dự án"). Mọi lần đổi đều qua hộp xác nhận nêu hệ quả.
 */
export function PrivacySection({ project, canAdmin }: { project: ProjectDto; canAdmin: boolean }) {
  const update = useUpdateProject(project.key, project.id);
  const confirm = useConfirm();
  const { data: members } = useProjectMembers(
    canAdmin && !project.isPrivate ? project.id : undefined,
  );
  const archived = !!project.archivedAt;

  async function toggle() {
    const next = !project.isPrivate;
    // Người "đang tham gia mặc định" (không có vai trò riêng) sẽ mất quyền khi chuyển riêng tư.
    const losing = (members ?? []).filter((m) => !m.isOverride).length;
    const ok = await confirm(
      next
        ? {
            title: 'Chuyển dự án sang riêng tư?',
            description: `${
              !members
                ? 'Những người đang tham gia mặc định sẽ mất quyền vào dự án.'
                : losing === 0
                  ? 'Mọi người đang tham gia đều đã được thêm riêng nên không ai mất quyền.'
                  : `${losing} người đang tham gia mặc định sẽ mất quyền vào dự án.`
            } Từ giờ chỉ thành viên được thêm ở mục Thành viên (cùng quản trị không gian làm việc) thấy dự án. Các kênh Telegram gắn riêng cho dự án này sẽ tự TẮT (bật lại ở mục Kết nối nếu thật sự cần), và báo cáo định kỳ của dự án không còn gửi vào kênh chat trừ khi bạn cho phép lại.`,
            confirmLabel: 'Chuyển sang riêng tư',
            destructive: true,
          }
        : {
            title: 'Mở dự án cho mọi thành viên?',
            description:
              'Mọi thành viên không gian làm việc sẽ thấy và tham gia dự án theo vai trò mặc định của họ.',
            confirmLabel: 'Mở dự án',
          },
    );
    if (!ok) return;
    try {
      await update.mutateAsync({ isPrivate: next });
      toast.success(next ? 'Dự án đã chuyển sang riêng tư' : 'Dự án đã mở cho mọi thành viên');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <SectionCard
      icon={<Lock className="h-4 w-4" />}
      title="Quyền xem"
      description="Chọn ai nhìn thấy dự án này."
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="proj-private-label" className="text-sm font-medium text-ink">
            Dự án riêng tư
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Chỉ thành viên dự án và quản trị không gian làm việc thấy dự án này.
          </p>
          {!canAdmin && <p className="mt-1 text-xs text-faint">Chỉ quản trị dự án mới đổi được.</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={project.isPrivate}
          aria-labelledby="proj-private-label"
          disabled={!canAdmin || archived || update.isPending}
          onClick={() => void toggle()}
          title={archived ? 'Dự án đã lưu trữ — khôi phục trước khi đổi' : undefined}
          className={cn(
            // Giữ disabled:opacity (không dùng token vô hiệu) — công tắc: trạng thái bật/tắt phải còn đọc được khi vô hiệu.
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
            project.isPrivate ? 'bg-primary' : 'bg-surface-3',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
              project.isPrivate ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>
    </SectionCard>
  );
}
