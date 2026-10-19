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
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { PasswordResetService } from './password-reset.service';
import { switchWorkspaceSchema, type SwitchWorkspaceInput } from './auth.schemas';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './refresh-cookie';

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
    setRefreshCookie(res, token, !!this.config.get<boolean>('isProd'));
  }

  private clearRefreshCookie(res: Response) {
    clearRefreshCookie(res, !!this.config.get<boolean>('isProd'));
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
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { apiKey?: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    // API key là thông tin xác thực của tích hợp, không được dùng để đăng xuất mọi phiên web của chủ key.
    if (req.apiKey)
      throw new ForbiddenAppException(
        'Chỉ phiên đăng nhập của người dùng mới được đăng xuất mọi thiết bị',
      );
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
