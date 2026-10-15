import { useState } from 'react';
import { Archive, ArchiveRestore, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { useArchiveProject, useUpdateProject } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          {icon}
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * Mục "Chung" của cấu hình dự án: sửa tên / mô tả / người phụ trách / cách giao việc mặc định,
 * và lưu trữ (hoặc khôi phục) dự án. Chỉ quản trị dự án mới sửa được; người khác chỉ xem.
 */
export function GeneralSection({ project, canAdmin }: { project: ProjectDto; canAdmin: boolean }) {
  const update = useUpdateProject(project.key, project.id);
  const archive = useArchiveProject(project.key, project.id);
  const people = useAssigneeOptions(project.id);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [leadId, setLeadId] = useState(project.leadId ?? '');
  const [assignMode, setAssignMode] = useState(project.defaultAssigneeMode);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archived = !!project.archivedAt;

  const dirty =
    name.trim() !== project.name ||
    description.trim() !== (project.description ?? '') ||
    leadId !== (project.leadId ?? '') ||
    assignMode !== project.defaultAssigneeMode;
  const canSave = canAdmin && dirty && !!name.trim() && !update.isPending;

  async function save() {
    try {
      await update.mutateAsync({
        ...(name.trim() !== project.name ? { name: name.trim() } : {}),
        ...(description.trim() !== (project.description ?? '')
          ? { description: description.trim() || null }
          : {}),
        ...(leadId !== (project.leadId ?? '') ? { leadId: leadId || null } : {}),
        ...(assignMode !== project.defaultAssigneeMode ? { defaultAssigneeMode: assignMode } : {}),
      });
      toast.success('Đã lưu thông tin dự án');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

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
      <Card
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="Thông tin dự án"
        description={
          canAdmin
            ? 'Tên, mô tả và người phụ trách hiển thị cho cả nhóm.'
            : 'Chỉ quản trị dự án mới sửa được thông tin này.'
        }
      >
        <form
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
                'w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint disabled:opacity-50',
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
                options={people}
                emptyLabel="Chưa có"
                disabled={!canAdmin}
                ariaLabel="Người phụ trách dự án"
              />
            </div>
            <div>
              <label htmlFor="proj-assign" className={field}>
                Việc mới mặc định giao cho
              </label>
              <select
                id="proj-assign"
                value={assignMode}
                disabled={!canAdmin}
                onChange={(e) => setAssignMode(e.target.value as ProjectDto['defaultAssigneeMode'])}
                className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="UNASSIGNED">Không ai (giao sau)</option>
                <option value="PROJECT_LEAD">Người phụ trách dự án</option>
              </select>
            </div>
          </div>
          {canAdmin && (
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={update.isPending} disabled={!canSave}>
                Lưu thay đổi
              </Button>
            </div>
          )}
        </form>
      </Card>

      {canAdmin && (
        <Card
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
        </Card>
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
