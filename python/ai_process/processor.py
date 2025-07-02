#!/usr/bin/env python3
"""
Main script for processing article content with LLM and saving results to the database.
"""
import argparse
import asyncio
import concurrent.futures
import logging
import time
import sys
from typing import Dict, List, Any, Optional

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

async def process_batch(db_client: DatabaseClient, llm_client: LLMClient, batch_size: int, mp_id: Optional[str] = None) -> Dict[str, int]:
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
        return {'processed': 0, 'success': 0, 'failed': 0}
        
    logger.info(f"Processing batch of {len(articles)} articles in parallel...")
    
    # Process the articles in parallel
    start_time = time.time()
    
    # Get total articles for progress reporting
    total_articles = len(articles)
    logger.info(f"Starting LLM processing for {total_articles} articles...")
    
    # Process all articles
    results = await llm_client.async_summarize_batch(articles)
    llm_time = time.time() - start_time
    
    # Show detailed results for each article
    success_count = 0
    for i, result in enumerate(results):
        article_id = result.get("article_id", "unknown")
        success = result.get("success", False)
        status = "✅ Success" if success else "❌ Failed"
        if success:
            success_count += 1
        
        # Show progress information
        percent = ((i + 1) / total_articles) * 100
        logger.info(f"Article {i+1}/{total_articles} ({percent:.1f}%): {status} - ID: {article_id}")
    
    logger.info(f"LLM processing completed in {llm_time:.2f} seconds for {total_articles} articles. Success rate: {success_count}/{total_articles} ({success_count/total_articles*100:.1f}%)")
    
    # Save results to database using a thread pool for concurrent operations
    success_count = 0
    successful_results = []
    failed_results = []
    
    # Separate successful and failed results
    for result in results:
        # Check if the result was marked as successful by the LLM client
        if result.get("success", False):
            # Also check if the summary starts with "Error:" which indicates a problem
            summary = result.get("summary", "")
            if summary.startswith("Error:"):
                logger.error(f"LLM processing error for article {result['article_id']}: {summary}")
                failed_results.append(result)
            else:
                successful_results.append(result)
        else:
            logger.error(f"Failed to process article {result['article_id']}: {result.get('error', 'Unknown error')}")
            failed_results.append(result)
    
    if successful_results:
        total_to_save = len(successful_results)
        logger.info(f"Saving {total_to_save} results to database in parallel...")
        start_db_time = time.time()
        
        def save_to_db(result, index):
            article_id = result["article_id"]
            try:
                saved = db_client.save_ai_summary(
                    article_id=article_id,
                    summary=result.get("summary", ""),
                    keywords=result.get("keywords", ""),
                    photography_keywords=result.get("photography_keywords", ""),
                    activity_keywords=result.get("activity_keywords", ""),
                    exhibition_keywords=result.get("exhibition_keywords", ""),
                    academic_keywords=result.get("academic_keywords", ""),
                    activity_time=result.get("activity_time", ""),
                    location=result.get("location", ""),
                    location_city=result.get("location_city", ""),
                    organizer=result.get("organizer", ""),
                    artists=result.get("artists", ""),
                    sentiment=result.get("sentiment", "")
                )
                
                if saved:
                    return (True, article_id, index)
                else:
                    logger.error(f"Failed to save summary for article {article_id}")
                    return (False, article_id, index)
            except Exception as e:
                logger.error(f"Error saving summary for article {article_id}: {str(e)}")
                return (False, article_id, index)
        
        # Use a ThreadPoolExecutor to run database saves in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, total_to_save)) as executor:
            # Submit all tasks to the executor with index for tracking
            future_to_result = {executor.submit(save_to_db, result, i): (result, i) 
                               for i, result in enumerate(successful_results)}
            
            saved_count = 0
            # Process results as they complete
            for future in concurrent.futures.as_completed(future_to_result):
                success, article_id, index = future.result()
                saved_count += 1
                percent = (saved_count / total_to_save) * 100
                
                if success:
                    success_count += 1
                    status = "✅ Saved"
                else:
                    status = "❌ Failed"
                
                # Show progress for each saved article
                logger.info(f"DB Save {saved_count}/{total_to_save} ({percent:.1f}%): {status} - Article ID: {article_id}")
        
        db_time = time.time() - start_db_time
        logger.info(f"Database operations completed in {db_time:.2f} seconds. Success rate: {success_count}/{total_to_save} ({success_count/total_to_save*100:.1f}%)")            # Report failed articles that will be available for retry
    if failed_results:
        failed_count = len(failed_results)
        logger.warning(f"{failed_count} articles failed processing and will be available for retry later:")
        for i, result in enumerate(failed_results, 1):
            article_id = result.get("article_id", "unknown")
            error = result.get("error", "Unknown error")
            if not error and "summary" in result:
                error = result.get("summary", "")
            logger.warning(f"  {i}. Article ID: {article_id} - Error: {error}")
    
    # Return detailed results about the batch processing
    return {
        'processed': len(articles),        # Total processed in this batch
        'success': success_count,          # Successfully processed and saved
        'failed': len(failed_results)      # Failed in this batch
    }

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
    total_success = 0
    total_failed = 0
    max_articles = args.max_articles
    
    # Get the total number of articles to process for overall progress tracking
    total_to_process = stats['articles_in_date_range'] - stats['processed_articles']
    if max_articles > 0 and max_articles < total_to_process:
        total_to_process = max_articles
        
    logger.info(f"Overall plan: processing up to {total_to_process} articles")
    start_time_total = time.time()
    
    try:
        while True:
            # Get updated stats before each batch for progress tracking
            current_stats = db_client.get_processing_stats(mp_id)
            articles_done = current_stats['processed_articles'] - stats['processed_articles']
            
            # Show overall progress
            if total_to_process > 0:
                overall_percent = (articles_done / total_to_process) * 100
                elapsed_time = time.time() - start_time_total
                articles_per_minute = (articles_done / elapsed_time) * 60 if elapsed_time > 0 else 0
                
                logger.info(f"OVERALL PROGRESS: {articles_done}/{total_to_process} articles ({overall_percent:.1f}%) - " +
                          f"Speed: {articles_per_minute:.1f} articles/minute - " +
                          f"Success: {total_success} | Failed: {total_failed}")
            
            # Process a batch
            batch_result = await process_batch(db_client, llm_client, args.batch_size, mp_id)
            processed = batch_result['processed']
            success = batch_result['success']
            failed = batch_result['failed']
            
            total_processed += processed
            total_success += success
            total_failed += failed
            
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
        end_stats = db_client.get_processing_stats(mp_id)
        elapsed_time = time.time() - start_time_total
        minutes, seconds = divmod(elapsed_time, 60)
        hours, minutes = divmod(minutes, 60)
        
        # Calculate the completion percentage
        initial_processed = stats['processed_articles']
        final_processed = end_stats['processed_articles']
        newly_processed = final_processed - initial_processed
        
        logger.info(f"========== PROCESSING COMPLETE ==========")
        logger.info(f"Total processing time: {int(hours)}h {int(minutes)}m {int(seconds)}s")
        logger.info(f"Articles processed in this run: {newly_processed} (Success: {total_success}, Failed: {total_failed})")
        
        if newly_processed > 0:
            articles_per_hour = (newly_processed / elapsed_time) * 3600 if elapsed_time > 0 else 0
            logger.info(f"Processing speed: {articles_per_hour:.1f} articles per hour")
            
        logger.info(f"Overall database status: {final_processed}/{end_stats['articles_in_date_range']} articles processed ({end_stats['completion_percentage']}% complete)")
        logger.info(f"=========================================")
        
if __name__ == "__main__":
    asyncio.run(main())
