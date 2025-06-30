import datetime
import time
import pandas as pd
import sqlalchemy
import argparse
from tqdm.auto import tqdm

def get_timestamp(year, month, day):
    """Convert a date to Unix timestamp."""
    dt = datetime.datetime(year, month, day, 0, 0, 0, tzinfo=datetime.timezone.utc)
    return int(dt.timestamp())

def parse_datetime(datetime_str):
    """Parse a datetime string to a datetime object.
    Accepts formats like: '2025-06-23', '2025-06-23 14:30', etc."""
    try:
        # Try different formats
        formats = [
            "%Y-%m-%d",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d %H:%M:%S",
            "%Y/%m/%d",
            "%Y/%m/%d %H:%M",
            "%Y/%m/%d %H:%M:%S",
        ]
        
        for fmt in formats:
            try:
                return datetime.datetime.strptime(datetime_str, fmt)
            except ValueError:
                continue
                
        raise ValueError(f"Could not parse datetime: {datetime_str}")
    except Exception as e:
        print(f"Error parsing datetime: {e}")
        return None

def get_sql_to_dump(processed_after=None):
    # Calculate timestamps for Jan 1, 2024 and Jan 1, 2025
    start_timestamp = get_timestamp(2024, 1, 1)
    end_timestamp = get_timestamp(2025, 1, 1)
    
    # Build the base query
    query = f"""
    select
        a."title",
        f.mp_name,
        a."id" as article_id,
        a."publish_time",
        ais."summary",
        ais."keywords",
        ais."photography_keywords",
        ais."activity_keywords",
        ais."activity_time",
        ais."location",
        ais."location_city",
        ais."organizer",
        ais."artists",
        ais."processed_at"
    from
        articles a
    join
        feeds f
    on f.id = a.mp_id
    inner join  -- 改为inner join以过滤掉没有AI结果的记录
        article_ai_summaries ais
    on a.id = ais.article_id
    where
        a."publish_time" >= {start_timestamp} -- January 1st, 2024, 00:00:00 UTC
        and a."publish_time" < {end_timestamp} -- January 1st, 2025, 00:00:00 UTC
    """
    
    # Add processed_after filter if provided
    if processed_after:
        query += f"""
        and ais."processed_at" >= '{processed_after.isoformat()}'
        """
        
    # Add ordering
    query += """
    order by
        a."publish_time" desc
    """
    return query

def main(processed_after=None):
    # Get the SQL query with optional processed_after filter
    sql = get_sql_to_dump(processed_after)
    
    # Database connection string
    db_connection_string = "postgresql://htc:htcNet.moe@172.27.42.5:5432/wewe_rss"
    
    try:
        # Create engine
        engine = sqlalchemy.create_engine(db_connection_string)
        
        # Connect to the database and execute the query
        print("连接数据库中...")
        with engine.connect() as connection:
            print("执行查询...")
            df = pd.read_sql_query(sql, connection)
            
            # Print some information about the DataFrame
            print(f"数据检索成功。数据维度: {df.shape}")
            print("前几行标题示例:")
            for title in df['title'].head():
                print(f"- {title}")
            
            # Convert publish_time from Unix timestamp to readable datetime
            try:
                df['publish_time_readable'] = pd.to_datetime(df['publish_time'], unit='s').dt.strftime('%Y-%m-%d %H:%M:%S')
            except Exception as e:
                print(f"警告: 无法转换发布时间: {e}")
                # 使用替代方案，逐行处理
                df['publish_time_readable'] = df['publish_time'].apply(
                    lambda x: datetime.datetime.fromtimestamp(x).strftime('%Y-%m-%d %H:%M:%S') if pd.notnull(x) else ''
                )
            
            # Format the processed_at datetime to readable format
            try:
                df['processed_at_readable'] = pd.to_datetime(df['processed_at']).dt.strftime('%Y-%m-%d %H:%M:%S')
            except Exception as e:
                print(f"警告: 无法转换AI处理时间: {e}")
                # 使用替代方案，逐行处理
                def format_dt(dt_str):
                    if pd.isnull(dt_str):
                        return ''
                    try:
                        if isinstance(dt_str, str):
                            dt = parse_datetime(dt_str)
                            return dt.strftime('%Y-%m-%d %H:%M:%S') if dt else ''
                        return str(dt_str)
                    except:
                        return str(dt_str)
                        
                df['processed_at_readable'] = df['processed_at'].apply(format_dt)
            
            # Create article URL column (using standard WeChat article URL format)
            df['article_url'] = 'https://mp.weixin.qq.com/s/' + df['article_id']
            
            # 重命名列为中文
            df.rename(columns={
                'title': '标题',
                'mp_name': '公众号名称',
                'article_url': '文章链接',
                'publish_time_readable': '发布时间',
                'processed_at_readable': 'AI处理时间',
                'summary': '总结',
                'keywords': '关键字',
                'photography_keywords': '影像关键字',
                'activity_keywords': '活动关键字',
                'activity_time': '活动时间',
                'location': '地点',
                'location_city': '城市',
                'organizer': '主办方',
                'artists': '参与嘉宾/艺术家'
            }, inplace=True)
            
            # 设置列顺序
            column_order = [
                '标题', '公众号名称', '文章链接',
                '影像关键字', '活动关键字', '关键字',
                '活动时间', '地点', '城市', '主办方', '参与嘉宾/艺术家', '总结', '发布时间', 'AI处理时间'
            ]
            
            # 保留需要的列并按顺序排列
            existing_columns = [col for col in column_order if col in df.columns]
            df = df[existing_columns]
            
            # 删除不需要的原始列
            columns_to_drop = ['article_id', 'publish_time', 'processed_at']
            for col in columns_to_drop:
                if col in df.columns:
                    df.drop(columns=[col], inplace=True)
            
            return df
    except Exception as e:
        print(f"连接数据库时出错: {e}")
        return None

