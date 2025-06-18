import datetime
import time
import pandas as pd
import sqlalchemy
import html2text
import html2markdown
from bs4 import BeautifulSoup
from tqdm.auto import tqdm

def get_timestamp(year, month, day):
    """Convert a date to Unix timestamp."""
    dt = datetime.datetime(year, month, day, 0, 0, 0, tzinfo=datetime.timezone.utc)
    return int(dt.timestamp())

def get_sql_to_dump():
    # Calculate timestamps for Jan 1, 2024 and Jan 1, 2025
    start_timestamp = get_timestamp(2024, 1, 1)
    end_timestamp = get_timestamp(2025, 1, 1)
    
    query = f"""
    select
        ac."content" as "content_html",
        a."title",
        a."publish_time",
        f.mp_name
    from
        article_caches ac
    join
        articles a
    on ac.article_id = a.id
    join
        feeds f
    on f.id = a.mp_id
    where
        a."publish_time" >= {start_timestamp} -- January 1st, 2024, 00:00:00 UTC
        and a."publish_time" < {end_timestamp} -- January 1st, 2025, 00:00:00 UTC
    """
    return query

def main():
    # Get the SQL query
    sql = get_sql_to_dump()
    
    # Database connection string
    db_connection_string = "postgresql://htc:htcNet.moe@172.27.42.5:5432/wewe_rss"
    
    try:
        # Create engine
        engine = sqlalchemy.create_engine(db_connection_string)
        
        # Connect to the database and execute the query
        print("Connecting to database...")
        with engine.connect() as connection:
            print("Executing query...")
            df = pd.read_sql_query(sql, connection)
            
            # Print some information about the DataFrame
            print(f"Data retrieved successfully. Shape: {df.shape}")
            print("First few rows (titles):")
            for title in df['title'].head():
                print(f"- {title}")
            
            # Convert publish_time from Unix timestamp to datetime
            df['publish_time_readable'] = pd.to_datetime(df['publish_time'], unit='s')
            
            # Convert HTML content to markdown with progress bar
            print("Converting HTML content to markdown...")
            tqdm.pandas(desc="Converting HTML to Markdown", unit="article")
            df['content_markdown'] = df['content_html'].progress_apply(html_to_markdown)
            print("Conversion complete!")
            
            return df
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return None

def html_to_markdown(html_content):
    """Convert HTML content to markdown"""
    try:
        # Try with html2text first (usually gives better results)
        h = html2text.HTML2Text()
        h.ignore_links = False
        h.ignore_images = False
        h.ignore_emphasis = False
        h.ignore_tables = False
        h.body_width = 0  # Don't wrap text at any width
        return h.handle(html_content)
    except Exception as e:
        print(f"\nWarning: html2text conversion failed: {e}. Trying fallback...")
        try:
            # Fallback to html2markdown
            return html2markdown.convert(html_content)
        except Exception as e2:
            print(f"\nWarning: All HTML conversion methods failed: {e2}")
            # Last resort: use BeautifulSoup to extract text
            try:
                soup = BeautifulSoup(html_content, 'html.parser')
                return soup.get_text(separator='\n\n')
            except Exception as e3:
                print(f"\nError extracting text: {e3}")
                return html_content  # Return original content if all fails

def save_to_excel(df, filename="wewe_rss_dump.xlsx"):
    """Save the DataFrame to an Excel file"""
    if df is None:
        print("No data to save.")
        return False

    try:
        with tqdm(total=100, desc=f"Saving to {filename}", unit="%") as pbar:
            # Start progress
            pbar.update(10)
            
            # Save the file
            df.to_excel(filename, index=False)
            
            # Update progress to completion
            pbar.update(90)
            
        print(f"✅ Data successfully saved to {filename}")
        return True
    except Exception as e:
        print(f"❌ Error saving to Excel: {e}")
        return False
        
def save_to_csv(df, filename="wewe_rss_dump.csv"):
    """Save the DataFrame to a CSV file"""
    if df is None:
        print("No data to save.")
        return False

    try:
        with tqdm(total=100, desc=f"Saving to {filename}", unit="%") as pbar:
            # Start progress
            pbar.update(10)
            
            # Save the file
            df.to_csv(filename, index=False)
            
            # Update progress to completion
            pbar.update(90)
            
        print(f"✅ Data successfully saved to {filename}")
        return True
    except Exception as e:
        print(f"❌ Error saving to CSV: {e}")
        return False

if __name__ == "__main__":
    # Print a nice header
    print("\n" + "="*50)
    print(" 📊 WEWE RSS DATA EXTRACTION TOOL")
    print("="*50)
    
    # Track start time
    start_time = time.time()
    
    # Run main process
    df = main()
    
    if df is not None:
        article_count = len(df)
        print(f"\n✨ Total articles retrieved: {article_count}")
        
        # Create output with original HTML content
        save_to_excel(df, "wewe_rss_dump_with_html.xlsx")
        
        # Create output with only markdown content (drop HTML column to save space)
        print("\nPreparing markdown-only datasets...")
        md_df = df.copy()
        md_df.drop(columns=['content_html'], inplace=True)
        save_to_excel(md_df, "wewe_rss_dump_markdown.xlsx") 
        save_to_csv(md_df, "wewe_rss_dump_markdown.csv")
        
        # Calculate elapsed time
        elapsed_time = time.time() - start_time
        minutes, seconds = divmod(elapsed_time, 60)
        
        print("\n" + "="*50)
        print("📋 SUMMARY")
        print("="*50)
        print(f"🕒 Process completed in {int(minutes)}m {int(seconds)}s")
        print(f"📄 Articles processed: {article_count}")
        print("\n📦 Output files generated:")
        print("  1. wewe_rss_dump_with_html.xlsx - Contains original HTML content")
        print("  2. wewe_rss_dump_markdown.xlsx - Contains markdown converted content")
        print("  3. wewe_rss_dump_markdown.csv - CSV version with markdown content")
        print("="*50)
    else:
        print("❌ No data retrieved.")
        print("="*50)