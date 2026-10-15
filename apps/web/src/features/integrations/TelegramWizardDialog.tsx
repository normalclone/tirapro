import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, CheckCircle2, Copy, ExternalLink, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { cn } from '@/lib/utils';
import {
  useCreateLinkCode,
  useCreateTelegram,
  useIntegrations,
  usePlatformTelegram,
  usePollLinkCode,
  useTestIntegration,
  type Integration,
  type LinkCode,
  type PlatformTelegram,
} from './api';
import { testToast } from './telegramStatus';
import {
  WIZARD_STEPS,
  formatRemaining,
  linkCommand,
  nextStep,
  pollPlan,
  startGroupUrl,
  validateTokenShape,
  type WizardEvent,
  type WizardStep,
} from './telegramWizard';

const FORM_ID = 'telegram-wizard-form';

/* ------------------------------------------------------------------ */
/* Khung chung                                                        */
/* ------------------------------------------------------------------ */

function Stepper({ step }: { step: WizardStep }) {
  const current = WIZARD_STEPS.findIndex((s) => s.id === step);
  return (
    <ol aria-label="Các bước kết nối" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {WIZARD_STEPS.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === current ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5',
            i === current ? 'font-semibold text-ink-strong' : 'text-faint',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'grid h-5 w-5 place-items-center rounded-full border text-[11px] tabular-nums',
              i < current && 'border-success bg-success/10 text-success',
              i === current && 'border-primary bg-primary text-primary-fg',
              i > current && 'border-border',
            )}
          >
            {i < current ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/** Mỗi bước là một form: Enter = nút chính. Nút hành động nằm cuối form, cùng một chỗ trong mọi bước. */
function StepForm({
  onSubmit,
  actions,
  children,
}: {
  onSubmit: () => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  function handle(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }
  return (
    <form id={FORM_ID} onSubmit={handle} noValidate>
      <div className="space-y-3">{children}</div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{actions}</div>
    </form>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Bước 1 — chọn bot                                                  */
/* ------------------------------------------------------------------ */

function BotHelp() {
  return (
    <ol className="list-decimal space-y-1 rounded-md bg-surface-2 py-2.5 pl-8 pr-3 text-sm text-ink">
      <li>
        Mở{' '}
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          @BotFather
        </a>{' '}
        trong Telegram.
      </li>
      <li>
        Gửi lệnh <code className="font-mono text-xs">/newbot</code>, đặt tên cho bot.
      </li>
      <li>
        Copy token dạng <code className="font-mono text-xs">123456:ABC…</code> rồi dán vào ô dưới.
      </li>
    </ol>
  );
}

function BotStep({
  platform,
  onReady,
  onClose,
}: {
  platform: PlatformTelegram | undefined;
  onReady: (integration: Integration) => void;
  onClose: () => void;
}) {
  const create = useCreateTelegram();
  const globalBot = platform?.globalBotAvailable ?? false;
  const [picked, setPicked] = useState<'global' | 'own' | null>(null);
  const mode = picked ?? (globalBot ? 'global' : 'own');
  const [name, setName] = useState('Telegram');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [created, setCreated] = useState<Integration | null>(null);

  function submit() {
    if (created) return onReady(created);
    const trimmedName = name.trim() || 'Telegram';
    let botToken: string | undefined;
    if (mode === 'own') {
      const check = validateTokenShape(token);
      if (!check.ok) return setTokenError(check.message);
      botToken = check.token;
    }
    setTokenError(null);
    create.mutate({ name: trimmedName, botToken }, { onSuccess: (it) => setCreated(it) });
  }

  const err = tokenError ?? (create.isError ? apiErrorMessage(create.error) : null);
  return (
    <StepForm
      onSubmit={submit}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={create.isPending}>
            {created ? 'Tiếp tục' : 'Kiểm tra bot'}
          </Button>
        </>
      }
    >
      {globalBot && !created && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-muted">Bot gửi tin</legend>
          {(['global', 'own'] as const).map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="tg-bot-mode"
                checked={mode === m}
                onChange={() => setPicked(m)}
              />
              {m === 'global'
                ? `Dùng bot chung của hệ thống${platform?.globalBotUsername ? ` (@${platform.globalBotUsername})` : ''}`
                : 'Dùng bot riêng của tôi'}
            </label>
          ))}
        </fieldset>
      )}
      {mode === 'own' && !created && (
        <>
          <BotHelp />
          <div>
            <label htmlFor="tg-token" className="mb-1 block text-xs font-medium text-muted">
              Token bot
            </label>
            <Input
              id="tg-token"
              type="password"
              autoComplete="off"
              autoFocus
              value={token}
              placeholder="123456789:AAH…"
              aria-invalid={tokenError ? true : undefined}
              onChange={(e) => {
                setToken(e.target.value);
                setTokenError(null);
              }}
            />
          </div>
        </>
      )}
      <div>
        <label htmlFor="tg-name" className="mb-1 block text-xs font-medium text-muted">
          Tên kết nối
        </label>
        <Input
          id="tg-name"
          value={name}
          disabled={Boolean(created)}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {err && <ErrorText>{err}</ErrorText>}
      {created && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {created.botUsername ? `@${created.botUsername}` : 'Bot chung'} dùng được
        </p>
      )}
    </StepForm>
  );
}

