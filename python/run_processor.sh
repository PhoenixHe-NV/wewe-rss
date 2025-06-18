#!/bin/bash
# Run the AI processor with Poetry environment activated

# Change to the script directory
cd "$(dirname "$0")"

# Process command line arguments
ARGS=""
for arg in "$@"; do
  ARGS="$ARGS $arg"
done

# Run the processor with Poetry
poetry run python run_ai_processor.py $ARGS
