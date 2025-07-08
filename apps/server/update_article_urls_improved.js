#!/usr/bin/env node

/**
 * Script to update article URLs based on article ID length and cache content
 * Improved version with better URL extraction from cache content
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Decodes HTML entities in a string
 */
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

/**
 * Improved function to extract URL from HTML content
 * Tries multiple patterns to find WeChat article URL
 */
function extractUrlFromCache(htmlContent) {
  if (!htmlContent) return null;
  
  // Try multiple methods to extract the URL
  let match;
  
  // 1. Look for og:url meta tag (most common)
  match = htmlContent.match(/<meta\s+(?:property|name)="og:url"\s+content="([^"]+)"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  match = htmlContent.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:url"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  // 2. Look for canonical link
  match = htmlContent.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  match = htmlContent.match(/<link\s+href="([^"]+)"\s+rel="canonical"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  // 3. Look for data-url attribute in JS variable
  match = htmlContent.match(/var\s+msgLink\s*=\s*["']([^"']+)["']/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  match = htmlContent.match(/data-url\s*=\s*["']([^"']+)["']/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  // 4. Look for specific WeChat URL pattern
  match = htmlContent.match(/https:\/\/mp\.weixin\.qq\.com\/s\/[a-zA-Z0-9_-]{10,}/g);
  if (match && match.length > 0) return match[0];
  
  // 5. Look for meta description with URL
  match = htmlContent.match(/<meta\s+(?:property|name)="description"\s+content="[^"]*?(https:\/\/mp\.weixin\.qq\.com\/s\/[a-zA-Z0-9_-]{10,})[^"]*?"/i);
  if (match) return decodeHtmlEntities(match[1]);
  
  return null;
}

/**
 * Main function to update article URLs
 */
async function updateArticleUrls() {
  try {
    console.log('Starting to update article URLs...');
    
    // First, get count of articles that don't have URLs yet
    const totalCount = await prisma.article.count({
      where: {
        url: null
      }
    });

    console.log(`Found ${totalCount} articles without URLs`);

    if (totalCount === 0) {
      console.log('No articles need URL updates');
      return;
    }

    let updatedCount = 0;
    let extractedUrlCount = 0;
    let fallbackUrlCount = 0;
    let batchSize = 100;
    let skip = 0;
    
    // Process articles in batches
    while (skip < totalCount) {
      const batchNumber = Math.floor(skip / batchSize) + 1;
      const totalBatches = Math.ceil(totalCount / batchSize);
      
      console.log(`\nProcessing batch ${batchNumber}/${totalBatches} (articles ${skip + 1}-${Math.min(skip + batchSize, totalCount)})`);
      
      // Get current batch of articles with ID only
      const articles = await prisma.article.findMany({
        where: {
          url: null
        },
        select: {
          id: true
        },
        skip: skip,
        take: batchSize,
        orderBy: {
          id: 'asc'
        }
      });

      // Process each article in the batch
      for (const article of articles) {
        try {
          // Get article with cache content
          const articleWithCache = await prisma.article.findUnique({
            where: { id: article.id },
            include: { cache: true }
          });
          
          let url;
          
          // Try to extract URL from cache content
          if (articleWithCache?.cache?.content) {
            url = extractUrlFromCache(articleWithCache.cache.content);
            if (url) {
              // Validate that it's a proper URL
              try {
                new URL(url);
                extractedUrlCount++;
              } catch (e) {
                // Invalid URL, fall back to ID-based URL
                url = null;
              }
            }
          }
          
          // If extraction failed, fall back to ID-based URL
          if (!url) {
            url = `https://mp.weixin.qq.com/s/${article.id}`;
            fallbackUrlCount++;
          }
          
          await prisma.article.update({
            where: { id: article.id },
            data: { url }
          });
          
          updatedCount++;
          
          // Show more detailed progress
          if (updatedCount % 10 === 0 || updatedCount === totalCount) {
            const percentage = Math.round((updatedCount / totalCount) * 100);
            console.log(`  ✓ Updated ${updatedCount}/${totalCount} articles (${percentage}%) - ${extractedUrlCount} extracted / ${fallbackUrlCount} fallback`);
          }
        } catch (error) {
          console.error(`  ✗ Failed to update article ${article.id}:`, error.message);
        }
      }
      
      skip += batchSize;
      
      // Small delay between batches to avoid overwhelming the database
      if (skip < totalCount) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`\nSummary:`);
    console.log(`- Successfully updated ${updatedCount} article URLs`);
    console.log(`- URLs extracted from cache: ${extractedUrlCount}`);
    console.log(`- Fallback URLs generated: ${fallbackUrlCount}`);
    
    // Show some statistics about updated URLs
    const extractedUrls = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM "Article"
      WHERE url NOT LIKE 'https://mp.weixin.qq.com/s/%'
    `;
    
    const shortIdUrls = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM "Article"
      WHERE LENGTH(id) = 22 AND url LIKE 'https://mp.weixin.qq.com/s/%'
    `;
    
    const longIdUrls = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM "Article"
      WHERE LENGTH(id) = 32 AND url LIKE 'https://mp.weixin.qq.com/s/%'
    `;
    
    console.log(`\nURL Statistics:`);
    console.log(`- Custom extracted URLs: ${extractedUrls[0].count}`);
    console.log(`- Short ID URLs (22-char): ${shortIdUrls[0].count}`);
    console.log(`- Long ID URLs (32-char): ${longIdUrls[0].count}`);
    
  } catch (error) {
    console.error('Error updating article URLs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
updateArticleUrls();
