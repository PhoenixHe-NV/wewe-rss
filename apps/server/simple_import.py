#!/usr/bin/env python3
"""
简化版文章导入脚本

直接处理您提供的数据格式并导入到wewe-rss系统
"""

import requests
import json
import time
from datetime import datetime


def import_article_to_wewe_rss(simple_data, server_url="http://localhost:3000", auth_code=""):
    """
    将文章数据导入到wewe-rss系统
    
    Args:
        simple_data: 您的数据格式字典，包含:
            - mp_name (nick_name)
            - mp_signature (signature) 
            - mp_img_link (round_head_img)
            - article_title (title)
            - article_publish_time (create_time)
            - article_url (link)
            - article_content (content_noencode)
        server_url: wewe-rss服务器地址
        auth_code: 认证码（可选）
    
    Returns:
        dict: 导入结果
    """
    
    # 准备请求
    url = f"{server_url.rstrip('/')}/api/import/article-cache"
    headers = {'Content-Type': 'application/json'}
    
    if auth_code:
        headers['Authorization'] = auth_code
    
    try:
        # 发送请求
        response = requests.post(url, headers=headers, json=simple_data, timeout=30)
        result = response.json()
        
        # 输出结果
        if response.status_code == 200 and result.get('success'):
            print(f"✅ 导入成功: {simple_data.get('article_title')}")
            data = result.get('data', {})
            print(f"   缓存操作: {data.get('cacheAction')}")
            print(f"   Feed创建: {data.get('feedCreated')}")
            print(f"   文章创建: {data.get('articleCreated')}")
        else:
            print(f"❌ 导入失败: {result.get('message', 'Unknown error')}")
            
        return result
        
    except Exception as e:
        print(f"❌ 请求异常: {e}")
        return {"success": False, "error": str(e)}


# 使用示例
if __name__ == "__main__":
    
    # 您的原始数据格式
    resp_data = {
        "nick_name": "AI技术分享",
        "signature": "专注人工智能技术分享",
        "round_head_img": "https://example.com/ai-avatar.jpg",
        "title": "ChatGPT原理深度解析",
        "create_time": int(time.time()),
        "link": "https://mp.weixin.qq.com/s/chatgpt_analysis_123",
        "content_noencode": "<html><body><h1>ChatGPT原理深度解析</h1><p>本文将深入探讨ChatGPT的工作原理...</p></body></html>"
    }
    
    # 转换为导入格式
    simple_data = {
        "mp_name": resp_data["nick_name"],
        "mp_signature": resp_data["signature"],
        "mp_img_link": resp_data["round_head_img"],
        "article_title": resp_data["title"],
        "article_publish_time": resp_data["create_time"],
        "article_url": resp_data["link"],
        "article_content": resp_data["content_noencode"],
    }
    
    # 导入到wewe-rss
    result = import_article_to_wewe_rss(
        simple_data,
        server_url="http://localhost:3000",  # 修改为您的服务器地址
        auth_code=""  # 如果需要认证，请填入认证码
    )
    
    print(f"\n完整结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
