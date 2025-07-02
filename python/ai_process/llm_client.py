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
