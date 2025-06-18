#!/bin/bash
set -e

# Run the article AI processor
# Usage: ./run_ai_processor.sh [--batch-size 20] [--continuous] [--sleep 300]

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Creating example .env file. Please edit it with your actual values."
  cp .env.example .env
fi

# Run with Poetry
cd "$(dirname "$0")/python"
poetry run python process_articles.py "$@"
