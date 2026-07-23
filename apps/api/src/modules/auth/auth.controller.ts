import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AuthService } from './auth.service';
import {
  inviteMemberSchema,
  switchWorkspaceSchema,
  type InviteMemberInput,
  type SwitchWorkspaceInput,
} from './auth.schemas';

const REFRESH_COOKIE = 'tirapro_rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private meta(req: Request) {
    return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
  }

  private setRefreshCookie(res: Response, token: string) {
    const days = 7;
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: !!this.config.get<boolean>('isProd'),
      sameSite: 'lax',
      path: '/',
      maxAge: days * 24 * 60 * 60 * 1000,
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
    const token = (req.cookies?.[REFRESH_COOKIE] as string) ?? '';
    const { refreshToken, ...rest } = await this.auth.refresh(token, this.meta(req));
    this.setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id, user.workspaceId);
  }

  /** Danh sách workspace user là thành viên. */
  @Get('workspaces')
  async workspaces(@CurrentUser() user: AuthUser) {
    return this.auth.listWorkspaces(user.id);
  }

  /** Chuyển workspace: cấp access token mới + xoay refresh cookie (giống login). */
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

  /** Mời thành viên vào workspace hiện tại. Cần quyền quản trị workspace. */
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  @HttpCode(200)
  @Post('invite')
  async invite(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(inviteMemberSchema)) dto: InviteMemberInput,
  ) {
    return this.auth.invite(user.workspaceId, dto);
  }
}
