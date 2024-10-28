const app = getApp()

Page({
  data: {
    messages: [],
    input: '',
    loading: false,
    loadingTime: 0,
    lastMessageId: '' // 用于自动滚动
  },

  onLoad: function () {
    // 页面加载时执行
  },

  inputChange: function (e) {
    this.setData({
      input: e.detail.value
    })
  },

  sendMessage: function () {
    if (!this.data.input.trim()) return;
  
    const userMessage = { type: 'user', content: this.data.input };
    const userInput = this.data.input; // 保存用户输入，因为后面会清空input

    this.setData({
      messages: [...this.data.messages, userMessage],
      input: '',
      loading: true
    });
  
    wx.request({
      url: 'https://www.leavel.top/v1/chat/completions',
      method: 'POST',
      data: {
        model: 'qwen2.5-72b-instruct',
        messages: [
          {
            role: 'user',
            content: userInput  // 使用保存的用户输入
          }
        ],
        temperature: 0.7,
        max_tokens: 8196,
        top_p: 0.8,
        stream: false
      },
      header: {
        'content-type': 'application/json'
      },
      success: (res) => {
        if (res.data.error) {
          const errorMessage = { 
            type: 'ai', 
            content: `错误: ${res.data.error}` 
          };
          this.setData({
            messages: [...this.data.messages, errorMessage],
            loading: false
          });
          return;
        }

        try {
          const aiMessage = { 
            type: 'ai', 
            content: this.formatAIResponse(res.data.choices[0].message.content)  // 添加格式化处理
          };
          this.setData({
            messages: [...this.data.messages, aiMessage],
            loading: false
          });
        } catch (error) {
          console.error('Response parsing error:', error, res.data);
          const errorMessage = { 
            type: 'ai', 
            content: '抱歉，服务器返回的数据格式有误' 
          };
          this.setData({
            messages: [...this.data.messages, errorMessage],
            loading: false
          });
        }
      },
      fail: (error) => {
        console.error('Request error:', error);
        const errorMessage = { 
          type: 'ai', 
          content: '抱歉，服务器暂时无法响应。请稍后再试。' 
        };
        this.setData({
          messages: [...this.data.messages, errorMessage],
          loading: false
        });
      }
    });
  
    // 更新完messages后设置lastMessageId
    this.setData({
      lastMessageId: `msg-${this.data.messages.length - 1}`
    });
  },

  formatAIResponse: function (text) {
    if (!text) return '无响应内容';
    
    // 添加emoji处理
    const emojiMap = {
      '第一天': '🚗 第一天',
      '第二天': '🏃 第二天',
      '第三天': '🎯 第三天',
      '上午': '☀️ 上午',
      '中午': '🌞 中午',
      '下午': '🌅 下午',
      '晚上': '🌙 晚上',
      '注意事项': '⚠️ 注意事项',
      '交通方式': '🚅 交通方式',
      '住宿': '🏨 住宿',
      '景点': '🏛️ 景点',
      '美食': '🍜 美食',
      '行程安排': '📅 行程安排',
      '预算': '💰 预算'
    };
    
    // 处理分段和emoji
    let formattedText = text.trim()
      // 移除 ### 和 #### 
      .replace(/#{3,4}\s*/g, '')
      // 移除 ** 符号
      .replace(/\*\*/g, '')
      // 移除 —— 
      .replace(/——/g, '')
      .replace(/[-]{2,}/g, '');
    
    // 替换所有匹配的文本为带emoji的版本
    Object.keys(emojiMap).forEach(key => {
      formattedText = formattedText.replace(new RegExp(key, 'g'), emojiMap[key]);
    });
    
    // 其他格式化处理
    formattedText = formattedText
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*[-•]\s/gm, '• ');
      
    return formattedText;
  },

  startLoadingTimer: function () {
    this.loadingTimer = setInterval(() => {
      this.setData({
        loadingTime: this.data.loadingTime + 1
      })
    }, 1000)
  },

  stopLoadingTimer: function () {
    clearInterval(this.loadingTimer);
    this.setData({
      loadingTime: 0
    })
  }
})
