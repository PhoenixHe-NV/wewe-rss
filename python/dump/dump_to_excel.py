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
        a."url",
        a."publish_time",
        ais."summary",
        ais."keywords",
        ais."photography_keywords",
        ais."activity_keywords",
        ais."exhibition_keywords",
        ais."academic_keywords",
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

def get_sql_to_dump_unprocessed():
    """
    获取有cache但没有AI处理结果的文章
    """
    # Calculate timestamps for Jan 1, 2024 and Jan 1, 2025
    start_timestamp = get_timestamp(2024, 1, 1)
    end_timestamp = get_timestamp(2025, 1, 1)
    
    # Build the query for articles that have cache but no AI summary
    query = f"""
    select
        a."title",
        f.mp_name,
        a."id" as article_id,
        a."url",
        a."publish_time",
        c."updated_at" as cache_updated_at
    from
        articles a
    join
        feeds f
    on f.id = a.mp_id
    join
        article_caches c
    on a.id = c.article_id
    left join
        article_ai_summaries ais
    on a.id = ais.article_id
    where
        a."publish_time" >= {start_timestamp} -- January 1st, 2024, 00:00:00 UTC
        and a."publish_time" < {end_timestamp} -- January 1st, 2025, 00:00:00 UTC
        and ais.article_id IS NULL
    order by
        a."publish_time" desc
    """
    
    return query

def process_dataframe(df, is_unprocessed=False):
    """处理数据框并格式化列"""
    if df.empty:
        return df
        
    # Convert publish_time from Unix timestamp to readable datetime
    try:
        df['publish_time_readable'] = pd.to_datetime(df['publish_time'], unit='s').dt.strftime('%Y-%m-%d %H:%M:%S')
    except Exception as e:
        print(f"警告: 无法转换发布时间: {e}")
        # 使用替代方案，逐行处理
        df['publish_time_readable'] = df['publish_time'].apply(
            lambda x: datetime.datetime.fromtimestamp(x).strftime('%Y-%m-%d %H:%M:%S') if pd.notnull(x) else ''
        )
    
    # Format the processed_at datetime to readable format (只对已处理的文章)
    if not is_unprocessed and 'processed_at' in df.columns:
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
    
    # 对于未处理的文章，处理cache_updated_at
    if is_unprocessed and 'cache_updated_at' in df.columns:
        try:
            df['cache_updated_at_readable'] = pd.to_datetime(df['cache_updated_at']).dt.strftime('%Y-%m-%d %H:%M:%S')
        except Exception as e:
            print(f"警告: 无法转换缓存更新时间: {e}")
            df['cache_updated_at_readable'] = df['cache_updated_at'].astype(str)
    
    # 处理文章URL：如果为空或None，则使用article_id拼接
    def generate_article_url(row):
        url = row.get('url')
        article_id = row.get('article_id')
        
        # 如果URL为空、None或者是"None"字符串，则生成URL
        if pd.isna(url) or url is None or url == '' or str(url).lower() == 'none':
            return f'https://mp.weixin.qq.com/s/{article_id}'
        else:
            return str(url)
    
    df['article_url'] = df.apply(generate_article_url, axis=1)
    
    # 清理所有文本列中结尾的双引号
    text_columns = ['title', 'mp_name', 'article_url']
    
    # 为已处理的文章添加额外的列
    if not is_unprocessed:
        text_columns.extend(['summary', 'keywords', 'photography_keywords', 
                         'activity_keywords', 'exhibition_keywords', 'academic_keywords', 
                         'activity_time', 'location', 'location_city', 'organizer', 'artists'])
    
    for col in text_columns:
        if col in df.columns:
            df[col] = df[col].astype(str).str.rstrip('"')
    
    # 重命名列为中文
    rename_dict = {
        'title': '标题',
        'mp_name': '公众号名称',
        'article_url': '文章链接',
        'publish_time_readable': '发布时间',
        'article_id': '文章ID',
    }
    
    # 为已处理和未处理的文章分别添加不同的列
    if not is_unprocessed:
        rename_dict.update({
            'processed_at_readable': 'AI处理时间',
            'summary': '总结',
            'keywords': '关键字',
            'photography_keywords': '影像关键字',
            'activity_keywords': '活动关键字',
            'exhibition_keywords': '展览关键字',
            'academic_keywords': '学术关键字',
            'activity_time': '活动时间',
            'location': '地点',
            'location_city': '城市',
            'organizer': '主办方',
            'artists': '参与嘉宾/艺术家'
        })
    else:
        rename_dict.update({
            'cache_updated_at_readable': '缓存更新时间'
        })
    
    df.rename(columns=rename_dict, inplace=True)
    
    # 设置列顺序
    if not is_unprocessed:
        column_order = [
            '标题', '公众号名称', '文章链接',
            '影像关键字', '活动关键字', '展览关键字', '学术关键字', '关键字',
            '活动时间', '地点', '城市', '主办方', '参与嘉宾/艺术家', '总结', '发布时间', 'AI处理时间'
        ]
    else:
        column_order = [
            '标题', '公众号名称', '文章链接', '文章ID', '发布时间', '缓存更新时间'
        ]
    
    # 保留需要的列并按顺序排列
    existing_columns = [col for col in column_order if col in df.columns]
    df = df[existing_columns]
    
    # 删除不需要的原始列
    columns_to_drop = ['url', 'publish_time']
    if not is_unprocessed:
        columns_to_drop.extend(['processed_at'])
    else:
        columns_to_drop.extend(['cache_updated_at'])
    
    for col in columns_to_drop:
        if col in df.columns:
            df.drop(columns=[col], inplace=True)
    
    return df

