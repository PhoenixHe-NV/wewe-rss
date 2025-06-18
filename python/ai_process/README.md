# WeWe RSS AI Processing Module

This module processes article content from the WeWe RSS database using LLM (Ali Bailian) to generate summaries, extract keywords, and perform sentiment analysis.

## Setup

### Prerequisites

- Python 3.12 or newer
- Poetry for dependency management
- PostgreSQL database with WeWe RSS schema
- Ali Bailian API key (OpenAI-compatible API)

### Installation

1. Install dependencies using Poetry:

```bash
cd python
poetry install
```

2. Create a `.env` file based on the `.env.example` template:

```bash
cp .env.example .env
```

3. Edit the `.env` file with your database credentials and API keys:

```
DATABASE_URL=postgresql://username:password@localhost:5432/wewe_rss
ALI_BAILIAN_API_KEY=your_api_key_here
ALI_BAILIAN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
ALI_BAILIAN_MODEL=qwen-max
```

## Usage

### Process Articles in Batch Mode

To process unprocessed articles in a single batch:

```bash
poetry run python process_articles.py --batch-size 20
```

This will process up to 20 unprocessed articles and exit.

### Process Articles in Continuous Mode

To run the processor in continuous mode, which will keep checking for new articles:

```bash
poetry run python process_articles.py --continuous --sleep 300
```

This will process articles in batches and then sleep for 300 seconds before checking for new articles.

### Processing Options

- `--batch-size`: Number of articles to process in each batch (default: 10)
- `--continuous`: Run in continuous mode, processing new articles as they arrive
- `--sleep`: Sleep time in seconds between batches in continuous mode (default: 300)
- `--max-articles`: Maximum number of articles to process, 0 for unlimited (default: 0)

## Development

The AI processing module consists of:

- `database.py`: Handles database operations
- `llm_client.py`: Interacts with Ali Bailian LLM API
- `processor.py`: Main processing logic
- `config.py`: Configuration management

### Adding New Features

To add new analysis features, modify the `llm_client.py` file and update the prompt or add new processing functions.