/* ------------------------------------------------------------------ */
/* Bước 2 — thêm bot vào nhóm                                         */
/* ------------------------------------------------------------------ */

function AddToGroupStep({
  botUsername,
  onNext,
  onClose,
}: {
  botUsername: string | null;
  onNext: () => void;
  onClose: () => void;
}) {
  const url = startGroupUrl(botUsername);
  const bot = botUsername ? `@${botUsername}` : 'bot của bạn';
  return (
    <StepForm
      onSubmit={onNext}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Làm sau
          </Button>
          <Button type="submit" autoFocus>
            Tôi đã thêm bot
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">
        Thêm {bot} vào nhóm Telegram sẽ nhận thông báo. Nhóm có thể là nhóm mới tạo.
      </p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-4 text-sm font-medium text-ink hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Mở Telegram để chọn nhóm
        </a>
      )}
      <p className="text-sm text-muted">Hoặc vào nhóm, chọn Thêm thành viên rồi tìm {bot}.</p>
    </StepForm>
  );
}

/* ------------------------------------------------------------------ */
/* Bước 3 — mã liên kết                                               */
/* ------------------------------------------------------------------ */

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

type LinkPhase = 'creating' | 'waiting' | 'linked' | 'expired' | 'error';

function CommandBlock({ command }: { command: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 p-3">
      <code className="min-w-0 flex-1 break-all font-mono text-base font-semibold text-ink-strong">
        {command}
      </code>
      <Button type="button" variant="secondary" size="sm" onClick={() => void copy(command)}>
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
        {copied ? 'Đã chép' : 'Sao chép'}
      </Button>
    </div>
  );
}

function LinkStep({
  integrationId,
  botUsername,
  onLinked,
  onBack,
  onClose,
}: {
  integrationId: string;
  botUsername: string | null;
  onLinked: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const {
    mutate: issueCode,
    isError: codeFailed,
    error: codeError,
  } = useCreateLinkCode(integrationId);
  const [session, setSession] = useState<{ code: LinkCode; startedAt: number } | null>(null);
  const started = useRef(false);
  const issue = useCallback(() => {
    setSession(null);
    issueCode(undefined, { onSuccess: (code) => setSession({ code, startedAt: Date.now() }) });
  }, [issueCode]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    issue();
  }, [issue]);

  const poll = usePollLinkCode(integrationId, session?.code.code ?? null, session?.startedAt ?? 0);
  const now = useNow(1000);
  const data = poll.data;

  let phase: LinkPhase = 'waiting';
  if (!session) phase = 'creating';
  else if (data?.status === 'linked') phase = 'linked';
  else if (data?.status === 'error') phase = 'error';
  else if (
    data?.status === 'expired' ||
    now >= Date.parse(session.code.expiresAt) ||
    !pollPlan(session.startedAt, now).continue
  )
    phase = 'expired';

  const name = session?.code.botUsername ?? botUsername;
  const command = session ? linkCommand(name, session.code.code) : '';
  const remaining = session ? Date.parse(session.code.expiresAt) - now : 0;

  return (
    <StepForm
      onSubmit={
        phase === 'linked'
          ? onLinked
          : phase === 'expired' || phase === 'error'
            ? issue
            : () => undefined
      }
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onBack}>
            Quay lại
          </Button>
          {phase !== 'linked' && (
            <Button type="button" variant="ghost" onClick={onClose}>
              Làm sau
            </Button>
          )}
          {phase === 'linked' && (
            <Button type="submit" autoFocus>
              Tiếp tục
            </Button>
          )}
          {(phase === 'expired' || phase === 'error') && (
            <Button type="submit" autoFocus>
              Tạo mã mới
            </Button>
          )}
        </>
      }
    >
      {codeFailed && <ErrorText>{apiErrorMessage(codeError)}</ErrorText>}
      {phase === 'creating' && !codeFailed && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Đang tạo mã liên kết…
        </p>
      )}
      {session && phase !== 'linked' && (
        <>
          <p className="text-sm text-ink">Gõ đúng dòng này trong nhóm Telegram (đã thêm bot):</p>
          <CommandBlock command={command} />
        </>
      )}
      <div aria-live="polite" className="text-sm">
        {phase === 'waiting' && (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang chờ tin nhắn trong nhóm… (còn {formatRemaining(remaining)})
          </p>
        )}
        {phase === 'waiting' && data?.status === 'waiting' && data.hint && (
          <p className="mt-1 text-warning-ink">{data.hint}</p>
        )}
        {phase === 'expired' && (
          <p className="text-warning-ink">
            Mã đã hết hạn hoặc chờ quá lâu — tạo mã mới để thử lại.
          </p>
        )}
        {phase === 'error' && data?.status === 'error' && <ErrorText>{data.hint}</ErrorText>}
        {phase === 'linked' && data?.status === 'linked' && (
          <p className="flex items-center gap-1.5 font-medium text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Đã liên kết nhóm &lsquo;{data.channel.title ?? data.channel.externalId}&rsquo;
          </p>
        )}
      </div>
    </StepForm>
  );
}

