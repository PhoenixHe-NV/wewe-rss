# Article AI Processor Usage Guide

This guide explains how to use the AI processor to generate summaries for articles.

> **Note:** The processor is currently configured to only process articles published between **January 1, 2024** and **January 1, 2025**. This date filter is applied automatically.

## Prerequisites

1. Set up the `.env` file with the correct values:
   ```
   # Update with your actual database connection string
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wewe_rss
   
   # Update with your Ali Bailian API key
   ALI_BAILIAN_API_KEY=your_api_key_here
   ALI_BAILIAN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
   ALI_BAILIAN_MODEL=qwen-max
   
   # Processing settings
   BATCH_SIZE=10
   MAX_RETRIES=3
   TIMEOUT=60
   ```

2. Make sure all Python dependencies are installed:
   ```bash
   cd /path/to/wewe-rss/python
   poetry install --no-root
   ```

## Running the Processor

You have several options to run the processor:

### Option 1: Using the shell script (recommended)

```bash
cd /path/to/wewe-rss/python
./run_processor.sh --batch-size 20 --continuous
```

### Option 2: Using Poetry directly

```bash
cd /path/to/wewe-rss/python
poetry run python process_articles.py --batch-size 20 --continuous
```

### Option 3: Running the executable Python script

```bash
cd /path/to/wewe-rss/python
./process_articles.py --batch-size 20 --continuous
```

## Command-line Options

- `--batch-size N`: Process N articles in each batch (default: 10)
- `--continuous`: Run in continuous mode, checking for new articles periodically
- `--sleep N`: Sleep N seconds between batches in continuous mode (default: 300)
- `--max-articles N`: Process a maximum of N articles and exit (0 means unlimited)
- `--mp-id ID`: Process only articles from a specific media publication ID

## Examples

1. Process 50 articles and exit:
   ```bash
   ./run_processor.sh --max-articles 50
   ```

2. Run in continuous mode with a large batch size:
   ```bash
   ./run_processor.sh --batch-size 50 --continuous
   ```

3. Run in continuous mode with more frequent checks:
   ```bash
   ./run_processor.sh --continuous --sleep 60
   ```

4. Process articles from a specific media publication:
   ```bash
   ./run_processor.sh --mp-id "media_publication_id"
   ```

5. Combine multiple options:
   ```bash
   ./run_processor.sh --mp-id "media_publication_id" --batch-size 20 --continuous
   ```

## Logs

The processor logs information to both the console and a log file named `ai_process.log` in the current directory.
