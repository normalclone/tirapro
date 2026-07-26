import { useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronRight, FolderPlus, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { ClientEditorModal } from './ClientEditorModal';
import { ClientProjectsModal } from './ClientProjectsModal';
import { ContractEditorModal } from './ContractEditorModal';
import {
  useClients, useDeleteClient, useDeleteContract, formatMoney,
  type ClientDto, type ContractDto,
} from './api';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}

function term(contract: ContractDto): string {
  if (!contract.startDate && !contract.endDate) return 'Chưa đặt thời hạn';
  return `${fmtDate(contract.startDate)} → ${fmtDate(contract.endDate)}`;
}

/** Hợp đồng đã hết hạn (ngày kết thúc ở quá khứ) → nhắc gia hạn. */
function isExpired(contract: ContractDto): boolean {
  if (!contract.endDate) return false;
  const t = new Date(contract.endDate).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

function ContractRow({
  contract,
  canManage,
  onEdit,
  onDelete,
}: {
  contract: ContractDto;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const expired = isExpired(contract);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {contract.code && (
          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{contract.code}</span>
        )}
        <span className="truncate text-sm text-ink">{contract.name}</span>
        {contract.project && (
          <span className="shrink-0 truncate text-[11px] text-faint">· {contract.project.key}</span>
        )}
      </div>
      <span className="tabular shrink-0 text-sm font-medium text-ink-strong" title="Giá trị hợp đồng">
        {formatMoney(contract.value, contract.currency)}
      </span>
      <span
        className={cn('tabular shrink-0 text-xs', expired ? 'text-danger' : 'text-muted')}
        title={expired ? 'Đã qua ngày kết thúc — cân nhắc gia hạn hoặc ký phụ lục' : 'Thời hạn hợp đồng: từ ngày đến ngày'}
      >
        {term(contract)}
        {expired && ' · hết hạn'}
      </span>
      {canManage && (
        <span className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Sửa giá trị, thời hạn và dự án của hợp đồng"
            aria-label={`Sửa hợp đồng ${contract.name}`}
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted hover:text-danger"
            title="Xoá hợp đồng khỏi khách hàng này"
            aria-label={`Xoá hợp đồng ${contract.name}`}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </span>
      )}
    </li>
  );
}

function ClientCard({
  client,
  canManage,
  onEdit,
  onAssign,
  onDelete,
  onAddContract,
  onEditContract,
  onDeleteContract,
}: {
  client: ClientDto;
  canManage: boolean;
  onEdit: () => void;
  onAssign: () => void;
  onDelete: () => void;
  onAddContract: () => void;
  onEditContract: (c: ContractDto) => void;
  onDeleteContract: (c: ContractDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = `client-body-${client.id}`;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-strong">{client.name}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
              {client.contactName && <span className="truncate">{client.contactName}</span>}
              {client.email && (
                <span className="flex min-w-0 items-center gap-1">
                  <Mail className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                  <span className="truncate">{client.email}</span>
                </span>
              )}
              {client.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                  {client.phone}
                </span>
              )}
              {!client.contactName && !client.email && !client.phone && (
                <span className="text-faint" title="Chưa lưu người liên hệ, email hay số điện thoại nào">
                  Chưa có thông tin liên hệ
                </span>
              )}
            </span>
          </span>
        </button>

        <p className="tabular flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span title="Số dự án đang gắn với khách hàng này"><span className="font-medium text-ink">{client.projectCount}</span> dự án</span>
          <span aria-hidden className="text-faint">·</span>
          <span title="Số hợp đồng đã ký với khách hàng này"><span className="font-medium text-ink">{client.contractCount}</span> hợp đồng</span>
          {client.contractTotals.map((t) => (
            <span
              key={t.currency}
              className="font-medium text-ink-strong"
              title={`Tổng giá trị các hợp đồng tính bằng ${t.currency}`}
            >
              {formatMoney(t.value, t.currency)}
            </span>
          ))}
        </p>

        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title="Chọn dự án đang làm cho khách hàng này"
              aria-label={`Gán dự án cho ${client.name}`}
              onClick={onAssign}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Sửa tên và thông tin liên hệ"
              aria-label={`Sửa khách hàng ${client.name}`}
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-danger"
              title="Xoá khách hàng cùng các hợp đồng của họ"
              aria-label={`Xoá khách hàng ${client.name}`}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div id={bodyId} className="space-y-4 border-t border-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Dự án</p>
            {client.projects.length === 0 ? (
              <p className="text-sm text-faint">
                {canManage
                  ? 'Chưa gán dự án nào. Dùng nút “Gán dự án” ở trên để nối dự án với khách hàng này.'
                  : 'Chưa gán dự án nào cho khách hàng này.'}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {client.projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-ink">
                    <span className="font-mono text-[11px] text-muted">{p.key}</span>
                    <span className="truncate">{p.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted">Hợp đồng</p>
              {canManage && (
                <Button size="sm" variant="secondary" onClick={onAddContract}>
                  <Plus className="h-4 w-4" /> Thêm hợp đồng
                </Button>
              )}
            </div>
            {client.contracts.length === 0 ? (
              <p className="text-sm text-faint">
                {canManage
                  ? 'Chưa có hợp đồng nào. Thêm hợp đồng để theo dõi giá trị và thời hạn đã cam kết.'
                  : 'Chưa có hợp đồng nào với khách hàng này.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {client.contracts.map((c) => (
                  <ContractRow
                    key={c.id}
                    contract={c}
                    canManage={canManage}
                    onEdit={() => onEditContract(c)}
                    onDelete={() => onDeleteContract(c)}
                  />
                ))}
              </ul>
            )}
          </div>

          {client.note && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Ghi chú</p>
              <p className="text-sm text-ink">{client.note}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Khách hàng & hợp đồng — ai đặt hàng, dự án nào phục vụ họ, cam kết những gì. */
export function ClientsPage() {
  const canManage = useAuth((s) => s.can('client:manage'));
  const { data: clients, isLoading } = useClients();
  const removeClient = useDeleteClient();
  const removeContract = useDeleteContract();

  const [q, setQ] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ClientDto | null>(null);
  const [assigning, setAssigning] = useState<ClientDto | null>(null);
  const [contractCtx, setContractCtx] = useState<{ client: ClientDto; contract: ContractDto | null } | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return clients ?? [];
    return (clients ?? []).filter((c) =>
      [c.name, c.contactName, c.email, c.phone].some((v) => v?.toLowerCase().includes(query)),
    );
  }, [clients, q]);

  function openCreate() { setEditing(null); setEditorOpen(true); }

  function handleDeleteClient(c: ClientDto) {
    const warn = c.contractCount > 0 ? ` ${c.contractCount} hợp đồng của khách hàng này sẽ bị xoá theo.` : '';
    if (!window.confirm(`Xoá khách hàng “${c.name}”?${warn} Các dự án vẫn giữ nguyên, chỉ bỏ liên kết với khách hàng.`)) return;
    removeClient.mutate(c.id, {
      onError: (e) => toast.error(apiErrorMessage(e)),
      onSuccess: () => toast.success('Đã xoá khách hàng'),
    });
  }

  function handleDeleteContract(client: ClientDto, contract: ContractDto) {
    if (!window.confirm(`Xoá hợp đồng “${contract.name}”? Thao tác này không khôi phục được.`)) return;
    removeContract.mutate(
      { clientId: client.id, id: contract.id },
      { onError: (e) => toast.error(apiErrorMessage(e)), onSuccess: () => toast.success('Đã xoá hợp đồng') },
    );
  }

  const hasClients = (clients ?? []).length > 0;

  return (
    <div className={pageContainer('lg')}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Khách hàng &amp; hợp đồng</h1>
          <p className="mt-1 text-sm text-muted">
            Lưu thông tin liên hệ của khách hàng, nối họ với dự án đang làm và ghi lại giá trị, thời hạn
            của từng hợp đồng để không bỏ sót cam kết.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Thêm khách hàng</Button>
        )}
      </header>

      {hasClients && (
        <div className="mb-4">
          <label htmlFor="client-search" className="sr-only">Tìm khách hàng</label>
          <Input
            id="client-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo tên khách hàng, người liên hệ, email hoặc số điện thoại…"
            className="max-w-sm"
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !hasClients ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="Chưa có khách hàng nào"
          description={
            canManage
              ? 'Đây là nơi lưu khách hàng cùng hợp đồng của họ. Thêm khách hàng đầu tiên rồi gắn dự án và hợp đồng để theo dõi cam kết.'
              : 'Đây là nơi lưu khách hàng cùng hợp đồng của họ. Khi có khách hàng được thêm, bạn sẽ thấy ở đây.'
          }
          action={canManage ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Thêm khách hàng</Button> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="Không tìm thấy khách hàng"
          description={`Không có khách hàng nào khớp “${q.trim()}”. Thử từ khoá ngắn hơn, hoặc xoá ô tìm kiếm để xem lại tất cả.`}
          action={<Button size="sm" variant="secondary" onClick={() => setQ('')}>Xoá từ khoá tìm</Button>}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              canManage={canManage}
              onEdit={() => { setEditing(c); setEditorOpen(true); }}
              onAssign={() => setAssigning(c)}
              onDelete={() => handleDeleteClient(c)}
              onAddContract={() => setContractCtx({ client: c, contract: null })}
              onEditContract={(contract) => setContractCtx({ client: c, contract })}
              onDeleteContract={(contract) => handleDeleteContract(c, contract)}
            />
          ))}
        </div>
      )}

      <ClientEditorModal open={editorOpen} client={editing} onClose={() => setEditorOpen(false)} />
      <ClientProjectsModal open={!!assigning} client={assigning} onClose={() => setAssigning(null)} />
      <ContractEditorModal
        open={!!contractCtx}
        clientId={contractCtx?.client.id ?? null}
        clientName={contractCtx?.client.name}
        contract={contractCtx?.contract}
        onClose={() => setContractCtx(null)}
      />
    </div>
  );
}
