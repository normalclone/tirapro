import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import type { AuthUser } from '../../../common/types/request';
import type { AccessTokenPayload } from '../token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret')!,
    });
  }

  /** Trả về AuthUser gắn vào req.user. Permissions resolve ở PermissionsGuard (không nhúng token). */
  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, displayName: true, isSystemAdmin: true, status: true },
    });
    if (!user || user.status === 'DEACTIVATED') {
      throw new UnauthorizedException('Tài khoản không hợp lệ');
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isSystemAdmin: user.isSystemAdmin,
      workspaceId: payload.workspaceId,
    };
  }
}
