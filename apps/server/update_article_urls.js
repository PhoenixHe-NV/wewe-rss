#!/usr/bin/env node

/**
 * Script to update article URLs based on article ID length and cache content
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Function to extract URL from meta tag in HTML content
function extractUrlFromMeta(htmlContent) {
  if (!htmlContent) return null;
  
  // Try multiple patterns to extract URL from cache content
  let match;
  
  // Look for og:url meta tag (most common format)
  match = htmlContent.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  // Alternative og:url format
  match = htmlContent.match(/<meta\s+content="([^"]+)"\s+property="og:url"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  // Look for canonical link
  match = htmlContent.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  // Look for WeChat URL pattern directly in the content
  match = htmlContent.match(/https:\/\/mp\.weixin\.qq\.com\/s\/[a-zA-Z0-9_-]{10,}/g);
  if (match && match.length > 0) return match[0];
  
  return null;
}

// Helper function to decode HTML entities
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}

// Function to generate URL based on article ID
function generateArticleUrl(articleId, cacheContent = null) {
  if (articleId.length === 22) {
    // Short ID format: https://mp.weixin.qq.com/s/articleId
    return `https://mp.weixin.qq.com/s/${articleId}`;
  } else if (articleId.length === 32 && cacheContent) {
    // Long ID format: extract from cache content
    const extractedUrl = extractUrlFromMeta(cacheContent);
    if (extractedUrl) {
      return extractedUrl;
    }
    // Fallback to simple format if extraction fails
    return `https://mp.weixin.qq.com/s/${articleId}`;
  } else {
    // Default fallback
    return `https://mp.weixin.qq.com/s/${articleId}`;
  }
}

async function updateArticleUrls() {
  try {
    console.log('Starting to update article URLs...');
    console.log('First retrieving all article IDs that need URL updates...');
    
    // 先获取所有需要更新的文章ID
    const allArticles = await prisma.article.findMany({
      where: {
        url: null
      },
      select: {
        id: true
      },
      orderBy: {
        id: 'asc'
      }
    });
    
    const totalCount = allArticles.length;
    console.log(`Found ${totalCount} articles without URLs`);

    if (totalCount === 0) {
      console.log('No articles need URL updates');
      return;
    }
    
    // 按照ID长度对文章进行分类
    const shortIds = allArticles.filter(a => a.id.length === 22).map(a => a.id);
    const longIds = allArticles.filter(a => a.id.length === 32).map(a => a.id);
    const otherIds = allArticles.filter(a => a.id.length !== 22 && a.id.length !== 32).map(a => a.id);
    
    console.log(`\nArticles by ID length:`);
    console.log(`- Short IDs (22 chars): ${shortIds.length}`);
    console.log(`- Long IDs (32 chars): ${longIds.length}`);
    console.log(`- Other IDs: ${otherIds.length}`);
    
    let updatedCount = 0;
    let extractedCount = 0;
    let fallbackCount = 0;
    const batchSize = 100;
    
    // 1. 批量处理短ID文章 (这些不需要查询cache，可以直接生成URL)
    if (shortIds.length > 0) {
      console.log(`\nProcessing ${shortIds.length} articles with 22-char IDs...`);
      
      for (let i = 0; i < shortIds.length; i += batchSize) {
        const currentBatch = shortIds.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(shortIds.length / batchSize);
        
        console.log(`\nProcessing short ID batch ${batchNumber}/${totalBatches} (articles ${i + 1}-${Math.min(i + batchSize, shortIds.length)})`);
        
        const updates = currentBatch.map(id => prisma.article.update({
          where: { id },
          data: { url: `https://mp.weixin.qq.com/s/${id}` },
        }));
        
        await prisma.$transaction(updates);
        
        updatedCount += currentBatch.length;
        fallbackCount += currentBatch.length;
        
        const percentage = Math.round((updatedCount / totalCount) * 100);
        console.log(`  ✓ Updated ${updatedCount}/${totalCount} articles (${percentage}%)`);
      }
    }
    
    // 2. 处理长ID文章，需要查询cache内容提取URL
    // 这些需要按批次处理，每批查询cache
    if (longIds.length > 0 || otherIds.length > 0) {
      const remainingIds = [...longIds, ...otherIds];
      console.log(`\nProcessing ${remainingIds.length} articles that need cache lookup...`);
      
      let skip = 0;
      
      while (skip < remainingIds.length) {
        const batchNumber = Math.floor(skip / batchSize) + 1;
        const totalBatches = Math.ceil(remainingIds.length / batchSize);
        
        console.log(`\nProcessing batch ${batchNumber}/${totalBatches} (articles ${skip + 1}-${Math.min(skip + batchSize, remainingIds.length)})`);
        
        const currentBatchIds = remainingIds.slice(skip, skip + batchSize);
        
        // 获取当前批次文章的cache内容
        const articlesWithCache = await prisma.article.findMany({
          where: {
            id: {
              in: currentBatchIds
            }
          },
          include: {
            cache: true
          }
        });

        console.log(`  Retrieved ${articlesWithCache.length} articles with cache content`);
        
        // 准备批量更新
        const updates = [];
        
        // 先在内存中处理所有文章（不进行数据库操作）
        for (const article of articlesWithCache) {
          let url;
          
          // 尝试从缓存内容提取URL
          if (article.cache?.content) {
            url = extractUrlFromMeta(article.cache.content);
            if (url) {
              extractedCount++;
            }
          }
          
          // 如果提取失败，使用基于ID的URL作为后备
          if (!url) {
            url = `https://mp.weixin.qq.com/s/${article.id}`;
            fallbackCount++;
          }
          
          // 添加到批量更新列表
          updates.push({
            id: article.id,
            url: url
          });
        }
        
        // 批量更新数据库（更高效）
        if (updates.length > 0) {
          console.log(`  Batch updating ${updates.length} articles...`);
          
          // 使用Prisma事务进行批量更新
          await prisma.$transaction(
            updates.map(update => 
              prisma.article.update({
                where: { id: update.id },
                data: { url: update.url }
              })
            )
          );
          
          updatedCount += updates.length;
          
          const percentage = Math.round((updatedCount / totalCount) * 100);
          console.log(`  ✓ Updated ${updatedCount}/${totalCount} articles (${percentage}%)`);
          console.log(`    Extracted URLs: ${extractedCount}, Fallback URLs: ${fallbackCount}`);
        }
        
        skip += batchSize;
        
        // 短暂延迟，避免数据库负载过重
        if (skip < remainingIds.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }    console.log(`\nSuccessfully updated ${updatedCount} article URLs`);
    console.log(`Extracted URLs: ${extractedCount}, Fallback URLs: ${fallbackCount}`);
    
    // 显示统计信息
    console.log(`\nUpdated articles statistics:`);
    console.log(`- Total articles updated: ${updatedCount}`);
    console.log(`- URLs extracted from cache: ${extractedCount} (${Math.round((extractedCount/updatedCount)*100)}%)`);
    console.log(`- Fallback URLs generated: ${fallbackCount} (${Math.round((fallbackCount/updatedCount)*100)}%)`);
    
    // 显示按ID长度分组的统计
    console.log(`\nID length distribution:`);
    console.log(`- 22-char IDs: ${shortIds.length} (${Math.round((shortIds.length/totalCount)*100)}%)`);
    console.log(`- 32-char IDs: ${longIds.length} (${Math.round((longIds.length/totalCount)*100)}%)`);
    console.log(`- Other lengths: ${otherIds.length} (${Math.round((otherIds.length/totalCount)*100)}%)`);
    
    // 显示数据库中所有文章的URL类型统计
    console.log(`\nGetting overall URL statistics from database...`);
    
    const totalArticles = await prisma.article.count();
    
    const articlesWithUrls = await prisma.article.count({
      where: {
        url: {
          not: null,
        },
      },
    });
    
    // 自定义URL（非标准URL格式）
    const customUrlsCount = await prisma.article.count({
      where: {
        url: {
          not: {
            startsWith: 'https://mp.weixin.qq.com/s/',
          },
          not: null,
        },
      },
    });
    
    // 使用字符串函数查询ID长度，因为Prisma不支持直接length属性
    // 这里改用字符串模式匹配，通过获取所有ID并过滤来统计
    
    // 获取所有有URL的文章
    const articlesWithUrlsAndIds = await prisma.article.findMany({
      where: {
        url: { not: null },
      },
      select: {
        id: true,
        url: true,
      },
    });
    
    // 在内存中进行分类统计
    const shortIdCount = articlesWithUrlsAndIds.filter(
      (a) => a.id.length === 22 && a.url.startsWith('https://mp.weixin.qq.com/s/'),
    ).length;
    
    const longIdCount = articlesWithUrlsAndIds.filter(
      (a) => a.id.length === 32 && a.url.startsWith('https://mp.weixin.qq.com/s/'),
    ).length;
    
    console.log(`\nOverall URL statistics:`);
    console.log(`- Total articles: ${totalArticles}`);
    console.log(`- Articles with URLs: ${articlesWithUrls} (${Math.round((articlesWithUrls/totalArticles)*100)}%)`);
    console.log(`- Custom extracted URLs: ${customUrlsCount}`);
    console.log(`- Short ID URLs (22-char): ${shortIdCount}`);
    console.log(`- Long ID URLs (32-char): ${longIdCount}`);
    
    // 显示最常见的URL
    const commonUrls = await prisma.article.groupBy({
      by: ['url'],
      _count: {
        id: true
      },
      where: {
        url: {
          not: null
        }
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 10
    });

    if (commonUrls.length > 0) {
      console.log(`\nTop 10 most common URLs:`);
      commonUrls.forEach((item, index) => {
        console.log(`${index + 1}. ${item.url} (${item._count.id} articles)`);
      });
    }
    
  } catch (error) {
    console.error('Error updating article URLs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
updateArticleUrls();
