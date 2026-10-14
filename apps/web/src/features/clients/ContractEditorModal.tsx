import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useProjects } from '@/features/projects/api';
import { useCreateContract, useUpdateContract, formatMoney, type ContractDto } from './api';

const CURRENCIES = [
  { value: 'VND', label: 'VND — Đồng' },
  { value: 'USD', label: 'USD — Đô la Mỹ' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'JPY', label: 'JPY — Yên Nhật' },
];

/** ISO → 'YYYY-MM-DD' cho input type=date. */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** '1.500.000' / '1500000' → 1500000. Chuỗi rỗng → null. */
function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

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

/** Modal tạo/sửa hợp đồng của một khách hàng. */
export function ContractEditorModal({
  open,
  clientId,
  clientName,
  contract,
  onClose,
}: {
  open: boolean;
  clientId: string | null;
  clientName?: string;
  contract?: ContractDto | null;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const create = useCreateContract();
  const update = useUpdateContract();
  const editing = !!contract;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('VND');
  const [projectId, setProjectId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(contract?.name ?? '');
    setCode(contract?.code ?? '');
    setValue(contract?.value != null ? String(contract.value) : '');
    setCurrency(contract?.currency ?? 'VND');
    setProjectId(contract?.project?.id ?? '');
    setStartDate(toDateInput(contract?.startDate));
    setEndDate(toDateInput(contract?.endDate));
    setNote(contract?.note ?? '');
  }, [open, contract]);

  const projectOptions = useMemo(
    () => [
      { value: '', label: 'Không gắn dự án' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [projects],
  );

  const parsedValue = parseMoney(value);
  const dateOrderInvalid = !!startDate && !!endDate && startDate > endDate;

  if (!open || !clientId) return null;

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !dateOrderInvalid && !busy;

  async function save() {
    if (!canSave || !clientId) return;
    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      value: parsedValue,
      currency,
      projectId: projectId || null,
      startDate: startDate || null,
      endDate: endDate || null,
      note: note.trim() || null,
    };
    try {
      if (editing && contract) {
        await update.mutateAsync({ clientId, id: contract.id, ...payload });
        toast.success('Đã lưu hợp đồng');
      } else {
        await create.mutateAsync({ clientId, ...payload });
        toast.success('Đã thêm hợp đồng');
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
      title={`${editing ? 'Sửa hợp đồng' : 'Thêm hợp đồng'}${clientName ? ` · ${clientName}` : ''}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu thay đổi' : 'Thêm hợp đồng'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên hợp đồng" htmlFor="contract-name">
          <Input id="contract-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Triển khai giai đoạn 1" autoFocus maxLength={160} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mã hợp đồng" hint="(tùy chọn — mã trên giấy tờ)" htmlFor="contract-code">
            <Input id="contract-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="HD-2026-001" maxLength={60} className="font-mono" />
          </Field>
          <Field label="Dự án liên quan" hint="(tùy chọn — dự án thực hiện hợp đồng)">
            <SearchSelect
              value={projectId}
              onChange={setProjectId}
              options={projectOptions}
              placeholder="Không gắn dự án"
              searchPlaceholder="Tìm dự án…"
              ariaLabel="Dự án của hợp đồng"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Giá trị hợp đồng" hint="(tùy chọn — chỉ nhập số)" htmlFor="contract-value">
            <Input
              id="contract-value"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="1500000000"
              className="tabular"
              title="Gõ liền số, không cần dấu chấm — hệ thống tự định dạng bên dưới"
            />
            {parsedValue !== null && (
              <p className="mt-1 text-xs text-faint" title="Số bạn vừa nhập, hiển thị theo định dạng tiền tệ">
                {formatMoney(parsedValue, currency)}
              </p>
            )}
          </Field>
          <Field label="Loại tiền">
            <SearchSelect
              value={currency}
              onChange={setCurrency}
              options={CURRENCIES}
              placeholder="VND"
              searchPlaceholder="Tìm loại tiền…"
              ariaLabel="Loại tiền của hợp đồng"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ngày bắt đầu" hint="(tùy chọn)" htmlFor="contract-start">
            <Input id="contract-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Ngày kết thúc" hint="(tùy chọn)" htmlFor="contract-end">
            <Input id="contract-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        {dateOrderInvalid && (
          <p className="text-xs text-danger" role="alert">
            Ngày kết thúc đang sớm hơn ngày bắt đầu — hãy sửa lại một trong hai ngày.
          </p>
        )}

        <Field label="Ghi chú" hint="(tùy chọn)" htmlFor="contract-note">
          <Input id="contract-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Điều khoản thanh toán, phạm vi công việc…" maxLength={1000} />
        </Field>
      </div>
    </Dialog>
  );
}
