#!/usr/bin/env python3
"""
wewe-rss 文章缓存导入Python示例

此脚本演示如何使用Python调用wewe-rss的文章缓存导入API
"""

import requests
import json
import time
from typing import Dict, Optional, List


class WeweRssImporter:
    """wewe-rss文章导入器"""
    
    def __init__(self, server_url: str, auth_code: Optional[str] = None):
        """
        初始化导入器
        
        Args:
            server_url: wewe-rss服务器地址，如 http://localhost:3000
            auth_code: 认证码（如果服务器启用了认证）
        """
        self.server_url = server_url.rstrip('/')
        self.auth_code = auth_code
        self.import_url = f"{self.server_url}/api/import/article-cache"
        
    def import_article(self, article_data: Dict) -> Dict:
        """
        导入单篇文章
        
        Args:
            article_data: 文章数据字典，包含以下字段：
                - mp_name: 公众号名称（必填）
                - mp_signature: 公众号简介（可选）
                - mp_img_link: 公众号头像链接（可选）
                - article_title: 文章标题（必填）
                - article_publish_time: 文章发布时间戳（必填）
                - article_url: 文章URL（必填）
                - article_content: 文章内容HTML（必填）
        
        Returns:
            Dict: API响应结果
        """
        # 准备请求头
        headers = {
            'Content-Type': 'application/json'
        }
        
        # 如果有认证码，添加到请求头
        if self.auth_code:
            headers['Authorization'] = self.auth_code
            
        try:
            # 发送POST请求
            response = requests.post(
                self.import_url,
                headers=headers,
                json=article_data,
                timeout=30
            )
            
            # 解析响应
            result = response.json()
            
            if response.status_code == 200:
                print(f"✅ 成功导入文章: {article_data.get('article_title', 'Unknown')}")
                if result.get('success'):
                    data = result.get('data', {})
                    print(f"   Feed ID: {data.get('feedId')}")
                    print(f"   Feed 是否新建: {data.get('feedCreated')}")
                    print(f"   文章 ID: {data.get('articleId')}")
                    print(f"   文章是否新建: {data.get('articleCreated')}")
                    print(f"   缓存操作: {data.get('cacheAction')}")
                    print(f"   内容匹配: {data.get('contentMatches')}")
                else:
                    print(f"   ⚠️  API返回失败: {result.get('message')}")
            else:
                print(f"❌ 导入失败: {article_data.get('article_title', 'Unknown')}")
                print(f"   状态码: {response.status_code}")
                print(f"   错误信息: {result.get('message', 'Unknown error')}")
                
            return result
            
        except requests.exceptions.RequestException as e:
            error_result = {
                'success': False,
                'error': 'Network Error',
                'message': str(e)
            }
            print(f"❌ 网络错误: {e}")
            return error_result
        except json.JSONDecodeError as e:
            error_result = {
                'success': False,
                'error': 'JSON Decode Error',
                'message': str(e)
            }
            print(f"❌ JSON解析错误: {e}")
            return error_result
    
    def import_articles_batch(self, articles: List[Dict], delay: float = 1.0) -> List[Dict]:
        """
        批量导入文章
        
        Args:
            articles: 文章数据列表
            delay: 每次请求之间的延迟（秒）
        
        Returns:
            List[Dict]: 所有导入结果的列表
        """
        results = []
        total = len(articles)
        
        print(f"开始批量导入 {total} 篇文章...")
        
        for i, article in enumerate(articles, 1):
            print(f"\n[{i}/{total}] 正在导入...")
            result = self.import_article(article)
            results.append(result)
            
            # 如果不是最后一个，等待一段时间
            if i < total and delay > 0:
                time.sleep(delay)
        
        # 统计结果
        successful = sum(1 for r in results if r.get('success'))
        failed = total - successful
        
        print(f"\n📊 批量导入完成:")
        print(f"   总计: {total} 篇")
        print(f"   成功: {successful} 篇")
        print(f"   失败: {failed} 篇")
        
        return results


def create_sample_article_data() -> Dict:
    """创建示例文章数据"""
    return {
        "mp_name": "技术分享公众号",
        "mp_signature": "分享最新技术动态和开发经验",
        "mp_img_link": "https://example.com/avatar.jpg",
        "article_title": "Python异步编程详解",
        "article_publish_time": int(time.time()),  # 当前时间戳
        "article_url": "https://mp.weixin.qq.com/s/example_article_id_123",
        "article_content": """
        <html>
        <head><title>Python异步编程详解</title></head>
        <body>
            <h1>Python异步编程详解</h1>
            <p>异步编程是现代Python开发中的重要技术...</p>
            <h2>1. 什么是异步编程</h2>
            <p>异步编程允许程序在等待某个操作完成时，继续执行其他任务...</p>
            <h2>2. asyncio库介绍</h2>
            <p>asyncio是Python的标准异步编程库...</p>
            <pre><code>
import asyncio

async def main():
    print("Hello, async world!")
    
asyncio.run(main())
            </code></pre>
        </body>
        </html>
        """
    }


def main():
    """主函数 - 演示如何使用导入器"""
    
    # 配置服务器信息
    SERVER_URL = "http://localhost:3000"  # 修改为您的服务器地址
    AUTH_CODE = ""  # 如果启用了认证，请填入认证码
    
    # 创建导入器实例
    importer = WeweRssImporter(SERVER_URL, AUTH_CODE)
    
    # 示例1: 导入单篇文章
    print("=== 示例1: 导入单篇文章 ===")
    article_data = create_sample_article_data()
    result = importer.import_article(article_data)
    
    # 示例2: 批量导入多篇文章
    print("\n=== 示例2: 批量导入文章 ===")
    articles = []
    for i in range(3):
        article = create_sample_article_data()
        article["article_title"] = f"技术文章 {i+1}"
        article["article_url"] = f"https://mp.weixin.qq.com/s/example_id_{i+1}"
        article["article_publish_time"] = int(time.time()) - i * 3600  # 每小时间隔
        articles.append(article)
    
    batch_results = importer.import_articles_batch(articles, delay=0.5)
    
    # 示例3: 从您的数据源导入
    print("\n=== 示例3: 从自定义数据源导入 ===")
    
    # 这里模拟您从其他地方获取的数据
    your_data = {
        "nick_name": "设计师公众号",
        "signature": "分享设计灵感与技巧",
        "round_head_img": "https://example.com/designer-avatar.jpg",
        "title": "UI设计趋势2025",
        "create_time": int(time.time()),
        "link": "https://mp.weixin.qq.com/s/design_trends_2025",
        "content_noencode": "<html><body><h1>UI设计趋势2025</h1><p>2025年的UI设计将更加注重用户体验...</p></body></html>"
    }
    
    # 转换为导入器需要的格式
    converted_data = {
        "mp_name": your_data["nick_name"],
        "mp_signature": your_data["signature"],
        "mp_img_link": your_data["round_head_img"],
        "article_title": your_data["title"],
        "article_publish_time": your_data["create_time"],
        "article_url": your_data["link"],
        "article_content": your_data["content_noencode"],
    }
    
    result = importer.import_article(converted_data)


if __name__ == "__main__":
    main()
