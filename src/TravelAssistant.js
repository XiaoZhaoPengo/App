import React, { useState, useEffect } from 'react';
import { Input, Button, List, Avatar, Typography } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons';
import axios from 'axios';

const { TextArea } = Input;
const { Title } = Typography;

const formatAIResponse = (text) => {
  const emojiMap = {
    '交通方案': '🚄',
    '住宿推荐': '🏨',
    '热门景点': '🏞️',
    '美食推荐': '🍜',
    '每日行程安排': '📆',
    '每日费用预算': '💰',
    '总费用估算': '📊',
    '实用旅行小贴士': '📝',
    '上午': '🌞',
    '下午': '🌇',
    '晚上': '🌙',
    '经济型': '💰',
    '舒适型': '🏆',
    '总计': '🧮',
    '第一天': '1️⃣',
    '第二天': '2️⃣',
    '第三天': '3️⃣',
    '第四天': '4️⃣',
    '第五天': '5️⃣'
  };

  const sections = text.split(/####|###|\n(?=🚄|交通方案|住宿推荐|热门景点|美食推荐|每日行程安排|每日费用预算|总费用估算|实用旅行小贴士)/);
  return sections.map((section, index) => {
    const lines = section.split('\n').filter(line => line.trim() !== '');
    const title = lines.length > 0 ? lines[0] : '';
    let content = lines.slice(1);
    const emoji = title.match(/^\p{Emoji}/u) ? '' : (emojiMap[title.trim()] || '✨');
    content = content.map(line => line.replace(/---$/, '').trim());

    return (
      <div key={index} className="ai-response-section">
        {index === 0 ? (
          <h2 className="travel-plan-title">{title}</h2>
        ) : (
          title && <h3>{emoji} {title.trim().replace(/^[#\s]+/, '')}</h3>
        )}
        {content.map((line, lineIndex) => {
          if (line.startsWith('- ')) {
            return <p key={lineIndex} className="list-item">💖 {line.substring(2)}</p>;
          } else if (line.includes('**')) {
            const parts = line.split('**');
            return (
              <p key={lineIndex}>
                {parts.map((part, partIndex) => 
                  partIndex % 2 === 0 ? part : <strong key={partIndex}>🌟 {part}</strong>
                )}
              </p>
            );
          } else if (line.match(/^[0-9]+\./)) {
            return <p key={lineIndex} className="list-item">🔸 {line.replace(/^[0-9]+\./, '')}</p>;
          } else if (Object.keys(emojiMap).some(key => line.startsWith(key))) {
            const matchedKey = Object.keys(emojiMap).find(key => line.startsWith(key));
            const lineEmoji = line.match(/^\p{Emoji}/u) ? '' : emojiMap[matchedKey];
            return <h4 key={lineIndex}>{lineEmoji} {line}</h4>;
          } else {
            return <p key={lineIndex}>{line}</p>;
          }
        })}
      </div>
    );
  });
};

const WelcomeMessage = () => (
  <div className="welcome-message">
    <img src="/travel-icon.png" alt="Travel Icon" className="welcome-icon" />
    <h2>欢迎使用旅行规划助手！</h2>
    <p>告诉我您的旅行计划，我将为您定制完美的行程。</p>
    <ul>
      <li>输入您的出发地和目的地</li>
      <li>告诉我旅行的人数和天数</li>
      <li>我会为您规划交通、住宿、景点和美食</li>
      <li>例如：北京到三亚，2人，3天</li>
    </ul>
  </div>
);

const TravelAssistant = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);

  useEffect(() => {
    let timer;
    if (loading) {
      timer = setInterval(() => {
        setLoadingTime(prevTime => prevTime + 1);
      }, 1000);
    } else {
      setLoadingTime(0);
    }
    return () => clearInterval(timer);
  }, [loading]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { type: 'user', content: input };
    setMessages([...messages, userMessage]);
    setInput('');
    setLoading(true);

    const maxRetries = 5;
    let retries = 0;

    const retryWithExponentialBackoff = async (retryCount) => {
      try {
        const response = await axios.post(
          'http://43.138.200.215:3001/v1/chat/completions',
          {
            model: 'qwen2.5-72b-instruct',
            messages: [

              { role: 'user', content: input }
            ],
            temperature: 0.7,
            max_tokens: 8196,
            top_p: 0.8,
            stream: false
          },
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 2500000,
            withCredentials: false
          }
        );

        console.log('API Response:', response.data);
        const aiMessage = { type: 'ai', content: formatAIResponse(response.data.choices[0].message.content) };
        setMessages([...messages, userMessage, aiMessage]);
      } catch (error) {
        console.error('Error:', error);
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000; // 指数退避
          console.log(`重试第 ${retryCount + 1} 次，等待 ${delay / 1000} 秒...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          await retryWithExponentialBackoff(retryCount + 1);
        } else {
          let errorMessage = { type: 'ai', content: '抱歉，服务器暂时无法响应。请稍后再试。' };
          if (error.response) {
            errorMessage = { type: 'ai', content: `抱歉，服务器返回了错误：${error.response.status} - ${error.response.data?.error || '未知错误'}` };
          } else if (error.request) {
            errorMessage = { type: 'ai', content: '网络连接出现问题。请检查您的网络连接并重试。' };
          } else if (error.message && error.message.includes('Network Error')) {
            errorMessage = { type: 'ai', content: '网络错误。请检查您的网络连接或联系服务器管理员。' };
          }
          setMessages([...messages, userMessage, errorMessage]);
        }
      }
    };

    await retryWithExponentialBackoff(0);
    setLoading(false);
  };

  return (
    <div className="travel-assistant">
      <Title level={2} className="travel-assistant-title">旅行规划助手</Title>
      <div className="message-container">
        {messages.length === 0 ? (
          <WelcomeMessage />
        ) : (
          <List
            className="message-list"
            itemLayout="horizontal"
            dataSource={messages}
            renderItem={(item) => (
              <List.Item className={`message-item ${item.type}`}>
                {item.type === 'ai' && <Avatar icon={<RobotOutlined />} className="assistant-avatar" />}
                <div className="message-content">{typeof item.content === 'string' ? item.content : item.content}</div>
                {item.type === 'user' && <Avatar icon={<UserOutlined />} className="user-avatar" />}
              </List.Item>
            )}
          />
        )}
      </div>
      <div className="input-container">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Hi～告诉我你的旅行计划吧！✈️"
          className="input-field"
          suffix={
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={sendMessage}
              loading={loading}
              className="send-button"
            >
              {loading ? `寻找最佳方案...请耐心等待（${loadingTime}秒）` : '发送'}
            </Button>
          }
        />
      </div>
    </div>
  );
};

export default TravelAssistant;
