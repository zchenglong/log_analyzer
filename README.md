# 日志分析系统

基于 CrewAI 多 Agent 协作的智能日志分析工具。上传日志文件，AI 自动完成日志解析、用户行为还原和问题诊断。

## 功能特性

- **多格式支持** — 自动检测 6 种常见日志格式（standard、syslog、laravel、apache、bracketed 等）
- **智能过滤** — 支持时间范围过滤和布尔关键字表达式（AND/OR/括号分组）
- **分页日志查看** — 关键字高亮显示，支持大文件浏览
- **AI 多 Agent 分析** — 三个专业 Agent 协作：
  - 日志解析专家：提取结构化时间线和关键事件
  - 用户行为分析师：还原用户操作流程
  - 问题诊断专家：识别问题根因并给出修复建议
- **拖拽上传** — 支持 .log / .txt / .csv / .xlog 格式，最大 50MB

## 快速开始

### 1. 安装依赖

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填写 API Key：

```env
# 选择模型: dashscope (阿里千问) 或 hunyuan (腾讯混元)
LLM_PROVIDER=dashscope

# 阿里云百炼平台 DashScope
DASHSCOPE_API_KEY=your_dashscope_api_key_here

# 腾讯混元
HUNYUAN_API_KEY=your_hunyuan_api_key_here
```

### 3. 启动服务

```bash
python app.py
```

浏览器访问 `http://localhost:5000`。

## 使用方式

1. 在页面顶部选择 AI 分析模型
2. 拖拽或点击上传日志文件
3. 查看自动解析的日志统计信息（行数、格式、时间范围、级别分布）
4. 可选：使用时间范围和关键字过滤缩小分析范围
5. 点击「开始分析」，等待三个 AI Agent 依次完成分析
6. 在「日志解析」「操作流程」「问题诊断」三个标签页查看分析报告

## 技术栈

| 组件 | 技术 |
|------|------|
| Web 框架 | Flask 3.x |
| Agent 编排 | CrewAI 0.108.x |
| LLM 适配 | LiteLLM 1.30.x |
| 前端 UI | Bootstrap 5.3 |
| Markdown 渲染 | Marked.js |

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
└── uploads/            # 上传文件存储
```

## 支持的日志格式

| 格式 | 示例 |
|------|------|
| bracketed | `[I][2024-03-11 +8.0 16:34:01.742][pid, tid][module]...` |
| standard | `2024-01-15 10:30:45.123 [INFO] message` |
| syslog | `Jan 15 10:30:45 hostname process[pid]: message` |
| laravel | `[2024-01-15 10:30:45] channel.ERROR: message` |
| apache_access | `127.0.0.1 - - [15/Jan/2024:10:30:45 +0000] "GET /path HTTP/1.1" 200` |
| generic_timestamp | `2024-01-15 10:30:45 any message` |

## 关键字过滤语法

支持布尔表达式组合：

```
ERROR                        # 单个关键字
ERROR OR WARN                # 任一匹配
ERROR AND timeout            # 同时匹配
(ERROR OR WARN) AND timeout  # 分组组合
"json error"                 # 带空格的关键字用引号包裹
```

## License

MIT
