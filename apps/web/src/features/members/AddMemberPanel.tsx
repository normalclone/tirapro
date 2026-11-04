import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Copy, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { ERROR_CODES } from '@tirapro/types';
import { Avatar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { useAuth } from '@/stores/auth';
import {
  useAddMember,
  useAllUsers,
  useCreateMemberAccount,
  useOrganizationMembers,
  type CreateMemberAccountResult,
} from './api';
import { PASSWORD_POLICY_HINT, passwordPolicyError } from './passwordPolicy';
import { useOrganizationRoleChoice } from './useOrganizationRoleChoice';
import { SectionCard } from '@/components/ui/SectionCard';
import { AddDialog } from '@/components/ui/AddDialog';

interface FlowProps {
  /** Gửi xong (đã thêm người có sẵn / bấm "Xong" sau khi tạo tài khoản) — hộp thoại dùng để tự đóng. */
  onFinished?: () => void;
  /** Báo có nội dung đang nhập dở (để hộp thoại hỏi trước khi đóng). */
  onDirtyChange?: (dirty: boolean, reason?: 'tempPassword') => void;
}

/**
 * MỘT luồng thêm thành viên: chọn người có sẵn trong hệ thống (pool chung) HOẶC bấm "Chưa có tài khoản? Tạo tài khoản mới"
 * để tạo tài khoản + thêm cùng lúc. Dùng trong thẻ (bước Làm quen) và trong hộp thoại "Mời thành viên" của trang Thành viên.
 */
function AddMemberFlow({ onFinished, onDirtyChange }: FlowProps) {
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  // Email vừa nhập nhưng đã có tài khoản → chuyển về "chọn người có sẵn" với ô tìm điền sẵn email.
  const [prefillEmail, setPrefillEmail] = useState('');
  return mode === 'pick' ? (
    <AddExistingUser
      prefillEmail={prefillEmail}
      onFinished={onFinished}
      onDirtyChange={onDirtyChange}
      onCreateNew={() => {
        setPrefillEmail('');
        setMode('create');
      }}
    />
  ) : (
    <CreateAccountForm
      onFinished={onFinished}
      onDirtyChange={onDirtyChange}
      onBack={() => setMode('pick')}
      onEmailExists={(email) => {
        setPrefillEmail(email);
        setMode('pick');
      }}
    />
  );
}

/**
 * Thẻ "Thêm thành viên" (bước Làm quen). Gated bằng `member:manage` — trùng với cách MembersPage kiểm tra quyền.
 * Trang Thành viên dùng `AddMemberDialog` thay vì thẻ mở sẵn.
 */
export function AddMemberPanel() {
  const canManage = useAuth((s) => s.can('member:manage'));
  if (!canManage) return null;
  return (
    <SectionCard
      icon={<UserPlus className="h-4 w-4" />}
      title="Thêm thành viên"
      description="Chọn người có sẵn trong hệ thống hoặc tạo tài khoản mới."
      bare
      data-tour="members-add"
    >
      <AddMemberFlow />
    </SectionCard>
  );
}

/** Đóng khi mật khẩu tạm còn đang hiện: nói rõ nó sẽ không hiện lại (khác lời hỏi "nhập dở" chung). */
const TEMP_PASSWORD_PROMPT = {
  title: 'Mật khẩu tạm sẽ không hiện lại',
  description: 'Mật khẩu tạm sẽ không hiện lại. Bạn đã chép lại chưa?',
  confirmLabel: 'Đã chép, đóng',
};

/** Hộp thoại "Mời thành viên" — cùng luồng/trường/quyền với thẻ cũ; nút mở nằm ở đầu trang Thành viên. */
export function AddMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [tempShown, setTempShown] = useState(false);
  return (
    <AddDialog
      open={open}
      onClose={() => {
        setDirty(false);
        setTempShown(false);
        onClose();
      }}
      dirty={dirty}
      dirtyPrompt={tempShown ? TEMP_PASSWORD_PROMPT : undefined}
      title="Mời thành viên"
      description="Chọn người có sẵn trong hệ thống hoặc tạo tài khoản mới."
      size="lg"
      bodyClassName="p-0"
    >
      <AddMemberFlow
        onDirtyChange={(d, reason) => {
          setDirty(d);
          setTempShown(reason === 'tempPassword');
        }}
        onFinished={() => {
          setDirty(false);
          setTempShown(false);
          onClose();
        }}
      />
    </AddDialog>
  );
}

/** Báo nội dung đang nhập dở lên hộp thoại bao quanh (nếu có). */
function useReportDirty(
  dirty: boolean,
  onDirtyChange?: FlowProps['onDirtyChange'],
  reason?: 'tempPassword',
) {
  useEffect(() => {
    onDirtyChange?.(dirty, reason);
  }, [dirty, reason, onDirtyChange]);
}

