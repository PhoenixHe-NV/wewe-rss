#!/usr/bin/env python3
"""
Simple script to run the AI article processor
"""
import os
import sys
from pathlib import Path
import asyncio
import argparse

# Add the current directory to the Python path
current_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(current_dir))

from ai_process.processor import main

if __name__ == "__main__":
    # Run the main function
    asyncio.run(main())
