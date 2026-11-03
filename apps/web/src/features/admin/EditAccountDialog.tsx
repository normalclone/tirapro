import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { useUpdateAdminUser, type AdminUser } from './api';
import { buildAccountPatch, validateAccountEdit } from './accountEdit';

/**
 * Sửa thông tin tài khoản (tên hiển thị, email đăng nhập) — admin hệ thống (logbug #31). Chỉ gửi trường thật sự đổi;
 * email trùng tài khoản khác hoặc không hợp lệ thì báo ngay tại ô, lỗi từ máy chủ hiện thành thông báo.
 */
export function EditAccountDialog({
  user,
  open,
  onClose,
}: {
  user: AdminUser;
  open: boolean;
  onClose: () => void;
}) {
  const update = useUpdateAdminUser();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName(user.displayName);
    setEmail(user.email);
    setTouched(false);
  }, [open, user.displayName, user.email]);

  const errors = validateAccountEdit({ displayName, email });
  const patch = buildAccountPatch(user, { displayName, email });

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (errors.displayName || errors.email) return;
    if (!patch) {
      onClose();
      return;
    }
    update.mutate(
      { id: user.id, patch },
      {
        onSuccess: () => {
          toast.success(`Đã cập nhật tài khoản ${displayName.trim()}`);
          onClose();
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Sửa tài khoản · ${user.displayName}`}
      size="md"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Tên hiển thị</span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            autoFocus
            aria-invalid={touched && errors.displayName ? true : undefined}
          />
          {touched && errors.displayName && (
            <p role="alert" className="text-xs text-danger">
              {errors.displayName}
            </p>
          )}
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Email đăng nhập</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={touched && errors.email ? true : undefined}
          />
          {touched && errors.email ? (
            <p role="alert" className="text-xs text-danger">
              {errors.email}
            </p>
          ) : (
            <p className="text-xs text-faint">
              Đổi email thì người dùng đăng nhập bằng email mới; mật khẩu giữ nguyên.
            </p>
          )}
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" size="sm" loading={update.isPending} disabled={!patch}>
            Lưu thay đổi
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
