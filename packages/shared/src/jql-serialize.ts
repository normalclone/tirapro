/**
 * AST JQL → chuỗi JQL (ngược của `parseJql`) và các hàm thuần để tách/ghép mệnh đề AND ở gốc.
 * Dùng cho gợi ý "bỏ bớt điều kiện" (092): hiển thị từng mệnh đề + dựng lại JQL khi bỏ một mệnh đề — parser không
 * giữ vị trí ký tự nên không thể "cắt chuỗi". Bất biến: `parseJql(serializeJqlQuery(ast))` bằng đúng `ast`.
 */
import type { JqlNode, JqlQueryAst, JqlValue } from './jql';

/** Chuỗi có nháy kép; `\` và `"` được escape bằng `\` (tokenizer của parser bỏ `\` đứng trước ký tự kế tiếp). */
function quoteString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Số → chuỗi thập phân thường (không dạng khoa học `1e+21`, parser chỉ nhận `-?\d+(\.\d+)?`). */
function numberText(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n) && Math.abs(n) >= 1e21) return BigInt(n).toString();
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : s;
}

function serializeValue(v: JqlValue): string {
  switch (v.kind) {
    case 'string':
      // Luôn có nháy: giữ nguyên nghĩa chuỗi dù trùng từ khoá (AND, true, 7d, 12, now…).
      return quoteString(v.value);
    case 'number':
      return numberText(v.value);
    case 'bool':
      return v.value ? 'true' : 'false';
    case 'list':
      return `(${v.value.map(serializeValue).join(', ')})`;
    case 'function':
      return `${v.name}()`;
    case 'relativeDate':
      return `${v.amount}${v.unit}`;
    case 'empty':
      return 'EMPTY';
  }
}

/** Độ ưu tiên: OR < AND < (NOT, so sánh). */
const PREC = { OR: 1, AND: 2 } as const;

function ser(node: JqlNode, parentPrec: number, isRight: boolean): string {
  if (node.type === 'comparison') {
    return `${node.field} ${node.operator} ${serializeValue(node.value)}`;
  }
  if (node.type === 'not') {
    // Parser chỉ nhận NOT trước dấu ngoặc → luôn bọc.
    return `NOT (${ser(node.node, 0, false)})`;
  }
  const prec = PREC[node.op];
  const text = `${ser(node.left, prec, false)} ${node.op} ${ser(node.right, prec, true)}`;
  // Parser kết hợp TRÁI: vế phải cùng toán tử chỉ có thể do ngoặc tường minh → giữ ngoặc để cây không đổi.
  const needParens = prec < parentPrec || (prec === parentPrec && isRight);
  return needParens ? `(${text})` : text;
}

/** Một nút điều kiện → chuỗi JQL (không gồm ORDER BY). `parseJql(serializeJqlNode(n)).where` bằng `n`. */
export function serializeJqlNode(node: JqlNode): string {
  return ser(node, 0, false);
}

/** Cả truy vấn: điều kiện + `ORDER BY` (nếu có). Truy vấn rỗng → chuỗi rỗng. */
export function serializeJqlQuery(ast: JqlQueryAst): string {
  const where = ast.where ? serializeJqlNode(ast.where) : '';
  const order = ast.orderBy.length
    ? `ORDER BY ${ast.orderBy.map((o) => `${o.field} ${o.direction}`).join(', ')}`
    : '';
  return [where, order].filter(Boolean).join(' ');
}

/**
 * Các vế AND ở gốc theo thứ tự xuất hiện. Nhóm lồng (OR), NOT, hoặc OR ở gốc đếm là MỘT mệnh đề;
 * nhóm AND có ngoặc được làm phẳng (cùng nghĩa). `null` (JQL rỗng) → [].
 */
export function flattenAnd(where: JqlNode | null): JqlNode[] {
  if (!where) return [];
  const out: JqlNode[] = [];
  const walk = (n: JqlNode): void => {
    if (n.type === 'logical' && n.op === 'AND') {
      walk(n.left);
      walk(n.right);
    } else {
      out.push(n);
    }
  };
  walk(where);
  return out;
}

/** Nối các mệnh đề bằng AND (kết hợp trái, như parser). Rỗng → null; một mệnh đề → chính nó. */
export function andAll(nodes: readonly JqlNode[]): JqlNode | null {
  if (!nodes.length) return null;
  return nodes
    .slice(1)
    .reduce<JqlNode>((left, right) => ({ type: 'logical', op: 'AND', left, right }), nodes[0]!);
}
