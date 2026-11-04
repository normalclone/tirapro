/** Khung nhìn ban đầu của sơ đồ quy trình (hàm thuần): lấp chiều ngang, không nhỏ hơn mức còn đọc được nhãn. */
export interface FitInput {
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  /** Tỉ lệ lề theo mỗi cạnh (0.1 = 10%). */
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export function fitViewport({
  bounds,
  size,
  padding = 0.1,
  minZoom = 0.5,
  maxZoom = 1.25,
}: FitInput): Viewport | null {
  if (size.width <= 0 || size.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return null;
  const padX = size.width * padding;
  const padY = size.height * padding;
  const fit = Math.min(
    (size.width - 2 * padX) / bounds.width,
    (size.height - 2 * padY) / bounds.height,
  );
  const zoom = Math.max(minZoom, Math.min(maxZoom, fit));
  const w = bounds.width * zoom;
  const h = bounds.height * zoom;
  // Vừa khung thì canh giữa; rộng hơn mức cho phép thì bắt đầu từ mép trái (kéo để xem tiếp), không thu nhỏ thêm.
  const x =
    w <= size.width - 2 * padX ? (size.width - w) / 2 - bounds.x * zoom : padX - bounds.x * zoom;
  const y =
    h <= size.height - 2 * padY ? (size.height - h) / 2 - bounds.y * zoom : padY - bounds.y * zoom;
  return { x, y, zoom };
}
