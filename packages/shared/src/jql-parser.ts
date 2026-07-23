/**
 * JQL parser tối giản: chuỗi → JqlQueryAst. Dùng chung BE (compile→Prisma) và FE (validate/autocomplete).
 * Recursive descent: OR < AND < NOT < primary. Hỗ trợ () nhóm, IN/NOT IN, IS/IS NOT EMPTY,
 * currentUser(), ORDER BY field [ASC|DESC] (, ...).
 */
import {
  JQL_FIELDS,
  JQL_FUNCTIONS,
  type JqlFieldName,
  type JqlFunctionName,
  type JqlNode,
  type JqlOperator,
  type JqlOrderBy,
  type JqlQueryAst,
  type JqlValue,
  type RelativeDateUnit,
} from './jql';

export class JqlParseError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
    this.name = 'JqlParseError';
  }
}

type TokKind = 'str' | 'num' | 'word' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';
interface Token {
  kind: TokKind;
  value: string;
  pos: number;
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IN', 'IS', 'ORDER', 'BY', 'ASC', 'DESC', 'EMPTY']);
const OP_CHARS = new Set(['=', '!', '<', '>', '~']);

function tokenize(input: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let buf = '';
      while (i < n && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < n) {
          i++;
          buf += input[i];
        } else {
          buf += input[i];
        }
        i++;
      }
      if (i >= n) throw new JqlParseError('Thiếu dấu nháy đóng', start);
      i++; // skip closing quote
      toks.push({ kind: 'str', value: buf, pos: start });
      continue;
    }
    if (c === '(') {
      toks.push({ kind: 'lparen', value: '(', pos: i++ });
      continue;
    }
    if (c === ')') {
      toks.push({ kind: 'rparen', value: ')', pos: i++ });
      continue;
    }
    if (c === ',') {
      toks.push({ kind: 'comma', value: ',', pos: i++ });
      continue;
    }
    if (OP_CHARS.has(c)) {
      const start = i;
      let op = c;
      i++;
      if (i < n && input[i] === '=') {
        op += '=';
        i++;
      } else if (op === '!' && i < n && input[i] === '~') {
        op += '~';
        i++;
      }
      toks.push({ kind: 'op', value: op, pos: start });
      continue;
    }
    // bareword: chữ/số/._-+:@
    const start = i;
    let buf = '';
    while (i < n && !/[\s(),=<>!~]/.test(input[i])) {
      buf += input[i];
      i++;
    }
    if (!buf) throw new JqlParseError(`Ký tự không hợp lệ: ${c}`, i);
    const upper = buf.toUpperCase();
    if (/^-?\d+(\.\d+)?$/.test(buf)) toks.push({ kind: 'num', value: buf, pos: start });
    else if (KEYWORDS.has(upper)) toks.push({ kind: 'word', value: upper, pos: start });
    else toks.push({ kind: 'word', value: buf, pos: start });
  }
  toks.push({ kind: 'eof', value: '', pos: n });
  return toks;
}

class Parser {
  private p = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token {
    return this.toks[this.p];
  }
  private next(): Token {
    return this.toks[this.p++];
  }
  private isKw(v: string): boolean {
    const t = this.peek();
    return t.kind === 'word' && t.value === v;
  }
  private eat(kind: TokKind, msg: string): Token {
    const t = this.peek();
    if (t.kind !== kind) throw new JqlParseError(msg, t.pos);
    return this.next();
  }

  parse(): JqlQueryAst {
    let where: JqlNode | null = null;
    if (!this.isKw('ORDER') && this.peek().kind !== 'eof') {
      where = this.parseOr();
    }
    const orderBy = this.parseOrderBy();
    if (this.peek().kind !== 'eof') {
      throw new JqlParseError(`Token thừa: "${this.peek().value}"`, this.peek().pos);
    }
    return { where, orderBy };
  }

  private parseOr(): JqlNode {
    let left = this.parseAnd();
    while (this.isKw('OR')) {
      this.next();
      const right = this.parseAnd();
      left = { type: 'logical', op: 'OR', left, right };
    }
    return left;
  }

  private parseAnd(): JqlNode {
    let left = this.parseUnary();
    while (this.isKw('AND')) {
      this.next();
      const right = this.parseUnary();
      left = { type: 'logical', op: 'AND', left, right };
    }
    return left;
  }

  private parseUnary(): JqlNode {
    if (this.isKw('NOT')) {
      // NOT (...) — phủ định nhóm. ("field NOT IN" xử lý trong parseComparison)
      const save = this.p;
      this.next();
      if (this.peek().kind === 'lparen') {
        const node = this.parseUnary();
        return { type: 'not', node };
      }
      this.p = save; // backtrack: NOT thuộc về comparison (NOT IN)
    }
    return this.parsePrimary();
  }

  private parsePrimary(): JqlNode {
    if (this.peek().kind === 'lparen') {
      this.next();
      const node = this.parseOr();
      this.eat('rparen', 'Thiếu dấu ) đóng');
      return node;
    }
    return this.parseComparison();
  }

