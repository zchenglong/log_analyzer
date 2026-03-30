"""Knot 智能体 AG-UI 协议客户端：封装 Knot API 调用逻辑。"""

import json
import os

import requests


def analyze_with_knot(stats_summary: str, log_content: str) -> str:
    """
    调用 Knot 智能体分析日志，返回完整的分析结果文本。

    使用 AG-UI 协议（stream=True），拼接所有 TEXT_MESSAGE_CONTENT 事件的 content。

    Args:
        stats_summary: 日志统计摘要文本
        log_content: 日志内容文本

    Returns:
        Knot 智能体返回的完整分析报告文本

    Raises:
        RuntimeError: 配置缺失或 API 调用失败时抛出
    """
    agent_id = os.getenv("KNOT_AGENT_ID")
    api_token = os.getenv("KNOT_API_TOKEN")
    api_user = os.getenv("KNOT_API_USER", "log_analyzer")

    if not agent_id:
        raise RuntimeError("环境变量 KNOT_AGENT_ID 未设置")
    if not api_token:
        raise RuntimeError("环境变量 KNOT_API_TOKEN 未设置")

    url = f"https://knot.woa.com/apigw/api/v1/agents/agui/{agent_id}"

    # 构造提示词
    message = (
        "请对以下日志进行全面分析，包括：\n"
        "1. 日志解析：识别格式、提取关键字段、按时间线整理事件、标注错误/警告\n"
        "2. 用户行为分析：还原用户操作流程、识别行为模式\n"
        "3. 问题诊断：列出问题、评估严重程度、分析根因、给出修复建议\n\n"
        f"## 日志统计摘要\n{stats_summary}\n\n"
        f"## 日志内容\n```\n{log_content}\n```\n\n"
        "请使用 Markdown 格式输出完整的分析报告。"
    )

    # 构造 Knot AG-UI 协议请求体
    payload = {
        "input": {
            "message": message,
            "conversation_id": "",
            "model": os.getenv("KNOT_MODEL", "deepseek-v3.1"),
            "stream": True,
            "enable_web_search": False,
            "chat_extra": {
                "agent_client_uuid": "",
                "extra_headers": {},
            },
        }
    }

    headers = {
        "Content-Type": "application/json",
        "x-knot-api-token": api_token,
        "x-knot-api-user": api_user,
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=300)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(f"Knot API 调用失败: {e}") from e

    # 解析 SSE 流，拼接 TEXT_MESSAGE_CONTENT 事件的 content
    result_parts: list[str] = []

    for chunk in resp.iter_lines():
        if not chunk:
            continue
        chunk_str = chunk.decode("utf-8").lstrip("data:").strip()
        if chunk_str == "[DONE]":
            break
        try:
            msg = json.loads(chunk_str)
        except json.JSONDecodeError:
            continue

        if "type" not in msg:
            continue

        if msg["type"] == "TEXT_MESSAGE_CONTENT":
            content = msg.get("rawEvent", {}).get("content", "")
            if content:
                result_parts.append(content)

    result = "".join(result_parts)
    if not result.strip():
        raise RuntimeError("Knot 智能体未返回有效的分析结果")

    return result