/* ------------------------------------------------------------------ */
/* Bước 4 — gửi thử                                                   */
/* ------------------------------------------------------------------ */

function TestStep({ integrationId, onDone }: { integrationId: string; onDone: () => void }) {
  const test = useTestIntegration();
  const result = test.data ? testToast(test.data) : null;
  return (
    <StepForm
      onSubmit={() => (result?.kind === 'success' ? onDone() : test.mutate(integrationId))}
      actions={
        <>
          {result?.kind !== 'success' && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Bỏ qua
            </Button>
          )}
          <Button type="submit" autoFocus loading={test.isPending}>
            {result?.kind === 'success' ? (
              'Xong'
            ) : (
              <>
                <Send className="h-4 w-4" aria-hidden />
                {result ? 'Gửi lại' : 'Gửi tin thử'}
              </>
            )}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">
        Gửi một tin thử tới các nhóm đã liên kết để chắc chắn bot nhắn được.
      </p>
      {test.isError && <ErrorText>{apiErrorMessage(test.error)}</ErrorText>}
      {result && (
        <p
          role="status"
          className={cn(
            'text-sm font-medium',
            result.kind === 'success' ? 'text-success' : 'text-warning-ink',
          )}
        >
          {result.text}
        </p>
      )}
    </StepForm>
  );
}

/* ------------------------------------------------------------------ */
/* Wizard                                                             */
/* ------------------------------------------------------------------ */

export interface TelegramWizardProps {
  open: boolean;
  onClose: () => void;
  /** Có = tiếp tục một kết nối đã tạo (bỏ bước 1). */
  integrationId?: string;
  /** Bước mở đầu (mặc định: 'bot' nếu chưa có kết nối, 'addToGroup' nếu có). */
  initialStep?: WizardStep;
}

/**
 * Wizard kết nối Telegram 4 bước. Luôn mount với `open` thật (Dialog giữ hiệu ứng đóng); cha gắn `key`
 * theo lần mở để state khởi tạo lại. Đóng giữa chừng không để lại kết nối "mồ côi": kết nối đã tạo vẫn
 * hiện ở danh sách với trạng thái đúng và nút "Hoàn tất kết nối".
 */
export function TelegramWizard({ open, onClose, integrationId, initialStep }: TelegramWizardProps) {
  const platform = usePlatformTelegram();
  const integrations = useIntegrations();
  const [step, setStep] = useState<WizardStep>(
    initialStep ?? (integrationId ? 'addToGroup' : 'bot'),
  );
  const [createdId, setCreatedId] = useState<string | undefined>(integrationId);
  const [createdBot, setCreatedBot] = useState<string | null>(null);
  const dispatch = (e: WizardEvent) => setStep((s) => nextStep(s, e));

  const id = createdId;
  const botUsername =
    createdBot ?? integrations.data?.find((i) => i.id === id)?.botUsername ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Kết nối Telegram"
      icon={<Send className="h-4 w-4" />}
      size="md"
    >
      <Stepper step={step} />
      {step === 'bot' && (
        <BotStep
          platform={platform.data}
          onClose={onClose}
          onReady={(it) => {
            setCreatedId(it.id);
            setCreatedBot(it.botUsername);
            dispatch('BOT_READY');
          }}
        />
      )}
      {step === 'addToGroup' && id && (
        <AddToGroupStep
          botUsername={botUsername}
          onClose={onClose}
          onNext={() => dispatch('GROUP_ADDED')}
        />
      )}
      {step === 'linking' && id && (
        <LinkStep
          integrationId={id}
          botUsername={botUsername}
          onClose={onClose}
          onBack={() => dispatch('BACK')}
          onLinked={() => dispatch('LINKED')}
        />
      )}
      {step === 'test' && id && <TestStep integrationId={id} onDone={onClose} />}
    </Dialog>
  );
}
