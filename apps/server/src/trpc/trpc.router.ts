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
            mpName: 'asc', // Sort by mpName for pinyin order
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
        this.trpcService.getHistoryMpArticles(
          mpId,
          limit_start_date ? new Date(limit_start_date) : undefined,
        );
      }),
    getInProgressHistoryMp: this.trpcService.protectedProcedure.query(
      async () => {
        return this.trpcService.inProgressHistoryMp;
      },
    ),

    deleteAllArticlesByMpId: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string(),
        }),
      )
      .mutation(async ({ input }) => {
        const { mpId } = input;

        if (!mpId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'MpId is required',
          });
        }

        // 先找出要删除的文章数量以记录日志，但这里不需要使用
        await this.prismaService.article.count({
          where: { mpId },
        });

        // 首先删除所有相关联的缓存
        await this.prismaService.articleCache.deleteMany({
          where: {
            article: {
              mpId,
            },
          },
        });

        // 然后删除所有文章
        const result = await this.prismaService.article.deleteMany({
          where: { mpId },
        });

        this.logger.log(`Deleted ${result.count} articles for mpId: ${mpId}`);

        return {
          success: true,
          count: result.count,
          message: `成功删除 ${result.count} 篇文章`,
        };
      }),
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
        const transformedItems = items.map((item) => ({
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
          startDate: z.string().nullish(),
          endDate: z.string().nullish(),
        }),
      )
      .mutation(async ({ input }) => {
        // Set default date range if not provided
        const { mpId } = input;
        const startDate = input.startDate || '2024-01-01';
        const endDate = input.endDate || '2025-01-01';

        this.logger.log(
          `Caching articles with date range: ${startDate} to ${endDate}`,
        );

        // Get all uncached articles with date filtering (using defaults if not provided)
        const articles = await this.prismaService.article.findMany({
          where: {
            mpId: mpId ? { equals: mpId } : undefined,
            cache: null, // Only get articles without cache
            publishTime: {
              gte: Math.floor(new Date(startDate).getTime() / 1000),
              lte: Math.floor(new Date(endDate).getTime() / 1000),
            },
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

        this.logger.log(
          `Starting caching process for ${totalCount} articles${mpId ? ` for mpId: ${mpId}` : ''}`,
        );

        // Get MP name if mpId is provided
        let mpNameValue: string | undefined = undefined;
        if (mpId) {
          try {
            const feed = await this.prismaService.feed.findUnique({
              where: { id: mpId },
              select: { mpName: true },
            });
            if (feed && feed.mpName) {
              mpNameValue = String(feed.mpName);
            }
          } catch (error) {
            this.logger.error(`Error fetching MP name for ${mpId}:`, error);
          }
        }

        // Create a map to store progress
        const progressMap = new Map<
          string,
          {
            total: number;
            processed: number;
            inProgress: boolean;
            isPaused: boolean;
            isCancelled: boolean;
            hasAccountError?: boolean;
            mpId?: string;
            mpName?: string;
          }
        >();
        const progressKey = mpId || 'all';

        progressMap.set(progressKey, {
          total: totalCount,
          processed: 0,
          inProgress: true,
          isPaused: false,
          isCancelled: false,
          hasAccountError: false,
          mpId: mpId || 'ALL',
          mpName: mpNameValue,
        });

        // Store the progress map in a global variable
        global.cacheProgressMap = progressMap;

        // Start the caching process in the background
        (async () => {
          try {
            for (const article of articles) {
              try {
                // Check if the process has been paused, and if so, wait until unpaused
                const currentProgressMap: Map<string, any> =
                  global.cacheProgressMap || new Map();
                const currentProgress = currentProgressMap.get(progressKey);

                // Check if the process has been cancelled
                if (currentProgress && currentProgress.isCancelled) {
                  this.logger.log(
                    `Caching for ${progressKey} has been cancelled`,
                  );

                  // Update the progress to mark as not in progress
                  currentProgress.inProgress = false;
                  currentProgressMap.set(progressKey, currentProgress);

                  global.cacheProgressMap = currentProgressMap;

                  // Exit the function
                  this.logger.log(
                    `Caching process cancelled for ${progressKey} after processing ${processedCount}/${totalCount} articles`,
                  );
                  return;
                }

                if (currentProgress && currentProgress.isPaused) {
                  // If paused, check every second if it's still paused
                  while (true) {
                    // Get the latest progress data
                    const latestProgressMap: Map<string, any> =
                      global.cacheProgressMap || new Map();
                    const latestProgress = latestProgressMap.get(progressKey);

                    // Check for cancellation
                    if (latestProgress && latestProgress.isCancelled) {
                      this.logger.log(
                        `Caching for ${progressKey} has been cancelled while paused`,
                      );

                      // Update the progress to mark as not in progress
                      latestProgress.inProgress = false;
                      latestProgressMap.set(progressKey, latestProgress);

                      global.cacheProgressMap = latestProgressMap;

                      // Exit the function
                      this.logger.log(
                        `Caching process cancelled for ${progressKey} after processing ${processedCount}/${totalCount} articles`,
                      );
                      return;
                    }

                    // If no longer paused or no longer in progress, break the loop
                    if (
                      !latestProgress ||
                      !latestProgress.isPaused ||
                      !latestProgress.inProgress
                    ) {
                      break;
                    }

                    // Wait for 1 second before checking again
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                  }

                  // After the pause loop, check if we should still continue
                  const finalProgressMap: Map<string, any> =
                    global.cacheProgressMap || new Map();
                  const finalProgress = finalProgressMap.get(progressKey);

                  // If no longer in progress, exit the function
                  if (!finalProgress || !finalProgress.inProgress) {
                    this.logger.log(
                      `Caching process stopped for ${progressKey} after processing ${processedCount}/${totalCount} articles`,
                    );
                    return;
                  }
                }

                const url = `https://mp.weixin.qq.com/s/${article.id}`;

                // Log the start of caching for this article
                this.logger.log(
                  `[${processedCount + 1}/${totalCount}] Caching article: ${article.id}`,
                );

                // Use the new fetchHtmlContent method
                let content;
                try {
                  content = await this.fetchHtmlContent(url);
                } catch (e: any) {
                  this.logger.error(
                    `[${processedCount + 1}/${totalCount}] Error fetching HTML from ${url}: ${e.message}`,
                  );

                  // If this is the "暂无可用读书账号" error, log it but continue with unauthenticated requests
                  // We won't throw the error because fetchHtmlContent will already have fallen back to unauthenticated requests
                  if (e.message?.includes('暂无可用读书账号')) {
                    // Update the progress map to include information about account limitations
                    const progress = progressMap.get(progressKey);
                    if (progress) {
                      progress.hasAccountError = true;
                      progressMap.set(progressKey, progress);
                    }

                    this.logger.warn(
                      'No available accounts, continuing with unauthenticated requests',
                    );
                  }

                  content = '获取全文失败，请重试~';
                }

                // Save to cache
                await this.prismaService.articleCache
                  .create({
                    data: {
                      articleId: article.id,
                      content,
                    },
                  })
                  .catch((e) => {
                    this.logger.error(
                      `[${processedCount + 1}/${totalCount}] Failed to cache article ${article.id}: ${e.message}`,
                    );
                  });

                processedCount++;

                // Log successful caching
                this.logger.log(
                  `[${processedCount}/${totalCount}] Successfully cached article: ${article.id} (${Math.round((processedCount / totalCount) * 100)}% complete)`,
                );

                // Update progress
                const progress = progressMap.get(progressKey);
                if (progress) {
                  progress.processed = processedCount;
                  progressMap.set(progressKey, progress);
                }

                // Sleep a bit to avoid overwhelming the server
                await new Promise((resolve) => setTimeout(resolve, 1000));
              } catch (error: any) {
                this.logger.error(
                  `[${processedCount + 1}/${totalCount}] Error caching article ${article.id}: ${error.message}`,
                );
                this.logger.error(`Stack trace: ${error.stack}`);
              }
            }

            // Log completion of caching process
            this.logger.log(
              `Caching process completed for ${progressKey}. Total processed: ${processedCount}/${totalCount} articles`,
            );

            // Update the progress to mark as completed
            const finalProgressMap: Map<string, any> =
              global.cacheProgressMap || new Map();
            const finalProgress = finalProgressMap.get(progressKey);

            if (finalProgress) {
              finalProgress.inProgress = false;
              finalProgressMap.set(progressKey, finalProgress);

              global.cacheProgressMap = finalProgressMap;
            }
          } catch (error: any) {
            this.logger.error(
              `Fatal error in caching process for ${progressKey}: ${error.message}`,
            );
            this.logger.error(`Stack trace: ${error.stack}`);

            // Update the progress to mark as failed in case of error
            const errorProgressMap: Map<string, any> =
              global.cacheProgressMap || new Map();
            const errorProgress = errorProgressMap.get(progressKey);

            if (errorProgress) {
              errorProgress.inProgress = false;
              errorProgressMap.set(progressKey, errorProgress);

              global.cacheProgressMap = errorProgressMap;
            }
          } finally {
            // This block will run regardless of whether the process completed normally,
            // was cancelled, or encountered an error
            this.logger.log(
              `Caching process for ${progressKey} finished processing ${processedCount}/${totalCount} articles`,
            );
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

        const progressMap: Map<
          string,
          {
            total: number;
            processed: number;
            inProgress: boolean;
            isPaused: boolean;
            isCancelled: boolean;
            hasAccountError?: boolean;
            mpId?: string;
            mpName?: string;
          }
        > = global.cacheProgressMap || new Map();

        // First try to get progress for the specific mpId
        let progress = progressMap.get(progressKey);

        // If no progress for specific mpId and it's not 'all', check if there's any active caching
        if (!progress || (!progress.inProgress && mpId && mpId !== 'all')) {
          // Find any active caching process
          for (const [, value] of progressMap.entries()) {
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
            isCancelled: false,
            hasAccountError: false,
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
          const progressMap: Map<string, any> =
            global.cacheProgressMap || new Map();

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

            global.cacheProgressMap = progressMap;

            const newPauseState = progress.isPaused;
            this.logger.log(
              `Caching for ${progressKey} is now ${newPauseState ? 'paused' : 'resumed'}`,
            );

            return {
              isPaused: newPauseState,
            };
          }

          this.logger.log(`No active caching process found for ${progressKey}`);
          return {
            isPaused: false,
          };
        } catch (error: any) {
          this.logger.error(
            `Error toggling pause state for ${progressKey}: ${error.message}`,
          );
          this.logger.error(`Stack trace: ${error.stack}`);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to toggle pause state: ${error.message}`,
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

        const progressMap: Map<string, any> =
          global.cacheProgressMap || new Map();

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
          startDate: z.string().nullish(),
          endDate: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const { mpId } = input;
        const startDate = input.startDate || '2024-01-01';
        const endDate = input.endDate || '2025-01-01';

        // Convert dates to UNIX timestamps (seconds since epoch)
        const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
        const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);

        // Get count of all uncached articles for this MP within the date range
        const count = await this.prismaService.article.count({
          where: {
            mpId,
            cache: null, // Only count articles without cache
            publishTime: {
              gte: startTimestamp,
              lte: endTimestamp,
            },
          },
        });

        this.logger.log(
          `Total uncached articles for mpId ${mpId} from ${startDate} to ${endDate}: ${count}`,
        );

        return { count };
      }),

    getMonthlyHistogram: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string(),
        }),
      )
      .query(async ({ input }) => {
        const { mpId } = input;

        // Fetch all articles with cache information
        const articles = await this.prismaService.article.findMany({
          where: {
            mpId,
          },
          select: {
            id: true,
            publishTime: true,
            cache: {
              select: {
                id: true,
              },
            },
          },
        });

        // Process the data to create a histogram for both total articles and cached articles
        const monthlyHistogram = articles.reduce(
          (acc, article) => {
            const date = new Date(article.publishTime * 1000);
            const yearMonth = `${date.getFullYear()}-${String(
              date.getMonth() + 1,
            ).padStart(2, '0')}`;

            // Initialize if not exists
            if (!acc[yearMonth]) {
              acc[yearMonth] = {
                total: 0,
                cached: 0,
              };
            }

            // Increment total count
            acc[yearMonth].total++;

            // If article has cache, increment cached count
            if (article.cache) {
              acc[yearMonth].cached++;
            }

            return acc;
          },
          {} as Record<string, { total: number; cached: number }>,
        );

        // Convert to array and sort by year-month
        const result = Object.entries(monthlyHistogram)
          .map(([month, counts]) => ({
            month,
            count: counts.total,
            cachedCount: counts.cached,
          }))
          .sort((a, b) => a.month.localeCompare(b.month));

        return result;
      }),

    importArticleCache: this.trpcService.protectedProcedure
      .input(
        z.object({
          mp_name: z.string(),
          mp_signature: z.string().optional().default(''),
          mp_img_link: z.string().optional().default(''),
          article_title: z.string(),
          article_publish_time: z
            .union([z.number(), z.string()])
            .transform((val) => {
              // If it's already a number, return as is
              if (typeof val === 'number') {
                return val;
              }

              // If it's a string, try to parse it as a date
              try {
                const date = new Date(val);
                if (isNaN(date.getTime())) {
                  throw new Error('Invalid date format');
                }
                return Math.floor(date.getTime() / 1000); // Convert to Unix timestamp
              } catch (error) {
                throw new Error(
                  `Invalid date format: ${val}. Expected Unix timestamp (number) or date string like "2024-03-11 18:01"`,
                );
              }
            }),
          article_url: z.string(),
          article_content: z.string(),
        }),
      )
      .mutation(async ({ input }) => {
        const {
          mp_name,
          mp_signature,
          mp_img_link,
          article_title,
          article_publish_time,
          article_url,
          article_content,
        } = input;

        try {
          // Extract article ID from URL - support both formats:
          // 1. https://mp.weixin.qq.com/s/articleId
          // 2. http://mp.weixin.qq.com/s?__biz=...&sn=articleId&...
          let articleId: string;

          // First try the simple format
          const simpleMatch = article_url.match(/\/s\/([^/?]+)/);
          if (simpleMatch && simpleMatch[1]) {
            articleId = simpleMatch[1];
          } else {
            // Try the complex format with sn parameter
            const complexMatch = article_url.match(/[?&]sn=([^&]+)/);
            if (complexMatch && complexMatch[1]) {
              articleId = complexMatch[1];
            } else {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message:
                  'Invalid article URL format. Expected either "/s/articleId" or "?sn=articleId" format',
              });
            }
          }

          // Step 1: Check if feed exists by mp_name, if not create it
          let feed = await this.prismaService.feed.findFirst({
            where: { mpName: mp_name },
          });

          let feedId: string;
          if (!feed) {
            // Generate a feed ID (you might want to use a different strategy)
            feedId = `mp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            feed = await this.prismaService.feed.create({
              data: {
                id: feedId,
                mpName: mp_name,
                mpCover: mp_img_link || '',
                mpIntro: mp_signature || '',
                syncTime: Math.floor(Date.now() / 1000),
                updateTime: article_publish_time,
                status: statusMap.ENABLE,
              },
            });

            this.logger.log(`Created new feed: ${mp_name} (ID: ${feedId})`);
          } else {
            feedId = feed.id;
          }

          // Step 2: Check if article exists by title and feed
          let article = await this.prismaService.article.findFirst({
            where: {
              title: article_title,
              mpId: feedId,
            },
            include: { cache: true },
          });

          let articleCreated = false;
          if (!article) {
            // Create new article
            article = await this.prismaService.article.create({
              data: {
                id: articleId,
                mpId: feedId,
                title: article_title,
                picUrl: '', // You might want to extract this from content if needed
                publishTime: article_publish_time,
              },
              include: { cache: true },
            });
            articleCreated = true;
            this.logger.log(
              `Created new article: ${article_title} (ID: ${articleId})`,
            );
          }

          // Step 3: Handle caching
          let cacheAction = 'none';
          let contentMatches = false;

          if (!article.cache) {
            // No cache exists, create new cache
            await this.prismaService.articleCache.create({
              data: {
                articleId: article.id,
                content: article_content,
              },
            });
            cacheAction = 'created';
            this.logger.log(`Created cache for article: ${article.id}`);
          } else {
            // Cache exists, compare content
            contentMatches = article.cache.content === article_content;

            if (!contentMatches) {
              // Update existing cache with new content
              await this.prismaService.articleCache.update({
                where: { articleId: article.id },
                data: { content: article_content },
              });
              cacheAction = 'updated';
              this.logger.log(`Updated cache for article: ${article.id}`);
            } else {
              cacheAction = 'unchanged';
              this.logger.log(
                `Cache content matches for article: ${article.id}`,
              );
            }
          }

          return {
            success: true,
            data: {
              feedId,
              feedCreated: !feed || feed.id === feedId,
              articleId: article.id,
              articleCreated,
              cacheAction,
              contentMatches:
                cacheAction === 'unchanged' ? true : contentMatches,
            },
            message: `Successfully processed article: ${article_title}`,
          };
        } catch (error: any) {
          this.logger.error(`Error importing article cache: ${error.message}`);
          this.logger.error(`Stack trace: ${error.stack}`);

          // Check if it's a duplicate key error
          if (error.code === 'P2002') {
            return {
              success: false,
              error: 'Duplicate entry detected',
              message: `Article or feed already exists with conflicting data`,
            };
          }

          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to import article cache: ${error.message}`,
          });
        }
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
        this.logger.log(
          `Using account ${account.name} (${account.id}) for fetching ${url}`,
        );

        // Use Got with authentication headers
        const got = (await import('got')).default;
        const enableCleanHtml =
          this.configService.get<any>('feed')?.enableCleanHtml;

        // Make the request with authentication headers and browser-like headers
        const html = await got(url, {
          responseType: 'text',
          headers: {
            // Authentication headers
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
            // Browser-like headers to mimic real browser
            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language':
              'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,en-GB;q=0.6',
            'cache-control': 'max-age=0',
            dnt: '1',
            'upgrade-insecure-requests': '1',
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
            'sec-ch-ua':
              '"Microsoft Edge";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-user': '?1',
            priority: 'u=0, i',
          },
        }).text();

        // Check if the response contains error message indicating environment issues
        if (html.includes('当前环境异常')) {
          this.logger.warn(
            `Received "当前环境异常" error for ${url}, will retry after delay`,
          );

          // If we have retries left, wait and retry
          if (retryCount > 0) {
            this.logger.log(
              `Waiting 20 seconds before retry. ${retryCount} attempts left`,
            );
            // Wait 20 seconds before retrying as requested
            await new Promise((resolve) => setTimeout(resolve, 20000));
            return this.fetchHtmlContent(url, retryCount - 1);
          } else {
            throw new Error(
              'Failed after multiple retries due to environment issues: 当前环境异常',
            );
          }
        }

        if (enableCleanHtml) {
          // Basic HTML cleaning if needed
          return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        }

        return html;
      } catch (accountError: any) {
        // If the error message indicates no available accounts, log warning and fall back to unauthenticated request
        if (accountError.message?.includes('暂无可用读书账号')) {
          this.logger.warn(
            `Failed to get available account: ${accountError.message}. Falling back to unauthenticated request.`,
          );
        } else {
          // For other account errors, also fall back to unauthenticated request
          this.logger.warn(
            `Failed to get available account: ${accountError.message}. Falling back to unauthenticated request.`,
          );
        }

        const got = (await import('got')).default;
        const enableCleanHtml =
          this.configService.get<any>('feed')?.enableCleanHtml;
        const html = await got(url, {
          responseType: 'text',
          headers: {
            // Browser-like headers to mimic real browser
            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language':
              'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,en-GB;q=0.6',
            'cache-control': 'max-age=0',
            dnt: '1',
            'upgrade-insecure-requests': '1',
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
            'sec-ch-ua':
              '"Microsoft Edge";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-user': '?1',
            priority: 'u=0, i',
          },
        }).text();

        // Also check for environment issues in the unauthenticated request
        if (html.includes('当前环境异常')) {
          this.logger.warn(
            `Received "当前环境异常" error in unauthenticated request for ${url}, will retry after delay`,
          );

          if (retryCount > 0) {
            this.logger.log(
              `Waiting 20 seconds before retry. ${retryCount} attempts left`,
            );
            // Wait 20 seconds before retrying as requested
            await new Promise((resolve) => setTimeout(resolve, 20000));
            return this.fetchHtmlContent(url, retryCount - 1);
          } else {
            throw new Error(
              'Failed after multiple retries due to environment issues: 当前环境异常',
            );
          }
        }

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
        this.logger.log(
          `Retrying fetchHtmlContent for ${url}, ${retryCount} attempts left`,
        );

        // If there's an API error, mark the current account as blocked before retrying
        if (
          error.response?.statusCode === 401 ||
          error.response?.statusCode === 403
        ) {
          this.logger.warn(
            `Account unauthorized for ${url}, will try another account`,
          );
          // The trpcService will automatically avoid blocked accounts on next call
        }

        // Wait a moment before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Retry with a different account
        return this.fetchHtmlContent(url, retryCount - 1);
      }

      throw error;
    }
  }
}

export type AppRouter = TrpcRouter[`appRouter`];
