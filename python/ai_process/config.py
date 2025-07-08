"""
Configuration for AI processing module.
"""
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Ali Bailian API Configuration (OpenAI compatible)
API_BASE_URL = os.getenv("ALI_BAILIAN_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1")
API_KEY = os.getenv("ALI_BAILIAN_API_KEY", "")
DEFAULT_MODEL = os.getenv("ALI_BAILIAN_MODEL", "qwen-max")  # Default model for Ali Bailian

# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Processing Configuration
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "10"))  # Number of articles to process in a batch
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))  # Max number of retries for API calls
TIMEOUT = int(os.getenv("TIMEOUT", "60"))  # Timeout for API calls in seconds

# Batch Processing Configuration
BATCH_MAX_WAIT_HOURS = int(os.getenv("BATCH_MAX_WAIT_HOURS", "24"))  # Maximum hours to wait for batch completion
BATCH_CHECK_INTERVAL_SECONDS = int(os.getenv("BATCH_CHECK_INTERVAL_SECONDS", "30"))  # Seconds between status checks

# Batch API Mode Configuration
USE_REAL_BATCH_API = os.getenv("USE_REAL_BATCH_API", "false").lower() == "true"  # 是否使用真实的Batch API

# 模拟模式下存储批处理任务与文章的映射关系
SIMULATION_ARTICLES = {}
