// 安装依赖: npm init -y && npm install express node-fetch http https https-proxy-agent node-cache p-queue
// 安装新增依赖: npm install compression
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const path = require('path');
const compression = require('compression');

(async () => {
    const { default: PQueue } = await import('p-queue');
    
    const app = express();
    
    // 1. 添加响应压缩
    app.use(compression());
    
    app.use(express.static(path.join(__dirname,'public')))

    // 2. 优化缓存配置
    const cache = new NodeCache({ 
        stdTTL: 3600, // 增加缓存时间到1小时
        checkperiod: 600, // 减少检查周期到10分钟
        useClones: false, // 禁用克隆以提升性能
        deleteOnExpire: true // 过期立即删除
    });

    // 3. 优化请求队列配置
    const queue = new PQueue({
        concurrency: 5, // 增加并发数
        interval: 1000,
        intervalCap: 5,
        timeout: 300000, // 添加队列超时时间
        throwOnTimeout: true
    });

    // 4. 优化JSON解析
    app.use(express.json({ 
        limit: '50mb',
        strict: true,
        inflate: true,
        type: ['application/json', 'text/plain'] // 支持更多Content-Type
    }));

    // 保持原有配置不变
    const API_KEY = "sk-1234567890";
    const HUGGINGFACE_API_KEY = "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";
    const options = {
        key: fs.readFileSync('./pem/www.leavel.top.key'),
        cert: fs.readFileSync('./pem/www.leavel.top.pem')
    };
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
        content: `你是专业旅行规划师。:

            请为下列出发地,目的地,人数,天数 信息制定小红书风格攻略`
    };

    // 5. 优化消息处理函数
    const processMessages = (messages) => {
        if (!Array.isArray(messages)) {
            throw new Error("messages must be an array");
        }
        return messages[0]?.role !== 'system' ? [SYSTEM_PROMPT, ...messages] : messages;
    };

    // 6. 优化缓存键生成
    const generateCacheKey = (messages, model) => {
        const messageString = JSON.stringify(messages.map(m => ({
            role: m.role,
            content: m.content
        })));
        return `${model}_${Buffer.from(messageString).toString('base64')}`;
    };

    // 7. 优化CORS中间件
    app.use((req, res, next) => {
        const allowedOrigins = ['*']; // 可以改为具体域名列表
        const origin = req.headers.origin;
        
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            res.header("Access-Control-Allow-Origin", origin);
            res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
            res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
            res.header("Access-Control-Max-Age", "86400");
        }
        
        if (req.method === "OPTIONS") {
            return res.status(200).end();
        }
        next();
    });

    // 8. 优化日志处理
    const log = {
        error: (message, ...args) => console.error(`[ERROR ${new Date().toISOString()}] ${message}`, ...args),
        info: (message, ...args) => console.log(`[INFO ${new Date().toISOString()}] ${message}`, ...args),
        debug: (message, ...args) => process.env.NODE_ENV !== 'production' && console.log(`[DEBUG ${new Date().toISOString()}] ${message}`, ...args)
    };

    // 9. 优化响应超时处理
    const handleResponseWithTimeout = async (promise, timeoutMs = 30000) => {
        let timeoutHandle;
        
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutHandle);
        }
    };

    // 10. 优化API调用函数
    async function callHuggingFaceAPI(apiUrl, fetchOptions, retries = 3) {
        const backoff = (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000);
        
        for (let i = 0; i < retries; i++) {
            try {
                const response = await handleResponseWithTimeout(
                    fetch(apiUrl, {
                        ...fetchOptions,
                        timeout: 60000 // 1分钟超时
                    }),
                    60000
                );

                if (response.ok) {
                    const result = await response.json();
                    if (!result?.choices?.[0]?.message) {
                        throw new Error("Invalid API response format");
                    }
                    return result;
                }

                const errorText = await response.text();
                throw new Error(`API responded with status ${response.status}: ${errorText}`);
            } catch (error) {
                if (i === retries - 1) throw error;
                
                const waitTime = backoff(i);
                log.info(`Attempt ${i + 1} failed, waiting ${waitTime}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    // 11. 优化性能监控中间件
    const performanceMiddleware = (req, res, next) => {
        const start = Date.now();
        const logFinish = () => {
            const duration = Date.now() - start;
            log.info(`${req.method} ${req.originalUrl} completed in ${duration}ms`);
        };
        
        res.on('finish', logFinish);
        res.on('close', logFinish);
        next();
    };

    app.use(performanceMiddleware);

    // 保持原有路由
    app.get('/', (req, res) => {
        res.sendFile(path.resolve(__dirname, './public/index.html'));
    });

    app.get('/v1/models', (req, res) => {
        const models = Object.keys(CUSTOMER_MODEL_MAP).map(id => ({ 
            id, 
            object: "model" 
        }));
        res.json({
            data: models,
            success: true
        });
    });

    // 12. 优化主要API处理函数
    app.post('/v1/chat/completions', async (req, res) => {
        const startTime = Date.now();
        
        try {
            // 快速参数验证
            if (!req.body?.messages?.length) {
                return res.status(400).json({ error: "messages 参数必须是非空数组" });
            }

            const {
                model = '',
                temperature = 0.7,
                max_tokens = 8196,
                top_p = 0.9,
                stream = false
            } = req.body;

            const processedMessages = processMessages(req.body.messages);
            const cacheKey = generateCacheKey(processedMessages, model);
            
            // 检查缓存
            const cachedResponse = cache.get(cacheKey);
            if (cachedResponse) {
                return res.json(cachedResponse);
            }

            const modelName = CUSTOMER_MODEL_MAP[model] || model;
            const apiUrl = `https://api-inference.huggingface.co/models/${modelName}/v1/chat/completions`;
            
            const fetchOptions = {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept-Encoding': 'gzip,deflate'
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
                compress: true
            };

            const result = await queue.add(
                () => callHuggingFaceAPI(apiUrl, fetchOptions),
                { priority: 1 }
            );

            cache.set(cacheKey, result);
            res.json(result);

        } catch (error) {
            log.error(`Request failed after ${Date.now() - startTime}ms:`, error);
            res.status(500).json({
                error: `请求处理失败: ${error.message}`,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    });

    // 保持原有的错误处理
    app.use((req, res) => {
        res.status(404).json({ error: "Not Found" });
    });

    app.use((err, req, res, next) => {
        log.error('Unhandled error:', err);
        res.status(500).json({
            error: "服务器内部错误",
            message: err.message
        });
    });

    // 创建服务器
    http.createServer((req, res) => {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(80, () => log.info('HTTP Server running on port 80'));

    const server = https.createServer(options, app).listen(443, () => {
        log.info('HTTPS Server running on port 443');
    });

    // 优化优雅退出处理
    const gracefulShutdown = () => {
        log.info('Received shutdown signal');
        server.close(() => {
            log.info('Server closed');
            cache.close();
            process.exit(0);
        });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

})().catch(error => {
    console.error('Server initialization failed:', error);
    process.exit(1);
});