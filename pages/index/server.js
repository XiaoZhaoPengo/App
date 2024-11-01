// 安装依赖: npm init -y && npm install express node-fetch http https https-proxy-agent node-cache p-queue
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');

// 使用异步立即执行函数来启动服务器
(async () => {
    // 动态导入 p-queue
    const { default: PQueue } = await import('p-queue');
    
    const app = express();

    // 初始化缓存，设置TTL为10分钟
    const cache = new NodeCache({ 
        stdTTL: 600,
        checkperiod: 120
    });

    // 初始化请求队列，限制并发请求数
    const queue = new PQueue({
        concurrency: 2, // 同时处理的最大请求数
        interval: 1000, // 间隔时间
        intervalCap: 2  // 在间隔时间内允许的最大请求数
    });

    // 添加 JSON 解析中间件
    app.use(express.json({ 
        limit: '50mb',
        strict: true
    }));

    // API Keys
    const API_KEY = "sk-1234567890";
    const HUGGINGFACE_API_KEY = "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";

    // SSL证书配置
    const options = {
        key: fs.readFileSync('./pem/www.leavel.top.key'),
        cert: fs.readFileSync('./pem/www.leavel.top.pem')
    };

    // 可用模型映射
    const CUSTOMER_MODEL_MAP = {
        "qwen2.5-72b-instruct": "Qwen/Qwen2.5-72B-Instruct",
        "gemma2-2b-it": "google/gemma-2-2b-it", 
        "gemma2-27b-it": "google/gemma-2-27b-it",
        "llama-3-8b-instruct": "meta-llama/Meta-Llama-3-8B-Instruct",
        "llama-3.2-1b-instruct": "meta-llama/Llama-3.2-1B-Instruct",
        "llama-3.2-3b-instruct": "meta-llama/Llama-3.2-3B-Instruct",
        "phi-3.5": "microsoft/Phi-3.5-mini-instruct"
    };

    // 系统预设消息模板
    const SYSTEM_PROMPT = {
        role: 'system',
        content: `作为旅行规划师，提供以下要点：交通路线、住宿推荐、主要景点、特色美食、行程安排和预算估算。注重实用信息，简明扼要。`
    };

    // 缓存键生成函数
    const generateCacheKey = (messages, model) => {
        const messageString = JSON.stringify(messages);
        return `${model}_${Buffer.from(messageString).toString('base64')}`;
    };

    // CORS 中间件
    app.use((req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "*");
        res.header("Access-Control-Allow-Headers", "*");
        res.header("Access-Control-Max-Age", "86400");
        
        if (req.method === "OPTIONS") {
            return res.status(200).end();
        }
        next();
    });

    // 增强的日志处理
    const log = {
        error: function(message, ...args) {
            console.error(`[ERROR ${new Date().toISOString()}] ${message}`, ...args);
        },
        info: function(message, ...args) {
            console.log(`[INFO ${new Date().toISOString()}] ${message}`, ...args);
        },
        debug: function(message, ...args) {
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[DEBUG ${new Date().toISOString()}] ${message}`, ...args);
            }
        }
    };

    // 性能监控中间件
    const performanceMiddleware = (req, res, next) => {
        const start = Date.now();
        // 添加请求参数日志
        log.info(`请求参数: ${JSON.stringify(req.body)}`);
        
        res.on('finish', () => {
            const duration = Date.now() - start;
            log.info(`${req.method} ${req.originalUrl} completed in ${duration}ms`);
        });
        next();
    };

    app.use(performanceMiddleware);

    // API路由配置
    app.get('/v1/models', (req, res) => {
        const arrs = Object.keys(CUSTOMER_MODEL_MAP).map(element => ({ 
            id: element, 
            object: "model" 
        }));
        res.json({
            data: arrs,
            success: true
        });
    });

    // API调用函数
    async function callHuggingFaceAPI(apiUrl, fetchOptions, retries = 3) {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(apiUrl, fetchOptions);
                if (response.ok) {
                    return await response.json();
                }
                lastError = new Error(`API responded with status ${response.status}`);
            } catch (error) {
                lastError = error;
                if (i < retries - 1) {
                    const waitTime = (i + 1) * 3000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        throw lastError;
    }

    // 主要API处理函数
    app.post('/v1/chat/completions', async (req, res) => {
        const startTime = Date.now();
        
        try {
            log.info('Received chat completion request');
            
            // 添加详细的请求参数日志
            log.info('Request parameters:', {
                model: req.body.model,
                temperature: req.body.temperature,
                max_tokens: req.body.max_tokens,
                messages_count: req.body?.messages?.length
            });
            
            // 1. 输入验证
            if (!req.body) {
                return res.status(400).json({ error: "请求体不能为空" });
            }

            const data = req.body;
            
            if (!data.messages || !Array.isArray(data.messages) || data.messages.length === 0) {
                return res.status(400).json({ error: "messages 参数必须是非空数组" });
            }

            // 2. 参数处理
            const model = CUSTOMER_MODEL_MAP[data.model] || data.model;
            const temperature = data.temperature || 0.7;
            const max_tokens = data.max_tokens || 8196;
            const top_p = Math.min(Math.max(data.top_p || 0.9, 0.0001), 0.9999);
            const stream = data.stream || false;

            // 3. 消息处理 - 添加系统提示
            let messages = [SYSTEM_PROMPT, ...data.messages];
            
            // 4. 检查缓存
            const cacheKey = generateCacheKey(messages, model);
            const cachedResponse = cache.get(cacheKey);
            
            if (cachedResponse) {
                log.info(`Cache hit for key: ${cacheKey}`);
                const duration = Date.now() - startTime;
                log.info(`Request served from cache in ${duration}ms`);
                return res.json(cachedResponse);
            }

            // 5. 构建请求
            const requestBody = {
                model: model,
                stream: stream,
                temperature: temperature,
                max_tokens: max_tokens,
                top_p: top_p,
                messages: messages
            };

            const apiUrl = `https://api-inference.huggingface.co/models/${model}/v1/chat/completions`;
            
            // 6. 设置请求配置
            const fetchOptions = {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
                agent: new HttpsProxyAgent('http://127.0.0.1:7890'),
                timeout: 180000 // 180秒超时
            };

            // 7. 将请求添加到队列
            const queuedRequest = async () => {
                log.info('Processing request in queue');
                const response = await callHuggingFaceAPI(apiUrl, fetchOptions);
                
                if (!response || !response.choices) {
                    throw new Error("API 返回的数据格式不正确");
                }

                // 记录API响应日志
                log.info('API Response received:', {
                    status: 'success',
                    choices_length: response.choices.length
                });

                // 缓存响应
                cache.set(cacheKey, response);
                
                return response;
            };

            // 8. 执行队列任务
            const result = await queue.add(queuedRequest);
            
            // 9. 发送响应
            const duration = Date.now() - startTime;
            log.info(`Request completed successfully in ${duration}ms`);
            
            res.json(result);

        } catch (error) {
            const duration = Date.now() - startTime;
            log.error(`Request failed after ${duration}ms:`, error);
            
            res.status(500).json({
                error: `请求处理失败: ${error.message}`,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    });

    // 404处理
    app.use((req, res) => {
        res.status(404).json({ error: "Not Found" });
    });

    // 错误处理中间件
    app.use((err, req, res, next) => {
        log.error('Unhandled error:', err);
        res.status(500).json({
            error: "服务器内部错误",
            message: err.message
        });
    });

    // 创建HTTP服务器(80端口)并重定向至HTTPS
    http.createServer((req, res) => {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(80, () => {
        log.info('HTTP Server running on port 80');
    });

    // 创建HTTPS服务器(443端口)
    const server = https.createServer(options, app).listen(443, () => {
        log.info('HTTPS Server running on port 443');
    });

    // 优雅退出处理
    process.on('SIGTERM', () => {
        log.info('SIGTERM received. Closing servers...');
        server.close(() => {
            log.info('Server closed. Exiting process.');
            process.exit(0);
        });
    });
})().catch(error => {
    console.error('Server initialization failed:', error);
    process.exit(1);
});