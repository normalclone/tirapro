import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useProjects } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { Field, IssueDefaultsFields } from './IssueDefaultsFields';
import { useCreateTemplate, useUpdateTemplate, type IssuePayload, type IssueTemplate } from './api';

const SHARED = '__shared__';

/** Tạo / sửa mẫu công việc. `template = null` là tạo mới. */
export function TemplateModal({
  open,
  template,
  onClose,
}: {
  open: boolean;
  template: IssueTemplate | null;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(SHARED);
  const [payload, setPayload] = useState<IssuePayload>({});

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setDescription(template?.description ?? '');
    setProjectId(template?.projectId ?? SHARED);
    setPayload(template?.payload ?? {});
  }, [open, template]);

  // Loại công việc / mức ưu tiên là cấu hình cấp không gian làm việc — cần một mã dự án bất kỳ để nạp.
  const metaKey = useMemo(() => {
    const list = projects ?? [];
    const chosen = projectId !== SHARED ? list.find((p) => p.id === projectId) : undefined;
    return (chosen ?? list[0])?.key;
  }, [projects, projectId]);

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !busy;

  async function submit() {
    if (!canSave) return;
    const input = {
      name: name.trim(),
      description: description.trim() || null,
      projectId: projectId === SHARED ? null : projectId,
      payload,
    };
    try {
      if (template) await update.mutateAsync({ id: template.id, ...input });
      else await create.mutateAsync(input);
      toast.success(template ? 'Đã cập nhật mẫu công việc' : 'Đã tạo mẫu công việc');
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={template ? 'Sửa mẫu công việc' : 'Mẫu công việc mới'}
      size="md"
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!canSave}>
            {template ? 'Lưu thay đổi' : 'Tạo mẫu'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên mẫu" htmlFor="tpl-name">
          <Input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Báo lỗi sản xuất"
            autoFocus
            maxLength={120}
          />
        </Field>

        <Field
          label="Mô tả ngắn"
          htmlFor="tpl-desc"
          hint="Hiện trong danh sách để mọi người biết khi nào nên dùng mẫu này."
        >
          <Input
            id="tpl-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ví dụ: dùng khi khách báo lỗi trên bản chạy thật"
            maxLength={500}
          />
        </Field>

        <Field
          label="Phạm vi"
          htmlFor="tpl-project"
          hint="Chọn “Dùng chung” thì mọi dự án trong không gian làm việc đều thấy mẫu này."
        >
          <SearchSelect
            id="tpl-project"
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: SHARED, label: 'Dùng chung cho mọi dự án' },
              ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
            ]}
            searchPlaceholder="Tìm dự án…"
            ariaLabel="Phạm vi mẫu"
          />
        </Field>

        <IssueDefaultsFields
          projectKey={metaKey}
          value={payload}
          onChange={setPayload}
          summaryPlaceholder="Ví dụ: [Lỗi] "
          summaryHint="Để trống nếu muốn người tạo việc tự nhập tiêu đề."
        />
      </div>
    </Dialog>
  );
}
