import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function initials(name: string): string {
  // Bỏ đoạn trong ngoặc (vd "Dũng (Dev)" → "Dũng"), chỉ lấy token bắt đầu bằng chữ/số
  // → tránh initials rác kiểu "D(" khi tên có hậu tố vai trò/ghi chú.
  const tokens = name
    .replace(/[([{].*?[)\]}]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const picked = (tokens.length ? tokens : name.trim().split(/\s+/)).slice(0, 2);
  return picked.map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}
