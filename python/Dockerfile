FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install Poetry
RUN pip install poetry && \
    poetry config virtualenvs.create false

# Copy Poetry configuration files
COPY poetry.lock pyproject.toml README.md ./

# Copy application code
COPY ai_process/ ./ai_process/
COPY process_articles.py ./

# Install dependencies
RUN poetry install --no-interaction --no-ansi

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Create a .env file if not provided at runtime
RUN echo "# This file will be overridden by mounted .env file" > .env

# Run the processor
ENTRYPOINT ["python", "process_articles.py"]
CMD ["--continuous", "--sleep", "300"]
