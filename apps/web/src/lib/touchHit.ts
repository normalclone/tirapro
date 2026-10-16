/**
 * Vùng bấm cho cảm ứng (`pointer: coarse`): điều khiển nhỏ trên dòng/thanh công cụ được mở rộng vùng bấm lên ≥ 44px bằng
 * pseudo-element (không đổi kích thước hiển thị, desktop giữ nguyên). Phần tử phải `relative` (đã có trong chuỗi).
 *
 * Quy tắc để vùng mở rộng không đè lên điều khiển kề (bộ đo `mobile:audit` kiểm `touch-overlap`):
 *  - `TOUCH_HIT`: mở cả 4 phía 13px — chỉ cho điều khiển 20px cách xa láng giềng ≥ 13px (chấm ưu tiên, chip điểm).
 *  - `CHIP_TOUCH_HIT`: chip cao 28px (`h-7`, viền 1px) chỉ mở THEO CHIỀU DỌC 8px ngoài viền (-9px tính từ mép đệm) → 44px; hàng chứa chip phải có `gap-y ≥ 8px`
 *    và, nếu là dải cuộn ngang (overflow cắt phần tràn), phải có `py-2` trên cảm ứng (`CHIP_STRIP_COARSE_PAD`).
 */
export const TOUCH_HIT =
  'relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-[13px]';

export const CHIP_TOUCH_HIT =
  'relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:inset-x-0 [@media(pointer:coarse)]:after:-inset-y-[9px]';

/** Đệm dọc cho dải chip cuộn ngang (dưới `sm`) trên cảm ứng — chứa vùng bấm mở rộng của chip (overflow cắt phần tràn). */
export const CHIP_STRIP_COARSE_PAD = '[@media(pointer:coarse)]:max-sm:py-2';

/**
 * Liên kết chữ một dòng cao ~17px (mã công việc trên dòng/thẻ): mở vùng bấm THEO CHIỀU DỌC 6px mỗi phía (→ ~29px, đủ
 * chuẩn 28px), không mở ngang; cả dòng/thẻ chứa nó vốn đã bấm được nên không cần đủ 44px. Mở ít để không phủ lên điều khiển kề.
 */
export const LINK_TOUCH_HIT =
  'relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:inset-x-0 [@media(pointer:coarse)]:after:-inset-y-1.5';