def main(processed_after=None):
    # Database connection string
    db_connection_string = "postgresql://htc:htcNet.moe@172.27.42.5:5432/wewe_rss"
    
    try:
        # Create engine
        engine = sqlalchemy.create_engine(db_connection_string)
        
        # Connect to the database
        print("连接数据库中...")
        with engine.connect() as connection:
            # 1. 获取已处理的文章
            print("执行已处理文章查询...")
            sql_processed = get_sql_to_dump(processed_after)
            df_processed = pd.read_sql_query(sql_processed, connection)
            
            # 处理已处理文章的数据
            print(f"已处理文章检索成功。数据维度: {df_processed.shape}")
            if not df_processed.empty:
                print("已处理文章标题示例:")
                for title in df_processed['title'].head():
                    print(f"- {title}")
                df_processed = process_dataframe(df_processed, is_unprocessed=False)
            
            # 2. 获取未处理但有cache的文章
            print("\n执行未处理文章查询...")
            sql_unprocessed = get_sql_to_dump_unprocessed()
            df_unprocessed = pd.read_sql_query(sql_unprocessed, connection)
            
            # 处理未处理文章的数据
            print(f"未处理文章检索成功。数据维度: {df_unprocessed.shape}")
            if not df_unprocessed.empty:
                print("未处理文章标题示例:")
                for title in df_unprocessed['title'].head():
                    print(f"- {title}")
                df_unprocessed = process_dataframe(df_unprocessed, is_unprocessed=True)
            
            return df_processed, df_unprocessed
            
    except Exception as e:
        print(f"连接数据库时出错: {e}")
        return None, None

# Function removed - no longer needed for this report

