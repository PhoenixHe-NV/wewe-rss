#!/usr/bin/env python3
"""
Main script for processing article content with LLM and saving results to the database.
"""
import argparse
import asyncio
import logging
import time
import sys
from typing import Dict, List, Any

from ai_process import DatabaseClient, LLMClient
from ai_process.config import BATCH_SIZE

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('ai_process.log')
    ]
)
logger = logging.getLogger(__name__)

async def process_batch(db_client: DatabaseClient, llm_client: LLMClient, batch_size: int, mp_id: Optional[str] = None) -> int:
    """
    Process a batch of articles and save results to the database.
    
    Args:
        db_client: Database client instance
        llm_client: LLM client instance
        batch_size: Number of articles to process in the batch
        mp_id: Optional media publication ID to filter articles by
        
    Returns:
        Number of successfully processed articles
    """
    # Get unprocessed article caches, filtering by mp_id if provided
    articles = db_client.get_unprocessed_article_caches(batch_size, mp_id)
    
    if not articles:
        logger.info("No unprocessed articles found.")
        return 0
        
    logger.info(f"Processing batch of {len(articles)} articles...")
    
    # Process the articles in parallel
    results = await llm_client.async_summarize_batch(articles)
    
    # Save results to database
    success_count = 0
    for result in results:
        if result.get("success", False):
            article_id = result["article_id"]
            summary = result["summary"]
            keywords = result.get("keywords", "")
            photography_keywords = result.get("photography_keywords", "")
            activity_keywords = result.get("activity_keywords", "")
            activity_time = result.get("activity_time", "")
            location = result.get("location", "")
            location_city = result.get("location_city", "")
            organizer = result.get("organizer", "")
            sentiment = result.get("sentiment", "")
            
            saved = db_client.save_ai_summary(
                article_id=article_id,
                summary=summary,
                keywords=keywords,
                photography_keywords=photography_keywords,
                activity_keywords=activity_keywords,
                activity_time=activity_time,
                location=location,
                location_city=location_city,
                organizer=organizer,
                sentiment=sentiment
            )
            
            if saved:
                success_count += 1
                logger.info(f"Successfully processed and saved summary for article {article_id}")
            else:
                logger.error(f"Failed to save summary for article {article_id}")
        else:
            logger.error(f"Failed to process article {result['article_id']}: {result.get('error', 'Unknown error')}")
            
    return success_count

async def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(description="Process article content with LLM and save summaries")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Batch size for processing")
    parser.add_argument("--continuous", action="store_true", help="Run in continuous mode, processing new articles as they arrive")
    parser.add_argument("--sleep", type=int, default=300, help="Sleep time in seconds between batches in continuous mode")
    parser.add_argument("--max-articles", type=int, default=0, help="Maximum number of articles to process (0 for unlimited)")
    parser.add_argument("--mp-id", type=str, help="Media publication ID to filter articles by")
    args = parser.parse_args()
    
    # Initialize clients
    db_client = DatabaseClient()
    llm_client = LLMClient()
    
    # Get initial stats with optional mp_id filter
    mp_id = args.mp_id
    stats = db_client.get_processing_stats(mp_id)
    
    # Log startup information
    logger.info(f"Starting processor with date filter: {stats['date_filter']}")
    
    # Add mp information if provided
    if mp_id and 'mp_name' in stats:
        logger.info(f"Filtering by media publication: {stats['mp_name']} (ID: {mp_id})")
    
    logger.info(f"Initial stats: {stats['total_articles']} total articles, {stats['processed_articles']} processed, {stats['articles_in_date_range']} articles in date range")
    
    total_processed = 0
    max_articles = args.max_articles
    
    try:
        while True:
            # Process a batch
            processed = await process_batch(db_client, llm_client, args.batch_size, mp_id)
            total_processed += processed
            
            # Check if we've hit the maximum
            if max_articles > 0 and total_processed >= max_articles:
                logger.info(f"Reached maximum number of articles to process ({max_articles}). Exiting.")
                break
                
            # If no articles were processed and we're not in continuous mode, exit
            if processed == 0 and not args.continuous:
                logger.info("No more articles to process. Exiting.")
                break
                
            # In continuous mode, sleep before the next batch
            if args.continuous:
                # Get updated stats
                stats = db_client.get_processing_stats(mp_id)
                logger.info(f"Progress: {stats['processed_articles']}/{stats['articles_in_date_range']} articles processed " +
                           f"({stats['completion_percentage']}% complete)")
                
                # Sleep between batches
                if processed == 0:
                    logger.info(f"No new articles to process. Sleeping for {args.sleep} seconds...")
                    time.sleep(args.sleep)
                    
    except KeyboardInterrupt:
        logger.info("Process interrupted by user.")
    finally:
        # Get final stats
        stats = db_client.get_processing_stats(mp_id)
        logger.info(f"Final stats: {stats['processed_articles']}/{stats['articles_in_date_range']} articles processed")
        logger.info(f"Total articles processed in this run: {total_processed}")
        
if __name__ == "__main__":
    asyncio.run(main())
