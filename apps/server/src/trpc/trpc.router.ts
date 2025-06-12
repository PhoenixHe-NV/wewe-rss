import { INestApplication, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { TrpcService } from '@server/trpc/trpc.service';
import * as trpcExpress from '@trpc/server/adapters/express';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '@server/prisma/prisma.service';
import { statusMap } from '@server/constants';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';

@Injectable()
export class TrpcRouter {
  constructor(
    private readonly trpcService: TrpcService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private readonly logger = new Logger(this.constructor.name);

  accountRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor } = input;

        const items = await this.prismaService.account.findMany({
          take: limit + 1,
          where: {},
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            token: false,
          },
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
          orderBy: {
            createdAt: 'asc',
          },
        });
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        const disabledAccounts = this.trpcService.getBlockedAccountIds();
        return {
          blocks: disabledAccounts,
          items,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const account = await this.prismaService.account.findUnique({
          where: { id },
        });
        if (!account) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No account with id '${id}'`,
          });
        }
        return account;
      }),
    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string().min(1).max(32),
          token: z.string().min(1),
          name: z.string().min(1),
          status: z.number().default(statusMap.ENABLE),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const account = await this.prismaService.account.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });
        this.trpcService.removeBlockedAccount(id);

        return account;
      }),
    edit: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          data: z.object({
            token: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            status: z.number().optional(),
          }),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, data } = input;
        const account = await this.prismaService.account.update({
          where: { id },
          data,
        });
        this.trpcService.removeBlockedAccount(id);
        return account;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.account.delete({ where: { id } });
        this.trpcService.removeBlockedAccount(id);

        return id;
      }),
  });

  feedRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor } = input;

        const items = await this.prismaService.feed.findMany({
          take: limit + 1,
          where: {},
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
          orderBy: {
            createdAt: 'asc',
          },
        });
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        return {
          items: items,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const feed = await this.prismaService.feed.findUnique({
          where: { id },
        });
        if (!feed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No feed with id '${id}'`,
          });
        }
        return feed;
      }),
    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          mpName: z.string(),
          mpCover: z.string(),
          mpIntro: z.string(),
          syncTime: z
            .number()
            .optional()
            .default(Math.floor(Date.now() / 1e3)),
          updateTime: z.number(),
          status: z.number().default(statusMap.ENABLE),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const feed = await this.prismaService.feed.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });

        return feed;
      }),
    edit: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          data: z.object({
            mpName: z.string().optional(),
            mpCover: z.string().optional(),
            mpIntro: z.string().optional(),
            syncTime: z.number().optional(),
            updateTime: z.number().optional(),
            status: z.number().optional(),
          }),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, data } = input;
        const feed = await this.prismaService.feed.update({
          where: { id },
          data,
        });
        return feed;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.feed.delete({ where: { id } });
        return id;
      }),

    refreshArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().optional(),
        }),
      )
      .mutation(async ({ input: { mpId } }) => {
        if (mpId) {
          await this.trpcService.refreshMpArticlesAndUpdateFeed(mpId);
        } else {
          await this.trpcService.refreshAllMpArticlesAndUpdateFeed();
        }
      }),

    isRefreshAllMpArticlesRunning: this.trpcService.protectedProcedure.query(
      async () => {
        return this.trpcService.isRefreshAllMpArticlesRunning;
      },
    ),
    getHistoryArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().optional(),
          limit_start_date: z.string().optional(),
        }),
      )
      .mutation(async ({ input: { mpId = '', limit_start_date = '' } }) => {
        this.trpcService.getHistoryMpArticles(mpId, limit_start_date ? new Date(limit_start_date) : undefined);
      }),
    getInProgressHistoryMp: this.trpcService.protectedProcedure.query(
      async () => {
        return this.trpcService.inProgressHistoryMp;
      },
    ),
  });

  articleRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
          mpId: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor, mpId } = input;

        const items = await this.prismaService.article.findMany({
          orderBy: [
            {
              publishTime: 'desc',
            },
          ],
          take: limit + 1,
          where: mpId ? { mpId } : undefined,
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
          include: {
            cache: true,
          },
        });
        
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        // Transform the items to include isCached property
        const transformedItems = items.map(item => ({
          ...item,
          isCached: item.cache !== null,
          cache: undefined, // Remove the cache object from the response
        }));

        return {
          items: transformedItems,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const article = await this.prismaService.article.findUnique({
          where: { id },
        });
        if (!article) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No article with id '${id}'`,
          });
        }
        return article;
      }),

    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          mpId: z.string(),
          title: z.string(),
          picUrl: z.string().optional().default(''),
          publishTime: z.number(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const article = await this.prismaService.article.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });

        return article;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.article.delete({ where: { id } });
        return id;
      }),
    
    cacheAll: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().nullish(),
        }),
      )
      .mutation(async ({ input }) => {
        const { mpId } = input;
        
        // Get all uncached articles
        const articles = await this.prismaService.article.findMany({
          where: {
            mpId: mpId ? { equals: mpId } : undefined,
            cache: null, // Only get articles without cache
          },
          select: {
            id: true,
          },
          orderBy: {
            publishTime: 'desc', // Order by publish time descending (newest first)
          },
        });
        
        const totalCount = articles.length;
        let processedCount = 0;
        
        this.logger.log(`Starting caching process for ${totalCount} articles${mpId ? ` for mpId: ${mpId}` : ''}`);
        
        // Get MP name if mpId is provided
        let mpNameValue: string | undefined = undefined;
        if (mpId) {
          try {
            const feed = await this.prismaService.feed.findUnique({
              where: { id: mpId },
              select: { mpName: true }
            });
            if (feed && feed.mpName) {
              mpNameValue = String(feed.mpName);
            }
          } catch (error) {
            this.logger.error(`Error fetching MP name for ${mpId}:`, error);
          }
        }
        
        // Create a map to store progress
        const progressMap = new Map<string, { 
          total: number; 
          processed: number; 
          inProgress: boolean;
          isPaused: boolean;
          isCancelled: boolean;
          mpId?: string;
          mpName?: string;
        }>();
        const progressKey = mpId || 'all';
        
        progressMap.set(progressKey, {
          total: totalCount,
          processed: 0,
          inProgress: true,
          isPaused: false,
          isCancelled: false,
          mpId: mpId || 'ALL',
          mpName: mpNameValue
        });
        
        // Store the progress map in a global variable
        // @ts-ignore
        global.cacheProgressMap = progressMap;
        
        // Start the caching process in the background
        (async () => {
          try {
            for (const article of articles) {
              try {
                // Check if the process has been paused, and if so, wait until unpaused
                // @ts-ignore
                const currentProgressMap: Map<string, any> = global.cacheProgressMap || new Map();
                const currentProgress = currentProgressMap.get(progressKey);
                
                // Check if the process has been cancelled
                if (currentProgress && currentProgress.isCancelled) {
                  this.logger.log(`Caching for ${progressKey} has been cancelled`);
                  
                  // Update the progress to mark as not in progress
                  currentProgress.inProgress = false;
                  currentProgressMap.set(progressKey, currentProgress);
                  
                  // @ts-ignore
                  global.cacheProgressMap = currentProgressMap;
                  
                  // Exit the function
                  this.logger.log(`Caching process cancelled for ${progressKey} after processing ${processedCount}/${totalCount} articles`);
                  return;
                }
                
                if (currentProgress && currentProgress.isPaused) {
                  // If paused, check every second if it's still paused
                  while (true) {
                    // Get the latest progress data
                    // @ts-ignore
                    const latestProgressMap: Map<string, any> = global.cacheProgressMap || new Map();
                    const latestProgress = latestProgressMap.get(progressKey);
                    
                    // Check for cancellation
                    if (latestProgress && latestProgress.isCancelled) {
                      this.logger.log(`Caching for ${progressKey} has been cancelled while paused`);
                      
                      // Update the progress to mark as not in progress
                      latestProgress.inProgress = false;
                      latestProgressMap.set(progressKey, latestProgress);
                      
                      // @ts-ignore
                      global.cacheProgressMap = latestProgressMap;
                      
                      // Exit the function
                      this.logger.log(`Caching process cancelled for ${progressKey} after processing ${processedCount}/${totalCount} articles`);
                      return;
                    }
                    
                    // If no longer paused or no longer in progress, break the loop
                    if (!latestProgress || !latestProgress.isPaused || !latestProgress.inProgress) {
                      break;
                    }
                    
                    // Wait for 1 second before checking again
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  }
                  
                  // After the pause loop, check if we should still continue
                  // @ts-ignore
                  const finalProgressMap: Map<string, any> = global.cacheProgressMap || new Map();
                  const finalProgress = finalProgressMap.get(progressKey);
                  
                  // If no longer in progress, exit the function
                  if (!finalProgress || !finalProgress.inProgress) {
                    this.logger.log(`Caching process stopped for ${progressKey} after processing ${processedCount}/${totalCount} articles`);
                    return;
                  }
                }
                
                const url = `https://mp.weixin.qq.com/s/${article.id}`;
                
                // Log the start of caching for this article
                this.logger.log(`[${processedCount + 1}/${totalCount}] Caching article: ${article.id}`);
                
                // Use the new fetchHtmlContent method
                const content = await this.fetchHtmlContent(url).catch((e) => {
                  this.logger.error(`[${processedCount + 1}/${totalCount}] Error fetching HTML from ${url}: ${e.message}`);
                  return '获取全文失败，请重试~';
                });
                
                // Save to cache
                await this.prismaService.articleCache.create({
                  data: {
                    articleId: article.id,
                    content,
                  },
                }).catch((e) => {
                  this.logger.error(`[${processedCount + 1}/${totalCount}] Failed to cache article ${article.id}: ${e.message}`);
                });
                
                processedCount++;
                
                // Log successful caching
                this.logger.log(`[${processedCount}/${totalCount}] Successfully cached article: ${article.id} (${Math.round((processedCount / totalCount) * 100)}% complete)`);
                
                // Update progress
                const progress = progressMap.get(progressKey);
                if (progress) {
                  progress.processed = processedCount;
                  progressMap.set(progressKey, progress);
                }
                
                // Sleep a bit to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (error: any) {
                this.logger.error(`[${processedCount + 1}/${totalCount}] Error caching article ${article.id}: ${error.message}`);
                this.logger.error(`Stack trace: ${error.stack}`);
              }
            }

            // Log completion of caching process
            this.logger.log(`Caching process completed for ${progressKey}. Total processed: ${processedCount}/${totalCount} articles`);
            
            // Update the progress to mark as completed
            // @ts-ignore
            const finalProgressMap: Map<string, any> = global.cacheProgressMap || new Map();
            const finalProgress = finalProgressMap.get(progressKey);
            
            if (finalProgress) {
              finalProgress.inProgress = false;
              finalProgressMap.set(progressKey, finalProgress);
              
              // @ts-ignore
              global.cacheProgressMap = finalProgressMap;
            }
          } catch (error: any) {
            this.logger.error(`Fatal error in caching process for ${progressKey}: ${error.message}`);
            this.logger.error(`Stack trace: ${error.stack}`);
            
            // Update the progress to mark as failed in case of error
            // @ts-ignore
            const errorProgressMap: Map<string, any> = global.cacheProgressMap || new Map();
            const errorProgress = errorProgressMap.get(progressKey);
            
            if (errorProgress) {
              errorProgress.inProgress = false;
              errorProgressMap.set(progressKey, errorProgress);
              
              // @ts-ignore
              global.cacheProgressMap = errorProgressMap;
            }
          } finally {
            // This block will run regardless of whether the process completed normally,
            // was cancelled, or encountered an error
            this.logger.log(`Caching process for ${progressKey} finished processing ${processedCount}/${totalCount} articles`);
          }
        })();
        
        return { total: totalCount };
      }),
      
    getCacheProgress: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const { mpId } = input;
        const progressKey = mpId || 'all';
        
        // @ts-ignore
        const progressMap: Map<string, { 
          total: number; 
          processed: number; 
          inProgress: boolean;
          isPaused: boolean;
          isCancelled: boolean;
          mpId?: string;
          mpName?: string;
        }> = global.cacheProgressMap || new Map();
        
        // First try to get progress for the specific mpId
        let progress = progressMap.get(progressKey);
        
        // If no progress for specific mpId and it's not 'all', check if there's any active caching
        if (!progress || (!progress.inProgress && mpId && mpId !== 'all')) {
          // Find any active caching process
          for (const [key, value] of progressMap.entries()) {
            if (value.inProgress) {
              progress = value;
              break;
            }
          }
        }
        
        // If still no progress, return default empty state
        if (!progress) {
          progress = {
            total: 0,
            processed: 0,
            inProgress: false,
            isPaused: false,
            isCancelled: false
          };
        }
        
        return progress;
      }),
      
    togglePauseCaching: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().nullish(),
        }),
      )
      .mutation(async ({ input }) => {
        const { mpId } = input;
        const progressKey = mpId || 'all';
        
        try {
          // @ts-ignore
          const progressMap: Map<string, any> = global.cacheProgressMap || new Map();
          
          // Get current progress
          const progress = progressMap.get(progressKey);
          
          this.logger.log(`Toggle pause request for ${progressKey}`);
          
          if (progress && progress.inProgress) {
            // Get current pause state for logging
            const wasPaused = progress.isPaused;
            
            this.logger.log(`Current pause state before toggle: ${wasPaused}`);
            
            // Toggle the pause state
            progress.isPaused = !wasPaused;
            progressMap.set(progressKey, progress);
            
            // @ts-ignore
            global.cacheProgressMap = progressMap;
            
            const newPauseState = progress.isPaused;
            this.logger.log(`Caching for ${progressKey} is now ${newPauseState ? 'paused' : 'resumed'}`);
            
            return {
              isPaused: newPauseState
            };
          }
          
          this.logger.log(`No active caching process found for ${progressKey}`);
          return {
            isPaused: false
          };
        } catch (error: any) {
          this.logger.error(`Error toggling pause state for ${progressKey}: ${error.message}`);
          this.logger.error(`Stack trace: ${error.stack}`);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to toggle pause state: ${error.message}`
          });
        }
      }),
    cancelCaching: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().nullish(),
        }),
      )
      .mutation(async ({ input }) => {
        const { mpId } = input;
        const progressKey = mpId || 'all';
        
        // @ts-ignore
        const progressMap: Map<string, any> = global.cacheProgressMap || new Map();
        
        // Get current progress
        const progress = progressMap.get(progressKey);
        
        if (progress && progress.inProgress) {
          // Set the cancelled flag
          progress.isCancelled = true;
          
          // If not paused, also set inProgress to false immediately
          if (!progress.isPaused) {
            progress.inProgress = false;
          }
          
          progressMap.set(progressKey, progress);
          
          // @ts-ignore
          global.cacheProgressMap = progressMap;
          
          this.logger.log(`Caching for ${progressKey} has been cancelled`);
          
          return { success: true };
        }
        
        return { success: false };
      }),
    getUncachedCount: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string(),
        }),
      )
      .query(async ({ input }) => {
        const { mpId } = input;
        
        // Get count of all uncached articles for this MP
        const count = await this.prismaService.article.count({
          where: {
            mpId,
            cache: null, // Only count articles without cache
          },
        });
        
        this.logger.log(`Total uncached articles for mpId ${mpId}: ${count}`);
        
        return { count };
      }),
  });

  platformRouter = this.trpcService.router({
    getMpArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string(),
        }),
      )
      .mutation(async ({ input: { mpId } }) => {
        try {
          const results = await this.trpcService.getMpArticles(mpId);
          return results;
        } catch (err: any) {
          this.logger.log('getMpArticles err: ', err);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: err.response?.data?.message || err.message,
            cause: err.stack,
          });
        }
      }),
    getMpInfo: this.trpcService.protectedProcedure
      .input(
        z.object({
          wxsLink: z
            .string()
            .refine((v) => v.startsWith('https://mp.weixin.qq.com/s/')),
        }),
      )
      .mutation(async ({ input: { wxsLink: url } }) => {
        try {
          const results = await this.trpcService.getMpInfo(url);
          return results;
        } catch (err: any) {
          this.logger.log('getMpInfo err: ', err);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: err.response?.data?.message || err.message,
            cause: err.stack,
          });
        }
      }),

    createLoginUrl: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.createLoginUrl();
    }),
    getLoginResult: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
        }),
      )
      .query(async ({ input }) => {
        return this.trpcService.getLoginResult(input.id);
      }),
  });

  appRouter = this.trpcService.router({
    feed: this.feedRouter,
    account: this.accountRouter,
    article: this.articleRouter,
    platform: this.platformRouter,
  });

  async applyMiddleware(app: INestApplication) {
    app.use(
      `/trpc`,
      trpcExpress.createExpressMiddleware({
        router: this.appRouter,
        createContext: ({ req }) => {
          const authCode =
            this.configService.get<ConfigurationType['auth']>('auth')!.code;

          if (authCode && req.headers.authorization !== authCode) {
            return {
              errorMsg: 'authCode不正确！',
            };
          }
          return {
            errorMsg: null,
          };
        },
        middleware: (req, res, next) => {
          next();
        },
      }),
    );
  }

  // Add this new method for fetching HTML content
  private async fetchHtmlContent(url: string, retryCount = 3): Promise<string> {
    try {
      // Get an available account to use for this request
      try {
        // Try to get an account from trpcService
        const account = await this.trpcService['getAvailableAccount']();
        this.logger.log(`Using account ${account.name} (${account.id}) for fetching ${url}`);
        
        // Use Got with authentication headers
        const got = (await import('got')).default;
        const enableCleanHtml = this.configService.get<any>('feed')?.enableCleanHtml;
        
        // Make the request with authentication headers
        const html = await got(url, { 
          responseType: 'text',
          headers: {
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
          }
        }).text();
        
        if (enableCleanHtml) {
          // Basic HTML cleaning if needed
          return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        }
        
        return html;
      } catch (accountError: any) {
        // If we can't get an account, fall back to unauthenticated request
        this.logger.warn(`Failed to get available account: ${accountError.message}. Falling back to unauthenticated request.`);
        
        const got = (await import('got')).default;
        const enableCleanHtml = this.configService.get<any>('feed')?.enableCleanHtml;
        const html = await got(url, { responseType: 'text' }).text();
        
        if (enableCleanHtml) {
          return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        }
        
        return html;
      }
    } catch (error: any) {
      this.logger.error(`Error fetching HTML from ${url}: ${error.message}`);
      
      // Implement retry logic with different accounts
      if (retryCount > 0) {
        this.logger.log(`Retrying fetchHtmlContent for ${url}, ${retryCount} attempts left`);
        
        // If there's an API error, mark the current account as blocked before retrying
        if (error.response?.statusCode === 401 || error.response?.statusCode === 403) {
          this.logger.warn(`Account unauthorized for ${url}, will try another account`);
          // The trpcService will automatically avoid blocked accounts on next call
        }
        
        // Wait a moment before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Retry with a different account
        return this.fetchHtmlContent(url, retryCount - 1);
      }
      
      throw error;
    }
  }
}

export type AppRouter = TrpcRouter[`appRouter`];
