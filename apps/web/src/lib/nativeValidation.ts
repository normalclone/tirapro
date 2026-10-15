/**
 * Thông điệp validation HTML5 bằng tiếng Việt.
 * Bong bóng cảnh báo native ("Please fill out this field.") theo ngôn ngữ trình duyệt chứ không theo
 * `<html lang>`; bắt sự kiện `invalid` rồi `setCustomValidity` để đổi chữ mà vẫn giữ cơ chế
 * focus-vào-ô-lỗi của trình duyệt (không cần `noValidate`). Gọi `installViValidation()` một lần ở main.tsx.
 */

export type ValidityLike = Pick<
  ValidityState,
  | 'valueMissing'
  | 'typeMismatch'
  | 'tooShort'
  | 'tooLong'
  | 'rangeUnderflow'
  | 'rangeOverflow'
  | 'patternMismatch'
  | 'stepMismatch'
  | 'badInput'
>;

export interface ValidationContext {
  type: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
}

/** Trả thông điệp tiếng Việt; chuỗi rỗng = để trình duyệt tự xử lý. */
export function viValidationMessage(v: ValidityLike, ctx: ValidationContext): string {
  if (v.valueMissing) {
    if (ctx.type === 'select-one' || ctx.type === 'select-multiple' || ctx.type === 'radio') {
      return 'Vui lòng chọn một mục.';
    }
    if (ctx.type === 'checkbox') return 'Vui lòng tích ô này để tiếp tục.';
    return 'Vui lòng điền trường này.';
  }
  if (v.typeMismatch) {
    if (ctx.type === 'email') return 'Email chưa đúng định dạng (ví dụ: ten@congty.com).';
    if (ctx.type === 'url') return 'Địa chỉ web chưa đúng (bắt đầu bằng https://).';
    return 'Giá trị chưa hợp lệ.';
  }
  if (v.tooShort) return `Cần ít nhất ${ctx.minLength ?? ''} ký tự.`;
  if (v.tooLong) return `Tối đa ${ctx.maxLength ?? ''} ký tự.`;
  if (v.rangeUnderflow) return `Giá trị phải từ ${ctx.min ?? ''} trở lên.`;
  if (v.rangeOverflow) return `Giá trị không được lớn hơn ${ctx.max ?? ''}.`;
  if (v.badInput) return 'Hãy nhập một số.';
  if (v.stepMismatch) return 'Giá trị chưa hợp lệ.';
  if (v.patternMismatch) return 'Định dạng chưa đúng.';
  return '';
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isControl(t: EventTarget | null): t is FormControl {
  return !!t && typeof (t as FormControl).setCustomValidity === 'function';
}

/** Ô tự đặt `customValidity` (có `data-custom-validity`) — bộ dịch không được đè/xoá. */
function isSelfManaged(el: FormControl): boolean {
  return el.hasAttribute('data-custom-validity');
}

/**
 * Cài bộ dịch validation native cho toàn tài liệu. Trả hàm gỡ.
 * Ô mang thuộc tính `data-custom-validity` tự quản lý `setCustomValidity` (vd `DateInput`) nên bị bỏ qua hoàn toàn.
 * Thông điệp tuỳ biến được xoá khi người dùng sửa ô (`input`/`change`) và trước mỗi lần bấm nút gửi,
 * để ô không kẹt trạng thái lỗi cũ khi giá trị đổi bằng code.
 */
export function installViValidation(doc: Document = document): () => void {
  const onInvalid = (e: Event) => {
    const el = e.target;
    if (!isControl(el) || isSelfManaged(el)) return;
    el.setCustomValidity(''); // đo lại validity gốc
    const i = el as HTMLInputElement;
    const msg = viValidationMessage(el.validity, {
      type: el.type,
      minLength: i.minLength > 0 ? i.minLength : undefined,
      maxLength: i.maxLength > 0 ? i.maxLength : undefined,
      min: i.min || undefined,
      max: i.max || undefined,
    });
    if (msg) el.setCustomValidity(msg);
  };
  const clear = (e: Event) => {
    if (isControl(e.target) && !isSelfManaged(e.target)) e.target.setCustomValidity('');
  };
  const clearForm = (e: Event) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest<HTMLButtonElement | HTMLInputElement>(
      'button, input[type="submit"]',
    );
    if (!btn || btn.type !== 'submit') return;
    for (const c of Array.from(btn.form?.elements ?? [])) {
      if (isControl(c) && !isSelfManaged(c)) c.setCustomValidity('');
    }
  };
  doc.addEventListener('invalid', onInvalid, true);
  doc.addEventListener('input', clear, true);
  doc.addEventListener('change', clear, true);
  doc.addEventListener('click', clearForm, true);
  return () => {
    doc.removeEventListener('invalid', onInvalid, true);
    doc.removeEventListener('input', clear, true);
    doc.removeEventListener('change', clear, true);
    doc.removeEventListener('click', clearForm, true);
  };
}
