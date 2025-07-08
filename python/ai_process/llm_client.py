"""
LLM client for interacting with Ali Bailian (Alibaba Cloud Bailian) LLM service.
"""
import json
import logging
import time
import asyncio
from typing import Dict, Any, Optional, List
import re

import openai
from openai import OpenAI
import httpx
# Import HTML to markdown conversion tools
import html2text
import html2markdown
from bs4 import BeautifulSoup

from .config import API_BASE_URL, API_KEY, DEFAULT_MODEL, TIMEOUT, MAX_RETRIES

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class LLMClient:
    """Client for interacting with Ali Bailian LLM via OpenAI-compatible API."""

    def __init__(self,
                 api_key: str = API_KEY,
                 api_base: str = API_BASE_URL,
                 model: str = DEFAULT_MODEL):
        """
        Initialize the LLM client.
        
        Args:
            api_key: API key for Ali Bailian
            api_base: Base URL for the API
            model: Model to use for generation
        """
        self.api_key = api_key
        self.api_base = api_base
        self.model = model

        # Initialize OpenAI client (compatible with Ali Bailian)
        self.client = OpenAI(api_key=self.api_key,
                             base_url=self.api_base,
                             timeout=TIMEOUT)
        
        # Also create an async HTTP client for parallel requests
        self._async_client = None

    def _html_to_markdown(self, html_content: str) -> str:
        """
        Convert HTML content to markdown and remove image links.
        
        Args:
            html_content: The HTML content to convert
            
        Returns:
            Converted markdown text with images removed
        """
        try:
            # Try with html2text first (usually gives better results)
            h = html2text.HTML2Text()
            h.ignore_links = False  # Keep links
            h.ignore_images = True  # Remove images
            h.ignore_emphasis = False
            h.ignore_tables = False
            h.body_width = 0  # Don't wrap text at any width
            markdown_text = h.handle(html_content)
        except Exception as e:
            logger.warning(
                f"html2text conversion failed: {e}. Trying fallback...")
            try:
                # Fallback to html2markdown
                markdown_text = html2markdown.convert(html_content)
                # Remove image links with regex
                markdown_text = re.sub(r'!\[.*?\]\(.*?\)', '', markdown_text)
            except Exception as e2:
                logger.warning(f"All HTML conversion methods failed: {e2}")
                # Last resort: use BeautifulSoup to extract text
                try:
                    soup = BeautifulSoup(html_content, 'html.parser')
                    markdown_text = soup.get_text(separator='\n\n')
                except Exception as e3:
                    logger.error(f"Error extracting text: {e3}")
                    markdown_text = html_content  # Return original content if all fails

        # Remove any remaining image markdown patterns just to be sure
        markdown_text = re.sub(r'!\[.*?\]\(.*?\)', '', markdown_text)

        # Limit text to 30k characters if needed
        if len(markdown_text) > 30000:
            logger.warning(
                f"Text exceeds 30k characters ({len(markdown_text)} chars). Truncating..."
            )
            markdown_text = markdown_text[:30000]

        return markdown_text

    def _clean_json_content(self, content: str) -> str:
        """Clean JSON content to handle common formatting issues."""
        # Remove markdown code block wrappers
        content_to_parse = content.strip()
        if content_to_parse.startswith("```json"):
            lines = content_to_parse.split('\n')
            json_lines = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
            content_to_parse = '\n'.join(json_lines)
        elif content_to_parse.startswith("```"):
            lines = content_to_parse.split('\n')
            json_lines = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
            content_to_parse = '\n'.join(json_lines)
        
        # Replace Chinese quotes with standard JSON quotes
        content_to_parse = content_to_parse.replace('"', '"').replace('"', '"')
        content_to_parse = content_to_parse.replace(''', "'").replace(''', "'")
        
        # Replace full-width parentheses with half-width
        content_to_parse = content_to_parse.replace('（', '(').replace('）', ')')
        
        # Simple approach: try to fix common quote issues in string values
        # Find pattern like: "key": "text with "quotes" inside",
        # and escape the inner quotes
        import re
        
        # Pattern to find string values that contain unescaped quotes
        def fix_unescaped_quotes(text):
            """Fix unescaped quotes in JSON string values."""
            lines = text.split('\n')
            fixed_lines = []
            
            for line in lines:
                # If this line contains a JSON key-value pair with string value
                if '":' in line and '"' in line:
                    # Find the pattern: "key": "value with possible quotes"
                    colon_pos = line.find('":')
                    if colon_pos > 0:
                        key_part = line[:colon_pos + 2]  # Include the ": part
                        rest = line[colon_pos + 2:].strip()
                        
                        # If the rest starts with a quote, it's a string value
                        if rest.startswith('"'):
                            # Find the end of the string value
                            # Simple approach: find the last quote before comma or }
                            if rest.endswith('",') or rest.endswith('"'):
                                end_char = rest[-1]
                                string_part = rest[1:-1]  # Remove surrounding quotes
                                # Escape any quotes in the string content
                                escaped_string = string_part.replace('"', '\\"')
                                fixed_line = f'{key_part} "{escaped_string}"{end_char if end_char == "," else ""}'
                                fixed_lines.append(fixed_line)
                                continue
                
                # If we didn't fix this line, keep it as is
                fixed_lines.append(line)
            
            return '\n'.join(fixed_lines)
        
        content_to_parse = fix_unescaped_quotes(content_to_parse)
        
        return content_to_parse

    def _get_system_message(self) -> str:
        """
        Get the system message for LLM processing.
        
        Returns:
            The system message string
        """
        return """你是一个AI助手，专门用于处理微信公众号内容。现在我们要通过微信公众号抓取影像相关的学术活动相关信息，以及展览预告，展览回顾，学术文章。请尽量使用中文回答问题。
影像包括摄影、录像、视频、纪录片、电影、影像、影像装置。学术活动包括学术讨论、圆桌、圆桌讨论、论坛、讲座、工作坊、大赛、摄影季、摄影节、影像节、放映计划。
学术文章是指讨论影像相关的具有艺术性、学术性、批评性的文章。
请根据以下指示生成摘要，关键词，影像相关性分析，活动相关性分析，展览相关性分析，学术文章分析:
- summary: 摘要，最长三段的简洁总结，概括文章的主要内容和观点。
- keywords: 关键词，提取文章中的重要关键词或短语，最多5个，用英文逗号(,)分隔。请不要包含公众号或者机构的名称，请专注在内容的关键词提取。
- photography_keywords: 分析文章中提到的影像的关键词，用英文逗号(,)分隔，如无关则留空。影像括摄影、录像、视频、纪录片、电影、影像、影像装置。以下不属于影像关键词：声音艺术。
- activity_keywords: 分析文章中提到的学术活动的关键词，用英文逗号(,)分隔，如无关则留空。学术活动包括学术讨论、圆桌、圆桌讨论、论坛、讲座、工作坊、大赛、摄影季、摄影节、影像节、放映计划。以下不属于学术活动：展览，开幕倒计时，导览。
- activity_time: 活动时间，格式为YYYY-MM-DD，如果文章中没有明确的时间信息或者不是活动，则留空。如果活动是一个时间段请以YYYY-MM-DD/YYYY-MM-DD格式表示。
- location: 活动地点，提取文章中提到的活动举办地点，如无关则留空。
- location_city: 活动举办城市，如无关则留空。
- organizer: 活动主办方和协办方，如无关则留空。
- artists: 文章中提到的参与活动的嘉宾或艺术家的姓名，用英文逗号(,)分隔，如无则留空。
- exhibition_keywords: 分析文章是否是展开预告或者展览回顾，提取展览相关的关键词，用英文逗号(,)分隔，如不是展览预告或者回顾则留空。展览预告是指介绍即将举办的展览，展览回顾是指对已举办展览的总结和评论。
- academic_keywords: 分析文章是否是学术文章，提取学术文章相关的关键词，用英文逗号(,)分隔，如不是学术文章则留空。学术文章是指讨论影像相关的具有艺术性、学术性、批评性的文章。

请按以下JSON样例的格式返回结果：
{
  "summary": "...",
  "keywords": "关键词1,关键词2,关键词3",
  "photography_keywords": "电影,影像装置",
  "activity_keywords": "工作坊",
  "activity_time": "2024-01-01",
  "location": "上海多伦现代美术馆",
  "location_city": "上海",
  "organizer": "上海市多伦现代美术馆",
  "artists": "张三,李四",
  "exhibition_keywords": "展览预告",
  "academic_keywords": "学术文章,批评性文章"
}
"""

    def _get_error_response(self, error_message: str) -> Dict[str, Any]:
        """
        Get a standardized error response structure.
        
        Args:
            error_message: The error message to include
            
        Returns:
            Dictionary with error response structure
        """
        return {
            "summary": error_message,
            "keywords": "",
            "photography_keywords": "",
            "activity_keywords": "",
            "exhibition_keywords": "",
            "academic_keywords": "",
            "activity_time": "",
            "location": "",
            "location_city": "",
            "organizer": "",
            "artists": "",
            "sentiment": "unknown"
        }

    def _prepare_text_and_prompt(self, text: str, title: Optional[str] = None) -> tuple[str, str, str]:
        """
        Prepare text and create prompts for LLM processing.
        
        Args:
            text: The article text to process
            title: Optional title of the article
            
        Returns:
            Tuple of (processed_text, system_message, user_message)
        """
        # Check if the text looks like HTML and convert to markdown if needed
        if "<" in text and ">" in text:
            logger.info("Content appears to be HTML. Converting to markdown...")
            text = self._html_to_markdown(text)
            logger.info(f"Converted to markdown. Length: {len(text)} characters")
        elif len(text) > 30000:
            logger.warning(f"Plain text exceeds 30k characters ({len(text)} chars). Truncating...")
            text = text[:30000]

        # Create a more focused prompt with the title if available
        title_context = f"标题: {title}\n\n" if title else ""
        
        # Get system message
        system_message = self._get_system_message()
        
        # Set up the full prompt with article content
        user_message = f"{title_context}文章正文:\n\n{text}"
        
        return text, system_message, user_message

    def summarize_text(self,
                       text: str,
                       title: Optional[str] = None) -> Dict[str, Any]:
        """
        Generate a summary, keywords, and sentiment analysis for the given text.
        
        Args:
            text: The article text to summarize (can be HTML or plain text)
            title: Optional title of the article
            
        Returns:
            Dictionary containing summary, keywords, and sentiment analysis
        """
        # Use shared method to prepare text and prompts
        processed_text, system_message, user_message = self._prepare_text_and_prompt(text, title)
        
        # Set up debug logging
        text_preview = processed_text[:100] + "..." if len(processed_text) > 100 else processed_text
        logger.debug(f"Processing text (preview): {text_preview}")

        # Perform retries if the API call fails
        for attempt in range(MAX_RETRIES):
            try:
                # Call the LLM API
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[{
                        "role": "system",
                        "content": system_message
                    }, {
                        "role": "user",
                        "content": user_message
                    }],
                    temperature=0.3,  # Lower temperature for more focused/factual responses
                    response_format={"type": "json_object"})

                # Extract and parse the content
                content = response.choices[0].message.content
                if content:
                    try:
                        # Handle cases where LLM returns JSON wrapped in markdown code blocks
                        content_to_parse = self._clean_json_content(content)
                        return json.loads(content_to_parse)
                    except json.JSONDecodeError as json_err:
                        logger.error(f"Failed to parse LLM JSON response: {json_err}")
                        logger.error(f"Response content: {content[:500]}...")
                        if attempt < MAX_RETRIES - 1:
                            wait_time = 2 ** attempt
                            logger.warning(f"JSON parsing error, retrying in {wait_time} seconds...")
                            time.sleep(wait_time)
                            continue
                        else:
                            return self._get_error_response("Error: Invalid JSON in LLM response.")
                else:
                    return self._get_error_response("Error: Empty response from LLM.")

            except (openai.APIError, openai.APITimeoutError,
                    openai.RateLimitError) as e:
                if attempt < MAX_RETRIES - 1:
                    wait_time = 2**attempt  # Exponential backoff
                    logger.warning(
                        f"API error: {str(e)}. Retrying in {wait_time} seconds..."
                    )
                    time.sleep(wait_time)
                else:
                    logger.error(f"Max retries reached. API error: {str(e)}")
                    return self._get_error_response(
                        f"Error: Unable to generate summary after {MAX_RETRIES} attempts."
                    )

            except json.JSONDecodeError as e:
                response_content = locals().get('content', 'N/A')
                logger.error(
                    f"JSON parsing error: {str(e)}, response content: {response_content}"
                )
                return self._get_error_response("Error: Unable to parse LLM response.")

            except Exception as e:
                logger.error(f"Unexpected error: {str(e)}")
                return self._get_error_response("Error: An unexpected error occurred.")
                
        # 如果所有重试都失败了，返回错误响应
        return self._get_error_response(f"Error: Unable to generate summary after {MAX_RETRIES} attempts.")
                
    def create_batch_job(self, texts: List[Dict[str, Any]], 
                        custom_id_prefix: str = "wewe_rss") -> Dict[str, Any]:
        """
        Create a batch job using Ali Bailian's batch API.
        根据阿里云灵积平台文档，Batch API是异步的，需要先创建批处理任务，
        然后轮询获取结果，整个过程可能需要几个小时。
        
        Args:
            texts: List of dictionaries, each with 'article_id', 'content', and optionally 'title'
            custom_id_prefix: Prefix for custom_id in batch requests
            
        Returns:
            Dictionary containing batch job information
        """
        if not texts:
            return {"error": "No texts provided for batch processing"}
            
        # 准备JSONL格式的批处理请求
        batch_requests = []
        system_message = self._get_system_message()
        
        for i, article in enumerate(texts):
            article_id = article["article_id"]
            content = article['content']
            title = article.get('title')
            
            # Process text and create prompt
            processed_text, _, user_message = self._prepare_text_and_prompt(content, title)
            
            # 创建符合批处理API格式的请求
            batch_request = {
                "custom_id": f"{custom_id_prefix}_{article_id}",
                "method": "POST",
                "url": "/v1/chat/completions",  # 使用正确的URL格式
                "body": {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": user_message}
                    ],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"}
                }
            }
            batch_requests.append(batch_request)
        
        # 将请求转换为JSONL格式
        jsonl_content = "\n".join([json.dumps(req, ensure_ascii=False) for req in batch_requests])
        
        try:
            # 根据配置决定使用真实API还是模拟模式
            from .config import USE_REAL_BATCH_API
            
            if USE_REAL_BATCH_API:
                # 尝试使用真实的阿里云灵积平台Batch API
                logger.info("🚀 使用真实的阿里云灵积平台Batch API")
                return self._create_real_batch_job(jsonl_content, texts)
            else:
                # 使用模拟模式
                logger.info("🔄 使用模拟Batch API模式")
                return self._create_simulated_batch_job(texts)
                
        except Exception as e:
            # 获取配置以决定回退策略
            try:
                from .config import USE_REAL_BATCH_API
            except ImportError:
                USE_REAL_BATCH_API = False
                
            if USE_REAL_BATCH_API:
                logger.warning(f"真实Batch API调用失败，回退到模拟模式: {str(e)}")
                return self._create_simulated_batch_job(texts)
            else:
                logger.error(f"模拟Batch API创建失败: {str(e)}")
                return {
                    "success": False,
                    "error": f"Failed to create batch job: {str(e)}"
                }
    
    def _create_real_batch_job(self, jsonl_content: str, texts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        使用真实的阿里云灵积平台OpenAI兼容Batch API创建批处理任务
        
        Args:
            jsonl_content: JSONL格式的批处理请求内容
            texts: 原始文章列表
            
        Returns:
            Dictionary containing batch job information
        """
        try:
            logger.info("🚀 开始创建真实的阿里云灵积Batch任务")
            
            # 1. 首先上传JSONL文件
            logger.info("📄 准备上传JSONL文件...")
            
            # 创建临时文件
            import tempfile
            import io
            
            # 将JSONL内容写入临时文件
            jsonl_bytes = jsonl_content.encode('utf-8')
            
            # 使用OpenAI client的files.create方法上传文件
            file_response = self.client.files.create(
                file=io.BytesIO(jsonl_bytes),
                purpose="batch"
            )
            
            input_file_id = file_response.id
            logger.info(f"✅ 文件上传成功，文件ID: {input_file_id}")
            
            # 2. 创建Batch任务
            logger.info("🔄 创建Batch任务...")
            
            batch_response = self.client.batches.create(
                input_file_id=input_file_id,
                endpoint="/v1/chat/completions",  # 使用标准的chat completions端点
                completion_window="24h"  # 24小时完成窗口
            )
            
            batch_id = batch_response.id
            logger.info(f"✅ Batch任务创建成功，任务ID: {batch_id}")
            
            return {
                "success": True,
                "batch_id": batch_id,
                "input_file_id": input_file_id,
                "status": "validating",  # 初始状态
                "created_at": batch_response.created_at,
                "total_requests": len(texts),
                "metadata": {
                    "endpoint": "/v1/chat/completions",
                    "completion_window": "24h",
                    "request_counts": {
                        "total": len(texts),
                        "completed": 0,
                        "failed": 0
                    }
                }
            }
            
        except Exception as e:
            logger.error(f"❌ 创建真实Batch任务失败: {str(e)}")
            raise e
    
    def _create_simulated_batch_job(self, texts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        创建模拟的批处理任务（用于开发和测试）
        
        Args:
            texts: 文章列表
            
        Returns:
            Dictionary containing simulated batch job information
        """
        # 注意：这里是对阿里云灵积平台Batch API的模拟实现
        # 阿里云灵积平台已提供真实的批处理API，详见：
        # https://bailian.console.aliyun.com/?tab=api#/api/?type=model&url=https%3A%2F%2Fhelp.aliyun.com%2Fdocument_detail%2F2842025.html
        # 未来应替换为真实API调用
        
        logger.warning("⚠️ 重要提示：当前为模拟Batch API实现，非真实API调用")
        logger.warning("阿里云灵积平台已提供Batch API，请参考官方文档进行实际集成")
        
        # 模拟批处理任务创建
        import uuid
        import time
        from .config import SIMULATION_ARTICLES
        
        batch_id = f"batch_{uuid.uuid4().hex[:8]}"
        current_time = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        # 保存文章信息到批处理映射表，以便后续模拟结果获取使用
        SIMULATION_ARTICLES[batch_id] = texts
        logger.info(f"保存 {len(texts)} 篇文章到模拟批处理任务 {batch_id}")
        
        # 返回模拟的批处理任务信息
        logger.info(f"模拟创建批处理任务: {batch_id}")
        
        return {
            "success": True,
            "batch_id": batch_id,
            "status": "validating",
            "created_at": current_time,
            "article_count": len(texts),
            "completion_window": "24h",
            "metadata": {
                "description": f"WeWe RSS batch processing for {len(texts)} articles",
                "created_at": current_time,
                "note": "This is a simulated batch job. Real implementation depends on Ali Bailian's actual batch API."
            }
        }

    def get_batch_job_status(self, batch_id: str) -> Dict[str, Any]:
        """
        Get the status of a batch job.
        
        Args:
            batch_id: The ID of the batch job
            
        Returns:
            Dictionary containing batch job status information
        """
        try:
            # 根据配置决定使用真实API还是模拟模式
            from .config import USE_REAL_BATCH_API
            
            if USE_REAL_BATCH_API:
                return self._get_real_batch_status(batch_id)
            else:
                return self._get_simulated_batch_status(batch_id)
                
        except Exception as e:
            logger.error(f"获取批处理任务状态失败: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to get batch job status: {str(e)}"
            }
    
    def _get_real_batch_status(self, batch_id: str) -> Dict[str, Any]:
        """
        使用真实的阿里云灵积平台OpenAI兼容API获取批处理任务状态
        
        Args:
            batch_id: 真实的批处理任务ID
            
        Returns:
            Dictionary containing batch job status information
        """
        try:
            logger.info(f"🔍 查询真实批处理任务状态: {batch_id}")
            
            # 使用OpenAI客户端查询批处理状态
            batch_status = self.client.batches.retrieve(batch_id)
            
            # 处理状态信息
            status = batch_status.status  # validating, in_progress, finalizing, completed, failed, expired, cancelled
            
            logger.info(f"📊 批处理任务 {batch_id} 当前状态: {status}")
            
            return {
                "success": True,
                "batch_id": batch_id,
                "status": status,
                "created_at": batch_status.created_at,
                "in_progress_at": getattr(batch_status, 'in_progress_at', None),
                "expires_at": getattr(batch_status, 'expires_at', None),
                "finalizing_at": getattr(batch_status, 'finalizing_at', None),
                "completed_at": getattr(batch_status, 'completed_at', None),
                "failed_at": getattr(batch_status, 'failed_at', None),
                "expired_at": getattr(batch_status, 'expired_at', None),
                "cancelled_at": getattr(batch_status, 'cancelled_at', None),
                "request_counts": {
                    "total": getattr(batch_status.request_counts, 'total', 0) if hasattr(batch_status, 'request_counts') else 0,
                    "completed": getattr(batch_status.request_counts, 'completed', 0) if hasattr(batch_status, 'request_counts') else 0,
                    "failed": getattr(batch_status.request_counts, 'failed', 0) if hasattr(batch_status, 'request_counts') else 0
                },
                "metadata": {
                    "input_file_id": getattr(batch_status, 'input_file_id', None),
                    "output_file_id": getattr(batch_status, 'output_file_id', None),
                    "error_file_id": getattr(batch_status, 'error_file_id', None),
                    "endpoint": getattr(batch_status, 'endpoint', None),
                    "completion_window": getattr(batch_status, 'completion_window', None)
                }
            }
            
        except Exception as e:
            logger.error(f"❌ 查询真实批处理任务状态失败: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to get batch status: {str(e)}"
            }
    
    def _get_simulated_batch_status(self, batch_id: str) -> Dict[str, Any]:
        """
        获取模拟批处理任务的状态
        
        Args:
            batch_id: 模拟的批处理任务ID
            
        Returns:
            Dictionary containing simulated batch job status information
        """
        logger.info(f"检查模拟批处理任务状态: {batch_id}")
        
        # 模拟不同的状态
        import random
        import time
        
        # 为了演示，强制返回completed状态
        current_status = "completed"
        
        return {
            "success": True,
            "batch_id": batch_id,
            "status": current_status,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ") if current_status == "completed" else None,
            "failed_at": None,
            "in_progress_at": time.strftime("%Y-%m-%dT%H:%M:%SZ") if current_status == "in_progress" else None,
            "request_counts": {
                "total": 3,
                "completed": 3 if current_status == "completed" else 0,
                "failed": 0
            },
            "metadata": {
                "note": "This is a simulated batch job status"
            }
        }

    def get_batch_job_results(self, batch_id: str) -> List[Dict[str, Any]]:
        """
        Get the results of a completed batch job.
        
        Args:
            batch_id: The ID of the batch job
            
        Returns:
            List of dictionaries with processing results for each article
        """
        # 首先检查批处理任务状态
        status_info = self.get_batch_job_status(batch_id)
        if not status_info.get("success"):
            return [{"error": status_info.get("error")}]
        
        status = status_info.get("status")
        if status != "completed":
            logger.warning(f"Batch job {batch_id} is not completed yet. Current status: {status}")
            return [{"error": f"Batch job not completed yet. Current status: {status}"}]
        
        try:
            # 根据配置决定使用真实API还是模拟模式
            from .config import USE_REAL_BATCH_API
            
            if USE_REAL_BATCH_API:
                return self._get_real_batch_results(batch_id)
            else:
                return self._get_simulated_batch_results(batch_id)
                
        except Exception as e:
            logger.error(f"获取批处理结果失败: {str(e)}")
            return [{"error": f"Failed to get batch job results: {str(e)}"}]
    
    def _get_real_batch_results(self, batch_id: str) -> List[Dict[str, Any]]:
        """
        使用真实的阿里云灵积平台OpenAI兼容API获取批处理结果
        
        Args:
            batch_id: 真实的批处理任务ID
            
        Returns:
            List of dictionaries with processing results for each article
        """
        try:
            logger.info(f"📥 获取真实批处理任务结果: {batch_id}")
            
            # 1. 首先获取批处理状态以获取输出文件ID
            batch_status = self.client.batches.retrieve(batch_id)
            
            if batch_status.status != "completed":
                logger.warning(f"批处理任务 {batch_id} 尚未完成，当前状态: {batch_status.status}")
                return [{"error": f"Batch job not completed yet. Current status: {batch_status.status}"}]
            
            if not hasattr(batch_status, 'output_file_id') or not batch_status.output_file_id:
                logger.error(f"批处理任务 {batch_id} 没有输出文件ID")
                return [{"error": "No output file available for this batch"}]
            
            # 2. 下载输出文件
            output_file_id = batch_status.output_file_id
            logger.info(f"📄 下载输出文件: {output_file_id}")
            
            # 获取文件内容
            file_content = self.client.files.content(output_file_id)
            
            # 读取JSONL内容
            import json
            results = []
            
            # 文件内容是字节流，需要解码
            content_str = file_content.content.decode('utf-8')
            
            # 逐行解析JSONL
            for line in content_str.strip().split('\n'):
                if line.strip():
                    try:
                        import json
                        result_data = json.loads(line)
                        
                        # 解析结果格式
                        custom_id = result_data.get('custom_id')
                        response = result_data.get('response', {})
                        error = result_data.get('error')
                        
                        # 从custom_id中提取真正的article_id
                        # custom_id格式是 "prefix_article_id"，需要去掉前缀
                        if custom_id and '_' in custom_id:
                            # 找到第一个下划线后的部分作为article_id
                            article_id = custom_id.split('_', 1)[1]
                        else:
                            article_id = custom_id
                        
                        if error:
                            # 处理错误情况
                            results.append({
                                "article_id": article_id,
                                "success": False,
                                "error": error.get('message', str(error)),
                                "analysis": None
                            })
                        else:
                            # 处理成功情况
                            body = response.get('body', {})
                            choices = body.get('choices', [])
                            
                            if choices and len(choices) > 0:
                                content = choices[0].get('message', {}).get('content', '')
                                
                                # 解析LLM返回的JSON内容
                                try:
                                    # 使用现有的JSON清理方法
                                    cleaned_content = self._clean_json_content(content)
                                    parsed_result = json.loads(cleaned_content)
                                    
                                    # 创建标准格式的结果
                                    result_entry = {
                                        "article_id": article_id,
                                        "success": True,
                                        "summary": parsed_result.get("summary", ""),
                                        "keywords": parsed_result.get("keywords", ""),
                                        "photography_keywords": parsed_result.get("photography_keywords", ""),
                                        "activity_keywords": parsed_result.get("activity_keywords", ""),
                                        "exhibition_keywords": parsed_result.get("exhibition_keywords", ""),
                                        "academic_keywords": parsed_result.get("academic_keywords", ""),
                                        "activity_time": parsed_result.get("activity_time", ""),
                                        "location": parsed_result.get("location", ""),
                                        "location_city": parsed_result.get("location_city", ""),
                                        "organizer": parsed_result.get("organizer", ""),
                                        "artists": parsed_result.get("artists", ""),
                                        "sentiment": parsed_result.get("sentiment", ""),
                                        "error": None,
                                        "usage": body.get('usage', {})
                                    }
                                    results.append(result_entry)
                                except (json.JSONDecodeError, Exception) as parse_error:
                                    logger.error(f"Failed to parse LLM JSON response for article {article_id}: {parse_error}")
                                    logger.error(f"Raw content: {content[:200]}...")
                                    results.append({
                                        "article_id": article_id,
                                        "success": False,
                                        "error": f"JSON parse error: {str(parse_error)}",
                                        "analysis": content,
                                        "usage": body.get('usage', {})
                                    })
                            else:
                                results.append({
                                    "article_id": article_id,
                                    "success": False,
                                    "error": "No response content received",
                                    "analysis": None
                                })
                                
                    except json.JSONDecodeError as e:
                        logger.error(f"JSON解析错误: {str(e)}, 行内容: {line}")
                        results.append({
                            "article_id": "unknown",
                            "success": False,
                            "error": f"JSON parse error: {str(e)}",
                            "analysis": None
                        })
            
            logger.info(f"✅ 成功解析 {len(results)} 个批处理结果")
            return results
            
        except Exception as e:
            logger.error(f"❌ 获取真实批处理结果失败: {str(e)}")
            return [{"error": f"Failed to get batch results: {str(e)}"}]
    
    def _get_simulated_batch_results(self, batch_id: str) -> List[Dict[str, Any]]:
        """
        获取模拟批处理任务的结果
        
        Args:
            batch_id: 模拟的批处理任务ID
            
        Returns:
            List of dictionaries with processing results for each article
        """
        logger.info(f"获取模拟批处理任务结果: {batch_id}")
        
        # 模拟结果处理，提取原始batch_job创建时用到的文章信息
        # 通过批处理ID关联到之前处理的文章列表
        from .config import SIMULATION_ARTICLES
        article_infos = SIMULATION_ARTICLES.get(batch_id, [])
        
        if not article_infos:
            logger.warning(f"找不到批处理ID {batch_id} 对应的文章信息，返回空结果")
            return []
        
        # 注意：这是本地模拟实现，而非真正的异步批处理API调用
        # 实际上是使用同步API一篇一篇处理，只是模拟了异步批处理的接口形式
        # 未来应替换为真实的阿里云灵积批处理API调用
        logger.info(f"🔄 模拟Batch API (实际使用同步API逐个处理): 处理 {len(article_infos)} 篇文章")
        results = []
        
        for article in article_infos:
            # 处理单篇文章
            try:
                article_id = article['article_id']
                content = article['content']
                title = article.get('title')
                
                logger.info(f"处理文章 {article_id}: '{title[:30] + '...' if title and len(title) > 30 else title}'")
                result = self.summarize_text(content, title)
                
                # 添加article_id和成功标志
                result_with_id = {
                    "article_id": article_id,
                    "success": True,
                    **result
                }
                results.append(result_with_id)
                logger.info(f"文章 {article_id} 处理成功")
            except Exception as e:
                logger.error(f"处理文章 {article.get('article_id', 'unknown')} 时出错: {str(e)}")
                results.append({
                    "article_id": article.get('article_id', 'unknown'),
                    "success": False,
                    "error": str(e)
                })
        
        logger.info(f"模拟异步批处理完成，共处理 {len(results)} 篇文章，成功 {sum(1 for r in results if r.get('success', False))} 篇")
        return results
            
    def summarize_batch_sync(self,
                           texts: List[Dict[str, Any]], 
                           max_wait_hours: int = 24,
                           check_interval_seconds: int = 30) -> List[Dict[str, Any]]:
        """
        Synchronous batch processing that waits for completion.
        注意：这个方法会阻塞直到批处理任务完成，可能需要几个小时。
        
        Args:
            texts: List of dictionaries, each with 'article_id', 'content', and optionally 'title'
            max_wait_hours: Maximum hours to wait for completion (default: 24)
            check_interval_seconds: Seconds between status checks (default: 30)
            
        Returns:
            List of dictionaries with processing results for each article
        """
        if not texts:
            return []
            
        # 创建批处理任务
        batch_info = self.create_batch_job(texts)
        if not batch_info.get("success"):
            return [{"error": batch_info.get("error")}]
        
        batch_id = batch_info["batch_id"]
        logger.info(f"Created batch job {batch_id}. Waiting for completion...")
        logger.warning(f"This may take up to {max_wait_hours} hours. Checking every {check_interval_seconds} seconds.")
        
        # 轮询等待完成
        max_checks = (max_wait_hours * 3600) // check_interval_seconds
        for check_count in range(max_checks):
            status_info = self.get_batch_job_status(batch_id)
            if not status_info.get("success"):
                return [{"error": status_info.get("error")}]
            
            status = status_info.get("status")
            if status == "completed":
                logger.info(f"Batch job {batch_id} completed successfully!")
                return self.get_batch_job_results(batch_id)
            elif status == "failed":
                logger.error(f"Batch job {batch_id} failed!")
                return [{"error": "Batch job failed"}]
            elif status in ["cancelled", "expired"]:
                logger.error(f"Batch job {batch_id} was {status}")
                return [{"error": f"Batch job was {status}"}]
            
            # 等待下一次检查
            wait_seconds = check_interval_seconds
            logger.info(f"Batch job {batch_id} status: {status}. Waiting {check_interval_seconds} seconds for next check...")
            time.sleep(wait_seconds)
        
        # 超时
        logger.error(f"Batch job {batch_id} did not complete within {max_wait_hours} hours")
        return [{"error": f"Batch job timed out after {max_wait_hours} hours"}]

    async def async_summarize_text(self,
                          text: str,
                          title: Optional[str] = None) -> Dict[str, Any]:
        """
        Asynchronous version of summarize_text - Generate a summary, keywords, and analysis for the given text.
        
        Args:
            text: The article text to summarize (can be HTML or plain text)
            title: Optional title of the article
            
        Returns:
            Dictionary containing summary, keywords, and other analysis fields
        """
        # Use shared method to prepare text and prompts
        processed_text, system_message, user_message = self._prepare_text_and_prompt(text, title)
        
        # Set up debug logging
        text_preview = processed_text[:100] + "..." if len(processed_text) > 100 else processed_text
        logger.debug(f"Processing text (preview): {text_preview}")

        # Initialize the async client on demand
        if not self._async_client:
            self._async_client = httpx.AsyncClient(timeout=TIMEOUT)
            
        # Prepare the API request payload
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.3,
            "response_format": {"type": "json_object"}
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        # Perform retries if the API call fails
        for attempt in range(MAX_RETRIES):
            response = None  # Initialize response variable
            try:
                # Make async API request
                url = f"{self.api_base}/chat/completions"
                response = await self._async_client.post(
                    url, 
                    headers=headers, 
                    json=payload
                )
                response.raise_for_status()
                
                # Parse the response
                response_data = response.json()
                if response_data.get("choices") and response_data["choices"][0].get("message"):
                    content = response_data["choices"][0]["message"].get("content", "")
                    if content:
                        try:
                            # Handle cases where LLM returns JSON wrapped in markdown code blocks
                            content_to_parse = self._clean_json_content(content)
                            return json.loads(content_to_parse)
                        except json.JSONDecodeError as json_err:
                            logger.error(f"Failed to parse LLM JSON response: {json_err}")
                            logger.error(f"Response content: {content[:500]}...")  # Log first 500 chars
                            if attempt < MAX_RETRIES - 1:
                                wait_time = 2 ** attempt
                                logger.warning(f"JSON parsing error, retrying in {wait_time} seconds...")
                                await asyncio.sleep(wait_time)
                                continue
                            else:
                                return self._get_error_response("Error: Invalid JSON in LLM response.")
                
                # If we got a response but couldn't extract content properly
                logger.error(f"Invalid response structure: {response_data}")
                return self._get_error_response("Error: Invalid response format from LLM API.")

            except httpx.HTTPError as e:
                logger.error(f"HTTP error: {e}")
                # Try to get more details about the error
                error_details = str(e)
                if hasattr(e, 'request') and e.request:
                    logger.error(f"Request URL: {e.request.url}")
                
                if attempt < MAX_RETRIES - 1:
                    wait_time = 2 ** attempt  # Exponential backoff
                    logger.warning(f"HTTP error: {error_details}. Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)  # async sleep
                else:
                    logger.error(f"Max retries reached. HTTP error: {error_details}")
                    return self._get_error_response(
                        f"Error: Unable to generate summary after {MAX_RETRIES} attempts."
                    )
            except json.JSONDecodeError as e:
                # This catches JSON decode errors from response.json()
                logger.error(f"Failed to parse API response as JSON: {e}")
                # Try to get response text for debugging
                if response is not None:
                    try:
                        response_text = response.text
                        logger.error(f"Raw response: {response_text[:200]}...")
                    except Exception as debug_err:
                        logger.error(f"Could not access response text: {debug_err}")
                else:
                    logger.error("Response object is None")
                
                if attempt < MAX_RETRIES - 1:
                    wait_time = 2 ** attempt
                    logger.warning(f"API response JSON error: {str(e)}. Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"Max retries reached. JSON decode error: {str(e)}")
                    return self._get_error_response(
                        f"Error: Unable to parse API response after {MAX_RETRIES} attempts."
                    )
            except Exception as e:
                logger.error(f"Unexpected error: {str(e)}")
                return self._get_error_response("Error: An unexpected error occurred.")
        
        # 如果所有重试都失败了，返回错误响应
        return self._get_error_response(f"Error: Unable to generate summary after {MAX_RETRIES} attempts.")

    async def async_summarize_batch(
            self, articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Process a batch of articles asynchronously.
        
        Args:
            articles: List of article dictionaries, each with 'article_id', 'content', and optionally 'title'
            
        Returns:
            List of dictionaries with article_id and processing results
        """

        async def process_article(article):
            try:
                article_id = article["article_id"]
                content = article['content']
                title = article.get('title')

                logger.info(
                    f"Processing article {article_id}: '{title}' ({len(content)} chars)"
                )

                # Process the article using async method for true parallel processing
                result = await self.async_summarize_text(content, title)

                logger.info(f"Article {article_id} processed successfully")
                return {
                    "article_id": article_id,
                    "success": True,
                    "summary": result.get("summary", ""),
                    "keywords": result.get("keywords", ""),
                    "photography_keywords": result.get("photography_keywords", ""),
                    "activity_keywords": result.get("activity_keywords", ""),
                    "exhibition_keywords": result.get("exhibition_keywords", ""),
                    "academic_keywords": result.get("academic_keywords", ""),
                    "activity_time": result.get("activity_time", ""),
                    "location": result.get("location", ""),
                    "location_city": result.get("location_city", ""),
                    "organizer": result.get("organizer", ""),
                    "artists": result.get("artists", ""),
                    "sentiment": result.get("sentiment", "")
                }
            except Exception as e:
                logger.error(
                    f"Error processing article {article['article_id']}: {str(e)}"
                )
                return {
                    "article_id": article["article_id"],
                    "success": False,
                    "error": str(e)
                }

        # Clean up any existing client if we have one
        if hasattr(self, '_async_client') and self._async_client is not None:
            await self._async_client.aclose()
            self._async_client = None
            
        # Initialize a new shared async client for all requests
        self._async_client = httpx.AsyncClient(timeout=TIMEOUT)
        
        try:
            # Create and run tasks in parallel
            tasks = [process_article(article) for article in articles]
            return await asyncio.gather(*tasks)
        finally:
            # Clean up the client when we're done
            if self._async_client:
                await self._async_client.aclose()
                self._async_client = None
