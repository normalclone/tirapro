import type { PointsRollup } from '@/lib/epic';

export interface PointsCell {
  text: string;
  title: string;
  strong: boolean;
}

/**
 * Nội dung ô "Điểm" của một dòng Cây việc. Dòng có con và các việc bên trong có điểm → "đã xong/tổng" cộng dồn, CHỈ đếm
 * việc lá (điểm của việc cha chính là tổng điểm việc con nên không cộng thêm; chỉ nhắc trong tooltip); ngược lại rơi về
 * điểm riêng của chính dòng.
 */
export function pointsCell(own: number | null, rollup: PointsRollup | null): PointsCell {
  if (rollup && rollup.totalPoints > 0) {
    const ownNote =
      own != null
        ? ` Điểm của việc này (${own}) là tổng điểm việc con — tổng chỉ đếm việc lá.`
        : '';
    return {
      text: `${rollup.donePoints}/${rollup.totalPoints}`,
      strong: true,
      title: `Điểm các việc lá bên trong: ${rollup.donePoints} đã xong / ${rollup.totalPoints} tổng (${rollup.count} việc).${ownNote}`,
    };
  }
  return own != null
    ? { text: String(own), strong: true, title: `${own} điểm ước lượng` }
    : { text: '—', strong: false, title: 'Chưa có điểm' };
}
