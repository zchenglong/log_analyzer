"""日志预处理模块：格式检测、分块、统计摘要。"""

import re
from dataclasses import dataclass, field
from typing import Optional


# 常见日志格式的正则模式
LOG_PATTERNS = {
    # [I][2026-03-11 +8.0 16:34:01.742][pid, tid][module][file, func, line][T:thread] message
    "bracketed": re.compile(
        r"^\[(?P<level>[A-Z])\]"
        r"\[(?P<timestamp>\d{4}-\d{2}-\d{2}\s+[^\]]*\d{2}:\d{2}:\d{2}[\.\d]*)\]"
        r"\[(?P<context>[^\]]*)\]"
    ),
    # 2024-01-15 10:30:45.123 [INFO] message
    "standard": re.compile(
        r"^(?P<timestamp>\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[\.\d]*)\s*"
        r"[\[\(]?(?P<level>DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)[\]\)]?\s+"
        r"(?P<message>.+)"
    ),
    # Jan 15 10:30:45 hostname process[pid]: message (syslog)
    "syslog": re.compile(
        r"^(?P<timestamp>\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+"
        r"(?P<host>\S+)\s+(?P<process>\S+?)(?:\[(?P<pid>\d+)\])?:\s+"
        r"(?P<message>.+)"
    ),
    # [2024-01-15 10:30:45] channel.LEVEL: message
    "laravel": re.compile(
        r"^\[(?P<timestamp>\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[\.\d]*)\]\s+"
        r"(?P<channel>\S+)\.(?P<level>DEBUG|INFO|WARNING|ERROR|CRITICAL|ALERT|EMERGENCY):\s+"
        r"(?P<message>.+)"
    ),
    # 10.0.0.1 - - [15/Jan/2024:10:30:45 +0000] "GET /path HTTP/1.1" 200 1234
    "apache_access": re.compile(
        r'^(?P<ip>\S+)\s+\S+\s+\S+\s+\[(?P<timestamp>[^\]]+)\]\s+'
        r'"(?P<method>\w+)\s+(?P<path>\S+)\s+\S+"\s+(?P<status>\d{3})\s+(?P<size>\d+)'
    ),
    # generic: anything starting with a timestamp-like pattern
    "generic_timestamp": re.compile(
        r"^(?P<timestamp>\d{2,4}[-/]\d{1,2}[-/]\d{1,2}[\sT]\d{2}:\d{2}:\d{2}[\.\d]*)\s+"
        r"(?P<message>.+)"
    ),
}

LEVEL_PATTERN = re.compile(r"\b(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL|ALERT|EMERGENCY)\b", re.IGNORECASE)

CHUNK_MAX_LINES = 3000


@dataclass
class LogStats:
    """日志文件的统计摘要。"""
    total_lines: int = 0
    non_empty_lines: int = 0
    detected_format: str = "unknown"
    time_range_start: Optional[str] = None
    time_range_end: Optional[str] = None
    level_counts: dict = field(default_factory=dict)
    sample_lines: list = field(default_factory=list)


def detect_format(lines: list[str]) -> str:
    """从前 50 行检测日志格式。优先匹配更具体的格式。"""
    sample = [l for l in lines[:50] if l.strip()]
    if not sample:
        return "unknown"

    scores = {name: 0 for name in LOG_PATTERNS}
    for line in sample:
        for name, pattern in LOG_PATTERNS.items():
            if pattern.match(line):
                scores[name] += 1

    # generic_timestamp 几乎能匹配所有带时间戳的行，优先级最低：
    # 只有在没有更具体格式匹配时才选它
    specific_formats = {k: v for k, v in scores.items() if k != "generic_timestamp"}
    best_specific = max(specific_formats, key=specific_formats.get)
    if specific_formats[best_specific] > 0:
        return best_specific

    if scores["generic_timestamp"] > 0:
        return "generic_timestamp"

    return "unknown"


# 通用时间戳提取正则 (不依赖日志格式，仅提取行首的时间戳)
# 支持：纯日期时间、方括号包裹、日期与时间之间有额外内容（如时区偏移）
_GENERIC_TS_RE = re.compile(
    r"^[\[\w\]\s]*\[?"
    r"(?P<timestamp>\d{2,4}[-/]\d{1,2}[-/]\d{1,2}[\sT]+(?:[^\d\s]*\s+)?\d{2}:\d{2}:\d{2}[\.\d]*)"
)