def save_to_excel(df_processed, df_unprocessed=None, filename="wewe_rss_dump.xlsx"):
    """Save the DataFrames to an Excel file with adjusted column widths"""
    if df_processed is None and df_unprocessed is None:
        print("没有数据可保存。")
        return False
    
    if df_processed is None and df_unprocessed is not None:
        df_processed = pd.DataFrame()  # 创建空DataFrame
    
    if df_unprocessed is None:
        df_unprocessed = pd.DataFrame()  # 创建空DataFrame

    try:
        with tqdm(total=100, desc=f"正在保存到 {filename}", unit="%") as pbar:
            # Start progress
            pbar.update(10)
            
            # 使用ExcelWriter来设置列宽
            with pd.ExcelWriter(filename, engine='openpyxl') as writer:
                # 写入已处理数据到第一个表
                df_processed.to_excel(writer, index=False, sheet_name='已处理文章')
                
                # 写入未处理数据到第二个表
                if not df_unprocessed.empty:
                    df_unprocessed.to_excel(writer, index=False, sheet_name='未处理文章')
                
                pbar.update(40)  # 更新进度
                
                # 处理已处理文章的表格
                if not df_processed.empty:
                    worksheet = writer.sheets['已处理文章']
                    
                    # 设置文章链接为可点击的超链接
                    link_col_index = None
                    for i, column in enumerate(df_processed.columns):
                        if column == '文章链接':
                            link_col_index = i
                            break
                    
                    if link_col_index is not None:
                        for row_idx, url in enumerate(df_processed['文章链接'], start=2):  # 从第2行开始（跳过表头）
                            cell = worksheet.cell(row=row_idx, column=link_col_index+1)  # +1 因为Excel列从1开始
                            cell.hyperlink = url
                            cell.style = 'Hyperlink'  # 应用超链接样式（蓝色下划线）
                    
                    # 设置列宽
                    set_column_widths(worksheet, df_processed.columns)
                
                # 处理未处理文章的表格
                if not df_unprocessed.empty:
                    worksheet = writer.sheets['未处理文章']
                    
                    # 设置文章链接为可点击的超链接
                    link_col_index = None
                    for i, column in enumerate(df_unprocessed.columns):
                        if column == '文章链接':
                            link_col_index = i
                            break
                    
                    if link_col_index is not None:
                        for row_idx, url in enumerate(df_unprocessed['文章链接'], start=2):
                            cell = worksheet.cell(row=row_idx, column=link_col_index+1)
                            cell.hyperlink = url
                            cell.style = 'Hyperlink'
                    
                    # 设置列宽
                    set_column_widths(worksheet, df_unprocessed.columns)
                
                pbar.update(50)  # 更新进度
            
        print(f"✅ 成功保存数据到 {filename}")
        return True
    except Exception as e:
        print(f"❌ 保存到Excel时出错: {e}")
        return False

def set_column_widths(worksheet, columns):
    """设置工作表的列宽"""
    # 定义每一列的宽度
    column_widths = {
        '标题': 30,
        '公众号名称': 20,
        '文章链接': 40,
        '文章ID': 35,
        '发布时间': 18,
        'AI处理时间': 18,
        '缓存更新时间': 18,
        '总结': 60,
        '关键字': 30,
        '影像关键字': 25,
        '活动关键字': 25,
        '展览关键字': 25,
        '学术关键字': 25,
        '活动时间': 15,
        '地点': 25,
        '城市': 15,
        '主办方': 25,
        '参与嘉宾/艺术家': 30
    }
    
    # 设置列宽
    for i, column in enumerate(columns):
        col_letter = worksheet.cell(row=1, column=i+1).column_letter
        if column in column_widths:
            worksheet.column_dimensions[col_letter].width = column_widths[column]
        else:
            worksheet.column_dimensions[col_letter].width = 15
        
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
    result = main(processed_after_dt)
    
    # 检查结果是否为元组，如果不是则处理错误情况
    if result is None or not isinstance(result, tuple):
        df_processed, df_unprocessed = None, None
    else:
        df_processed, df_unprocessed = result
    
    # 统计文章数量
    processed_count = 0 if df_processed is None else len(df_processed)
    unprocessed_count = 0 if df_unprocessed is None else len(df_unprocessed)
    total_count = processed_count + unprocessed_count
    
    if total_count > 0:
        print(f"\n✨ 成功检索文章: 共 {total_count} 篇")
        print(f"  • 已处理: {processed_count} 篇")
        print(f"  • 未处理但有缓存: {unprocessed_count} 篇")
        
        # 使用带时间戳的文件名
        current_time = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"影像艺术活动AI分析报表_{current_time}.xlsx"
        
        # 创建输出文件
        save_to_excel(df_processed, df_unprocessed, file_name)
        
        # 计算耗时
        elapsed_time = time.time() - start_time
        minutes, seconds = divmod(elapsed_time, 60)
        
        print("\n" + "="*50)
        print("📋 汇总信息")
        print("="*50)
        print(f"🕒 处理完成，用时 {int(minutes)}分 {int(seconds)}秒")
        print(f"📄 总文章数: {total_count} 篇")
        print(f"  • 已处理文章: {processed_count} 篇")
        print(f"  • 未处理文章: {unprocessed_count} 篇")
        print("\n📦 生成的输出文件:")
        print(f"  • {file_name} - 包含两个表格：")
        print(f"    - 已处理文章: {processed_count} 篇")
        print(f"    - 未处理文章: {unprocessed_count} 篇")
        print("="*50)
    else:
        print("❌ 没有检索到数据。")
        print("="*50)