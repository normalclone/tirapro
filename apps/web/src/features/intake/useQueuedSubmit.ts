import { useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * Gửi có xếp hàng: khi `waiting` (vd meta dự án chưa tải nên chưa biết mức nghiêm trọng mặc định) mà người dùng bấm
 * Gửi / ⌘Enter thì nhớ lại (`queued` → nút hiện trạng thái đang tải) và tự gửi ngay khi hết chờ. Form chưa hợp lệ thì bỏ qua.
 */
export function useQueuedSubmit({
  valid,
  waiting,
  submit,
}: {
  valid: boolean;
  waiting: boolean;
  submit: () => Promise<void>;
}) {
  const [queued, setQueued] = useState(false);
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!queued || waiting) return;
    setQueued(false);
    void submitRef.current();
  }, [queued, waiting]);
  const trySubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    if (waiting) setQueued(true);
    else void submit();
  };
  return { queued, trySubmit };
}
