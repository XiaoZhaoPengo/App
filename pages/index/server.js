const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');
const NodeCache = require('node-cache');
const compression = require('compression');

const app = express();
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// 证书路径配置 - Windows版本
const CERT_PATH = 'C:\Users\Administrator\Desktop\Certificates'; // 创建这个目录并把证书文件放在这里
let httpsServer;

try {
    // SSL证书配置
    const SSL_OPTIONS = {
        key: fs.readFileSync(path.join(CERT_PATH, 'private.key')),
        cert: fs.readFileSync(path.join(CERT_PATH, 'certificate.crt'))
    };
    
    // 创建HTTPS服务器
    httpsServer = https.createServer(SSL_OPTIONS, app);
} catch (error) {
    console.error('SSL证书加载失败，将以HTTP模式运行:', error);
}

// API Keys
const API_KEY = "sk-1234567890";
const HUGGINGFACE_API_KEY = "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";

// 代理设置 - 设置是否使用代理
const USE_PROXY = true;
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = '7890';

// 根据设置创建代理
const httpsAgent = USE_PROXY ? new HttpsProxyAgent(`http://${PROXY_HOST}:${PROXY_PORT}`) : undefined;

// Available models mapping
const CUSTOMER_MODEL_MAP = {
    "qwen2.5-72b-instruct": "Qwen/Qwen2.5-72B-Instruct",
    "gemma2-2b-it": "google/gemma-2-2b-it",
    "gemma2-27b-it": "google/gemma-2-27b-it",
    "llama-3-8b-instruct": "meta-llama/Meta-Llama-3-8B-Instruct",
    "llama-3.2-1b-instruct": "meta-llama/Llama-3.2-1B-Instruct",
    "llama-3.2-3b-instruct": "meta-llama/Llama-3.2-3B-Instruct",
    "phi-3.5": "microsoft/Phi-3.5-mini-instruct"
};

// 预设的系统消息
const SYSTEM_MESSAGE = {
    "role": "system",
    "content": "你是专业旅行规划师。请为下列信息制定小红书风格攻略:* 出发地* 目的地人数天数 需包含: 1. 交通方式:最快2种交通方式、时间、价格 2. 住宿推荐:经济/舒适型各2-3家，含位置、价格，避开青年旅社3. 景点打卡:5-8个重点景点介绍，含位置、价格4. 美食打卡:5-8个特色推荐，含位置、价格5. 具体日程:经济/舒适两版，含具体时间安排和具体行程内容安排，含位置、价格6. 预算:两种方案总费用明细。"
};

// Middleware setup
app.use(compression());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
}));
app.use(express.json({ limit: '10mb' }));

// 添加安全相关的头部
app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Configure axios defaults
const axiosInstance = axios.create({
    timeout: 300000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
});

// Models endpoint
app.get('/v1/models', (req, res) => {
    const cachedModels = cache.get('models');
    if (cachedModels) {
        return res.json(cachedModels);
    }

    const models = Object.keys(CUSTOMER_MODEL_MAP).map(id => ({
        id,
        object: "model"
    }));

    const response = {
        data: models,
        success: true
    };

    cache.set('models', response);
    res.json(response);
});

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const {
            messages,
            model,
            temperature = 0.7,
            max_tokens = 8196,
            top_p = 0.9,
            stream = false
        } = req.body;

        const actualModel = CUSTOMER_MODEL_MAP[model] || model;

        if (!messages || !Array.isArray(messages) || !model) {
            return res.status(400).json({
                error: "缺少必要参数或参数格式错误"
            });
        }

        // 修改系统消息拼接逻辑
        const systemMessageWithUserQuery = {
            ...SYSTEM_MESSAGE,
            content: SYSTEM_MESSAGE.content + " 请为以下行程制定攻略：" + messages[messages.length - 1].content
        };

        const fullMessages = [systemMessageWithUserQuery];

        const requestBody = {
            model: actualModel,
            messages: fullMessages,
            stream,
            temperature: Math.min(Math.max(temperature, 0), 1),
            max_tokens: Math.min(Math.max(max_tokens, 1), 8196),
            top_p: Math.min(Math.max(top_p, 0.0001), 0.9999),
        };

        const apiUrl = `https://api-inference.huggingface.co/models/${actualModel}/v1/chat/completions`;

        const axiosConfig = {
            headers: {
                'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            responseType: stream ? 'stream' : 'json',
            validateStatus: status => status < 500,
        };

        if (USE_PROXY && httpsAgent) {
            axiosConfig.httpsAgent = httpsAgent;
            axiosConfig.proxy = false;
        }
        
        console.log('Request Body:', requestBody);

        const response = await axiosInstance.post(apiUrl, requestBody, axiosConfig);
        console.log('API Response:', response.data);
        
        if (response.status !== 200) {
            throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
        }

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            response.data.pipe(res);
        } else {
            res.json(response.data);
        }

    } catch (error) {
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            response: error.response?.data,
        });

        let errorMessage = '请求处理失败';
        if (error.code === 'ETIMEDOUT') {
            errorMessage = 'API 请求超时，请检查网络连接';
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage = USE_PROXY ?
                '代理服务器连接失败，请检查代理设置或关闭代理' :
                'API 连接失败，请检查网络设置';
        } else if (error.response?.data) {
            errorMessage = `API错误: ${JSON.stringify(error.response.data)}`;
        } else {
            errorMessage = error.message;
        }

        res.status(error.response?.status || 500).json({
            error: errorMessage,
            details: error.response?.data || error.message
        });
    }
});

// 创建HTTP服务器用于重定向
const httpServer = http.createServer((req, res) => {
    // 处理 Let's Encrypt 验证
    if (req.url.startsWith('/.well-known/acme-challenge/')) {
        const challengePath = path.join('C:\\win-acme\\httpchallenges', req.url);
        fs.readFile(challengePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(data);
        });
        return;
    }

    // 其他所有HTTP请求重定向到HTTPS
    res.writeHead(301, {
        'Location': 'https://' + req.headers.host + req.url
    });
    res.end();
});

// 启动服务器
const HTTP_PORT = 80;
const HTTPS_PORT = 443;

// 启动HTTP服务器
httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP服务器运行在端口 ${HTTP_PORT}`);
});

// 如果HTTPS证书加载成功，启动HTTPS服务器
if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, () => {
        console.log(`HTTPS服务器运行在端口 ${HTTPS_PORT}`);
        console.log(`代理状态: ${USE_PROXY ? '启用' : '禁用'}`);
        if (USE_PROXY) {
            console.log(`代理设置: ${PROXY_HOST}:${PROXY_PORT}`);
        }
    });
} else {
    console.log('HTTPS服务器未启动，仅运行HTTP服务');
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: "服务器内部错误",
        message: err.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: "接口不存在"
    });
});