def extract_timestamp(line: str, fmt: str) -> Optional[str]:
    """尝试从行中提取时间戳字符串。"""
    # 优先用检测到的格式
    if fmt in LOG_PATTERNS:
        m = LOG_PATTERNS[fmt].match(line)
        if m and "timestamp" in m.groupdict():
            return m.group("timestamp")
    # fallback: 用通用时间戳正则（只匹配行首的标准日期时间格式）
    m = _GENERIC_TS_RE.match(line)
    if m:
        return m.group("timestamp")
    return None


def count_levels(lines: list[str]) -> dict[str, int]:
    """统计各日志级别的出现次数。"""
    counts: dict[str, int] = {}
    for line in lines:
        m = LEVEL_PATTERN.search(line)
        if m:
            level = m.group(1).upper()
            # 归一化 WARNING -> WARN
            if level == "WARNING":
                level = "WARN"
            counts[level] = counts.get(level, 0) + 1
    return counts


def parse_log_file(filepath: str) -> tuple[LogStats, list[str]]:
    """
    读取日志文件，返回统计摘要和完整行列表。

    Returns:
        (stats, lines) 元组
    """
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    lines = [l.rstrip("\n\r") for l in lines]
    stats = LogStats()
    stats.total_lines = len(lines)
    stats.non_empty_lines = sum(1 for l in lines if l.strip())

    non_empty = [l for l in lines if l.strip()]
    stats.detected_format = detect_format(non_empty)
    stats.level_counts = count_levels(non_empty)

    # 时间范围
    first_ts = None
    last_ts = None
    for line in non_empty:
        ts = extract_timestamp(line, stats.detected_format)
        if ts:
            if first_ts is None:
                first_ts = ts
            last_ts = ts
    stats.time_range_start = first_ts
    stats.time_range_end = last_ts

    # 取前 20 行作为样本
    stats.sample_lines = lines[:20]

    return stats, lines


def chunk_lines(lines: list[str], max_lines: int = CHUNK_MAX_LINES) -> list[str]:
    """
    将日志行分块，每块不超过 max_lines 行。
    返回文本块列表。
    """
    chunks = []
    for i in range(0, len(lines), max_lines):
        chunk = "\n".join(lines[i : i + max_lines])
        chunks.append(chunk)
    return chunks


def filter_lines_by_time(
    lines: list[str], fmt: str, time_start: Optional[str], time_end: Optional[str]
) -> list[str]:
    """
    按时间范围过滤日志行。

    无法提取时间戳的行（如多行堆栈跟踪）会跟随上一条有时间戳的行。
    time_start/time_end 为原始时间戳字符串，直接做字符串比较
    （适用于 ISO 格式等字典序与时间序一致的格式）。
    """
    if not time_start and not time_end:
        return lines

    result: list[str] = []
    include = False  # 当前行是否在范围内

    for line in lines:
        ts = extract_timestamp(line, fmt)
        if ts:
            in_range = True
            if time_start and ts < time_start:
                in_range = False
            if time_end and ts > time_end:
                in_range = False
            include = in_range
        # 没有时间戳的行（堆栈跟踪等）跟随前一条
        if include:
            result.append(line)

    return result


def group_log_entries(lines: list[str], fmt: str) -> list[list[str]]:
    """
    将日志行按条目分组。每条日志以带时间戳的行开头，
    后续没有时间戳的行（堆栈跟踪、多行消息等）归入同一条目。
    """
    entries: list[list[str]] = []
    current: list[str] = []

    for line in lines:
        ts = extract_timestamp(line, fmt)
        if ts and current:
            entries.append(current)
            current = [line]
        else:
            current.append(line)

    if current:
        entries.append(current)

    return entries


def _parse_keyword_expr(expr: str):
    """
    解析关键字布尔表达式，返回一个可调用的匹配函数。

    支持的语法：
    - 关键字: 任意非空白非括号非运算符的字符串，或用引号包裹的字符串
    - AND / and / &: 与运算
    - OR / or / |: 或运算
    - ( ): 分组
    - 默认运算符（相邻关键字之间没有运算符）为 OR

    示例: (ERROR OR WARN) AND timeout
          "json error" | crash
          ERROR AND (timeout OR 404)

    返回: function(text: str) -> bool
    """
    tokens = _tokenize_expr(expr)
    if not tokens:
        return None
    pos, node = _parse_or(tokens, 0)
    return lambda text: _eval_node(node, text)


