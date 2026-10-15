import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ProjectType } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useCreateProject } from './create-project.api';

const selectClass = cn(
  'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-ink',
  'transition-colors duration-150 focus-visible:outline-none focus-visible:border-primary',
  'focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
);

const KEY_RE = /^[A-Z][A-Z0-9]*$/;

/**
 * Gợi ý key từ tên dự án: lấy chữ/số viết hoa.
 * Nhiều từ → viết tắt chữ đầu mỗi từ (vd "Website Mới" → "WM").
 * Một từ → cắt còn ≤10 ký tự (vd "Website" → "WEBSITE").
 */
function suggestKey(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return '';
  const raw = words.length > 1 ? words.map((w) => w[0]).join('') : words[0]!;
  return raw.toUpperCase().slice(0, 10);
}

export function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateProject();

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<ProjectType>('SCRUM');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
      setKey('');
      setKeyTouched(false);
      setType('SCRUM');
      setDescription('');
    }
  }, [open]);

  if (!open) return null;

  function onNameChange(value: string) {
    setName(value);
    if (!keyTouched) setKey(suggestKey(value));
  }

  function onKeyChange(value: string) {
    setKeyTouched(true);
    setKey(value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }

  const trimmedName = name.trim();
  const keyValid = KEY_RE.test(key) && key.length >= 2 && key.length <= 10;
  const showKeyHint = key.length > 0 && !keyValid;
  const canSubmit = trimmedName.length > 0 && keyValid;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const created = await create.mutateAsync({
        name: trimmedName,
        key,
        type,
        description: description.trim() || null,
      });
      toast.success(`Đã tạo dự án ${created.key}`);
      onClose();
      navigate(`/p/${created.key}/board`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Tạo dự án"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            type="submit"
            form="create-project-form"
            loading={create.isPending}
            disabled={!canSubmit}
          >
            Tạo dự án
          </Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <div>
          <label htmlFor="cp-name" className="mb-1.5 block text-sm font-medium text-muted">
            Tên dự án
          </label>
          <Input
            id="cp-name"
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="VD: Website Mới"
            className="text-sm"
          />
        </div>

        <div>
          <label htmlFor="cp-key" className="mb-1.5 block text-sm font-medium text-muted">
            Key
          </label>
          <Input
            id="cp-key"
            value={key}
            onChange={(e) => onKeyChange(e.target.value)}
            placeholder="VD: WM"
            maxLength={10}
            aria-invalid={showKeyHint}
            className="font-mono text-sm uppercase"
          />
          <p className={cn('mt-1.5 text-xs', showKeyHint ? 'text-danger' : 'text-faint')}>
            {showKeyHint
              ? 'Mã gồm 2–10 ký tự, chữ in hoa/số, bắt đầu bằng chữ cái.'
              : 'Dùng làm tiền tố cho mã công việc (vd WM-1). Có thể sửa.'}
          </p>
        </div>

        <div>
          <label htmlFor="cp-type" className="mb-1.5 block text-sm font-medium text-muted">
            Loại
          </label>
          <select
            id="cp-type"
            value={type}
            onChange={(e) => setType(e.target.value as ProjectType)}
            className={selectClass}
          >
            <option value="SCRUM">Scrum</option>
            <option value="KANBAN">Kanban</option>
          </select>
        </div>

        <div>
          <label htmlFor="cp-desc" className="mb-1.5 block text-sm font-medium text-muted">
            Mô tả <span className="font-normal text-faint">(tùy chọn)</span>
          </label>
          <textarea
            id="cp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Mục tiêu, phạm vi, ghi chú…"
            className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus-visible:border-primary"
          />
        </div>
      </form>
    </Dialog>
  );
}
