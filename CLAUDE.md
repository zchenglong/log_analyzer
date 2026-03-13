# CLAUDE.md

## 项目概述

基于 Flask + CrewAI 的 AI 日志分析系统。用户通过 Web 界面上传日志文件，系统使用三个 AI Agent（日志解析专家、用户行为分析师、问题诊断专家）协作分析日志，输出结构化报告。

## 技术栈

- **后端**: Flask 3.x, CrewAI 0.108.x, LiteLLM 1.30.x, python-dotenv
- **前端**: Bootstrap 5.3, Marked.js, 原生 JavaScript
- **AI 模型**: 阿里 DashScope (Qwen-Turbo) / 腾讯混元 (Hunyuan)
- **Python**: 3.12+

## 项目结构

```
├── app.py              # Flask 主应用，路由与请求处理
├── agents.py           # CrewAI Agent 定义与编排
├── log_parser.py       # 日志解析、格式检测、过滤、统计
├── requirements.txt    # Python 依赖
├── .env.example        # 环境变量模板
├── static/
│   ├── app.js          # 前端交互逻辑
│   └── style.css       # 自定义样式
├── templates/
│   └── index.html      # 主页模板
└── uploads/            # 上传文件存储（已 gitignore）
```

## 常用命令

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务（监听 0.0.0.0:5000）
python app.py
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写 API Key：

- `LLM_PROVIDER` — 选择模型提供商：`dashscope` 或 `hunyuan`
- `DASHSCOPE_API_KEY` — 阿里 DashScope API Key
- `HUNYUAN_API_KEY` — 腾讯混元 API Key
- `DASHSCOPE_API_BASE_URL` — 可选，覆盖 DashScope 接口地址

## 核心架构

### API 路由 (app.py)

| 路由 | 方法 | 功能 |
|------|------|------|
| `/` | GET | 渲染主页 |
| `/providers` | GET | 返回可用模型列表 |
| `/upload` | POST | 上传并预解析日志文件 |
| `/filter` | POST | 按时间范围和关键字过滤日志 |
| `/logs` | POST | 返回过滤后的分页日志 |
| `/analyze` | POST | 触发 CrewAI 多 Agent 分析 |

### Agent 协作流程 (agents.py)

三个 Agent 通过 CrewAI 顺序执行：
1. **日志解析专家** — 提取结构化信息、时间线、错误/警告事件
2. **用户行为分析师** — 还原用户操作流程和行为模式
3. **问题诊断专家** — 识别问题、评估严重程度、给出修复建议

### 日志解析 (log_parser.py)

支持 6 种日志格式自动检测：`bracketed`、`standard`、`syslog`、`laravel`、`apache_access`、`generic_timestamp`。

关键字过滤支持布尔表达式（AND/OR/括号分组），时间过滤基于时间戳字符串比较。

## 编码规范

- 代码注释和 UI 文本使用中文
- 使用 Python type hints
- 使用 dataclass 定义数据结构
- 前端使用 IIFE 封装，避免全局变量污染
