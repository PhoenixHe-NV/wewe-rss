import { FC, useMemo, useState, useEffect } from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  getKeyValue,
  Button,
  Spinner,
  Link,
  Chip,
  Progress,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Input,
} from '@nextui-org/react';
import { trpc } from '@web/utils/trpc';
import dayjs from 'dayjs';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

interface CacheProgress {
  processed: number;
  total: number;
  inProgress: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  hasAccountError?: boolean;
  mpId?: string;
  mpName?: string;
}

const ArticleList: FC<{ id: string }> = ({ id }) => {
  const mpId = id || '';
  console.log('mpId', mpId);
  
  const [isCaching, setIsCaching] = useState(false);
  const [startDate, setStartDate] = useState<string>("2024-01-01");
  const [endDate, setEndDate] = useState<string>("2025-01-01");
  
  const [cacheProgress, setCacheProgress] = useState<CacheProgress>({
    processed: 0, 
    total: 0, 
    inProgress: false,
    isPaused: false,
    isCancelled: false,
    mpId: undefined,
    mpName: undefined
  });

  const { data, fetchNextPage, isLoading, hasNextPage, refetch: refetchArticles } =
    trpc.article.list.useInfiniteQuery(
      {
        limit: 20,
        mpId: mpId,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    );

  const { mutateAsync: startCaching } = trpc.article.cacheAll.useMutation();
  const { mutateAsync: togglePauseCaching } = trpc.article.togglePauseCaching.useMutation();
  const { mutateAsync: cancelCaching } = trpc.article.cancelCaching.useMutation();
  
  // Get the total count of uncached articles
  const { data: uncachedCountData, refetch: refetchUncachedCount } = trpc.article.getUncachedCount.useQuery(
    { mpId, startDate, endDate },
    { 
      enabled: !!mpId, // Only run the query if mpId is available
      refetchOnWindowFocus: true,
    }
  );
  
  // Always query for cache progress, not just when we're caching in this view
  const { data: progressData } = trpc.article.getCacheProgress.useQuery(
    { mpId },
    { 
      refetchInterval: 2000, // Polling every 2 seconds to check for active caching
    }
  );
  
  // Update progress and caching status when data changes
  useEffect(() => {
    if (progressData) {
      setCacheProgress({
        processed: progressData.processed,
        total: progressData.total,
        inProgress: progressData.inProgress,
        isPaused: progressData.isPaused,
        isCancelled: progressData.isCancelled,
        hasAccountError: progressData.hasAccountError,
        mpId: progressData.mpId,
        mpName: progressData.mpName
      });
      
      // Check for account error and show toast if needed
      if (progressData.hasAccountError) {
        toast.error('暂无可用读书账号!', {
          description: '系统暂时没有可用的读书账号，请稍后再试',
          id: 'no-available-account', // Use ID to prevent duplicate toasts
        });
      }
      
      // Set caching flag based on progress status
      if (progressData.inProgress && !isCaching) {
        setIsCaching(true);
      } else if (!progressData.inProgress && isCaching) {
        setIsCaching(false);
        // Refetch data instead of refreshing the whole page
        refetchArticles();
        refetchUncachedCount();
      }
    }
  }, [progressData, isCaching, refetchArticles, refetchUncachedCount]);

  // Remove the monitoring effect as we don't want to automatically show toast warnings

  const handleCacheAll = async () => {
    // Only allow caching if an mpId is specified
    if (!mpId) {
      console.error('Cannot cache articles: No specific media platform ID provided');
      toast?.error('请先选择一个特定的公众号，再进行缓存操作');
      return;
    }

    try {
      setIsCaching(true);
      console.log('Starting cache for mpId:', mpId, 'with date range:', { startDate, endDate });
      
      // Pass date filter parameters to the API
      const result = await startCaching({ 
        mpId, 
        startDate, 
        endDate 
      });
      
      setCacheProgress({
        processed: 0,
        total: result.total,
        inProgress: true,
        isPaused: false,
        isCancelled: false,
        mpId: mpId,
        mpName: undefined
      });
      
      // Show toast with date range information
      toast.success(`已开始缓存文章，时间范围: ${startDate} 至 ${endDate}`);
      
      // Refresh the uncached count after caching starts
      refetchUncachedCount();
    } catch (error: unknown) {
      console.error('Failed to start caching:', error);
      setIsCaching(false);
      toast.error('缓存失败，请重试');
    }
  };

  const handleTogglePause = async () => {
    // Get the current pause state for the toast message
    const currentlyPaused = cacheProgress.isPaused;
    
    try {
      console.log('Before toggle - Current isPaused state:', currentlyPaused);
      
      const result = await togglePauseCaching({ mpId });
      
      console.log('Server returned isPaused:', result.isPaused);
      
      // Update the local state immediately for better UI responsiveness
      setCacheProgress(prev => {
        const newState = {
          ...prev,
          isPaused: result.isPaused
        };
        console.log('Updated local state - isPaused:', newState.isPaused);
        return newState;
      });
      
      // Show toast based on the NEW state, not the previous state
      if (result.isPaused) {
        toast.success('缓存已暂停');
      } else {
        toast.success('缓存已恢复');
      }
    } catch (error) {
      console.error('Failed to toggle pause state:', error);
      toast.error('切换暂停状态失败');
    }
  };

  const handleCancelCaching = async () => {
    if (!cacheProgress.isPaused) {
      toast.error('只能在暂停状态下取消缓存');
      return;
    }
    
    try {
      const result = await cancelCaching({ mpId });
      
      if (result.success) {
        setCacheProgress(prev => ({
          ...prev,
          inProgress: false,
          isCancelled: true
        }));
        
        toast.success('缓存已取消');
        
        // Give a short delay before resetting the UI
        setTimeout(() => {
          setIsCaching(false);
          // Refetch data instead of refreshing the whole page
          refetchArticles();
          refetchUncachedCount();
        }, 1500);
      } else {
        toast.error('取消缓存失败');
      }
    } catch (error) {
      console.error('Failed to cancel caching:', error);
      toast.error('取消缓存失败');
    }
  };

  interface ArticleItem {
    id: string;
    title: string;
    publishTime: number;
    isCached: boolean;
  }
  
  const items = useMemo(() => {
    const items = data
      ? data.pages.reduce<ArticleItem[]>((acc, page) => [...acc, ...page.items], [])
      : [];

    return items;
  }, [data]);
  
  // Use the total count from the server for the uncached count
  const totalUncachedCount = useMemo(() => {
    return uncachedCountData?.count || 0;
  }, [uncachedCountData]);

  return (
    <div>
      
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">文章列表</h2>
        <div className="flex items-center gap-2">
          {isCaching && (
            <div className="flex items-center gap-3">
              {/* Account info & progress percentage */}
              <div className="flex flex-col">
                {cacheProgress.mpName ? (
                  <span className="text-sm">正在缓存: {cacheProgress.mpName}</span>
                ) : cacheProgress.mpId ? (
                  <span className="text-sm">正在缓存 ID: {cacheProgress.mpId}</span>
                ) : (
                  <span className="text-sm">缓存进度</span>
                )}
                <div className="flex items-center">
                  <span className="text-sm">进度: {cacheProgress.processed}/{cacheProgress.total}</span>
                  {cacheProgress.isPaused && (
                    <span className="text-xs text-warning ml-2">已暂停</span>
                  )}
                </div>
              </div>
              
              {/* Progress bar */}
              <div className="w-40">
                <Progress 
                  value={(cacheProgress.processed / cacheProgress.total) * 100} 
                  color={cacheProgress.isPaused ? "warning" : "success"}
                  size="sm"
                  isStriped={true}
                  isIndeterminate={cacheProgress.total === 0}
                  className="h-5"
                />
                <div className="flex justify-end mt-1">
                  <span className="text-xs">{Math.round((cacheProgress.processed / cacheProgress.total) * 100)}%</span>
                </div>
              </div>
              
              {/* Control buttons */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  color={cacheProgress.isPaused ? "success" : "warning"}
                  onPress={handleTogglePause}
                >
                  {cacheProgress.isPaused ? "恢复缓存" : "暂停缓存"}
                </Button>
                {cacheProgress.isPaused && (
                  <Button
                    size="sm"
                    color="danger"
                    onPress={handleCancelCaching}
                  >
                    取消缓存
                  </Button>
                )}
              </div>
            </div>
          )}
          {!isCaching && (
            <div className="flex items-center mr-4 gap-2">
              <div className="flex items-center">
                <Input
                  label="开始日期"
                  placeholder="YYYY-MM-DD"
                  type="date" 
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    // Refresh uncached count with new date range
                    refetchUncachedCount();
                  }}
                  className="w-40"
                  size="sm"
                />
              </div>
              <div className="flex items-center">
                <Input
                  label="结束日期"
                  placeholder="YYYY-MM-DD"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    // Refresh uncached count with new date range
                    refetchUncachedCount();
                  }}
                  className="w-40"
                  size="sm"
                />
              </div>
              <Button
                size="sm"
                variant="light"
                onPress={() => {
                  setStartDate("2024-01-01");
                  setEndDate("2025-01-01");
                  toast.info("已重置为默认日期范围");
                  refetchUncachedCount();
                }}
              >
                重置
              </Button>
            </div>
          )}
          <Button
            color="primary"
            onPress={handleCacheAll}
            isLoading={isCaching}
            isDisabled={isCaching || totalUncachedCount === 0}
          >
            缓存文章 {totalUncachedCount > 0 && `(${totalUncachedCount})`}
          </Button>
        </div>
      </div>
      
      <Table
        classNames={{
          base: 'h-full',
          table: 'min-h-[420px]',
        }}
        aria-label="文章列表"
        bottomContent={
          hasNextPage && !isLoading ? (
            <div className="flex w-full justify-center">
              <Button
                isDisabled={isLoading}
                variant="flat"
                onPress={() => {
                  fetchNextPage();
                }}
              >
                {isLoading && <Spinner color="white" size="sm" />}
                加载更多
              </Button>
            </div>
          ) : null
        }
      >
        <TableHeader>
          <TableColumn key="title">标题</TableColumn>
          <TableColumn width={180} key="publishTime">
            发布时间
          </TableColumn>
          <TableColumn width={100} key="isCached">缓存状态</TableColumn>
        </TableHeader>
        <TableBody
          isLoading={isLoading}
          emptyContent={'暂无数据'}
          items={items || []}
          loadingContent={<Spinner />}
        >
          {(item: ArticleItem) => (
            <TableRow key={item.id}>
              {(columnKey) => {
                let value = getKeyValue(item, columnKey);

                if (columnKey === 'publishTime') {
                  value = dayjs(value * 1e3).format('YYYY-MM-DD HH:mm:ss');
                  return <TableCell>{value}</TableCell>;
                }

                if (columnKey === 'isCached') {
                  return (
                    <TableCell>
                      {value ? (
                        <Chip color="success" size="sm">已缓存</Chip>
                      ) : (
                        <Chip color="default" size="sm">未缓存</Chip>
                      )}
                    </TableCell>
                  );
                }

                if (columnKey === 'title') {
                  return (
                    <TableCell>
                      <Link
                        className="visited:text-neutral-400"
                        isBlock
                        showAnchorIcon
                        color="foreground"
                        target="_blank"
                        href={`https://mp.weixin.qq.com/s/${item.id}`}
                      >
                        {value}
                      </Link>
                    </TableCell>
                  );
                }
                return <TableCell>{value}</TableCell>;
              }}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default ArticleList;
