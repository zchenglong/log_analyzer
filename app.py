"""Flask 主应用：路由、文件上传、分析调用。"""

import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from agents import get_available_providers, run_analysis
from log_parser import count_levels, filter_lines_by_time, filter_lines_by_keywords, parse_log_file

load_dotenv(Path(__file__).parent / ".env")

app = Flask(__name__)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

ALLOWED_EXTENSIONS = {".log", ".txt", ".csv", ".xlog"}

# 内存中保存已上传文件的信息 (简易方案，生产环境应用数据库)
_uploads: dict[str, dict] = {}


def _allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/providers")
def providers():
    return jsonify(get_available_providers())


@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "没有找到上传的文件"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "文件名为空"}), 400

    if not _allowed_file(file.filename):
        return jsonify({"error": f"不支持的文件格式，仅支持 {', '.join(ALLOWED_EXTENSIONS)}"}), 400

    file_id = uuid.uuid4().hex[:12]
    ext = Path(file.filename).suffix
    saved_name = f"{file_id}{ext}"
    saved_path = UPLOAD_DIR / saved_name
    file.save(str(saved_path))

    # 预解析获取统计信息和预览
    stats, lines = parse_log_file(str(saved_path))

    _uploads[file_id] = {
        "path": str(saved_path),
        "original_name": file.filename,
        "stats": stats,
        "lines": lines,
    }

    return jsonify({
        "file_id": file_id,
        "filename": file.filename,
        "total_lines": stats.total_lines,
        "detected_format": stats.detected_format,
        "time_range_start": stats.time_range_start,
        "time_range_end": stats.time_range_end,
        "time_range": (
            f"{stats.time_range_start} → {stats.time_range_end}"
            if stats.time_range_start else "未检测到"
        ),
        "level_counts": stats.level_counts,
        "preview": stats.sample_lines,
    })


@app.route("/filter", methods=["POST"])
def filter_log():
    """按时间范围和关键字过滤日志，返回过滤后的统计和预览。"""
    data = request.get_json(silent=True) or {}
    file_id = data.get("file_id")
    time_start = data.get("time_start")
    time_end = data.get("time_end")
    keyword_expr = data.get("keyword_expr", "")

    if not file_id or file_id not in _uploads:
        return jsonify({"error": "无效的文件 ID"}), 400

    upload_info = _uploads[file_id]
    stats = upload_info["stats"]
    all_lines = upload_info["lines"]

    filtered = filter_lines_by_time(all_lines, stats.detected_format, time_start, time_end)
    filtered = filter_lines_by_keywords(filtered, keyword_expr, fmt=stats.detected_format)
    non_empty = [l for l in filtered if l.strip()]

    return jsonify({
        "total_lines": len(filtered),
        "non_empty_lines": len(non_empty),
        "level_counts": count_levels(non_empty),
        "preview": filtered[:20],
    })


@app.route("/logs", methods=["POST"])
def get_logs():
    """返回过滤后的完整日志（分页）。"""
    data = request.get_json(silent=True) or {}
    file_id = data.get("file_id")
    time_start = data.get("time_start")
    time_end = data.get("time_end")
    keyword_expr = data.get("keyword_expr", "")
    page = data.get("page", 1)
    page_size = data.get("page_size", 500)

    if not file_id or file_id not in _uploads:
        return jsonify({"error": "无效的文件 ID"}), 400

    upload_info = _uploads[file_id]
    stats = upload_info["stats"]
    all_lines = upload_info["lines"]

    filtered = filter_lines_by_time(all_lines, stats.detected_format, time_start, time_end)
    filtered = filter_lines_by_keywords(filtered, keyword_expr, fmt=stats.detected_format)

    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    page_lines = filtered[start:end]

    return jsonify({
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
        "lines": page_lines,
    })


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(silent=True) or {}
    file_id = data.get("file_id")
    provider = data.get("provider")

    if not file_id or file_id not in _uploads:
        return jsonify({"error": "无效的文件 ID，请先上传文件"}), 400

    upload_info = _uploads[file_id]
    stats = upload_info["stats"]
    lines = upload_info["lines"]

    # 应用过滤（时间 + 关键字）
    time_start = data.get("time_start")
    time_end = data.get("time_end")
    keyword_expr = data.get("keyword_expr", "")
    lines = filter_lines_by_time(lines, stats.detected_format, time_start, time_end)
    lines = filter_lines_by_keywords(lines, keyword_expr, fmt=stats.detected_format)

    if not lines:
        return jsonify({"error": "过滤后没有日志内容，请调整过滤条件"}), 400

    try:
        results = run_analysis(stats, lines, provider=provider)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"分析过程出错: {e}"}), 500

    return jsonify(results)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