# Function removed - no longer needed for this report

def save_to_excel(df, filename="wewe_rss_dump.xlsx"):
    """Save the DataFrame to an Excel file with adjusted column widths"""
    if df is None:
        print("没有数据可保存。")
        return False

    try:
        with tqdm(total=100, desc=f"正在保存到 {filename}", unit="%") as pbar:
            # Start progress
            pbar.update(10)
            
            # 使用ExcelWriter来设置列宽
            with pd.ExcelWriter(filename, engine='openpyxl') as writer:
                df.to_excel(writer, index=False, sheet_name='数据报告')
                
                # 获取工作表
                worksheet = writer.sheets['数据报告']
                
                # 设置文章链接为可点击的超链接
                link_col_index = None
                for i, column in enumerate(df.columns):
                    if column == '文章链接':
                        link_col_index = i
                        break
                
                if link_col_index is not None:
                    for row_idx, url in enumerate(df['文章链接'], start=2):  # 从第2行开始（跳过表头）
                        cell = worksheet.cell(row=row_idx, column=link_col_index+1)  # +1 因为Excel列从1开始
                        cell.hyperlink = url
                        cell.style = 'Hyperlink'  # 应用超链接样式（蓝色下划线）
                
                # 定义每一列的宽度
                column_widths = {
                    '标题': 30,
                    '公众号名称': 20,
                    '文章链接': 40,
                    '发布时间': 18,
                    'AI处理时间': 18,
                    '总结': 60,
                    '关键字': 30,
                    '影像关键字': 25,
                    '活动关键字': 25,
                    '活动时间': 15,
                    '地点': 25,
                    '城市': 15,
                    '主办方': 25,
                    '参与嘉宾/艺术家': 30
                }
                
                # 设置列宽
                for i, column in enumerate(df.columns):
                    col_letter = worksheet.cell(row=1, column=i+1).column_letter
                    if column in column_widths:
                        worksheet.column_dimensions[col_letter].width = column_widths[column]
                    else:
                        worksheet.column_dimensions[col_letter].width = 15
            
            # Update progress to completion
            pbar.update(90)
            
        print(f"✅ 成功保存数据到 {filename}")
        return True
    except Exception as e:
        print(f"❌ 保存到Excel时出错: {e}")
        return False
        
# Function removed - no longer needed for this report

if __name__ == "__main__":
    # 设置命令行参数
    parser = argparse.ArgumentParser(description="微信公众号AI分析数据导出工具")
    parser.add_argument(
        "--processed-after", 
        type=str, 
        help="只导出在指定日期之后处理的AI摘要 (格式: YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS)",
        required=False
    )
    args = parser.parse_args()
    
    # 解析 processed_after 参数
    processed_after_dt = None
    if args.processed_after:
        processed_after_dt = parse_datetime(args.processed_after)
        if not processed_after_dt:
            print(f"❌ 无效的日期格式: {args.processed_after}")
            print("请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS 格式")
            exit(1)
    
    # 打印标题
    print("\n" + "="*50)
    print(" 📊 微信公众号AI分析数据导出工具")
    print("="*50)
    
    # 显示过滤条件
    if processed_after_dt:
        print(f"🔍 过滤条件: AI处理时间 > {processed_after_dt.strftime('%Y-%m-%d %H:%M:%S')}")
    
    # 记录开始时间
    start_time = time.time()
    
    # 运行主流程
    df = main(processed_after_dt)
    
    if df is not None:
        article_count = len(df)
        print(f"\n✨ 成功检索文章: {article_count} 篇")
        
        # 使用带时间戳的文件名
        current_time = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"影像艺术活动AI分析报表_{current_time}.xlsx"
        
        # 创建输出文件
        save_to_excel(df, file_name)
        
        # 计算耗时
        elapsed_time = time.time() - start_time
        minutes, seconds = divmod(elapsed_time, 60)
        
        print("\n" + "="*50)
        print("📋 汇总信息")
        print("="*50)
        print(f"🕒 处理完成，用时 {int(minutes)}分 {int(seconds)}秒")
        print(f"📄 处理文章数: {article_count} 篇")
        print("\n📦 生成的输出文件:")
        print(f"  • {file_name} - 包含文章数据和AI分析结果")
        print("="*50)
    else:
        print("❌ 没有检索到数据。")
        print("="*50)