/**
 * Access token có bị thu hồi không? `sessionsRevokedAt` (khoá tài khoản, đặt lại mật khẩu, đăng xuất mọi thiết bị) là mốc:
 * token cấp TRƯỚC mốc đó chết ngay. Dùng chung cho guard HTTP (JwtStrategy) và WebSocket (RealtimeGateway).
 *
 * Ưu tiên `iatMs` (chính xác tới ms, claim do server ký); token cũ chỉ có `iat` theo giây → coi như cấp ở cuối giây đó,
 * nên token cấp cùng giây với mốc thu hồi vẫn hợp lệ. Thiếu cả hai → coi như đã bị thu hồi (fail-closed).
 */
export function isSessionRevoked(
  token: { iat?: number; iatMs?: number },
  sessionsRevokedAt: Date | null | undefined,
): boolean {
  if (!sessionsRevokedAt) return false;
  const issuedMs = token.iatMs ?? (token.iat ?? 0) * 1000 + 999;
  return issuedMs < sessionsRevokedAt.getTime();
}