/** Dòng báo khi quay về từ "tạo tài khoản" vì email đã có tài khoản. */
function PrefillNotice({ email, isMember }: { email: string; isMember: boolean }) {
  return (
    <p className="rounded-md bg-primary-subtle px-3 py-2 text-sm text-ink" role="status">
      {isMember
        ? `${email} đã là thành viên của tổ chức này.`
        : `${email} đã có tài khoản — chọn người đó để thêm vào tổ chức.`}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Chọn người dùng có sẵn                                              */
/* ------------------------------------------------------------------ */

type PoolUser = NonNullable<ReturnType<typeof useAllUsers>['data']>[number];

function AddExistingUser({
  prefillEmail,
  onCreateNew,
  onFinished,
  onDirtyChange,
}: FlowProps & {
  prefillEmail: string;
  onCreateNew: () => void;
}) {
  // `search` chỉ dùng để tìm đúng người khi quay về từ "email đã tồn tại", rồi trả về rỗng để pool không bị đóng băng.
  const [search, setSearch] = useState(prefillEmail);
  const [userId, setUserId] = useState('');
  const [prefilledUser, setPrefilledUser] = useState<PoolUser | null>(null);

  const { data: members } = useOrganizationMembers();
  const { data: users, isLoading: usersLoading } = useAllUsers(search);
  const addMember = useAddMember();
  const { roleOptions, effectiveRoleIds, setRoleIds, resetRoles, frozen } =
    useOrganizationRoleChoice();

  // Loại người đã ở trong tổ chức khỏi pool.
  const memberUserIds = useMemo(() => new Set((members ?? []).map((m) => m.user.id)), [members]);
  const addableUsers = (users ?? []).filter((u) => !memberUserIds.has(u.id));
  // Người được chọn sẵn luôn có trong danh sách lựa chọn dù pool đã trở về không lọc.
  if (prefilledUser && !addableUsers.some((u) => u.id === prefilledUser.id)) {
    addableUsers.unshift(prefilledUser);
  }
  const userSelectOptions = addableUsers.map((u) => ({
    value: u.id,
    label: u.displayName,
    hint: u.email,
  }));
  const picked = addableUsers.find((u) => u.id === userId);
  useReportDirty(userId !== '', onDirtyChange);

  // Quay lại từ "tạo tài khoản" vì email đã tồn tại: chọn sẵn đúng người đó (nếu chưa là thành viên).
  const prefilled = prefillEmail
    ? addableUsers.find((u) => u.email.toLowerCase() === prefillEmail.toLowerCase())
    : undefined;
  useEffect(() => {
    if (!prefilled) return;
    setUserId(prefilled.id);
    setPrefilledUser(prefilled);
    setSearch('');
  }, [prefilled]);
  const prefillIsMember =
    !!prefillEmail &&
    !usersLoading &&
    !prefilled &&
    !prefilledUser &&
    (members ?? []).some((m) => m.user.email.toLowerCase() === prefillEmail.toLowerCase());

  function reset() {
    setUserId('');
    resetRoles();
    setPrefilledUser(null);
  }

  function submit() {
    if (!userId) {
      toast.error('Chọn một người dùng.');
      return;
    }
    if (effectiveRoleIds.length === 0) {
      toast.error('Chọn ít nhất một vai trò.');
      return;
    }
    addMember.mutate(
      { userId, roleIds: effectiveRoleIds },
      {
        onSuccess: (m) => {
          toast.success(`Đã thêm ${m.user.displayName} vào tổ chức`);
          reset();
          onFinished?.();
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  // Cmd/Ctrl+Enter thêm người (UX_CONVENTIONS).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (userId && effectiveRoleIds.length > 0 && !addMember.isPending) submit();
    }
  }

  return (
    <div className="space-y-4 p-5" onKeyDown={onKeyDown}>
      {prefillEmail && <PrefillNotice email={prefillEmail} isMember={prefillIsMember} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Người dùng</span>
          <SearchSelect
            value={userId}
            onChange={setUserId}
            options={userSelectOptions}
            placeholder="Chọn người dùng…"
            searchPlaceholder="Tìm theo tên hoặc email…"
            ariaLabel="Chọn người để thêm vào tổ chức"
          />
          {!usersLoading && addableUsers.length === 0 && (
            <p className="text-xs text-faint">
              Mọi người trong hệ thống đều đã là thành viên ở đây.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Vai trò</span>
          <RoleMultiSelect
            options={roleOptions}
            value={effectiveRoleIds}
            onChange={setRoleIds}
            frozen={frozen}
            requireOne={false}
            disabled={addMember.isPending}
            placeholder="Mặc định — Thành viên"
            ariaLabel="Vai trò cho thành viên mới"
          />
        </div>
      </div>

      {picked && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <Avatar name={picked.displayName} src={picked.avatarUrl} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{picked.displayName}</p>
            <p className="truncate text-xs text-faint">{picked.email}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setUserId('')}
            aria-label="Bỏ chọn người dùng"
            title="Bỏ chọn"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Button
        type="button"
        size="sm"
        onClick={submit}
        loading={addMember.isPending}
        disabled={!userId || effectiveRoleIds.length === 0}
      >
        <UserPlus className="h-4 w-4" />
        Thêm vào tổ chức
      </Button>

      <div className="border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCreateNew}>
          Chưa có tài khoản? Tạo tài khoản mới
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tạo tài khoản mới + thêm vào tổ chức                      */
/* ------------------------------------------------------------------ */

function CreateAccountForm({
  onBack,
  onEmailExists,
  onFinished,
  onDirtyChange,
}: FlowProps & {
  onBack: () => void;
  onEmailExists: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState<CreateMemberAccountResult | null>(null);

  const { roleOptions, effectiveRoleIds, setRoleIds, resetRoles, frozen } =
    useOrganizationRoleChoice();
  const create = useCreateMemberAccount();
  // Mật khẩu tạm không được nằm lại trong MutationCache sau khi rời form ("chỉ hiện một lần").
  const resetCreate = create.reset;
  useEffect(() => resetCreate, [resetCreate]);
  const passwordError = passwordPolicyError(password);
  // Đang nhập dở, hoặc vừa tạo xong và mật khẩu tạm (chỉ hiện một lần) chưa được ghi lại → đóng thì phải hỏi.
  const dirty =
    created !== null
      ? !!created.tempPassword
      : email.trim() !== '' || displayName.trim() !== '' || password.trim() !== '';
  useReportDirty(dirty, onDirtyChange, created?.tempPassword ? 'tempPassword' : undefined);
  const canSubmit =
    !!email.trim() && !!displayName.trim() && effectiveRoleIds.length > 0 && !passwordError;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSubmit || create.isPending) return;
    const cleanEmail = email.trim();
    create.mutate(
      {
        email: cleanEmail,
        displayName: displayName.trim(),
        roleIds: effectiveRoleIds,
        password: password.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          toast.success(`Đã tạo tài khoản và thêm ${res.member.user.displayName}`);
          setCreated(res);
        },
        onError: (err) => {
          if (apiErrorCode(err) === ERROR_CODES.EMAIL_ALREADY_REGISTERED) {
            // Đánh dấu lỗi đã được xử lý tại đây để MutationCache toàn cục không toast lần hai.
            void apiErrorMessage(err);
            toast.info('Email này đã có tài khoản — chọn người đó trong danh sách.');
            onEmailExists(cleanEmail);
          } else toast.error(apiErrorMessage(err));
        },
      },
    );
  }

  // Cmd/Ctrl+Enter lưu (UX_CONVENTIONS).
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  if (created) {
    return (
      <CreatedAccountNotice
        result={created}
        onDone={() => {
          create.reset(); // xoá mật khẩu tạm khỏi bộ nhớ đệm mutation
          setCreated(null);
          setEmail('');
          setDisplayName('');
          setPassword('');
          resetRoles();
          onFinished?.();
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Email</span>
          <Input
            type="email"
            required
            autoComplete="off"
            autoFocus
            placeholder="ten@congty.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={create.isPending}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Tên hiển thị</span>
          <Input
            required
            autoComplete="off"
            placeholder="Nguyễn Văn A"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={create.isPending}
          />
        </label>
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Vai trò</span>
          <RoleMultiSelect
            options={roleOptions}
            value={effectiveRoleIds}
            onChange={setRoleIds}
            frozen={frozen}
            requireOne={false}
            disabled={create.isPending}
            placeholder="Mặc định — Thành viên"
            ariaLabel="Vai trò cho tài khoản mới"
          />
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">
            Mật khẩu <span className="font-normal text-faint">(tuỳ chọn)</span>
          </span>
          <Input
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={create.isPending}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby="add-member-password-hint"
          />
          <p
            id="add-member-password-hint"
            className={passwordError ? 'text-xs text-danger' : 'text-xs text-faint'}
          >
            {passwordError ?? PASSWORD_POLICY_HINT}
          </p>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={create.isPending} disabled={!canSubmit}>
          <UserPlus className="h-4 w-4" />
          Tạo tài khoản và thêm
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Chọn từ danh sách
        </Button>
      </div>
    </form>
  );
}

/** Sau khi tạo: hiện mật khẩu tạm MỘT lần (nếu hệ thống sinh) kèm nút sao chép. */
function CreatedAccountNotice({
  result,
  onDone,
}: {
  result: CreateMemberAccountResult;
  onDone: () => void;
}) {
  const { copied, copy } = useCopyToClipboard('Đã sao chép mật khẩu tạm');
  const { tempPassword, member } = result;

  return (
    <div className="space-y-3 p-5" role="status">
      <p className="text-sm font-medium text-ink-strong">
        Đã tạo và thêm {member.user.displayName} ({member.user.email})
      </p>
      {tempPassword ? (
        <>
          <p className="text-sm text-muted">
            Gửi mật khẩu tạm này cho họ. <strong className="text-ink">Chỉ hiện một lần</strong> —
            đóng thông báo này là không xem lại được.
          </p>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={tempPassword}
              aria-label="Mật khẩu tạm"
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copy(tempPassword)}
              aria-label="Sao chép mật khẩu tạm"
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              Sao chép
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Họ đăng nhập bằng mật khẩu bạn đã đặt.</p>
      )}
      <Button type="button" size="sm" onClick={onDone}>
        Xong
      </Button>
    </div>
  );
}
