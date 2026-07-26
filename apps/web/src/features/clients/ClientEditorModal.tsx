import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
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
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Sửa khách hàng' : 'Thêm khách hàng'}
        className="relative flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-medium text-ink">{editing ? 'Sửa khách hàng' : 'Thêm khách hàng'}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <Field label="Tên khách hàng" htmlFor="client-name">
            <Input id="client-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Công ty CP ABC" autoFocus maxLength={160} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Người liên hệ" hint="(tùy chọn)" htmlFor="client-contact">
              <Input id="client-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Họ tên đầu mối" maxLength={120} />
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
            {emailInvalid && <p className="mt-1 text-xs text-danger" role="alert">Email không hợp lệ.</p>}
          </Field>

          <Field label="Ghi chú" hint="(tùy chọn)" htmlFor="client-note">
            <Input id="client-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Điều khoản, lưu ý khi làm việc…" maxLength={1000} />
          </Field>

          <Field label="Dự án của khách hàng" hint="(gỡ khỏi danh sách = bỏ liên kết)">
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

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>{editing ? 'Lưu' : 'Thêm khách hàng'}</Button>
        </footer>
      </div>
    </div>
  );
}
