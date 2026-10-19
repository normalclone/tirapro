import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useAssigneePicker } from '@/features/issue-edit/useAssigneeOptions';
import { useArchiveProject, useUpdateProject } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { PrivacySection } from './PrivacySection';
import { settleField } from '@/lib/settleField';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { SectionCard } from '@/components/ui/SectionCard';

/**
 * Mục "Chung" của cấu hình dự án: sửa tên / mô tả / người phụ trách / cách giao việc mặc định,
 * và lưu trữ (hoặc khôi phục) dự án. Chỉ quản trị dự án mới sửa được; người khác chỉ xem.
 */
export function GeneralSection({ project, canAdmin }: { project: ProjectDto; canAdmin: boolean }) {
  const update = useUpdateProject(project.key, project.id);
  const archive = useArchiveProject(project.key, project.id);
  const people = useAssigneePicker(project.id);

  // Mốc so sánh để biết "đã sửa": giá trị đã lưu gần nhất. Lưu xong cập nhật NGAY tại đây (không chờ refetch `project`)
  // → dirty về false trước khi người dùng kịp điều hướng, không bị hỏi "bỏ thay đổi" oan.
  const [saved, setSaved] = useState({
    name: project.name,
    description: project.description ?? '',
    leadId: project.leadId ?? '',
    assignMode: project.defaultAssigneeMode,
  });
  const [name, setName] = useState(saved.name);
  const [description, setDescription] = useState(saved.description);
  const [leadId, setLeadId] = useState(saved.leadId);
  const [assignMode, setAssignMode] = useState(saved.assignMode);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const archived = !!project.archivedAt;

  const dirty =
    name.trim() !== saved.name ||
    description.trim() !== saved.description ||
    leadId !== saved.leadId ||
    assignMode !== saved.assignMode;
  const canSave = canAdmin && dirty && !!name.trim() && !update.isPending;

  function reset() {
    setName(saved.name);
    setDescription(saved.description);
    setLeadId(saved.leadId);
    setAssignMode(saved.assignMode);
  }

  async function save() {
    const next = {
      name: name.trim(),
      description: description.trim(),
      leadId,
      assignMode,
    };
    try {
      await update.mutateAsync({
        ...(next.name !== saved.name ? { name: next.name } : {}),
        ...(next.description !== saved.description
          ? { description: next.description || null }
          : {}),
        ...(next.leadId !== saved.leadId ? { leadId: next.leadId || null } : {}),
        ...(next.assignMode !== saved.assignMode ? { defaultAssigneeMode: next.assignMode } : {}),
      });
      setSaved(next);
      // Lưu có thể mất vài giây: người dùng có thể đã gõ tiếp → chỉ đặt lại ô chưa bị đổi (so với chuỗi đã gửi).
      setName((cur) => settleField(cur, next.name));
      setDescription((cur) => settleField(cur, next.description));
      toast.success('Đã lưu thông tin dự án');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  // Thanh "thay đổi chưa lưu" thay nút Lưu cuối thẻ; Lưu qua requestSubmit để chạy đúng trình xử lý submit bên dưới.
  useUnsavedChanges({
    dirty: canAdmin && dirty,
    saving: update.isPending,
    canSave,
    onSave: () => formRef.current?.requestSubmit(),
    onReset: reset,
    description: 'Tên, mô tả và người phụ trách bạn vừa sửa chưa được lưu.',
  });

  async function toggleArchive(next: boolean) {
    try {
      await archive.mutateAsync(next);
      setConfirmArchive(false);
      toast.success(
        next ? `Đã lưu trữ dự án “${project.name}”` : `Đã khôi phục dự án “${project.name}”`,
      );
    } catch (e) {
      setConfirmArchive(false);
      toast.error(apiErrorMessage(e));
    }
  }

  const field = 'mb-1.5 block text-sm font-medium text-muted';
  return (
    <>
      <SectionCard
        headingLevel={3}
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="Thông tin dự án"
        description={
          canAdmin
            ? 'Tên, mô tả và người phụ trách hiển thị cho cả nhóm.'
            : 'Chỉ quản trị dự án mới sửa được thông tin này.'
        }
      >
        <form
          ref={formRef}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div>
              <label htmlFor="proj-name" className={field}>
                Tên dự án
              </label>
              <Input
                id="proj-name"
                value={name}
                maxLength={120}
                disabled={!canAdmin}
                onChange={(e) => setName(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <label htmlFor="proj-key" className={field}>
                Mã dự án
              </label>
              <Input
                id="proj-key"
                value={project.key}
                readOnly
                disabled
                className="font-mono text-sm"
                title="Mã dự án đã nằm trong mã mọi công việc nên không đổi được"
              />
            </div>
          </div>
          <div>
            <label htmlFor="proj-desc" className={field}>
              Mô tả
            </label>
            <textarea
              id="proj-desc"
              value={description}
              maxLength={2000}
              rows={3}
              disabled={!canAdmin}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dự án này làm gì, cho ai?"
              className={cn(
                'w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg',
                'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className={field}>Người phụ trách dự án</span>
              <PeoplePicker
                value={leadId}
                onChange={setLeadId}
                {...people}
                selectedFallback={project.lead ?? undefined}
                emptyLabel="Chưa có"
                disabled={!canAdmin}
                ariaLabel="Người phụ trách dự án"
              />
            </div>
            <div>
              <span className={field}>Việc mới mặc định giao cho</span>
              <SearchSelect
                ariaLabel="Việc mới mặc định giao cho"
                value={assignMode}
                disabled={!canAdmin}
                onChange={(v) => setAssignMode(v as ProjectDto['defaultAssigneeMode'])}
                options={[
                  { value: 'UNASSIGNED', label: 'Không ai (giao sau)' },
                  { value: 'PROJECT_LEAD', label: 'Người phụ trách dự án' },
                ]}
              />
            </div>
          </div>
          {/* Enter trong ô nhập vẫn lưu: nút gửi mặc định ẩn (nút Lưu thật nằm ở thanh "thay đổi chưa lưu"). */}
          {canAdmin && <button type="submit" className="sr-only" tabIndex={-1} aria-hidden />}
        </form>
      </SectionCard>

      <PrivacySection project={project} canAdmin={canAdmin} />

      {canAdmin && (
        <SectionCard
          headingLevel={3}
          icon={archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          title={archived ? 'Dự án đã lưu trữ' : 'Lưu trữ dự án'}
          description={
            archived
              ? 'Dự án đang chỉ đọc và bị ẩn khỏi danh sách. Khôi phục để làm việc tiếp.'
              : 'Dự án đã xong hoặc tạm dừng? Lưu trữ để ẩn khỏi danh sách và khoá chỉnh sửa. Dữ liệu được giữ nguyên, có thể khôi phục bất cứ lúc nào.'
          }
        >
          {archived ? (
            <Button
              variant="secondary"
              size="sm"
              loading={archive.isPending}
              onClick={() => void toggleArchive(false)}
            >
              <ArchiveRestore className="h-4 w-4" /> Khôi phục dự án
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmArchive(true)}>
              <Archive className="h-4 w-4" /> Lưu trữ dự án
            </Button>
          )}
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmArchive}
        title={`Lưu trữ dự án “${project.name}”?`}
        description="Dự án sẽ chuyển sang chỉ đọc: không ai tạo hay sửa được việc, sprint và bảng, và dự án bị ẩn khỏi danh sách (bật “Hiện đã lưu trữ” để xem lại). Bạn có thể khôi phục bất cứ lúc nào."
        confirmLabel="Lưu trữ"
        loading={archive.isPending}
        onConfirm={() => void toggleArchive(true)}
        onCancel={() => setConfirmArchive(false)}
      />
    </>
  );
}
