import {
  Avatar,
  Button,
  Divider,
  Listbox,
  ListboxItem,
  ListboxSection,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Textarea,
  Tooltip,
  useDisclosure,
  Link,
  Input,
  Progress,
} from '@nextui-org/react';
import { PlusIcon } from '@web/components/PlusIcon';
import { trpc } from '@web/utils/trpc';
import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { serverOriginUrl } from '@web/utils/env';
import ArticleList from './list';

// Constants for localStorage keys
const STORAGE_KEY_SELECTED_FEED = 'wewe-rss-selected-feed';

const Feeds = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  
  // Check both URL param, query param, and localStorage for feedId
  const queryFeedId = searchParams.get('feedId');
  
  // Function to get feedId from localStorage
  const getStoredFeedId = () => {
    try {
      const storedId = localStorage.getItem(STORAGE_KEY_SELECTED_FEED);
      console.log('Retrieved from localStorage:', storedId);
      return storedId || '';
    } catch (e) {
      console.error('Failed to read from localStorage:', e);
      return '';
    }
  };
  
  // Function to store feedId to localStorage
  const storeFeedId = (feedId: string) => {
    try {
      if (feedId) {
        localStorage.setItem(STORAGE_KEY_SELECTED_FEED, feedId);
        console.log('Stored to localStorage:', feedId);
      } else {
        localStorage.removeItem(STORAGE_KEY_SELECTED_FEED);
        console.log('Removed from localStorage');
      }
    } catch (e) {
      console.error('Failed to write to localStorage:', e);
    }
  };
  
  // Get feedId with priority: URL param > query param > localStorage > empty string
  const initialFeedId = id || queryFeedId || getStoredFeedId() || '';

  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
  const { refetch: refetchFeedList, data: feedData } = trpc.feed.list.useQuery(
    {},
    {
      refetchOnWindowFocus: true,
    },
  );

  const navigate = useNavigate();

  const queryUtils = trpc.useUtils();

  const { mutateAsync: getMpInfo, isLoading: isGetMpInfoLoading } =
    trpc.platform.getMpInfo.useMutation({});
  const { mutateAsync: updateMpInfo } = trpc.feed.edit.useMutation({});

  const { mutateAsync: addFeed, isLoading: isAddFeedLoading } =
    trpc.feed.add.useMutation({});
  const { mutateAsync: refreshMpArticles, isLoading: isGetArticlesLoading } =
    trpc.feed.refreshArticles.useMutation();
  const {
    mutateAsync: getHistoryArticles,
    isLoading: isGetHistoryArticlesLoading,
  } = trpc.feed.getHistoryArticles.useMutation();

  const { data: inProgressHistoryMp, refetch: refetchInProgressHistoryMp } =
    trpc.feed.getInProgressHistoryMp.useQuery(undefined, {
      refetchOnWindowFocus: true,
      refetchInterval: 10 * 1e3,
      refetchOnMount: true,
      refetchOnReconnect: true,
    });

  const { data: isRefreshAllMpArticlesRunning } =
    trpc.feed.isRefreshAllMpArticlesRunning.useQuery();

  const { mutateAsync: deleteFeed, isLoading: isDeleteFeedLoading } =
    trpc.feed.delete.useMutation({});

  const [wxsLink, setWxsLink] = useState('');

  const [currentMpId, setCurrentMpId] = useState(initialFeedId);

  const [limitStartDate, setLimitStartDate] = useState('2024-01-01');

  // State to track if history fetching is active in the UI
  const [isHistoryFetching, setIsHistoryFetching] = useState(false);
  
  // 添加一个布尔值标记，表示组件已经初始化完成
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Update the history fetching state when inProgressHistoryMp changes
  useEffect(() => {
    if (inProgressHistoryMp && inProgressHistoryMp.id) {
      setIsHistoryFetching(true);
    } else {
      setIsHistoryFetching(false);
    }
  }, [inProgressHistoryMp]);

  // 初始化 feed 选择和 URL 同步
  useEffect(() => {
    // 仅在feedData加载完成后执行初始化
    if (!isInitialized && feedData) {
      console.log("Initializing feed selection with data:", {
        initialFeedId,
        currentState: currentMpId,
        urlParam: id,
        queryParam: queryFeedId,
        localStorage: getStoredFeedId(),
        feedsLoaded: !!feedData
      });

      // 检查 initialFeedId 是否有效 (在feed列表中存在)
      const feedExists = initialFeedId ? 
        feedData.items?.some(item => item.id === initialFeedId) : 
        true; // 空字符串(全部)总是有效的
      
      if (feedExists) {
        // 如果feed存在且与当前状态不同，更新currentMpId
        if (initialFeedId !== currentMpId) {
          console.log(`Feed exists, updating from ${currentMpId} to ${initialFeedId}`);
          setCurrentMpId(initialFeedId);
        }
        
        // 确保URL与选择一致
        const targetUrl = initialFeedId ? 
          `/feeds?feedId=${initialFeedId}` : 
          '/feeds';
        
        // 只有当URL与目标URL不匹配时才更新
        const currentPath = window.location.pathname + window.location.search;
      
        // 检查当前路径是否已包含目标路径的关键部分
        if (!currentPath.includes(initialFeedId ? `feedId=${initialFeedId}` : '/feeds') || 
            (initialFeedId && currentPath.includes('feedId') && !currentPath.includes(`feedId=${initialFeedId}`))) {
          console.log(`URL mismatch, navigating to ${targetUrl}`);
          navigate(targetUrl, { replace: true });
        }
        
        // 确保localStorage同步
        storeFeedId(initialFeedId);
      } else {
        console.log(`Selected feed ${initialFeedId} not found in feed list, resetting selection`);
        // Feed不存在，清除选择
        setCurrentMpId('');
        storeFeedId('');
        navigate('/feeds', { replace: true });
      }
      
      setIsInitialized(true);
    }
  }, [feedData, initialFeedId, currentMpId, id, queryFeedId, navigate, isInitialized]);

  // Update currentMpId when URL parameters change and update URL
  // 只在初始化完成后才响应URL参数变化
  useEffect(() => {
    // 如果还没初始化完成，跳过这个effect
    if (!isInitialized) {
      return;
    }
    
    const idFromParams = id || searchParams.get('feedId') || '';
    
    if (idFromParams !== currentMpId) {
      console.log(`URL params changed: Updating currentMpId from ${currentMpId} to ${idFromParams}`);
      setCurrentMpId(idFromParams);
      
      // Save to localStorage using storeFeedId helper
      storeFeedId(idFromParams);
      
      // When the feedId comes from the query parameter, update the URL structure
      // to be consistent with direct navigation, but avoid unnecessary updates
      if (!id && idFromParams && window.location.pathname === '/dash/feeds' && !window.location.search.includes(`feedId=${idFromParams}`)) {
        // Only update if we need to - avoid infinite loops
        console.log(`Updating URL to include feedId=${idFromParams}`);
        navigate(`/feeds?feedId=${idFromParams}`, { replace: true });
      }
    }
  }, [id, searchParams, currentMpId, navigate, isInitialized]);

  const handleConfirm = async () => {
    console.log('wxsLink', wxsLink);
    // TODO show operation in progress
    const wxsLinks = wxsLink.split('\n').filter((link) => link.trim() !== '');
    for (const link of wxsLinks) {
      console.log('add wxsLink', link);
      const res = await getMpInfo({ wxsLink: link });
      if (res[0]) {
        const item = res[0];
        await addFeed({
          id: item.id,
          mpName: item.name,
          mpCover: item.cover,
          mpIntro: item.intro,
          updateTime: item.updateTime,
          status: 1,
        });
        await refreshMpArticles({ mpId: item.id });
        toast.success('添加成功', {
          description: `公众号 ${item.name}`,
        });
        await queryUtils.article.list.reset();
      } else {
        toast.error('添加失败', { description: '请检查链接是否正确' });
      }
    }
    refetchFeedList();
    setWxsLink('');
    onClose();
  };

  const isActive = (key: string) => {
    return currentMpId === key;
  };

  const currentMpInfo = useMemo(() => {
    return feedData?.items.find((item) => item.id === currentMpId);
  }, [currentMpId, feedData?.items]);

  const handleExportOpml = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!feedData?.items?.length) {
      console.warn('没有订阅源');
      return;
    }

    let opmlContent = `<?xml version="1.0" encoding="UTF-8"?>
    <opml version="2.0">
      <head>
        <title>WeWeRSS 所有订阅源</title>
      </head>
      <body>
    `;

    feedData?.items.forEach((sub) => {
      opmlContent += `    <outline text="${sub.mpName}" type="rss" xmlUrl="${window.location.origin}/feeds/${sub.id}.atom" htmlUrl="${window.location.origin}/feeds/${sub.id}.atom"/>\n`;
    });

    opmlContent += `    </body>
    </opml>`;

    const blob = new Blob([opmlContent], { type: 'text/xml;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'WeWeRSS-All.opml';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handler for fetching or stopping history articles
  const handleHistoryArticles = async (mpId: string) => {
    try {
      if (inProgressHistoryMp?.id === mpId) {
        // Stop fetching
        await getHistoryArticles({
          mpId: '',
          limit_start_date: limitStartDate || undefined,
        });
        toast.success('已停止获取历史文章');
      } else {
        // Start fetching
        await getHistoryArticles({
          mpId: mpId,
          limit_start_date: limitStartDate || undefined,
        });
        toast.success('开始获取历史文章');
      }
      
      await refetchInProgressHistoryMp();
    } catch (error) {
      console.error('Failed to handle history articles:', error);
      toast.error('获取历史文章操作失败');
    }
  };

  // 对feeds按拼音排序，数字和字母排前面，模拟Excel顺序
  const sortedFeedItems = useMemo(() => {
    if (!feedData?.items) return [];
    const sorted = [...feedData.items];
    const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'accent' });

    // 判断首字符类型
    function getType(str: string) {
      if (!str) return 3; // 兜底
      const first = str.trim()[0];
      if (/^[0-9]/.test(first)) return 0; // 数字
      if (/^[A-Za-z]/.test(first)) return 1; // 字母
      return 2; // 其他（中文等）
    }

    sorted.sort((a, b) => {
      const typeA = getType(a.mpName);
      const typeB = getType(b.mpName);
      if (typeA !== typeB) return typeA - typeB;
      // 同类型再按拼音
      return collator.compare(a.mpName, b.mpName);
    });
    return sorted;
  }, [feedData?.items]);

  // Add ref for the listbox container for auto-scrolling
  const listboxContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to selected feed item when:
    // 1. Component is initialized
    // 2. Feed data is loaded
    // 3. Current feed selection changes
    if (isInitialized && feedData && listboxContainerRef.current) {
      console.log("Attempting to scroll to selected feed:", currentMpId);
      
      // Give a slight delay to ensure DOM is fully rendered
      setTimeout(() => {
        // Find the selected feed item by its ID
        const feedItemId = currentMpId ? `feed-item-${currentMpId}` : 'feed-item-all';
        const selectedElement = document.getElementById(feedItemId);
        
        if (selectedElement && listboxContainerRef.current) {
          console.log("Found element, scrolling to:", feedItemId);
          
          // Use scrollIntoView with smooth scrolling
          selectedElement.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }
      }, 100);
    }
  }, [currentMpId, isInitialized, feedData]);

  return (
    <>
      <div className="h-full flex justify-between">
        <div className="w-64 p-4 h-full">
          <div className="pb-4 flex justify-between align-middle items-center">
            <Button
              color="primary"
              size="sm"
              onPress={onOpen}
              endContent={<PlusIcon />}
            >
              添加
            </Button>
            <div className="font-normal text-sm">
              共{feedData?.items.length || 0}个订阅
            </div>
          </div>

          {feedData?.items ? (
            <Listbox
              aria-label="订阅源"
              emptyContent="暂无订阅"
              onAction={(key) => {
                const feedId = key as string;
                console.log(`Listbox onAction: Selecting feed "${feedId}"`);
                
                // Set currentMpId first
                setCurrentMpId(feedId);
                
                // Update localStorage
                storeFeedId(feedId);
                
                // Then update URL with the selected feedId (navigate triggers the URL change useEffect)
                const targetUrl = feedId ? `/feeds?feedId=${feedId}` : '/feeds';
                console.log(`Navigating to ${targetUrl}`);
                navigate(targetUrl, { replace: true });
              }}
              ref={listboxContainerRef}
            >
              <ListboxSection showDivider>
                <ListboxItem
                  key={''}
                  // href={`/feeds`}
                  className={isActive('') ? 'bg-primary-50 text-primary' : ''}
                  startContent={<Avatar name="ALL"></Avatar>}
                  id="feed-item-all"
                >
                  全部
                </ListboxItem>
              </ListboxSection>

              <ListboxSection className="overflow-y-auto h-[calc(100vh-260px)]">
                {sortedFeedItems.map((item) => {
                  return (
                    <ListboxItem
                      // href={`/feeds/${item.id}`}
                      className={
                        isActive(item.id) ? 'bg-primary-50 text-primary' : ''
                      }
                      key={item.id}
                      startContent={<Avatar src={item.mpCover}></Avatar>}
                      // 移除onSelect，因为onAction已经处理了这个逻辑
                      id={`feed-item-${item.id}`}
                    >
                      {item.mpName}
                    </ListboxItem>
                  );
                }) || []}
              </ListboxSection>
            </Listbox>
          ) : (
            ''
          )}
        </div>
        <div className="flex-1 h-full flex flex-col">
          <div className="p-4 pb-0 flex justify-between">
            <h3 className="text-medium font-mono flex-1 overflow-hidden text-ellipsis break-keep text-nowrap pr-1">
              {currentMpInfo?.mpName || '全部'}
            </h3>
            {currentMpInfo ? (
              <div className="flex h-5 items-center space-x-4 text-small">
                <div className="font-light">
                  最后更新时间:
                  {dayjs(currentMpInfo.syncTime * 1e3).format(
                    'YYYY-MM-DD HH:mm:ss',
                  )}
                </div>
                <Divider orientation="vertical" />
                <Tooltip
                  content="频繁调用可能会导致一段时间内不可用"
                  color="danger"
                >
                  <Link
                    size="sm"
                    href="#"
                    isDisabled={isGetArticlesLoading}
                    onClick={async (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      await refreshMpArticles({ mpId: currentMpInfo.id });
                      await refetchFeedList();
                      await queryUtils.article.list.reset();
                    }}
                  >
                    {isGetArticlesLoading ? '更新中...' : '立即更新'}
                  </Link>
                </Tooltip>
                <Divider orientation="vertical" />
                {/* Always show history article controls regardless of hasHistory flag */}
                <>
                  <div className="flex items-center gap-2">
                    <div className="text-small">截止</div>
                    <Input
                      type="date"
                      size="sm"
                      className="w-36"
                      value={limitStartDate}
                      onChange={(e) => { console.log(e.target.value); setLimitStartDate(e.target.value)}}
                      placeholder="选择日期"
                    />
                  </div>
                    
                  {/* History Articles Controls */}
                  <div className="flex items-center gap-2">
                    {isHistoryFetching && inProgressHistoryMp?.id === currentMpInfo.id ? (
                      <div className="flex items-center gap-3">
                        {/* Progress info */}
                        <div className="flex flex-col">
                          <span className="text-sm">正在获取历史文章</span>
                          <span className="text-sm">页数: {inProgressHistoryMp?.page || 1}</span>
                        </div>
                        
                        {/* Progress bar */}
                        <div className="w-40">
                          <Progress
                            size="sm"
                            isIndeterminate={true}
                            color="primary"
                            className="h-5"
                          />
                          <div className="flex justify-end mt-1">
                            <span className="text-xs">第 {inProgressHistoryMp?.page || 1} 页</span>
                          </div>
                        </div>
                        
                        {/* Control button */}
                        <Button
                          size="sm"
                          color="danger"
                          isDisabled={isGetHistoryArticlesLoading}
                          onPress={() => handleHistoryArticles(currentMpInfo.id)}
                        >
                          停止获取
                        </Button>
                      </div>
                    ) : (
                      <Tooltip content="抓取公众号历史文章">
                        <Button
                          size="sm"
                          color="primary"
                          isDisabled={
                            (inProgressHistoryMp?.id ? inProgressHistoryMp?.id !== currentMpInfo.id : false) ||
                            isGetHistoryArticlesLoading ||
                            isGetArticlesLoading
                          }
                          onPress={() => handleHistoryArticles(currentMpInfo.id)}
                        >
                          获取历史文章
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                  <Divider orientation="vertical" />
                </>
                

                <Tooltip content="启用服务端定时更新">
                  <div>
                    <Switch
                      size="sm"
                      onValueChange={async (value) => {
                        await updateMpInfo({
                          id: currentMpInfo.id,
                          data: {
                            status: value ? 1 : 0,
                          },
                        });

                        await refetchFeedList();
                      }}
                      isSelected={currentMpInfo?.status === 1}
                    ></Switch>
                  </div>
                </Tooltip>
                <Divider orientation="vertical" />
                <Tooltip content="仅删除订阅源，已获取的文章不会被删除">
                  <Link
                    href="#"
                    color="danger"
                    size="sm"
                    isDisabled={isDeleteFeedLoading}                      onClick={async (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();

                      if (window.confirm('确定删除吗？')) {
                        await deleteFeed(currentMpInfo.id);
                        
                        // Fetch updated feed list first
                        await refetchFeedList();
                        
                        // After refetching, find another feed to navigate to
                        const updatedFeeds = queryUtils.feed.list.getData();
                        let nextFeedId = '';
                        
                        // Select the next feed if available
                        if (updatedFeeds?.items && updatedFeeds.items.length > 0) {
                          // Try to find the index of deleted feed
                          const deletedIndex = feedData?.items?.findIndex(item => item.id === currentMpInfo.id) ?? -1;
                          
                          if (deletedIndex !== -1 && updatedFeeds.items && deletedIndex < updatedFeeds.items.length) {
                            // Select the next feed in the list
                            nextFeedId = updatedFeeds.items[deletedIndex]?.id || '';
                          } else if (updatedFeeds.items && updatedFeeds.items.length > 0) {
                            // Or select the first feed
                            nextFeedId = updatedFeeds.items[0]?.id || '';
                          }
                          
                          // Save the next feed ID to localStorage using storeFeedId helper
                          if (nextFeedId) {
                            storeFeedId(nextFeedId);
                            console.log('Selected next feed after delete:', nextFeedId);
                          } else {
                            storeFeedId(''); // Clear selection if no feeds left
                          }
                        }
                        
                        // Navigate to the next feed or to the feeds page
                        if (nextFeedId) {
                          navigate(`/feeds?feedId=${nextFeedId}`, { replace: true });
                        } else {
                          navigate('/feeds', { replace: true });
                        }
                      }
                    }}
                  >
                    删除
                  </Link>
                </Tooltip>

                <Divider orientation="vertical" />
                <Tooltip
                  content={
                    <div>
                      可添加.atom/.rss/.json格式输出, limit=20&page=1控制分页
                    </div>
                  }
                >
                  <Link
                    size="sm"
                    showAnchorIcon
                    target="_blank"
                    href={`${serverOriginUrl}/feeds/${currentMpInfo.id}.atom`}
                    color="foreground"
                  >
                    RSS
                  </Link>
                </Tooltip>
              </div>
            ) : (
              <div className="flex gap-2">
                <Tooltip
                  content="频繁调用可能会导致一段时间内不可用"
                  color="danger"
                >
                  <Link
                    size="sm"
                    href="#"
                    isDisabled={
                      isRefreshAllMpArticlesRunning || isGetArticlesLoading
                    }
                    onClick={async (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      await refreshMpArticles({});
                      await refetchFeedList();
                      await queryUtils.article.list.reset();
                    }}
                  >
                    {isRefreshAllMpArticlesRunning || isGetArticlesLoading
                      ? '更新中...'
                      : '更新全部'}
                  </Link>
                </Tooltip>
                <Link
                  href="#"
                  color="foreground"
                  onClick={handleExportOpml}
                  size="sm"
                >
                  导出OPML
                </Link>
                <Divider orientation="vertical" />
                <Link
                  size="sm"
                  showAnchorIcon
                  target="_blank"
                  href={`${serverOriginUrl}/feeds/all.atom`}
                  color="foreground"
                >
                  RSS
                </Link>
              </div>
            )}
          </div>
          <div className="p-2 overflow-y-auto">
            <ArticleList id={currentMpId}></ArticleList>
          </div>
        </div>
      </div>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                添加公众号源
              </ModalHeader>
              <ModalBody>
                <Textarea
                  value={wxsLink}
                  onValueChange={setWxsLink}
                  autoFocus
                  label="分享链接"
                  placeholder="输入公众号文章分享链接，一行一条，如 https://mp.weixin.qq.com/s/xxxxxx https://mp.weixin.qq.com/s/xxxxxx"
                  variant="bordered"
                />
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="primary"
                  isDisabled={
                    !wxsLink.startsWith('https://mp.weixin.qq.com/s/')
                  }
                  onPress={handleConfirm}
                  isLoading={
                    isAddFeedLoading ||
                    isGetMpInfoLoading ||
                    isGetArticlesLoading
                  }
                >
                  确定
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
};

export default Feeds;
