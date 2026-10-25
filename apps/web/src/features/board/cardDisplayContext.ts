import { createContext } from 'react';
import { DEFAULT_CARD_DISPLAY, type CardDisplay } from './cardDisplay';

/**
 * Tuỳ chọn hiển thị thẻ của người dùng cho bảng hiện tại. Đi qua context (không qua prop của `Card`/`Column`) để `memo`
 * của thẻ không phải biết tới nó: giá trị chỉ đổi khi người dùng đổi tuỳ chọn, nên thẻ chỉ vẽ lại lúc đó.
 * Ngoài provider (DragOverlay riêng lẻ, test) = mặc định = giao diện cũ.
 */
export const CardDisplayContext = createContext<CardDisplay>(DEFAULT_CARD_DISPLAY);
