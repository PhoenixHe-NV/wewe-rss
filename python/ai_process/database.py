"""
Database operations for AI processing.
"""
import asyncio
import uuid
from typing import List, Optional, Dict, Any
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
import pandas as pd
import logging

from .config import DATABASE_URL

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DatabaseClient:
    def __init__(self, connection_string: str = DATABASE_URL):
        self.engine = create_engine(connection_string)
        
    def get_unprocessed_article_caches(self, limit: int = 100, mp_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get article caches that haven't been processed by AI yet.
        Filters articles to those published between 2024-01-01 and 2025-01-01.
        
        Args:
            limit: Maximum number of articles to fetch
            mp_id: Optional media publication ID to filter by
            
        Returns:
            List of article caches with their content and metadata
        """
        try:
            # Convert dates to Unix timestamps
            # 2024-01-01 00:00:00 UTC = 1704067200
            # 2025-01-01 00:00:00 UTC = 1735689600
            start_timestamp = 1704067200
            end_timestamp = 1735689600
            
            # Build the query with optional mp_id filter
            base_query = """
            SELECT ac.article_id, ac.content, a.title, a.publish_time, a.mp_id
            FROM article_caches ac
            JOIN articles a ON ac.article_id = a.id
            LEFT JOIN article_ai_summaries ais ON ac.article_id = ais.article_id
            WHERE ais.article_id IS NULL
              AND a.publish_time >= :start_time
              AND a.publish_time <= :end_time
            """
            
            # Add mp_id filter if provided
            if mp_id:
                query = base_query + " AND a.mp_id = :mp_id LIMIT :limit"
                params = {
                    "limit": limit, 
                    "start_time": start_timestamp, 
                    "end_time": end_timestamp,
                    "mp_id": mp_id
                }
            else:
                query = base_query + " LIMIT :limit"
                params = {
                    "limit": limit, 
                    "start_time": start_timestamp, 
                    "end_time": end_timestamp
                }
            
            with self.engine.connect() as conn:
                result = conn.execute(text(query), params)
                articles = [
                    {
                        "article_id": row[0],
                        "content": row[1],
                        "title": row[2],
                        "publish_time": row[3],
                        "mp_id": row[4]
                    }
                    for row in result
                ]
            
            return articles
        except SQLAlchemyError as e:
            logger.error(f"Database error when fetching unprocessed articles: {str(e)}")
            return []
            
    def save_ai_summary(
        self, 
        article_id: str, 
        summary: str, 
        keywords: Optional[str] = None,
        photography_keywords: Optional[str] = None,
        activity_keywords: Optional[str] = None,
        activity_time: Optional[str] = None,
        location: Optional[str] = None,
        location_city: Optional[str] = None,
        organizer: Optional[str] = None,
        sentiment: Optional[str] = None
    ) -> bool:
        """
        Save AI-generated summary to the database.
        
        Args:
            article_id: ID of the article
            summary: Generated summary text
            keywords: Optional keywords extracted from the article
            photography_keywords: Optional keywords related to photography/video
            activity_keywords: Optional keywords related to academic activities
            activity_time: Optional activity time (YYYY-MM-DD format)
            location: Optional activity location
            location_city: Optional city where the activity takes place
            organizer: Optional organizer of the activity
            sentiment: Optional sentiment analysis result
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Generate a UUID for the id field
            summary_id = str(uuid.uuid4())
            
            query = """
            INSERT INTO article_ai_summaries (
                id, article_id, summary, keywords, photography_keywords, 
                activity_keywords, activity_time, location, location_city, 
                organizer, sentiment
            )
            VALUES (
                :id, :article_id, :summary, :keywords, :photography_keywords,
                :activity_keywords, :activity_time, :location, :location_city,
                :organizer, :sentiment
            )
            ON CONFLICT (article_id) 
            DO UPDATE SET 
                summary = :summary,
                keywords = :keywords,
                photography_keywords = :photography_keywords,
                activity_keywords = :activity_keywords,
                activity_time = :activity_time,
                location = :location,
                location_city = :location_city,
                organizer = :organizer,
                sentiment = :sentiment,
                updated_at = CURRENT_TIMESTAMP
            """
            
            with self.engine.connect() as conn:
                conn.execute(
                    text(query), 
                    {
                        "id": summary_id,
                        "article_id": article_id, 
                        "summary": summary, 
                        "keywords": keywords,
                        "photography_keywords": photography_keywords,
                        "activity_keywords": activity_keywords,
                        "activity_time": activity_time,
                        "location": location,
                        "location_city": location_city,
                        "organizer": organizer,
                        "sentiment": sentiment
                    }
                )
                conn.commit()
            
            return True
        except SQLAlchemyError as e:
            logger.error(f"Database error when saving AI summary: {str(e)}")
            return False
            
    def get_processing_stats(self, mp_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get statistics about AI processing progress.
        
        Args:
            mp_id: Optional media publication ID to filter stats by
            
        Returns:
            Dictionary with count of processed and unprocessed articles and completion percentage
        """
        try:
            # Convert timestamps to readable dates
            from datetime import datetime
            start_date = datetime.fromtimestamp(1704067200).strftime('%Y-%m-%d')
            end_date = datetime.fromtimestamp(1735689600).strftime('%Y-%m-%d')
            
            # Base query counts
            base_query = """
            SELECT 
                (SELECT COUNT(*) FROM article_caches) as total_articles,
                (SELECT COUNT(*) FROM article_ai_summaries) as processed_articles
            """
            
            # Add mp_id filter for date range count if provided
            if mp_id:
                date_range_query = f"""
                , (SELECT COUNT(*) FROM articles a 
                   WHERE a.publish_time >= 1704067200 
                   AND a.publish_time <= 1735689600
                   AND a.mp_id = :mp_id) as articles_in_date_range
                """
                mp_name_query = f"""
                , (SELECT f.mp_name FROM feeds f WHERE f.id = :mp_id) as mp_name
                """
                query = base_query + date_range_query + mp_name_query
                params = {"mp_id": mp_id}
            else:
                date_range_query = f"""
                , (SELECT COUNT(*) FROM articles a 
                   WHERE a.publish_time >= 1704067200 
                   AND a.publish_time <= 1735689600) as articles_in_date_range
                """
                query = base_query + date_range_query
                params = {}
            
            with self.engine.connect() as conn:
                result = conn.execute(text(query), params)
                row = result.fetchone()
                
                if row:
                    total = row[0] or 0
                    processed = row[1] or 0
                    in_date_range = row[2] or 0
                    
                    stats = {
                        "total_articles": total,
                        "processed_articles": processed,
                        "remaining_articles": max(0, total - processed),
                        "completion_percentage": round((processed / total * 100) if total > 0 else 0, 2),
                        "articles_in_date_range": in_date_range,
                        "date_filter": f"{start_date} to {end_date}"
                    }
                    
                    # Add mp_id info if provided
                    if mp_id:
                        mp_name = row[3] if len(row) > 3 else "Unknown"
                        stats["mp_id"] = mp_id
                        stats["mp_name"] = mp_name
                        
                    return stats
                
                stats = {
                    "total_articles": 0, 
                    "processed_articles": 0, 
                    "remaining_articles": 0, 
                    "completion_percentage": 0,
                    "articles_in_date_range": 0,
                    "date_filter": f"{start_date} to {end_date}"
                }
                
                # Add mp_id info if provided
                if mp_id:
                    stats["mp_id"] = mp_id
                    stats["mp_name"] = "Unknown"
                    
                return stats
        except SQLAlchemyError as e:
            # Convert timestamps to readable dates again to ensure they're defined in this scope
            from datetime import datetime
            start_date = datetime.fromtimestamp(1704067200).strftime('%Y-%m-%d')
            end_date = datetime.fromtimestamp(1735689600).strftime('%Y-%m-%d')
            
            logger.error(f"Database error when fetching processing stats: {str(e)}")
            
            stats = {
                "total_articles": 0, 
                "processed_articles": 0, 
                "remaining_articles": 0, 
                "completion_percentage": 0,
                "articles_in_date_range": 0,
                "date_filter": f"{start_date} to {end_date}"
            }
            
            # Add mp_id info if provided
            if mp_id:
                stats["mp_id"] = mp_id
                stats["mp_name"] = "Unknown"
                
            return stats
