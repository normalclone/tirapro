import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useProjects } from '@/features/projects/api';
import { useCreateClient, useUpdateClient, type ClientDto } from './api';

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Modal tạo/sửa khách hàng: thông tin liên hệ + tập dự án được giao. */
export function ClientEditorModal({
  open,
  client,
  onClose,
}: {
  open: boolean;
  client?: ClientDto | null;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const create = useCreateClient();
  const update = useUpdateClient();
  const editing = !!client;

  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(client?.name ?? '');
    setContactName(client?.contactName ?? '');
    setEmail(client?.email ?? '');
    setPhone(client?.phone ?? '');
    setNote(client?.note ?? '');
    setProjectIds(client?.projects.map((p) => p.id) ?? []);
  }, [open, client]);

  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ id: p.id, name: `${p.key} · ${p.name}` })),
    [projects],
  );

  const emailInvalid = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  if (!open) return null;

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !emailInvalid && !busy;

  async function save() {
    if (!canSave) return;
    const payload = {
      name: name.trim(),
      contactName: contactName.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      note: note.trim() || null,
      projectIds,
    };
    try {
      if (editing && client) {
        await update.mutateAsync({ id: client.id, ...payload });
        toast.success('Đã lưu khách hàng');
      } else {
        await create.mutateAsync(payload);
        toast.success('Đã tạo khách hàng');
      }
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
      title={editing ? 'Sửa khách hàng' : 'Thêm khách hàng'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu thay đổi' : 'Thêm khách hàng'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên khách hàng" htmlFor="client-name">
          <Input id="client-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Công ty CP ABC" autoFocus maxLength={160} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Người liên hệ" hint="(tùy chọn — đầu mối bên khách hàng)" htmlFor="client-contact">
            <Input id="client-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="VD: Trần Thu Hà" maxLength={120} />
          </Field>
          <Field label="Điện thoại" hint="(tùy chọn)" htmlFor="client-phone">
            <Input id="client-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" maxLength={40} />
          </Field>
        </div>

        <Field label="Email" hint="(tùy chọn)" htmlFor="client-email">
          <Input
            id="client-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="lienhe@congty.vn"
            maxLength={160}
            aria-invalid={emailInvalid}
          />
          {emailInvalid && (
            <p className="mt-1 text-xs text-danger" role="alert">
              Email chưa đúng dạng — cần có @ và tên miền, ví dụ lienhe@congty.vn.
            </p>
          )}
        </Field>

        <Field label="Ghi chú" hint="(tùy chọn)" htmlFor="client-note">
          <Input id="client-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lưu ý khi làm việc, thói quen phản hồi…" maxLength={1000} />
        </Field>

        <Field label="Dự án của khách hàng" hint="(bỏ chọn một dự án = gỡ liên kết với khách hàng này)">
          <RoleMultiSelect
            options={projectOptions}
            value={projectIds}
            onChange={setProjectIds}
            requireOne={false}
            placeholder="Chọn dự án…"
            ariaLabel="Chọn dự án của khách hàng"
          />
        </Field>
      </div>
    </Dialog>
  );
}
