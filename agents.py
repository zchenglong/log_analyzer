"""CrewAI Agent、Task、Crew 定义：3 个 Agent 协作分析日志。"""

import os

from crewai import Agent, Crew, LLM, Process, Task

from log_parser import LogStats, chunk_lines, format_stats_summary

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)

# 支持的模型配置
LLM_PROVIDERS = {
    "dashscope": {
        "model": "dashscope/qwen-turbo",
        "env_key": "DASHSCOPE_API_KEY",
    },
    "hunyuan": {
        "model": "openai/hunyuan-2.0-thinking-20251109",
        "env_key": "HUNYUAN_API_KEY",
        "base_url": "http://api.taiji.woa.com/openapi/v1/messages",
    },
}


def _build_llm(provider: str | None = None) -> LLM:
    provider = provider or os.getenv("LLM_PROVIDER", "dashscope")
    config = LLM_PROVIDERS.get(provider)
    if not config:
        raise RuntimeError(f"不支持的模型提供商: {provider}，可选: {', '.join(LLM_PROVIDERS)}")

    api_key = os.getenv(config["env_key"])
    if not api_key:
        raise RuntimeError(f"环境变量 {config['env_key']} 未设置")

    kwargs = {"model": config["model"], "api_key": api_key}
    if "base_url" in config:
        kwargs["base_url"] = config["base_url"]
    # 允许用户通过环境变量覆盖 base_url
    env_base_url = os.getenv("DASHSCOPE_API_BASE_URL") if provider == "dashscope" else None
    if env_base_url:
        kwargs["base_url"] = env_base_url

    return LLM(**kwargs)


def get_available_providers() -> list[dict[str, str]]:
    """返回可用的模型提供商列表 (供前端下拉框使用)。"""
    return [
        {"id": "dashscope", "name": "阿里千问 (Qwen-Plus)"},
        {"id": "hunyuan", "name": "腾讯混元 (Hunyuan-Turbo)"},
    ]

# ---------------------------------------------------------------------------
# Agent 定义
# ---------------------------------------------------------------------------

def _create_log_parser_agent(llm: LLM) -> Agent:
    return Agent(
        role="日志解析专家",
        goal="解析原始日志，提取结构化的时间线事件、关键字段和模式",
        backstory=(
            "你是一位资深的日志分析工程师，擅长从各种格式的应用程序日志中"
            "提取关键信息。你能快速识别时间戳、日志级别、模块名、错误码等字段，"
            "并将杂乱的日志整理成清晰的时间线事件列表。"
        ),
        llm=llm,
        verbose=False,
    )


def _create_behavior_analyst_agent(llm: LLM) -> Agent:
    return Agent(
        role="用户行为分析师",
        goal="根据日志解析结果，还原用户的操作流程，生成步骤化的操作描述",
        backstory=(
            "你是一位用户体验研究专家，擅长从系统日志中还原用户的真实操作路径。"
            "你能从 API 调用、页面访问、按钮点击等日志事件中推断出用户的意图和行为模式，"
            "并以清晰的步骤化描述呈现完整的用户操作流程。"
        ),
        llm=llm,
        verbose=False,
    )


def _create_issue_diagnostician_agent(llm: LLM) -> Agent:
    return Agent(
        role="问题诊断专家",
        goal="识别日志中的异常、错误和性能问题，给出根因分析和修复建议",
        backstory=(
            "你是一位高级 SRE 工程师，有丰富的生产环境问题排查经验。"
            "你能从日志中快速定位 ERROR、异常堆栈、超时、资源瓶颈等问题，"
            "分析它们的根本原因，评估严重程度，并给出具体可行的修复建议。"
        ),
        llm=llm,
        verbose=False,
    )


# ---------------------------------------------------------------------------
# 公共接口
# ---------------------------------------------------------------------------

