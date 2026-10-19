import { useId, useState, type ChangeEvent, type CompositionEvent } from 'react';
import { Input } from '@/components/ui/Input';
import { matchesConfirmText, normalizeConfirmText } from '@/lib/confirmText';

/**
 * Trạng thái ô "gõ tên để xác nhận". `matches` = đã khớp (hoặc không bắt gõ). Đang gõ dở bằng bộ gõ (Telex/VNI —
 * `isComposing`) thì chưa tính khớp để chữ chưa chốt không mở khoá nút.
 */
export function useRequireText(expected?: string) {
  const [value, setValue] = useState('');
  const [composing, setComposing] = useState(false);
  const required = !!expected && normalizeConfirmText(expected) !== '';
  return {
    required,
    value,
    matches: !required || (!composing && matchesConfirmText(value, expected ?? '')),
    reset: () => {
      setValue('');
      setComposing(false);
    },
    bind: {
      value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => {
        setComposing(false);
        setValue(e.currentTarget.value);
      },
    },
  };
}

export type RequireTextState = ReturnType<typeof useRequireText>;

/** Nhãn nêu rõ chữ cần gõ + ô nhập (focus ngay khi hộp mở). Enter xác nhận khi đã khớp. */
export function RequireTextField({
  expected,
  text,
  onEnter,
}: {
  expected: string;
  text: RequireTextState;
  onEnter: () => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm text-ink">
        Gõ <strong className="break-all font-semibold text-ink-strong">{expected}</strong> để xác
        nhận
      </label>
      <Input
        id={id}
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        {...text.bind}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.matches) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </div>
  );
}
