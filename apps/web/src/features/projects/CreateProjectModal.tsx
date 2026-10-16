import { useState, type FormEvent, type ComponentProps } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectTemplateKey } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useOpenSession } from '@/lib/useOpenSession';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useCreateProject } from './create-project.api';
import { templateOptions } from './templateOptions';

const TEMPLATES = templateOptions();

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

/**
 * Luôn mount (có hiệu ứng đóng); `key` theo lần mở → mỗi lần mở là mount mới nên form khởi tạo lại, không có
 * khung hình nội dung cũ. Lúc đóng `key` giữ nguyên nên nội dung ở lại suốt hiệu ứng.
 */
export function CreateProjectModal(props: ComponentProps<typeof CreateProjectModalInner>) {
  const session = useOpenSession(props.open);
  return <CreateProjectModalInner key={session} {...props} />;
}

function CreateProjectModalInner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateProject();

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [templateKey, setTemplateKey] = useState<ProjectTemplateKey>('scrum');
  const [description, setDescription] = useState('');

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
        templateKey,
        type: TEMPLATES.find((t) => t.key === templateKey)?.projectType ?? 'SCRUM',
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
      open={open}
      icon={<FolderKanban className="h-4 w-4" />}
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

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium text-muted">Mẫu dự án</legend>
          {TEMPLATES.map((t) => (
            <label
              key={t.key}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                'focus-within:ring-2 focus-within:ring-[var(--ring)]',
                templateKey === t.key
                  ? 'border-primary bg-primary-subtle'
                  : 'border-border hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                name="cp-template"
                value={t.key}
                checked={templateKey === t.key}
                onChange={() => setTemplateKey(t.key)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{t.name}</span>
                <span className="block text-xs text-muted">{t.description}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-faint">
                  {t.steps.map((step, i) => (
                    <span key={step} className="inline-flex items-center gap-1">
                      {i > 0 && <span aria-hidden>→</span>}
                      <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-muted">
                        {step}
                      </span>
                    </span>
                  ))}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

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
