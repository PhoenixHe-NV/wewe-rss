import { Controller, Post, Body, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { TrpcRouter } from '@server/trpc/trpc.router';
import { Response } from 'express';

interface ImportArticleCacheDto {
  mp_name: string;
  mp_signature?: string;
  mp_img_link?: string;
  article_title: string;
  article_publish_time: number | string;
  article_url: string;
  article_content: string;
}

@Controller('api/import')
export class ImportController {
  constructor(
    private readonly trpcRouter: TrpcRouter,
    private readonly configService: ConfigService,
  ) {}

  @Post('article-cache')
  async importArticleCache(
    @Body() body: ImportArticleCacheDto,
    @Res() res: Response,
  ) {
    try {
      // Check authorization
      const authCode =
        this.configService.get<ConfigurationType['auth']>('auth')?.code;
      const authHeader = res.req.headers.authorization;

      if (authCode && authHeader !== authCode) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Unauthorized',
          message: 'Invalid authorization code',
        });
      }

      // Validate required fields
      const {
        mp_name,
        article_title,
        article_publish_time,
        article_url,
        article_content,
      } = body;

      if (
        !mp_name ||
        !article_title ||
        !article_publish_time ||
        !article_url ||
        !article_content
      ) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Missing required fields',
          message:
            'mp_name, article_title, article_publish_time, article_url, and article_content are required',
        });
      }

      // Convert article_publish_time to number if it's a string
      let publishTimeNumber: number;
      if (typeof article_publish_time === 'string') {
        try {
          const date = new Date(article_publish_time);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date format');
          }
          publishTimeNumber = Math.floor(date.getTime() / 1000);
        } catch (error) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            success: false,
            error: 'Invalid date format',
            message: `Invalid article_publish_time format: ${article_publish_time}. Expected Unix timestamp (number) or date string like "2024-03-11 18:01"`,
          });
        }
      } else {
        publishTimeNumber = article_publish_time;
      }

      // Call the tRPC mutation directly
      const result = await this.trpcRouter.articleRouter.importArticleCache({
        input: {
          mp_name,
          mp_signature: body.mp_signature || '',
          mp_img_link: body.mp_img_link || '',
          article_title,
          article_publish_time: publishTimeNumber,
          article_url,
          article_content,
        },
        ctx: { errorMsg: null }, // Mock context since we're calling directly
        type: 'mutation',
        path: 'article.importArticleCache',
        rawInput: body,
      });

      return res.status(HttpStatus.OK).json(result);
    } catch (error: any) {
      console.error('Error importing article cache:', error);

      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: error.message || 'Failed to import article cache',
      });
    }
  }
}
