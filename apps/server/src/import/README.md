# 文章缓存导入API使用说明

## 接口信息

**URL**: `POST /api/import/article-cache`

**Content-Type**: `application/json`

**认证**: 需要在Header中提供Authorization字段（如果系统配置了认证码）

## 请求参数

```json
{
  "mp_name": "公众号名称（必填）",
  "mp_signature": "公众号简介（可选）",
  "mp_img_link": "公众号头像链接（可选）",
  "article_title": "文章标题（必填）",
  "article_publish_time": 1640995200,
  "article_url": "https://mp.weixin.qq.com/s/ARTICLE_ID（必填）",
  "article_content": "文章内容HTML（必填）"
}
```

### 参数说明

- `mp_name`: 公众号名称，用于查找或创建Feed
- `mp_signature`: 公众号简介，创建Feed时使用
- `mp_img_link`: 公众号头像链接，创建Feed时使用
- `article_title`: 文章标题
- `article_publish_time`: 文章发布时间（Unix时间戳，秒）
- `article_url`: 微信文章链接，必须包含文章ID
- `article_content`: 文章内容HTML

## 响应格式

### 成功响应

```json
{
  "success": true,
  "data": {
    "feedId": "feed_12345",
    "feedCreated": true,
    "articleId": "article_67890",
    "articleCreated": false,
    "cacheAction": "created",
    "contentMatches": false
  },
  "message": "Successfully processed article: 文章标题"
}
```

### 响应字段说明

- `feedId`: Feed的ID
- `feedCreated`: 是否创建了新的Feed
- `articleId`: 文章ID
- `articleCreated`: 是否创建了新文章
- `cacheAction`: 缓存操作类型
  - `created`: 创建了新缓存
  - `updated`: 更新了现有缓存
  - `unchanged`: 缓存内容未变化
- `contentMatches`: 如果文章已有缓存，表示内容是否匹配

### 错误响应

```json
{
  "success": false,
  "error": "错误类型",
  "message": "错误详细信息"
}
```

## 使用示例

### cURL示例

```bash
curl -X POST http://your-server/api/import/article-cache \
  -H "Content-Type: application/json" \
  -H "Authorization: your-auth-code" \
  -d '{
    "mp_name": "技术公众号",
    "mp_signature": "分享最新技术动态",
    "mp_img_link": "https://example.com/avatar.jpg",
    "article_title": "如何使用新API",
    "article_publish_time": 1640995200,
    "article_url": "https://mp.weixin.qq.com/s/abc123def456",
    "article_content": "<html><body>文章内容...</body></html>"
  }'
```

### Python示例

#### 基础导入示例

```python
import requests
import json

url = "http://your-server/api/import/article-cache"
headers = {
    "Content-Type": "application/json",
    "Authorization": "your-auth-code"
}

data = {
    "mp_name": "技术公众号",
    "mp_signature": "分享最新技术动态",
    "mp_img_link": "https://example.com/avatar.jpg",
    "article_title": "如何使用新API",
    "article_publish_time": 1640995200,
    "article_url": "https://mp.weixin.qq.com/s/abc123def456",
    "article_content": "<html><body>文章内容...</body></html>"
}

response = requests.post(url, headers=headers, json=data)
result = response.json()

if result.get("success"):
    print("导入成功:", result.get("message"))
    print("操作详情:", result.get("data"))
else:
    print("导入失败:", result.get("message"))
```

#### 直接处理您的数据格式

```python
import requests
import time

def import_article_from_your_data(resp_data, server_url, auth_code=""):
    """直接从您的数据格式导入文章"""
    
    # 转换数据格式
    simple_data = {
        "mp_name": resp_data["nick_name"],
        "mp_signature": resp_data["signature"],
        "mp_img_link": resp_data["round_head_img"],
        "article_title": resp_data["title"],
        "article_publish_time": resp_data["create_time"],
        "article_url": resp_data["link"],
        "article_content": resp_data["content_noencode"],
    }
    
    # 发送请求
    url = f"{server_url}/api/import/article-cache"
    headers = {'Content-Type': 'application/json'}
    if auth_code:
        headers['Authorization'] = auth_code
        
    response = requests.post(url, headers=headers, json=simple_data)
    return response.json()

# 使用示例
your_data = {
    "nick_name": "技术公众号",
    "signature": "分享技术动态",
    "round_head_img": "https://example.com/avatar.jpg",
    "title": "文章标题",
    "create_time": int(time.time()),
    "link": "https://mp.weixin.qq.com/s/article_id",
    "content_noencode": "<html>文章内容</html>"
}

result = import_article_from_your_data(
    your_data, 
    "http://localhost:3000",
    "your-auth-code"
)
print(result)
```

#### 完整的Python导入类

查看 `import_articles_example.py` 文件获取完整的Python导入类实现，包含批量导入、错误处理等功能。

## 处理逻辑

1. **Feed处理**：根据`mp_name`查找现有Feed，如果不存在则创建新Feed
2. **文章处理**：从`article_url`提取文章ID，检查文章是否存在，不存在则创建
3. **缓存处理**：
   - 如果文章无缓存：创建新缓存
   - 如果文章有缓存：比较内容，不同则更新，相同则保持不变

## 注意事项

- 文章URL必须是标准的微信公众号文章链接格式
- 发布时间使用Unix时间戳（秒为单位）
- 如果系统启用了认证，需要在请求头中包含正确的Authorization
- 重复导入相同文章会根据内容变化决定是否更新缓存
