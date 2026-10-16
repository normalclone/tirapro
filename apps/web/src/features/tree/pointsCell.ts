export interface PointsRollup {
  donePoints: number;
  totalPoints: number;
  count: number;
}

export interface PointsCell {
  text: string;
  title: string;
  strong: boolean;
}

/**
 * Nội dung ô "Điểm" của một dòng Cây việc. Dòng có con và các việc bên trong có điểm → "đã xong/tổng" cộng dồn
 * (điểm riêng của dòng không tính vào tổng, chỉ nhắc trong tooltip); ngược lại rơi về điểm riêng của chính dòng.
 */
export function pointsCell(own: number | null, rollup: PointsRollup | null): PointsCell {
  if (rollup && rollup.totalPoints > 0) {
    const ownNote =
      own != null ? ` Bản thân việc này: ${own} điểm (không tính vào tổng bên trong).` : '';
    return {
      text: `${rollup.donePoints}/${rollup.totalPoints}`,
      strong: true,
      title: `Điểm của các việc bên trong: ${rollup.donePoints} đã xong / ${rollup.totalPoints} tổng (${rollup.count} việc).${ownNote}`,
    };
  }
  return own != null
    ? { text: String(own), strong: true, title: `${own} điểm ước lượng` }
    : { text: '—', strong: false, title: 'Chưa có điểm' };
}