def run_analysis(stats: LogStats, lines: list[str], provider: str | None = None) -> dict[str, str]:
    """
    使用 CrewAI 执行完整的日志分析流程。

    返回:
        {
            "log_parsing": "...",       # 日志解析结果
            "user_behavior": "...",     # 用户操作流程
            "issue_diagnosis": "...",   # 问题诊断报告
        }
    """
    llm = _build_llm(provider)

    # 准备日志内容 —— 如果日志太长则分块后取摘要
    chunks = chunk_lines(lines)
    if len(chunks) == 1:
        log_content = chunks[0]
    else:
        # 多块时拼接前两块 + 最后一块，避免超长
        parts = chunks[:2]
        if len(chunks) > 2:
            parts.append(chunks[-1])
        log_content = "\n...(中间部分省略)...\n".join(parts)

    stats_summary = format_stats_summary(stats)

    # --- Agents ---
    parser_agent = _create_log_parser_agent(llm)
    behavior_agent = _create_behavior_analyst_agent(llm)
    diagnostician_agent = _create_issue_diagnostician_agent(llm)

    # --- Tasks ---
    parse_task = Task(
        description=(
            "请解析以下日志内容，提取结构化信息。\n\n"
            f"## 日志统计摘要\n{stats_summary}\n\n"
            f"## 日志内容\n```\n{log_content}\n```\n\n"
            "请完成以下工作：\n"
            "1. 识别日志的格式和关键字段（时间戳、级别、模块、消息等）\n"
            "2. 提取关键事件，按时间线排列\n"
            "3. 标注所有 ERROR、WARN 级别的事件\n"
            "4. 识别重复出现的模式\n"
        ),
        expected_output=(
            "结构化的日志解析报告，包含：事件时间线、关键字段说明、"
            "错误/警告事件列表、重复模式识别。使用 Markdown 格式输出。"
        ),
        agent=parser_agent,
    )

    behavior_task = Task(
        description=(
            "基于日志解析结果，还原用户的操作流程。\n\n"
            "请完成以下工作：\n"
            "1. 从日志事件中识别用户触发的操作（如登录、页面导航、表单提交等）\n"
            "2. 按时间顺序整理出完整的用户操作步骤\n"
            "3. 标注每个步骤的结果（成功/失败/异常）\n"
            "4. 总结用户的主要使用场景和行为模式\n"
            "如果日志中没有明显的用户操作信息，请基于系统调用和请求模式推断可能的操作流程。"
        ),
        expected_output=(
            "用户操作流程报告，包含：步骤化的操作描述（含时间、操作、结果）、"
            "用户行为模式总结。使用 Markdown 格式输出。"
        ),
        agent=behavior_agent,
    )

    diagnosis_task = Task(
        description=(
            "基于日志解析结果和用户行为分析，进行问题诊断。\n\n"
            "请完成以下工作：\n"
            "1. 列出所有发现的问题（错误、异常、性能瓶颈等）\n"
            "2. 对每个问题评估严重程度（Critical/High/Medium/Low）\n"
            "3. 分析每个问题的根本原因\n"
            "4. 给出具体可行的修复建议\n"
            "5. 如果没有发现严重问题，也请给出系统健康状况评估和优化建议\n"
        ),
        expected_output=(
            "问题诊断报告，包含：问题列表（含严重程度）、根因分析、"
            "修复建议、系统健康评估。使用 Markdown 格式输出。"
        ),
        agent=diagnostician_agent,
    )

    # --- Crew ---
    crew = Crew(
        agents=[parser_agent, behavior_agent, diagnostician_agent],
        tasks=[parse_task, behavior_task, diagnosis_task],
        process=Process.sequential,
        verbose=False,
    )

    result = crew.kickoff()

    # 提取各 task 的输出
    task_outputs = result.tasks_output
    return {
        "log_parsing": task_outputs[0].raw if len(task_outputs) > 0 else "",
        "user_behavior": task_outputs[1].raw if len(task_outputs) > 1 else "",
        "issue_diagnosis": task_outputs[2].raw if len(task_outputs) > 2 else "",
    }