  private parseComparison(): JqlNode {
    const fieldTok = this.eat('word', 'Cần tên trường (field)');
    const field = this.resolveField(fieldTok.value, fieldTok.pos);
    const operator = this.parseOperator();
    const value = this.parseValue(operator);
    return { type: 'comparison', field, operator, value };
  }

  private resolveField(raw: string, pos: number): JqlFieldName {
    const key = (Object.keys(JQL_FIELDS) as JqlFieldName[]).find(
      (k) => k.toLowerCase() === raw.toLowerCase(),
    );
    if (!key) throw new JqlParseError(`Trường không hỗ trợ: "${raw}"`, pos);
    return key;
  }

  private parseOperator(): JqlOperator {
    const t = this.peek();
    if (t.kind === 'op') {
      this.next();
      return t.value as JqlOperator;
    }
    if (t.kind === 'word') {
      if (t.value === 'IN') {
        this.next();
        return 'IN';
      }
      if (t.value === 'NOT') {
        this.next();
        if (this.isKw('IN')) {
          this.next();
          return 'NOT IN';
        }
        throw new JqlParseError('Sau NOT phải là IN', t.pos);
      }
      if (t.value === 'IS') {
        this.next();
        if (this.isKw('NOT')) {
          this.next();
          return 'IS NOT';
        }
        return 'IS';
      }
    }
    throw new JqlParseError(`Cần toán tử sau trường, gặp "${t.value || t.kind}"`, t.pos);
  }

  private parseValue(op: JqlOperator): JqlValue {
    // IS / IS NOT → EMPTY
    if (op === 'IS' || op === 'IS NOT') {
      if (this.isKw('EMPTY')) {
        this.next();
        return { kind: 'empty' };
      }
      throw new JqlParseError('Sau IS / IS NOT phải là EMPTY', this.peek().pos);
    }
    // IN / NOT IN → danh sách
    if (op === 'IN' || op === 'NOT IN') {
      this.eat('lparen', 'IN cần danh sách trong ngoặc ( )');
      const items: JqlValue[] = [];
      if (this.peek().kind !== 'rparen') {
        items.push(this.parseScalar());
        while (this.peek().kind === 'comma') {
          this.next();
          items.push(this.parseScalar());
        }
      }
      this.eat('rparen', 'Thiếu ) đóng danh sách');
      return { kind: 'list', value: items };
    }
    return this.parseScalar();
  }

  private parseScalar(): JqlValue {
    const t = this.peek();
    if (t.kind === 'str') {
      this.next();
      return { kind: 'string', value: t.value };
    }
    if (t.kind === 'num') {
      this.next();
      return { kind: 'number', value: Number(t.value) };
    }
    if (t.kind === 'word') {
      this.next();
      const up = t.value.toUpperCase();
      if (up === 'TRUE') return { kind: 'bool', value: true };
      if (up === 'FALSE') return { kind: 'bool', value: false };
      if (up === 'EMPTY') return { kind: 'empty' };
      // Ngày tương đối: -7d, 30d, -1w, 2m, 1y (m = tháng).
      const rel = /^([+-]?\d+)([dwmy])$/i.exec(t.value);
      if (rel) {
        return { kind: 'relativeDate', amount: parseInt(rel[1], 10), unit: rel[2].toLowerCase() as RelativeDateUnit };
      }
      // Hàm: currentUser(), now(), startOfWeek()… (ngoặc tuỳ chọn).
      const fn = JQL_FUNCTIONS.find((f) => f.toLowerCase() === t.value.toLowerCase());
      if (fn) {
        if (this.peek().kind === 'lparen') {
          this.next();
          this.eat('rparen', `${fn}() cần ngoặc đóng`);
        }
        return { kind: 'function', name: fn as JqlFunctionName, args: [] };
      }
      return { kind: 'string', value: t.value };
    }
    throw new JqlParseError(`Giá trị không hợp lệ: "${t.value || t.kind}"`, t.pos);
  }

  private parseOrderBy(): JqlOrderBy[] {
    if (!this.isKw('ORDER')) return [];
    this.next();
    if (!this.isKw('BY')) throw new JqlParseError('ORDER phải đi cùng BY', this.peek().pos);
    this.next();
    const list: JqlOrderBy[] = [];
    do {
      const f = this.eat('word', 'Cần tên trường sau ORDER BY');
      const field = this.resolveField(f.value, f.pos);
      let direction: 'ASC' | 'DESC' = 'ASC';
      if (this.isKw('ASC')) this.next();
      else if (this.isKw('DESC')) {
        direction = 'DESC';
        this.next();
      }
      list.push({ field, direction });
      if (this.peek().kind === 'comma') {
        this.next();
        continue;
      }
      break;
    } while (true);
    return list;
  }
}

/** Parse chuỗi JQL → AST. Ném JqlParseError(message, position) nếu sai cú pháp. */
export function parseJql(input: string): JqlQueryAst {
  const trimmed = input.trim();
  if (!trimmed) return { where: null, orderBy: [] };
  return new Parser(tokenize(trimmed)).parse();
}
