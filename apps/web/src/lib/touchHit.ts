/**
 * Vùng bấm cho cảm ứng (`pointer: coarse`): điều khiển nhỏ trên dòng/thanh công cụ được mở rộng vùng bấm lên ≥ 44px bằng
 * pseudo-element (không đổi kích thước hiển thị, desktop giữ nguyên). Phần tử phải `relative` (đã có trong chuỗi).
 *
 * Quy tắc để vùng mở rộng không đè lên điều khiển kề (bộ đo `mobile:audit` kiểm `touch-overlap`):
 *  - `TOUCH_HIT`: mở cả 4 phía 13px — chỉ cho điều khiển 20px cách xa láng giềng ≥ 13px (chấm ưu tiên, chip điểm).
 *  - `CHIP_TOUCH_HIT`: chip cao 28px (`h-7`, viền 1px) chỉ mở THEO CHIỀU DỌC 8px ngoài viền (-9px tính từ mép đệm) → 44px; khung `flex-wrap` chứa chip phải có
 *    `gap-y ≥ 16px` trên cảm ứng (`CHIP_ROW_GAP_COARSE`, xem bên dưới) và, nếu là dải cuộn ngang (overflow cắt phần tràn), phải có `py-2` trên cảm ứng (`CHIP_STRIP_COARSE_PAD`).
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

/**
 * Công tắc (switch) 20px: mở vùng bấm THEO CHIỀU DỌC 12px mỗi phía (→ 44px), không mở ngang. Hàng chứa công tắc phải
 * cao ≥ 44px trên cảm ứng (`min-h-11`) để vùng của hai công tắc xếp dọc không chồng nhau.
 */
export const SWITCH_TOUCH_HIT =
  'relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:inset-x-0 [@media(pointer:coarse)]:after:-inset-y-3';

/**
 * Khoảng cách dọc giữa các hàng chip (`CHIP_TOUCH_HIT`) trên cảm ứng: mỗi chip mở 8px lên/xuống → hai hàng liền nhau
 * cần bước hàng ≥ 44px = 28 + 16, tức `gap-y` ≥ 16px (8px chỉ vừa đủ để vùng bấm không đè lên HỘP của hàng kề, còn hai
 * VÙNG BẤM vẫn chồng 8px). Đặt trên mọi khung `flex-wrap` chứa chip.
 */
export const CHIP_ROW_GAP_COARSE = '[@media(pointer:coarse)]:gap-y-4';
