#!/usr/bin/env node

const http = require('http');

// 测试数据
const testData = {
  mp_name: '测试公众号',
  mp_signature: '这是一个测试公众号',
  mp_img_link: 'https://example.com/test-avatar.jpg',
  article_title: '测试文章标题',
  article_publish_time: Math.floor(Date.now() / 1000), // 当前时间戳
  article_url: 'https://mp.weixin.qq.com/s/test123456789',
  article_content:
    '<html><head><title>测试文章</title></head><body><h1>测试文章标题</h1><p>这是测试文章的内容。</p></body></html>',
};

// 服务器配置
const serverHost = 'localhost';
const serverPort = 3000;
const authCode = process.env.AUTH_CODE || ''; // 从环境变量获取认证码

// 创建请求
const postData = JSON.stringify(testData);

const options = {
  hostname: serverHost,
  port: serverPort,
  path: '/api/import/article-cache',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    ...(authCode && { Authorization: authCode }),
  },
};

console.log('测试文章缓存导入API...');
console.log(
  '请求URL:',
  `http://${serverHost}:${serverPort}/api/import/article-cache`,
);
console.log('请求数据:', JSON.stringify(testData, null, 2));

const req = http.request(options, (res) => {
  console.log('响应状态码:', res.statusCode);
  console.log('响应头:', res.headers);

  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('响应内容:');
    try {
      const jsonResponse = JSON.parse(responseData);
      console.log(JSON.stringify(jsonResponse, null, 2));

      if (jsonResponse.success) {
        console.log('\n✅ 测试成功!');
        console.log('操作详情:');
        console.log(`- Feed ID: ${jsonResponse.data.feedId}`);
        console.log(`- Feed 是否新建: ${jsonResponse.data.feedCreated}`);
        console.log(`- 文章 ID: ${jsonResponse.data.articleId}`);
        console.log(`- 文章是否新建: ${jsonResponse.data.articleCreated}`);
        console.log(`- 缓存操作: ${jsonResponse.data.cacheAction}`);
        console.log(`- 内容匹配: ${jsonResponse.data.contentMatches}`);
      } else {
        console.log('\n❌ 测试失败:');
        console.log('错误:', jsonResponse.error);
        console.log('消息:', jsonResponse.message);
      }
    } catch (error) {
      console.log('解析JSON响应失败:', error.message);
      console.log('原始响应:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('请求失败:', error.message);
  console.log('\n请确保:');
  console.log('1. 服务器正在运行在', `http://${serverHost}:${serverPort}`);
  console.log('2. 数据库连接正常');
  console.log('3. 如果启用了认证，请设置正确的 AUTH_CODE 环境变量');
});

// 发送请求
req.write(postData);
req.end();
