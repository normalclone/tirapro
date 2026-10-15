import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { PasswordResetService } from './password-reset.service';
import { switchWorkspaceSchema, type SwitchWorkspaceInput } from './auth.schemas';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';

const REFRESH_COOKIE = 'tirapro_rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly passwordReset: PasswordResetService,
    private readonly config: ConfigService,
  ) {}

  private meta(req: Request) {
    return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
  }

  private setRefreshCookie(res: Response, token: string) {
    const days = 7;
    const isProd = !!this.config.get<boolean>('isProd');
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      // Production: web và API thường KHÁC domain (vd *.onrender.com) → cookie phải
      // SameSite=None + Secure thì trình duyệt mới gửi kèm khi gọi chéo site;
      // nếu để 'lax' thì /auth/refresh luôn 401 → reload là bị đăng xuất.
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: days * 24 * 60 * 60 * 1000,
    });
  }

  /** Xoá cookie phải khớp thuộc tính lúc set (secure/sameSite) thì trình duyệt mới chấp nhận. */
  private clearRefreshCookie(res: Response) {
    const isProd = !!this.config.get<boolean>('isProd');
    res.clearCookie(REFRESH_COOKIE, {
      path: '/',
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      httpOnly: true,
    });
  }

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.register(dto, this.meta(req));
    this.setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.login(dto, this.meta(req));
    this.setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
    // Chưa đăng nhập (không có cookie) là trạng thái bình thường, không phải lỗi: FE gọi refresh lúc mở trang
    // để dò phiên (cookie httpOnly nên JS không tự biết). Trả 200 + null để console không đỏ 401.
    // Cookie CÓ nhưng sai/hết hạn/bị thu hồi vẫn 401 (tín hiệu tái sử dụng token — không nới).
    if (!token) return { accessToken: null };
    // Access token cũ (có thể đã hết hạn) cho biết workspace đang làm việc — refresh phải giữ nguyên nó.
    const preferredWorkspaceId = this.tokens.workspaceFromExpiredAccess(req.headers.authorization);
    const { refreshToken, ...rest } = await this.auth.refresh(
      token,
      this.meta(req),
      preferredWorkspaceId,
    );
    // refreshToken = null khi đây là lượt refresh đồng thời (tab khác đã xoay) — giữ nguyên cookie hiện có.
    if (refreshToken) this.setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  /** Đăng xuất mọi thiết bị của chính mình (kể cả thiết bị này). */
  // Chỉ tác động lên tài khoản của chính người gọi (user.id từ token), không nhận id từ client.
  @AuthOnly()
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.logoutAll(user.id);
    this.clearRefreshCookie(res);
    return out;
  }

  // Tài khoản & danh sách workspace của chính người dùng; switchWorkspace tự kiểm tra thành viên trong service.
  @AuthOnly()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id, user.workspaceId);
  }

  /** Danh sách workspace user là thành viên. */
  // Tài khoản & danh sách workspace của chính người dùng; switchWorkspace tự kiểm tra thành viên trong service.
  @AuthOnly()
  @Get('workspaces')
  async workspaces(@CurrentUser() user: AuthUser) {
    return this.auth.listWorkspaces(user.id);
  }

  /** Chuyển workspace: cấp access token mới + xoay refresh cookie (giống login). */
  // Tài khoản & danh sách workspace của chính người dùng; switchWorkspace tự kiểm tra thành viên trong service.
  @AuthOnly()
  @HttpCode(200)
  @Post('switch-workspace')
  async switchWorkspace(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(switchWorkspaceSchema)) dto: SwitchWorkspaceInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.switchWorkspace(
      user.id,
      dto.workspaceId,
      this.meta(req),
    );
    this.setRefreshCookie(res, refreshToken);
    return rest;
  }

  /** Luôn trả `{ success: true }` dù email có tồn tại hay không (không lộ tài khoản). 5 lần / 15 phút / IP. */
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('forgot-password')
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordInput,
  ) {
    await this.passwordReset.requestReset(dto.email);
    return { success: true };
  }

  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('reset-password')
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordInput) {
    await this.passwordReset.resetPassword(dto);
    return { success: true };
  }
}
