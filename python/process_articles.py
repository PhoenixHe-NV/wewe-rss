#!/usr/bin/env python3
"""
Convenience script to run the article AI processor.
"""
import os
import sys
import argparse
from pathlib import Path

# Add the project root to sys.path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# Import the processor after adding to sys.path
from ai_process.processor import main
import asyncio

if __name__ == "__main__":
    # Parse arguments and pass them to the main function
    parser = argparse.ArgumentParser(description="Process article content with LLM")
    parser.add_argument("--batch-size", type=int, default=10, help="Number of articles to process in each batch")
    parser.add_argument("--continuous", action="store_true", help="Run in continuous mode")
    parser.add_argument("--sleep", type=int, default=300, help="Sleep time between batches in continuous mode")
    parser.add_argument("--max-articles", type=int, default=0, help="Maximum number of articles to process (0 for unlimited)")
    
    args = parser.parse_args()
    
    # Set environment variables for the process
    if os.path.exists(".env"):
        print("Loading environment variables from .env file")
    else:
        print("Warning: No .env file found. Make sure environment variables are set.")
    
    # Run the main function - don't pass args since main() already parses arguments
    asyncio.run(main())
