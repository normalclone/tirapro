// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvatarUploader } from './AvatarUploader';

afterEach(cleanup);

describe('AvatarUploader — quyền (TIRA-BUG-24)', () => {
  it('disabled: nút "Tải ảnh lên" bị khoá, hiện hint quyền', () => {
    render(
      <AvatarUploader
        name="Dự án A"
        src={null}
        uploadFn={vi.fn()}
        disabled
        hint="Chỉ quản trị dự án mới đổi được ảnh dự án."
      />,
    );
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /Tải ảnh lên/ });
    expect(btn.disabled).toBe(true);
    expect(screen.getByText('Chỉ quản trị dự án mới đổi được ảnh dự án.')).toBeTruthy();
  });

  it('có quyền: nút "Tải ảnh lên" bấm được', () => {
    render(<AvatarUploader name="Dự án A" src={null} uploadFn={vi.fn()} />);
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /Tải ảnh lên/ });
    expect(btn.disabled).toBe(false);
  });
});
