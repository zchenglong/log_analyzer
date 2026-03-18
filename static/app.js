/* 前端交互逻辑 */

(function () {
    "use strict";

    // DOM 元素
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const uploadSection = document.getElementById("upload-section");
    const fileInfoSection = document.getElementById("file-info-section");
    const loadingSection = document.getElementById("loading-section");
    const resultSection = document.getElementById("result-section");
    const errorSection = document.getElementById("error-section");
    const modelSelect = document.getElementById("model-select");
    const timeStart = document.getElementById("time-start");
    const timeEnd = document.getElementById("time-end");
    const timeFilter = document.getElementById("time-filter");
    const keywordExprField = document.getElementById("keyword-expr");
    const keywordInput = document.getElementById("keyword-input");
    const keywordBubbles = document.getElementById("keyword-bubbles");
    const keywordBar = document.getElementById("keyword-bar");
    const matchCount = document.getElementById("keyword-match-count");
    const logViewer = document.getElementById("log-viewer");
    const logTotalInfo = document.getElementById("log-total-info");
    const btnExport = document.getElementById("btn-export");

    let currentFileId = null;
    let rawTimeStart = null;
    let rawTimeEnd = null;

    // 关键字数据: [{keyword: "ERROR", op: "OR"}, ...] op 是该关键字与前一个的连接符
    let kwItems = [];

    // ---- 加载模型列表 ----

    (async function loadProviders() {
        try {
            const resp = await fetch("/providers");
            const providers = await resp.json();
            providers.forEach((p) => {
                const opt = document.createElement("option");
                opt.value = p.id;
                opt.textContent = p.name;
                modelSelect.appendChild(opt);
            });
        } catch (_) {
            const opt = document.createElement("option");
            opt.value = "dashscope";
            opt.textContent = "阿里千问 (Qwen-Plus)";
            modelSelect.appendChild(opt);
        }
    })();

    // ---- 工具函数 ----

    function show(el) { el.classList.remove("d-none"); }
    function hide(el) { el.classList.add("d-none"); }

    function showError(msg) {
        document.getElementById("error-message").textContent = msg;
        show(errorSection);
    }

    function hideError() { hide(errorSection); }

    function resetUI() {
        currentFileId = null;
        rawTimeStart = null;
        rawTimeEnd = null;
        kwItems = [];
        hide(fileInfoSection);
        hide(loadingSection);
        hide(resultSection);
        hideError();
        show(uploadSection);
        fileInput.value = "";
        timeFilter.classList.add("d-none");
        keywordInput.value = "";
        hide(matchCount);
        logViewer.innerHTML = "";
        logTotalInfo.textContent = "";
        renderBubbles();
    }

    // ---- 表达式生成 ----

    function buildExpr() {
        if (kwItems.length === 0) return "";
        let parts = [];
        kwItems.forEach((item, i) => {
            if (i > 0) parts.push(item.op);
            // 包含空格的关键字用引号包裹
            if (item.keyword.includes(" ")) {
                parts.push('"' + item.keyword + '"');
            } else {
                parts.push(item.keyword);
            }
        });
        return parts.join(" ");
    }

    function syncExpr() {
        keywordExprField.value = buildExpr();
    }

    function getFilterParams() {
        return {
            file_id: currentFileId,
            time_start: timeStart.value || null,
            time_end: timeEnd.value || null,
            keyword_expr: buildExpr() || null,
        };
    }

    function getHighlightKeywords() {
        return kwItems.map(item => item.keyword.toLowerCase());
    }

    // ---- 气泡渲染 ----

    function renderBubbles() {
        keywordBubbles.innerHTML = "";
        kwItems.forEach((item, i) => {
            // 运算符（第二个起显示）
            if (i > 0) {
                const opEl = document.createElement("span");
                opEl.className = "kw-op";
                opEl.textContent = item.op;
                opEl.title = "点击切换 AND / OR";
                opEl.addEventListener("click", () => {
                    item.op = item.op === "OR" ? "AND" : "OR";
                    renderBubbles();
                    syncExpr();
                    triggerFilter();
                });
                keywordBubbles.appendChild(opEl);
            }
            // 气泡
            const bubble = document.createElement("span");
            bubble.className = "kw-bubble";
            bubble.innerHTML = escapeHtml(item.keyword) +
                ' <button class="kw-remove" title="移除">&times;</button>';
            bubble.querySelector(".kw-remove").addEventListener("click", () => {
                kwItems.splice(i, 1);
                renderBubbles();
                syncExpr();
                syncQuickButtons();
                triggerFilter();
            });
            keywordBubbles.appendChild(bubble);
        });
        syncQuickButtons();
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ---- 关键字增删 ----

    function addKeyword(kw, op) {
        kw = kw.trim();
        if (!kw) return;
        // 去重
        if (kwItems.some(item => item.keyword.toLowerCase() === kw.toLowerCase())) return;
        kwItems.push({ keyword: kw, op: op || "OR" });
        renderBubbles();
        syncExpr();
        triggerFilter();
    }

    function removeKeyword(kw) {
        kwItems = kwItems.filter(item => item.keyword.toLowerCase() !== kw.toLowerCase());
        renderBubbles();
        syncExpr();
        syncQuickButtons();
        triggerFilter();
    }

    function hasKeyword(kw) {
        return kwItems.some(item => item.keyword.toLowerCase() === kw.toLowerCase());
    }

    // ---- 输入框事件 ----

    keywordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addKeyword(keywordInput.value);
            keywordInput.value = "";
        }
        // Backspace 删除最后一个气泡
        if (e.key === "Backspace" && keywordInput.value === "" && kwItems.length > 0) {
            kwItems.pop();
            renderBubbles();
            syncExpr();
            syncQuickButtons();
            triggerFilter();
        }
    });

    // 点击整个 bar 聚焦输入框
    keywordBar.addEventListener("click", (e) => {
        if (e.target === keywordBar || e.target === keywordBubbles) {
            keywordInput.focus();
        }
    });

    // 清除
    document.getElementById("btn-keyword-clear").addEventListener("click", () => {
        kwItems = [];
        keywordInput.value = "";
        hide(matchCount);
        renderBubbles();
        syncExpr();
        triggerFilter();
    });

    // ---- 快捷按钮 ----

    document.querySelectorAll(".quick-kw").forEach(btn => {
        btn.addEventListener("click", () => {
            const kw = btn.dataset.kw;
            if (hasKeyword(kw)) {
                removeKeyword(kw);
            } else {
                addKeyword(kw);
            }
            keywordInput.focus();
        });
    });

    function syncQuickButtons() {
        document.querySelectorAll(".quick-kw").forEach(btn => {
            const kw = btn.dataset.kw.toLowerCase();
            if (hasKeyword(kw)) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    }

    // ---- 防抖过滤 ----

    let _filterTimer = null;

    function triggerFilter() {
        clearTimeout(_filterTimer);
        _filterTimer = setTimeout(applyFilter, 300);
    }

    // ---- 拖拽上传 ----

    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            uploadFile(files[0]);
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            uploadFile(fileInput.files[0]);
        }
    });

    // ---- 上传文件 ----

    async function uploadFile(file) {
        hideError();
        const formData = new FormData();
        formData.append("file", file);

        try {
            const resp = await fetch("/upload", { method: "POST", body: formData });
            const data = await resp.json();

            if (!resp.ok) {
                showError(data.error || "上传失败");
                return;
            }

            currentFileId = data.file_id;
            kwItems = [];
            keywordInput.value = "";
            hide(matchCount);
            renderBubbles();
            syncExpr();
            displayFileInfo(data);
            loadLogs();
        } catch (err) {
            showError("上传请求失败: " + err.message);
        }
    }

    function displayFileInfo(data) {
        hide(uploadSection);
        show(fileInfoSection);

        document.getElementById("file-name").textContent = data.filename;
        document.getElementById("stat-lines").textContent = data.total_lines;
        document.getElementById("stat-format").textContent = data.detected_format;
        document.getElementById("stat-time").textContent = data.time_range;

        updateBadges(data.level_counts);

        rawTimeStart = data.time_range_start || null;
        rawTimeEnd = data.time_range_end || null;
        if (rawTimeStart) {
            timeStart.value = rawTimeStart;
            timeEnd.value = rawTimeEnd || "";
            timeFilter.classList.remove("d-none");
        } else {
            timeFilter.classList.add("d-none");
        }
    }

    function updateBadges(levelCounts) {
        const badgesEl = document.getElementById("level-badges");
        badgesEl.innerHTML = "";
        const levelColors = {
            ERROR: "danger", FATAL: "danger", CRITICAL: "danger",
            WARN: "warning", WARNING: "warning",
            INFO: "info", DEBUG: "secondary"
        };
        for (const [level, count] of Object.entries(levelCounts || {})) {
            const color = levelColors[level] || "secondary";
            const badge = document.createElement("span");
            badge.className = `badge bg-${color} me-2`;
            badge.textContent = `${level}: ${count}`;
            badgesEl.appendChild(badge);
        }
    }

    // ---- 重新上传 ----

    document.getElementById("btn-reset").addEventListener("click", resetUI);

    // ---- 时间重置 ----

    document.getElementById("btn-time-reset").addEventListener("click", () => {
        timeStart.value = rawTimeStart || "";
        timeEnd.value = rawTimeEnd || "";
        applyFilter();
    });

    // ---- 应用过滤 (时间 + 关键字) ----

    document.getElementById("btn-time-apply").addEventListener("click", applyFilter);

    async function applyFilter() {
        if (!currentFileId) return;
        hideError();

        try {
            const resp = await fetch("/filter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(getFilterParams()),
            });
            const data = await resp.json();
            if (!resp.ok) {
                showError(data.error || "过滤失败");
                return;
            }

            document.getElementById("stat-lines").textContent = data.total_lines;
            updateBadges(data.level_counts);

            document.getElementById("filter-result").innerHTML =
                '<span class="text-success">已过滤，共 ' + data.total_lines + ' 行</span>';

            if (kwItems.length > 0) {
                matchCount.textContent = data.total_lines + " 条匹配";
                matchCount.className = "badge " + (data.total_lines > 0 ? "bg-success" : "bg-secondary");
                show(matchCount);
            } else {
                hide(matchCount);
            }

            loadLogs();
        } catch (err) {
            showError("过滤请求失败: " + err.message);
        }
    }

    // ---- 日志查看器 ----

    async function loadLogs() {
        if (!currentFileId) return;

        const params = getFilterParams();
        params.page = 1;
        params.page_size = 0; // 不分页，后端返回全部

        try {
            const resp = await fetch("/logs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params),
            });
            const data = await resp.json();
            if (!resp.ok) return;

            renderLogLines(data.lines);
            logTotalInfo.textContent = `共 ${data.total} 行`;
            logViewer.scrollTop = 0;
        } catch (_) {
            // ignore
        }
    }

    function renderLogLines(lines) {
        const kws = getHighlightKeywords();

        if (kws.length === 0) {
            logViewer.textContent = lines.join("\n");
            return;
        }

        const fragment = document.createDocumentFragment();
        lines.forEach((line, i) => {
            if (i > 0) fragment.appendChild(document.createTextNode("\n"));
            appendHighlightedLine(fragment, line, kws);
        });
        logViewer.innerHTML = "";
        logViewer.appendChild(fragment);
    }

    function appendHighlightedLine(parent, line, kws) {
        const lineLower = line.toLowerCase();
        const ranges = [];
        kws.forEach(kw => {
            let idx = 0;
            while ((idx = lineLower.indexOf(kw, idx)) !== -1) {
                ranges.push([idx, idx + kw.length]);
                idx += kw.length;
            }
        });

        if (ranges.length === 0) {
            parent.appendChild(document.createTextNode(line));
            return;
        }

        ranges.sort((a, b) => a[0] - b[0]);
        const merged = [ranges[0]];
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            if (ranges[i][0] <= last[1]) {
                last[1] = Math.max(last[1], ranges[i][1]);
            } else {
                merged.push(ranges[i]);
            }
        }

        let pos = 0;
        merged.forEach(([start, end]) => {
            if (pos < start) {
                parent.appendChild(document.createTextNode(line.slice(pos, start)));
            }
            const mark = document.createElement("mark");
            mark.className = "highlight";
            mark.textContent = line.slice(start, end);
            parent.appendChild(mark);
            pos = end;
        });
        if (pos < line.length) {
            parent.appendChild(document.createTextNode(line.slice(pos)));
        }
    }

    // ---- 导出过滤后的日志 ----

    btnExport.addEventListener("click", exportLogs);

    async function exportLogs() {
        if (!currentFileId) return;
        hideError();

        btnExport.disabled = true;
        btnExport.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 导出中...';

        try {
            const resp = await fetch("/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(getFilterParams()),
            });

            if (!resp.ok) {
                const data = await resp.json();
                showError(data.error || "导出失败");
                return;
            }

            // 从 Content-Disposition 获取文件名
            const disposition = resp.headers.get("Content-Disposition") || "";
            const match = disposition.match(/filename="?([^"]+)"?/);
            const filename = match ? match[1] : "filtered.log";

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            showError("导出请求失败: " + err.message);
        } finally {
            btnExport.disabled = false;
            btnExport.innerHTML = '<i class="bi bi-download"></i> 导出';
        }
    }

    // ---- 开始分析 ----

    document.getElementById("btn-analyze").addEventListener("click", startAnalysis);

    async function startAnalysis() {
        if (!currentFileId) return;

        hideError();
        hide(fileInfoSection);
        hide(resultSection);
        show(loadingSection);

        const params = getFilterParams();
        params.provider = modelSelect.value;

        try {
            const resp = await fetch("/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params),
            });
            const data = await resp.json();

            hide(loadingSection);

            if (!resp.ok) {
                show(fileInfoSection);
                showError(data.error || "分析失败");
                return;
            }

            displayResults(data);
        } catch (err) {
            hide(loadingSection);
            show(fileInfoSection);
            showError("分析请求失败: " + err.message);
        }
    }

    function displayResults(data) {
        show(fileInfoSection);
        show(resultSection);

        document.getElementById("result-parsing").innerHTML = marked.parse(data.log_parsing || "*无结果*");
        document.getElementById("result-behavior").innerHTML = marked.parse(data.user_behavior || "*无结果*");
        document.getElementById("result-diagnosis").innerHTML = marked.parse(data.issue_diagnosis || "*无结果*");

        resultSection.scrollIntoView({ behavior: "smooth" });
    }
})();