def _tokenize_expr(expr: str) -> list[str]:
    """将表达式拆分为 token 列表。"""
    tokens: list[str] = []
    i = 0
    while i < len(expr):
        c = expr[i]
        if c in " \t":
            i += 1
            continue
        if c in "()|&":
            tokens.append(c)
            i += 1
            continue
        # 带引号的关键字
        if c in ('"', "'"):
            j = expr.find(c, i + 1)
            if j == -1:
                j = len(expr)
            tokens.append(expr[i + 1 : j])
            i = j + 1
            continue
        # 普通词
        j = i
        while j < len(expr) and expr[j] not in ' \t()|&"\'':
            j += 1
        word = expr[i:j]
        # 识别 AND / OR 运算符
        if word.upper() in ("AND", "OR"):
            tokens.append(word.upper())
        else:
            tokens.append(word)
        i = j
    return tokens


def _parse_or(tokens: list[str], pos: int) -> tuple[int, tuple]:
    """解析 OR 表达式。"""
    pos, left = _parse_and(tokens, pos)
    while pos < len(tokens) and tokens[pos] in ("OR", "|"):
        pos += 1  # skip OR
        pos, right = _parse_and(tokens, pos)
        left = ("OR", left, right)
    return pos, left


def _parse_and(tokens: list[str], pos: int) -> tuple[int, tuple]:
    """解析 AND 表达式。"""
    pos, left = _parse_primary(tokens, pos)
    while pos < len(tokens):
        if tokens[pos] in ("AND", "&"):
            pos += 1  # skip AND
            pos, right = _parse_primary(tokens, pos)
            left = ("AND", left, right)
        elif tokens[pos] not in ("OR", "|", ")"):
            # 相邻关键字，默认 OR
            pos, right = _parse_primary(tokens, pos)
            left = ("OR", left, right)
        else:
            break
    return pos, left


def _parse_primary(tokens: list[str], pos: int) -> tuple[int, tuple]:
    """解析基本表达式（关键字或括号分组）。"""
    if pos >= len(tokens):
        return pos, ("KW", "")
    if tokens[pos] == "(":
        pos += 1  # skip (
        pos, node = _parse_or(tokens, pos)
        if pos < len(tokens) and tokens[pos] == ")":
            pos += 1  # skip )
        return pos, node
    # 关键字
    return pos + 1, ("KW", tokens[pos])


def _eval_node(node: tuple, text: str) -> bool:
    """对文本求值表达式树。"""
    op = node[0]
    if op == "KW":
        kw = node[1].lower()
        return kw in text if kw else True
    elif op == "AND":
        return _eval_node(node[1], text) and _eval_node(node[2], text)
    elif op == "OR":
        return _eval_node(node[1], text) or _eval_node(node[2], text)
    return False


def filter_lines_by_keywords(lines: list[str], keyword_expr: str, fmt: str = "unknown") -> list[str]:
    """
    按关键字表达式过滤日志条目。

    支持布尔表达式: AND, OR, 括号分组。
    示例: (ERROR OR WARN) AND timeout

    先将行按日志条目分组，将整条日志的所有行拼接后匹配，
    匹配成功则保留该条目的所有行。
    """
    if not keyword_expr or not keyword_expr.strip():
        return lines

    matcher = _parse_keyword_expr(keyword_expr.strip())
    if not matcher:
        return lines

    entries = group_log_entries(lines, fmt)
    result: list[str] = []

    for entry_lines in entries:
        entry_text = "\n".join(entry_lines).lower()
        if matcher(entry_text):
            result.extend(entry_lines)

    return result


def format_stats_summary(stats: LogStats) -> str:
    """将统计信息格式化为可读的文本摘要。"""
    parts = [
        f"总行数: {stats.total_lines}",
        f"非空行数: {stats.non_empty_lines}",
        f"检测到的日志格式: {stats.detected_format}",
    ]
    if stats.time_range_start:
        parts.append(f"时间范围: {stats.time_range_start} → {stats.time_range_end}")
    if stats.level_counts:
        level_str = ", ".join(f"{k}: {v}" for k, v in sorted(stats.level_counts.items()))
        parts.append(f"日志级别分布: {level_str}")
    return "\n".join(parts)
