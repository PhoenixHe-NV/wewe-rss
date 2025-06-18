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
