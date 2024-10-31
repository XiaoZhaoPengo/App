// 安装依赖: npm init -y  npm install express node-fetch http https https-proxy-agent
// npm install node-fetch@2 https-proxy-agent
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const app = express();

// 添加 JSON 解析中间件
app.use(express.json());

// API Keys
const API_KEY = "sk-1234567890";
const HUGGINGFACE_API_KEY = "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";

// SSL证书配置
const options = {
    key: fs.readFileSync('./pem/www.leavel.top.key'),  // 替换为您的.key文件名
    cert: fs.readFileSync('./pem/www.leavel.top.pem')  // 替换为您的.pem文件名
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

// 添加日志对象
const log = {
    error: function(message, ...args) {
        console.error(`[ERROR] ${message}`, ...args);
    }
};

app.post('/v1/chat/completions', async (req, res) => {
    try {
        // 1. 增加整体超时时间到 60 秒
        res.setTimeout(60000, () => {
            if (!res.headersSent) {
                res.status(408).json({
                    error: "请求超时",
                    message: "Request timeout after 60s"
                });
            }
        });

        // 2. 请求体验证
        if (!req.body) {
            return res.status(400).json({
                error: "请求体不能为空"
            });
        }

        const data = req.body;
        
        if (!data.messages || !Array.isArray(data.messages) || data.messages.length === 0) {
            return res.status(400).json({
                error: "messages 参数必须是非空数组"
            });
        }

        const model = CUSTOMER_MODEL_MAP[data.model] || data.model;
        const temperature = data.temperature || 0.5;
        const max_tokens = data.max_tokens || 2048;
        const top_p = Math.min(Math.max(data.top_p || 0.7, 0.1), 0.9);
        const stream = data.stream || false;

        // 4. 优化系统预设消息
        const systemMessage = {
            role: 'system',
            content: '你是一个旅行规划师，请根据用户需求提供简洁的旅行建议。'
        };
        
        // 5. 使用展开运算符创建新数组
        let messages = [systemMessage, ...data.messages];

        // 6. 构建请求体 - 修改请求格式以适应 HuggingFace API
        const requestBody = {
            inputs: messages.map(msg => msg.content).join('\n'), // 将消息内容合并
            parameters: {
                temperature: temperature,
                max_new_tokens: max_tokens,
                top_p: top_p,
                do_sample: true,
                return_full_text: false
            }
        };

        // 7. 构建 API URL
        const apiUrl = `https://api-inference.huggingface.co/models/${model}`;
        
        console.log('开始请求 API:', apiUrl);
        console.log('请求参数:', JSON.stringify(requestBody, null, 2));

        // 8. 实现优化的重试机制
        let retries = 2;
        let lastError = null;
        
        while (retries >= 0) {
            try {
                console.log(`尝试请求 API (剩余重试次数: ${retries})`);
                
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`
                    },
                    body: JSON.stringify(requestBody),
                    agent: new HttpsProxyAgent('http://127.0.0.1:7890'),
                    timeout: 30000
                });

                if (response.ok) {
                    const responseData = await response.json();
                    // 格式化响应以匹配 OpenAI 格式
                    const formattedResponse = {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: Array.isArray(responseData) ? responseData[0].generated_text : responseData.generated_text
                            }
                        }],
                        model: data.model,
                        usage: {
                            total_tokens: 0 // HuggingFace API 不提供 token 计数
                        }
                    };
                    console.log('API 请求成功');
                    return res.json(formattedResponse);
                }

                lastError = new Error(`API call failed with status ${response.status}`);
                console.error(`API 请求失败 (状态码: ${response.status})`);
                
            } catch (error) {
                lastError = error;
                console.error('API 请求出错:', error.message);
            }

            retries--;
            if (retries >= 0) {
                const waitTime = 2000;
                console.log(`等待 ${waitTime/1000} 秒后重试...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }

        throw lastError || new Error('Maximum retries reached');

    } catch (error) {
        console.error('Error details:', error);
        res.status(500).json({
            error: `请求处理失败: ${error.message}`,
            details: error.stack
        });
    }
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
});

// 创建HTTP服务器(80端口)并重定向至HTTPS
http.createServer((req, res) => {
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
    res.end();
}).listen(80, () => {
    console.log('HTTP Server running on port 80');
});

// 创建HTTPS服务器(443端口)
https.createServer(options, app).listen(443, () => {
    console.log('HTTPS Server running on port 443');
});