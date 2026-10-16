import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';

/** Chuột: rê quá `distance` px mới tính là kéo (bấm trơn vẫn mở việc). */
export const mouseActivation = (distance: number) => ({ distance });
/**
 * Cảm ứng: phải NHẤN GIỮ 250ms (rê lệch ≤ 8px) mới nhấc — vuốt dọc/ngang ngay từ dòng/thẻ vẫn cuộn trang.
 * Dòng/thẻ dùng `touch-action: manipulation` (không `none`) để trình duyệt vẫn cuộn.
 */
export const TOUCH_ACTIVATION = { delay: 250, tolerance: 8 } as const;

/** Cảm biến kéo-thả chuẩn: chuột + cảm ứng nhấn giữ + (tuỳ chọn) bàn phím. */
export function useDragSensors(opts: { distance: number; keyboard?: KeyboardCoordinateGetter }) {
  const mouse = useSensor(MouseSensor, { activationConstraint: mouseActivation(opts.distance) });
  const touch = useSensor(TouchSensor, { activationConstraint: TOUCH_ACTIVATION });
  const keyboard = useSensor(KeyboardSensor, { coordinateGetter: opts.keyboard });
  return useSensors(mouse, touch, ...(opts.keyboard ? [keyboard] : []));
}
