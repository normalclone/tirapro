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
  useWorkspaceMembers,
  type CreateMemberAccountResult,
} from './api';
import { PASSWORD_POLICY_HINT, passwordPolicyError } from './passwordPolicy';
import { useWorkspaceRoleChoice } from './useWorkspaceRoleChoice';

/**
 * Thẻ "Thêm thành viên" — MỘT hộp: chọn người có sẵn trong hệ thống (pool chung) HOẶC bấm
 * "Chưa có tài khoản? Tạo tài khoản mới" để tạo tài khoản + thêm cùng lúc.
 * Gated bằng `member:manage` — trùng với cách MembersPage kiểm tra quyền.
 */
export function AddMemberPanel() {
  const can = useAuth((s) => s.can);
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  // Email vừa nhập nhưng đã có tài khoản → chuyển về "chọn người có sẵn" với ô tìm điền sẵn email.
  const [prefillEmail, setPrefillEmail] = useState('');
  if (!can('member:manage')) return null;
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <UserPlus className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Thêm thành viên</h2>
          <p className="mt-0.5 text-sm text-muted">
            Chọn người có sẵn trong hệ thống hoặc tạo tài khoản mới.
          </p>
        </div>
      </div>
      {mode === 'pick' ? (
        <AddExistingUser
          prefillEmail={prefillEmail}
          onCreateNew={() => {
            setPrefillEmail('');
            setMode('create');
          }}
        />
      ) : (
        <CreateAccountForm
          onBack={() => setMode('pick')}
          onEmailExists={(email) => {
            setPrefillEmail(email);
            setMode('pick');
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chọn người dùng có sẵn                                              */
/* ------------------------------------------------------------------ */

type PoolUser = NonNullable<ReturnType<typeof useAllUsers>['data']>[number];

function AddExistingUser({
  prefillEmail,
  onCreateNew,
}: {
  prefillEmail: string;
  onCreateNew: () => void;
}) {
  // `search` chỉ dùng để tìm đúng người khi quay về từ "email đã tồn tại", rồi trả về rỗng để pool không bị đóng băng.
  const [search, setSearch] = useState(prefillEmail);
  const [userId, setUserId] = useState('');
  const [prefilledUser, setPrefilledUser] = useState<PoolUser | null>(null);

  const { data: members } = useWorkspaceMembers();
  const { data: users, isLoading: usersLoading } = useAllUsers(search);
  const addMember = useAddMember();
  const { roleOptions, effectiveRoleIds, setRoleIds, resetRoles } = useWorkspaceRoleChoice();

  // Loại người đã ở trong không gian làm việc khỏi pool.
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
          toast.success(`Đã thêm ${m.user.displayName} vào không gian làm việc`);
          reset();
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
      {prefillEmail && (
        <p className="rounded-md bg-primary-subtle px-3 py-2 text-sm text-ink" role="status">
          {prefillIsMember
            ? `${prefillEmail} đã là thành viên của không gian làm việc này.`
            : `${prefillEmail} đã có tài khoản — chọn người đó để thêm vào không gian làm việc.`}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Người dùng</span>
          <SearchSelect
            value={userId}
            onChange={setUserId}
            options={userSelectOptions}
            placeholder="Chọn người dùng…"
            searchPlaceholder="Tìm theo tên hoặc email…"
            ariaLabel="Chọn người để thêm vào không gian làm việc"
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
        Thêm vào không gian làm việc
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
/* Tạo tài khoản mới + thêm vào không gian làm việc                      */
/* ------------------------------------------------------------------ */

function CreateAccountForm({
  onBack,
  onEmailExists,
}: {
  onBack: () => void;
  onEmailExists: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState<CreateMemberAccountResult | null>(null);

  const { roleOptions, effectiveRoleIds, setRoleIds, resetRoles } = useWorkspaceRoleChoice();
  const create = useCreateMemberAccount();
  // Mật khẩu tạm không được nằm lại trong MutationCache sau khi rời form ("chỉ hiện một lần").
  const resetCreate = create.reset;
  useEffect(() => resetCreate, [resetCreate]);
  const passwordError = passwordPolicyError(password);
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
