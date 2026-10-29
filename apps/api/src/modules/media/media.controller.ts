import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Phục vụ ảnh đại diện — công khai (nhúng trực tiếp bằng URL ảnh, không gửi token được). */
  @Public()
  @Get('avatars/:file')
  async avatar(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, mimeType, size } = await this.media.serve(file);
    res.setHeader('Content-Type', mimeType);
    if (size !== undefined) res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Toàn cục là same-site; ảnh đại diện được nhúng từ web khác origin nên mở riêng cho route này.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(stream);
  }
}
