# Article AI Processor Usage Guide

This guide explains how to use the AI processor to generate summaries for articles using Ali Bailian LLM service.

> **Note:** The processor is currently configured to only process articles published between **January 1, 2024** and **January 1, 2025**. This date filter is applied automatically.

## Prerequisites

### System Requirements
- Python 3.12 or newer
- Poetry for dependency management
- PostgreSQL database with WeWe RSS schema
- Ali Bailian API key (OpenAI-compatible API)

### Installation

1. Install dependencies using Poetry:
   ```bash
   cd /path/to/wewe-rss/python
   poetry install --no-root
   ```

2. Set up the `.env` file with the correct values:
   ```
   # Database Configuration
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wewe_rss
   
   # Ali Bailian API Configuration
   ALI_BAILIAN_API_KEY=your_api_key_here
   ALI_BAILIAN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
   ALI_BAILIAN_MODEL=qwen-max
   
   # Processing Configuration
   BATCH_SIZE=10
   MAX_RETRIES=3
   TIMEOUT=60
   
   # Batch Processing Configuration
   BATCH_MAX_WAIT_HOURS=24
   BATCH_CHECK_INTERVAL_SECONDS=30
   
   # Batch API Mode (set to "true" for production batch processing)
   USE_REAL_BATCH_API=false
   ```

## Processing Modes

### 1. Parallel Processing Mode (Default)
Fast processing using parallel API calls, suitable for real-time processing.

### 2. Batch Processing Mode (Asynchronous)
Uses Ali Bailian's Batch API for large-scale, cost-effective processing. Offers 50% cost savings but takes up to 24 hours to complete.

## Running the Processor

### Option 1: Using the shell script (recommended)

```bash
cd /path/to/wewe-rss/python
./run_processor.sh --batch-size 20 --continuous
```

### Option 2: Using Poetry directly

```bash
cd /path/to/wewe-rss/python
poetry run python run_ai_processor.py --batch-size 20 --continuous
```

### Option 3: Running the executable Python script

```bash
cd /path/to/wewe-rss/python
./run_ai_processor.py --batch-size 20 --continuous
```

## Command-line Options

### Basic Options
- `--batch-size N`: Process N articles in each batch (default: 10)
- `--continuous`: Run in continuous mode, checking for new articles periodically
- `--sleep N`: Sleep N seconds between batches in continuous mode (default: 300)
- `--max-articles N`: Process a maximum of N articles and exit (0 means unlimited)
- `--mp-id ID`: Process only articles from a specific media publication ID

### Batch Processing Options
- `--async-batch`: Use asynchronous batch processing (Ali Bailian Batch API)
- `--batch-check-interval N`: Seconds between batch status checks (default: 30)

## Usage Examples

### Standard Processing

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

### Batch Processing (Large Scale)

1. Enable real Batch API and process 1000 articles:
   ```bash
   export USE_REAL_BATCH_API="true"
   ./run_processor.sh --async-batch --max-articles 1000
   ```

2. Batch processing with custom check interval:
   ```bash
   USE_REAL_BATCH_API=true ./run_processor.sh --async-batch --batch-check-interval 60
   ```

3. Combine multiple options:
   ```bash
   ./run_processor.sh --mp-id "media_publication_id" --batch-size 20 --continuous
   ```

## Batch API Features

### Dual-Mode Architecture
- **Real API Mode**: Uses Ali Bailian's OpenAI-compatible Batch API
- **Simulation Mode**: For development and testing

### Complete Batch Processing Flow
1. **Create Batch Job**: Upload JSONL file → Create batch task → Return task ID
2. **Monitor Status**: Query task status (validating → in_progress → completed)
3. **Retrieve Results**: Download result file → Parse JSONL → Format output

### Configuration Management
```python
# Environment variable control
USE_REAL_BATCH_API = os.getenv("USE_REAL_BATCH_API", "false").lower() == "true"

# Automatic mode switching
if USE_REAL_BATCH_API:
    return self._create_real_batch_job(jsonl_content, texts)
else:
    return self._create_simulated_batch_job(texts)
```

### Performance Comparison

| Feature | Real Batch API | Simulation Mode | Real-time API |
|---------|----------------|-----------------|---------------|
| Cost | 50% discount | Free (dev) | Standard price |
| Latency | Within 24 hours | Immediate | Seconds |
| Scale | Unlimited | Unlimited | Concurrency limited |
| Use Case | Large batch offline | Dev/testing | Real-time interaction |

## Error Handling

### Automatic Fallback Strategy
- Falls back to simulation mode if real API fails
- Detailed error logging
- Network exception and timeout handling

### Status Monitoring
- Supports all official statuses: validating, in_progress, finalizing, completed, failed, expired, cancelled
- Complete request count statistics
- Timestamp recording

## Logs and Monitoring

The processor logs information to both the console and a log file named `ai_process.log` in the current directory.

### Log Levels
- INFO: General processing information
- WARNING: Non-critical issues and fallbacks
- ERROR: Critical errors requiring attention

## Development

### Module Structure
```
python/
├── ai_process/
│   ├── config.py              # Configuration management
│   ├── database.py            # Database operations
│   ├── llm_client.py          # LLM client with Batch API support
│   └── processor.py           # Main processing logic
├── run_ai_processor.py        # Main execution script
└── AI_PROCESSOR_USAGE.md      # This documentation
```

### Core Components
- `database.py`: Handles database operations
- `llm_client.py`: Interacts with Ali Bailian LLM API (both real-time and batch)
- `processor.py`: Main processing logic with dual-mode support
- `config.py`: Configuration management

### Adding New Features
To add new analysis features, modify the `llm_client.py` file and update the system prompt or add new processing functions.

## Troubleshooting

### Common Issues

1. **API Authentication Errors**
   - Check ALI_BAILIAN_API_KEY is correctly set
   - Verify API key has necessary permissions

2. **Database Connection Issues**
   - Verify DATABASE_URL is correct
   - Check database server is running

3. **Batch Processing Not Starting**
   - Ensure USE_REAL_BATCH_API="true" is set
   - Check API quota and limits

4. **Long Processing Times**
   - Batch API typically takes several hours
   - Check status with shorter --batch-check-interval
   - Monitor logs for progress updates

### Configuration Testing
```bash
# Test current configuration
python -c "
from ai_process.config import USE_REAL_BATCH_API, BATCH_CHECK_INTERVAL_SECONDS
print(f'Real Batch API: {USE_REAL_BATCH_API}')
print(f'Check Interval: {BATCH_CHECK_INTERVAL_SECONDS} seconds')
"
```

## Best Practices

### For Development
- Use simulation mode (USE_REAL_BATCH_API=false)
- Test with small --max-articles values
- Use shorter check intervals for faster feedback

### For Production
- Enable real Batch API (USE_REAL_BATCH_API=true)
- Use appropriate batch sizes (50-1000 articles)
- Monitor costs and API quotas
- Set reasonable check intervals (60-300 seconds)

### For Large Scale Processing
- Process during off-peak hours
- Monitor batch job status regularly
- Have fallback strategies for failed batches
- Keep detailed logs for troubleshooting

---
*Last updated: July 3, 2025*
