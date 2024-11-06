// 安装依赖: npm init -y && npm install express node-fetch http https https-proxy-agent node-cache p-queue compression redis ioredis cluster
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const Redis = require('ioredis');
const path = require('path');
const compression = require('compression');
const cluster = require('cluster');
const os = require('os');

// Redis配置优化
const redisConfig = {
    host: '127.0.0.1',
    port: 6379,
    password: '', 
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    // 添加连接优化
    connectTimeout: 10000,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    autoResendUnfulfilledCommands: true
};

// 日志函数保持不变
const log = {
    info: (...args) => console.log(`[INFO ${new Date().toISOString()}]`, ...args),
    error: (...args) => console.error(`[ERROR ${new Date().toISOString()}]`, ...args),
    debug: (...args) => process.env.NODE_ENV !== 'production' && console.log(`[DEBUG ${new Date().toISOString()}]`, ...args),
    perf: (...args) => console.log(`[PERF ${new Date().toISOString()}]`, ...args)
};

// SSL证书检查函数保持不变
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

// 集群模式处理保持不变
if (cluster.isMaster) {
    const numCPUs = os.cpus().length;
    log.info(`主进程 ${process.pid} 正在运行`);

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        log.error(`工作进程 ${worker.process.pid} 已退出`);
        cluster.fork();
    });
} else {
    (async () => {
        const { default: PQueue } = await import('p-queue');
        
        const app = express();
        
        // Redis客户端初始化
        const redisClient = new Redis(redisConfig);
        redisClient.on('error', (err) => log.error('Redis错误:', err));
        redisClient.on('connect', () => log.info('Redis连接成功'));

        // 优化内存缓存配置
        const memoryCache = new NodeCache({ 
            stdTTL: 3600, // 增加缓存时间到1小时
            checkperiod: 600,
            useClones: false,
            deleteOnExpire: true,
            maxKeys: 5000 // 增加缓存容量
        });

        // 压缩配置优化
        app.use(compression({
            level: 6, // 调整压缩级别平衡性能
            threshold: 512, // 降低压缩阈值
            filter: (req, res) => {
                if (req.headers['x-no-compression']) return false;
                return compression.filter(req, res);
            }
        }));
        
        // 静态文件服务优化
        app.use(express.static(path.join(__dirname,'public'), {
            maxAge: '7d', // 增加缓存时间
            etag: true,
            lastModified: true
        }));

        // 修改队列配置
        const queue = new PQueue({
            concurrency: 10,  // 降低并发数
            interval: 1000,
            intervalCap: 10,
            timeout: 60000,   // 增加超时时间到60秒
            throwOnTimeout: false,
            autoStart: true
        });

        // JSON解析配置保持不变
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

            // API配置保持不变
            const API_KEY = "sk-1234567890";
            const HUGGINGFACE_API_KEY = "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";
            
            // 模型映射保持不变
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
                content: `你是专业旅行规划师。请根据出发地,目的地,人数,天数 信息制定小红书风格攻略。内容需要合理且详细，必须包含价格和详细位置。内容最后需要加上旅行小贴士。无需回复和旅行的无关问题。`
            };

            // CORS配置优化
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

            // 消息处理保持不变
            const processMessages = (messages) => {
                if (!Array.isArray(messages)) {
                    throw new Error("messages必须是数组");
                }
                const cleanedMessages = messages.map(msg => ({
                    role: msg.role,
                    content: String(msg.content).trim()
                }));
                return cleanedMessages[0]?.role !== 'system' ? [SYSTEM_PROMPT, ...cleanedMessages] : cleanedMessages;
            };

            // 优化缓存键生成
            const generateCacheKey = (messages, model) => {
                const messageString = JSON.stringify(messages.map(m => ({
                    role: m.role,
                    content: m.content.substring(0, 100) // 只使用内容前100个字符
                })));
                return `${model}_${Buffer.from(messageString).toString('base64')}`;
            };

            // 修改 API 调用函数
            const callHuggingFaceAPI = async (url, options) => {
                let lastError;
                for (let i = 0; i < 3; i++) {  // 最多重试3次
                    try {
                        const response = await fetch(url, {
                            ...options,
                            agent: proxyAgent,
                            timeout: 60000,  // 增加超时时间到60秒
                            compress: true
                        });

                        if (!response.ok) {
                            throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
                        }

                        const data = await response.json();
                        return data;
                    } catch (error) {
                        lastError = error;
                        log.error(`第${i + 1}次请求失败:`, error);
                        if (i < 2) {  // 如果不是最后一次尝试，等待后重试
                            await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
                        }
                    }
                }
                throw lastError;
            };

            // 优化缓存检查函数
            const checkCache = async (cacheKey) => {
                const memResult = memoryCache.get(cacheKey);
                if (memResult) {
                    return { data: memResult, source: 'memory' };
                }

                const redisResult = await redisClient.get(cacheKey);
                if (redisResult) {
                    const parsed = JSON.parse(redisResult);
                    memoryCache.set(cacheKey, parsed);
                    return { data: parsed, source: 'redis' };
                }

                return null;
            };

            // 优化缓存写入
            const setCache = async (cacheKey, data) => {
                memoryCache.set(cacheKey, data);
                await redisClient.set(cacheKey, JSON.stringify(data), 'EX', 3600); // 增加缓存时间到1小时
            };

            // 修改代理配置
            const proxyAgent = new HttpsProxyAgent({
                host: '127.0.0.1',
                port: 7890,
                timeout: 60000,    // 增加超时时间到60秒
                keepAlive: true,
                keepAliveMsecs: 1000,
                maxSockets: 50,    // 降低最大连接数
                maxFreeSockets: 10,
                scheduling: 'lifo'
            });

            // 主API路由优化
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
                    
                    const cachedResult = await checkCache(cacheKey);
                    if (cachedResult) {
                        res.setHeader('X-Cache', `HIT-${cachedResult.source}`);
                        return res.json(cachedResult.data);
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
                        agent: proxyAgent,
                        compress: true,
                        timeout: 60000
                    };

                    const result = await queue.add(
                        () => callHuggingFaceAPI(apiUrl, fetchOptions),
                        { priority: 1 }
                    );

                    await setCache(cacheKey, result);
                    
                    res.setHeader('X-Response-Time', `${Date.now() - startTime}ms`);
                    res.json(result);

                    log.perf(`请求处理完成, 耗时: ${Date.now() - startTime}ms`);

                } catch (error) {
                    log.error(`请求处理失败 (${Date.now() - startTime}ms):`, error);
                    res.status(500).json({
                        error: `请求处理失败: ${error.message}`,
                        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
                    });
                }
            });

            // 错误处理中间件保持不变
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

            // HTTP服务器保持不变
            const httpServer = http.createServer((req, res) => {
                const httpsUrl = `https://${req.headers.host}${req.url}`;
                res.writeHead(301, { 
                    "Location": httpsUrl,
                    "Cache-Control": "no-cache"
                });
                res.end();
            });

            // HTTPS服务器保持不变
            const httpsServer = https.createServer(sslOptions, app);
            
            // 错误处理保持不变
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

            // 启动服务器
            httpServer.listen(80, () => {
                log.info(`工作进程 ${process.pid} - HTTP服务器运行在端口 80`);
            });

            httpsServer.listen(443, () => {
                log.info(`工作进程 ${process.pid} - HTTPS服务器运行在端口 443`);
            });

            // 优雅退出处理保持不变
            const gracefulShutdown = async (signal) => {
                log.info(`收到关闭信号: ${signal}`);
                
                try {
                    await Promise.all([
                        new Promise(resolve => httpServer.close(resolve)),
                        new Promise(resolve => httpsServer.close(resolve))
                    ]);
                    
                    await queue.clear();
                    await redisClient.quit();
                    memoryCache.close();
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
}

// 全局未捕获异常处理
process.on('uncaughtException', (error) => {
    log.error('未捕获的异常:', error);
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('未处理的Promise拒绝:', reason);
});
