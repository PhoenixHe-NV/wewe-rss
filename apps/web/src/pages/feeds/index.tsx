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
import { useMemo, useState, useEffect } from 'react';
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
      return localStorage.getItem(STORAGE_KEY_SELECTED_FEED) || '';
    } catch (e) {
      console.error('Failed to read from localStorage:', e);
      return '';
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
  
  // Update the history fetching state when inProgressHistoryMp changes
  useEffect(() => {
    if (inProgressHistoryMp && inProgressHistoryMp.id) {
      setIsHistoryFetching(true);
    } else {
      setIsHistoryFetching(false);
    }
  }, [inProgressHistoryMp]);

  // Update currentMpId when URL parameters change and update URL
  useEffect(() => {
    const idFromParams = id || searchParams.get('feedId') || '';
    
    if (idFromParams !== currentMpId) {
      console.log(`Updating currentMpId from ${currentMpId} to ${idFromParams}`);
      setCurrentMpId(idFromParams);
      
      // Save to localStorage
      try {
        if (idFromParams) {
          localStorage.setItem(STORAGE_KEY_SELECTED_FEED, idFromParams);
        } else {
          // If no feed selected, remove from localStorage
          localStorage.removeItem(STORAGE_KEY_SELECTED_FEED);
        }
      } catch (e) {
        console.error('Failed to save to localStorage:', e);
      }
      
      // When the feedId comes from the query parameter, update the URL structure
      // to be consistent with direct navigation
      if (!id && idFromParams) {
        // Only update if we need to - avoid infinite loops
        navigate(`/feeds?feedId=${idFromParams}`, { replace: true });
      }
    }
  }, [id, searchParams, currentMpId, navigate]);

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
                setCurrentMpId(feedId);
                
                // Save to localStorage
                try {
                  if (feedId) {
                    localStorage.setItem(STORAGE_KEY_SELECTED_FEED, feedId);
                  } else {
                    localStorage.removeItem(STORAGE_KEY_SELECTED_FEED);
                  }
                } catch (e) {
                  console.error('Failed to save to localStorage:', e);
                }
                
                // Update URL with the selected feedId
                if (feedId) {
                  // Use navigate instead of setSearchParams to update the URL properly
                  navigate(`/feeds?feedId=${feedId}`, { replace: true });
                } else {
                  // Remove the parameter if no feed is selected
                  navigate('/feeds', { replace: true });
                }
              }}
            >
              <ListboxSection showDivider>
                <ListboxItem
                  key={''}
                  // href={`/feeds`}
                  className={isActive('') ? 'bg-primary-50 text-primary' : ''}
                  startContent={<Avatar name="ALL"></Avatar>}
                >
                  全部
                </ListboxItem>
              </ListboxSection>

              <ListboxSection className="overflow-y-auto h-[calc(100vh-260px)]">
                {feedData?.items.map((item) => {
                  return (
                    <ListboxItem
                      // href={`/feeds/${item.id}`}
                      className={
                        isActive(item.id) ? 'bg-primary-50 text-primary' : ''
                      }
                      key={item.id}
                      startContent={<Avatar src={item.mpCover}></Avatar>}
                      onSelect={() => {
                        setCurrentMpId(item.id);
                        
                        // Save to localStorage
                        try {
                          localStorage.setItem(STORAGE_KEY_SELECTED_FEED, item.id);
                        } catch (e) {
                          console.error('Failed to save to localStorage:', e);
                        }
                        
                        // Update URL with the selected feedId using navigate
                        navigate(`/feeds?feedId=${item.id}`, { replace: true });
                      }}
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
                        
                        // Remove from localStorage if the deleted feed is currently selected
                        try {
                          const storedFeedId = localStorage.getItem(STORAGE_KEY_SELECTED_FEED);
                          if (storedFeedId === currentMpInfo.id) {
                            localStorage.removeItem(STORAGE_KEY_SELECTED_FEED);
                          }
                        } catch (e) {
                          console.error('Failed to access localStorage:', e);
                        }
                        
                        // Clear the feedId parameter when deleting and navigate
                        navigate('/feeds', { replace: true });
                        
                        await refetchFeedList();
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
