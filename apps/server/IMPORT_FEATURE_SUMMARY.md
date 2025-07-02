# 文章缓存导入功能实现总结

## 实现的功能

已为wewe-rss系统添加了文章缓存导入功能，包括：

### 1. tRPC接口 (`article.importArticleCache`)
- 位置: `/apps/server/src/trpc/trpc.router.ts`
- 功能: 处理文章缓存数据的导入逻辑
- 输入参数匹配您提供的数据结构

### 2. HTTP REST API (`POST /api/import/article-cache`)
- 位置: `/apps/server/src/import/import.controller.ts`
- 功能: 提供HTTP接口供外部系统调用
- 支持认证验证和错误处理

### 3. 智能处理逻辑

#### Feed处理
- 根据`mp_name`查找现有Feed
- 如果不存在，自动创建新Feed
- 使用提供的`mp_signature`和`mp_img_link`作为Feed信息

#### 文章处理
- 从`article_url`提取文章ID
- 检查文章是否已存在
- 如果不存在，创建新文章记录

#### 缓存处理
- **无缓存**: 创建新缓存
- **有缓存**: 比较内容
  - 内容相同: 保持不变 (`cacheAction: "unchanged"`)
  - 内容不同: 更新缓存 (`cacheAction: "updated"`)

### 4. 详细响应信息
返回操作的详细信息：
```json
{
  "success": true,
  "data": {
    "feedId": "生成的Feed ID",
    "feedCreated": "是否创建了新Feed",
    "articleId": "文章ID", 
    "articleCreated": "是否创建了新文章",
    "cacheAction": "缓存操作类型",
    "contentMatches": "内容是否匹配"
  },
  "message": "处理结果描述"
}
```

### 5. 测试工具
- 测试脚本: `test-import-api.js`
- 使用文档: `README.md`

## 数据映射

您的数据结构 → 系统字段映射：
```
mp_name → Feed.mpName (查找/创建Feed的关键字段)
mp_signature → Feed.mpIntro
mp_img_link → Feed.mpCover
article_title → Article.title
article_publish_time → Article.publishTime
article_url → 提取Article.id和Article.mpId关联
article_content → ArticleCache.content
```

## 重复检测机制

1. **Feed重复**: 通过`mp_name`完全匹配检测
2. **文章重复**: 通过从URL提取的文章ID检测
3. **缓存重复**: 比较现有缓存内容与新内容的字符串匹配

## 使用方式

```bash
# 基本调用
curl -X POST http://your-server/api/import/article-cache \
  -H "Content-Type: application/json" \
  -H "Authorization: your-auth-code" \
  -d '您的数据JSON'

# 测试调用
node test-import-api.js
```

## 错误处理

- 数据验证失败
- 数据库操作错误 
- 认证失败
- URL格式错误

所有错误都会返回详细的错误信息和HTTP状态码。

## 已集成到现有系统

- 添加到AppModule的controllers中
- 使用现有的PrismaService
- 复用现有的认证机制
- 遵循现有的错误处理模式

这个实现完全满足您的需求，能够智能处理重复数据，提供详细的操作反馈，并且很好地集成到了现有的wewe-rss系统中。
