// 安装依赖: npm init -y && npm install express node-fetch http https https-proxy-agent node-cache p-queue compression
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const NodeCache = require('node-cache'); 
const path = require('path');
const compression = require('compression');

// 优化日志函数
const log = {
    info: (...args) => console.log(`[INFO ${new Date().toISOString()}]`, ...args),
    error: (...args) => console.error(`[ERROR ${new Date().toISOString()}]`, ...args),
    debug: (...args) => process.env.NODE_ENV !== 'production' && console.log(`[DEBUG ${new Date().toISOString()}]`, ...args)
};

// 优化证书检查函数
const checkSSLCertificates = () => {
    const certPath = './pem/www.leavel.top.pem';
    const keyPath = './pem/www.leavel.top.key';
    
    try {
        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            throw new Error('SSL证书文件不存在');
        }
        return {
            cert: fs.readFileSync(certPath, 'utf8'),
            key: fs.readFileSync(keyPath, 'utf8')
        };
    } catch (error) {
        throw new Error(`SSL证书错误: ${error.message}`);
    }
};

(async () => {
    const { default: PQueue } = await import('p-queue');
    
    const app = express();
    
    // 1. 优化压缩配置 - 增加压缩级别和过滤条件
    app.use(compression({
        level: 7, // 提高压缩级别
        threshold: 1024, // 只压缩超过1KB的响应
        filter: (req, res) => {
            if (req.headers['x-no-compression']) return false;
            return compression.filter(req, res);
        },
        strategy: compression.Z_RLE // 使用RLE压缩策略
    }));
    
    app.use(express.static(path.join(__dirname,'public'), {
        maxAge: '1d', // 静态文件缓存1天
        etag: true
    }));

    // 2. 优化缓存配置 - 增加更多缓存选项
    const cache = new NodeCache({ 
        stdTTL: 1800,
        checkperiod: 300,
        useClones: false,
        deleteOnExpire: true,
        maxKeys: 1000,
        errorOnMissing: false,
        forceString: false
    });

    // 3. 优化请求队列配置 - 增加重试和超时处理
    const queue = new PQueue({
        concurrency: 15, // 增加并发数
        interval: 1000,
        intervalCap: 15,
        timeout: 60000,
        throwOnTimeout: true,
        autoStart: true,
        retries: 2 // 添加重试次数
    });

    // 4. 优化JSON解析 - 增加安全限制
    app.use(express.json({ 
        limit: '5mb',
        strict: true,
        inflate: true,
        type: ['application/json'],
        verify: (req, res, buf) => {
            try {
                JSON.parse(buf);
            } catch (e) {
                throw new Error('Invalid JSON');
            }
        }
    }));

    try {
        const sslFiles = checkSSLCertificates();
        const sslOptions = {
            key: sslFiles.key,
            cert: sslFiles.cert,
            minVersion: 'TLSv1.3',
            ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384',
            honorCipherOrder: true,
            requestCert: false
        };

        // API配置
        const API_KEY = "sk-1234567890";
        const HUGGINGFACE_API_KEY = "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";
        const CUSTOMER_MODEL_MAP = {
            "qwen2.5-72b-instruct": "Qwen/Qwen2.5-72B-Instruct",
            "gemma2-2b-it": "google/gemma-2-2b-it", 
            "gemma2-27b-it": "google/gemma-2-27b-it",
            "llama-3-8b-instruct": "meta-llama/Meta-Llama-3-8B-Instruct",
            "llama-3.2-1b-instruct": "meta-llama/Llama-3.2-1B-Instruct",
            "llama-3.2-3b-instruct": "meta-llama/Llama-3.2-3B-Instruct",
            "phi-3.5": "microsoft/Phi-3.5-mini-instruct"
        };

        const SYSTEM_PROMPT = {
            role: 'system',
            content: `你是专业旅行规划师。请为下列出发地,目的地,人数,天数 信息制定小红书风格攻略`
        };

        // 5. 优化CORS配置 - 增加安全头
        app.use((req, res, next) => {
            res.header("Access-Control-Allow-Origin", "*");
            res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
            res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
            res.header("Access-Control-Max-Age", "86400");
            res.header("X-Content-Type-Options", "nosniff");
            res.header("X-Frame-Options", "DENY");
            res.header("X-XSS-Protection", "1; mode=block");
            
            if (req.method === "OPTIONS") {
                return res.status(200).end();
            }
            next();
        });

        // 6. 优化消息处理 - 增加验证和清理
        const processMessages = (messages) => {
            if (!Array.isArray(messages)) {
                throw new Error("messages必须是数组");
            }
            // 清理和验证消息
            const cleanedMessages = messages.map(msg => ({
                role: msg.role,
                content: String(msg.content).trim()
            }));
            return cleanedMessages[0]?.role !== 'system' ? [SYSTEM_PROMPT, ...cleanedMessages] : cleanedMessages;
        };

        // 7. 优化缓存键生成 - 增加hash处理
        const generateCacheKey = (messages, model) => {
            const messageString = JSON.stringify(messages.map(m => ({
                role: m.role,
                content: m.content
            })));
            return `${model}_${Buffer.from(messageString).toString('base64')}`;
        };

        // 8. 优化API调用函数 - 增加重试和超时处理
        const callHuggingFaceAPI = async (url, options, retries = 2) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 100000);

            try {
                for (let i = 0; i <= retries; i++) {
                    try {
                        const response = await fetch(url, {
                            ...options,
                            signal: controller.signal,
                            compress: true,
                            timeout: 10000
                        });
                        
                        if (!response.ok) {
                            throw new Error(`API请求失败: ${response.statusText}`);
                        }
                        
                        return await response.json();
                    } catch (error) {
                        if (i === retries) throw error;
                        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                    }
                }
            } finally {
                clearTimeout(timeout);
            }
        };

        // 9. 主API路由优化 - 增加批处理和响应优化
        app.post('/v1/chat/completions', async (req, res) => {
            const startTime = Date.now();
            
            try {
                if (!req.body?.messages?.length) {
                    return res.status(400).json({ error: "messages参数必须是非空数组" });
                }

                const {
                    model = '',
                    temperature = 0.7,
                    max_tokens = 4096,
                    top_p = 0.9,
                    stream = false
                } = req.body;

                const processedMessages = processMessages(req.body.messages);
                const cacheKey = generateCacheKey(processedMessages, model);
                
                // 检查缓存
                const cachedResponse = cache.get(cacheKey);
                if (cachedResponse) {
                    res.setHeader('X-Cache', 'HIT');
                    return res.json(cachedResponse);
                }
                res.setHeader('X-Cache', 'MISS');

                const modelName = CUSTOMER_MODEL_MAP[model] || model;
                const apiUrl = `https://api-inference.huggingface.co/models/${modelName}/v1/chat/completions`;
                
                const fetchOptions = {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
                        'Content-Type': 'application/json',
                        'Accept-Encoding': 'gzip,deflate',
                        'Connection': 'keep-alive'
                    },
                    body: JSON.stringify({
                        model: modelName,
                        stream,
                        temperature,
                        max_tokens,
                        top_p,
                        messages: processedMessages
                    }),
                    agent: new HttpsProxyAgent('http://127.0.0.1:7890'),
                    compress: true,
                    timeout: 100000
                };

                const result = await queue.add(
                    () => callHuggingFaceAPI(apiUrl, fetchOptions),
                    { priority: 1 }
                );

                // 设置缓存
                cache.set(cacheKey, result);
                
                // 设置响应头
                res.setHeader('X-Response-Time', `${Date.now() - startTime}ms`);
                res.json(result);

            } catch (error) {
                log.error(`请求处理失败 (${Date.now() - startTime}ms):`, error);
                res.status(500).json({
                    error: `请求处理失败: ${error.message}`,
                    details: process.env.NODE_ENV === 'development' ? error.stack : undefined
                });
            }
        });

        // 10. 错误处理中间件
        app.use((req, res) => {
            res.status(404).json({ error: "接口不存在" });
        });

        app.use((err, req, res, next) => {
            log.error('未处理的错误:', err);
            res.status(500).json({
                error: "服务器内部错误",
                message: process.env.NODE_ENV === 'production' ? '服务器错误' : err.message
            });
        });

        // 11. HTTP服务器(重定向到HTTPS)
        const httpServer = http.createServer((req, res) => {
            const httpsUrl = `https://${req.headers.host}${req.url}`;
            res.writeHead(301, { 
                "Location": httpsUrl,
                "Cache-Control": "no-cache"
            });
            res.end();
        });

        // 12. HTTPS服务器
        const httpsServer = https.createServer(sslOptions, app);
        
        // 13. 错误处理
        const handleServerError = (server, error) => {
            log.error(`服务器错误: ${error.message}`);
            if (error.code === 'EADDRINUSE') {
                setTimeout(() => {
                    server.close();
                    server.listen();
                }, 1000);
            }
        };

        httpsServer.on('error', (error) => handleServerError(httpsServer, error));
        httpServer.on('error', (error) => handleServerError(httpServer, error));

        // 14. 启动服务器
        httpServer.listen(80, () => {
            log.info('HTTP服务器运行在端口 80');
        });

        httpsServer.listen(443, () => {
            log.info('HTTPS服务器运行在端口 443');
        });

        // 15. 优雅退出处理
        const gracefulShutdown = async (signal) => {
            log.info(`收到关闭信号: ${signal}`);
            
            try {
                await Promise.all([
                    new Promise(resolve => httpServer.close(resolve)),
                    new Promise(resolve => httpsServer.close(resolve))
                ]);
                
                await queue.clear();
                cache.close();
                log.info('服务器已安全关闭');
                process.exit(0);
            } catch (error) {
                log.error('关闭过程出错:', error);
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        log.error('服务器初始化失败:', error);
        process.exit(1);
    }

})().catch(error => {
    console.error('服务器初始化失败:', error);
    process.exit(1);
});