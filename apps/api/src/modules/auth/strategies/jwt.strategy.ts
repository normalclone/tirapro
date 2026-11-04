import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import type { AuthUser } from '../../../common/types/request';
import { claimedOrganizationId, type AccessTokenPayload } from '../token.service';
import { isSessionRevoked } from '../session-revocation';

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
      select: {
        id: true,
        email: true,
        displayName: true,
        isSystemAdmin: true,
        status: true,
        sessionsRevokedAt: true,
      },
    });
    if (!user || user.status === 'DEACTIVATED') {
      throw new UnauthorizedException('Tài khoản không hợp lệ');
    }
    // Phiên bị thu hồi (khoá, đặt lại mật khẩu, đăng xuất mọi thiết bị): token cấp TRƯỚC mốc đó chết ngay.
    if (isSessionRevoked(payload, user.sessionsRevokedAt)) {
      throw new UnauthorizedException('Phiên đăng nhập đã bị thu hồi — hãy đăng nhập lại');
    }
    // Kiểm tra membership MỖI request (PK lookup rẻ): token còn hạn nhưng đã bị gỡ khỏi
    // tổ chức thì không được tiếp tục dùng. System admin được miễn.
    const organizationId = claimedOrganizationId(payload);
    if (organizationId && !user.isSystemAdmin) {
      const membership = await this.prisma.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        select: { id: true },
      });
      if (!membership) {
        throw new UnauthorizedException(
          'Bạn không còn là thành viên của tổ chức này — hãy đăng nhập lại để chọn tổ chức khác',
        );
      }
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isSystemAdmin: user.isSystemAdmin,
      organizationId,
    };
  }
}
