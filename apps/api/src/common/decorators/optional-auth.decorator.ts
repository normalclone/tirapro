import { SetMetadata } from '@nestjs/common';

export const OPTIONAL_AUTH_KEY = 'optionalAuth';
/** Dùng cùng @Public(): route vẫn công khai nhưng nếu có token hợp lệ thì `req.user` được gắn. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);
