/* 前端交互逻辑 */

(function () {
    "use strict";

    const API_BASE = "";

    function api(path) {
        return API_BASE + path;
    }

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
    const hlInput = document.getElementById("hl-input");
    const hlBubbles = document.getElementById("hl-bubbles");
    const hlBar = document.getElementById("hl-bar");

    let currentFileId = null;
    let rawTimeStart = null;
    let rawTimeEnd = null;

    // 关键字数据: [{keyword: "ERROR", op: "OR"}, ...] op 是该关键字与前一个的连接符
    let kwItems = [];

    // 高亮关键字列表（独立于过滤，仅做高亮）
    let hlItems = [];

    // 多色高亮调色板
    const HL_COLORS = [
        "#fff3cd", "#d1ecf1", "#d4edda", "#f8d7da", "#e2d9f3",
        "#fde2c8", "#cce5ff", "#f5c6cb", "#c3e6cb", "#d6d8db",
    ];

    // ---- 加载模型列表 ----

    (async function loadProviders() {
        try {
            const resp = await fetch(api("/providers"));
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
        hlItems = [];
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
        renderHlBubbles();
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
        // 合并过滤关键字 + 高亮关键字，去重
        const set = new Set();
        kwItems.forEach(item => set.add(item.keyword.toLowerCase()));
        hlItems.forEach(kw => set.add(kw.toLowerCase()));
        return Array.from(set);
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

    // ---- 高亮关键字（独立于过滤） ----

    function renderHlBubbles() {
        hlBubbles.innerHTML = "";
        hlItems.forEach((kw, i) => {
            const bubble = document.createElement("span");
            bubble.className = "hl-bubble";
            bubble.style.backgroundColor = HL_COLORS[i % HL_COLORS.length];
            bubble.innerHTML = escapeHtml(kw) +
                ' <button class="hl-remove" title="移除">&times;</button>';
            bubble.querySelector(".hl-remove").addEventListener("click", () => {
                hlItems.splice(i, 1);
                renderHlBubbles();
                reHighlight();
            });
            hlBubbles.appendChild(bubble);
        });
    }

    function addHlKeyword(kw) {
        kw = kw.trim();
        if (!kw) return;
        if (hlItems.some(item => item.toLowerCase() === kw.toLowerCase())) return;
        hlItems.push(kw);
        renderHlBubbles();
        reHighlight();
    }

    /** 只刷新高亮，不重新请求日志 */
    function reHighlight() {
        // 把当前 logViewer 里已有的纯文本重新渲染
        const text = logViewer.textContent;
        if (!text) return;
        const lines = text.split("\n");
        renderLogLines(lines);
    }

    hlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addHlKeyword(hlInput.value);
            hlInput.value = "";
        }
        if (e.key === "Backspace" && hlInput.value === "" && hlItems.length > 0) {
            hlItems.pop();
            renderHlBubbles();
            reHighlight();
        }
    });

    hlBar.addEventListener("click", (e) => {
        if (e.target === hlBar || e.target === hlBubbles) {
            hlInput.focus();
        }
    });

    document.getElementById("btn-hl-clear").addEventListener("click", () => {
        hlItems = [];
        hlInput.value = "";
        renderHlBubbles();
        reHighlight();
    });

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
            const resp = await fetch(api("/upload", { method: "POST", body: formData });
            const data = await resp.json();

            if (!resp.ok) {
                showError(data.error || "上传失败");
                return;
            }

            currentFileId = data.file_id;
            kwItems = [];
            hlItems = [];
            keywordInput.value = "";
            hlInput.value = "";
            hide(matchCount);
            renderBubbles();
            renderHlBubbles();
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
            const resp = await fetch(api("/filter", {
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
            const resp = await fetch(api("/logs", {
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
        // 为每个匹配记录 [start, end, kwIndex] 以支持多色
        const ranges = [];
        kws.forEach((kw, ki) => {
            let idx = 0;
            while ((idx = lineLower.indexOf(kw, idx)) !== -1) {
                ranges.push([idx, idx + kw.length, ki]);
                idx += kw.length;
            }
        });

        if (ranges.length === 0) {
            parent.appendChild(document.createTextNode(line));
            return;
        }

        // 按位置排序，重叠区间合并（保留最先匹配的颜色索引）
        ranges.sort((a, b) => a[0] - b[0]);
        const merged = [[ranges[0][0], ranges[0][1], ranges[0][2]]];
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            if (ranges[i][0] <= last[1]) {
                last[1] = Math.max(last[1], ranges[i][1]);
            } else {
                merged.push([ranges[i][0], ranges[i][1], ranges[i][2]]);
            }
        }

        // 构建颜色映射：合并过滤关键字和高亮关键字，为每个分配颜色
        const colorMap = {};
        kws.forEach((kw, ki) => {
            colorMap[ki] = HL_COLORS[ki % HL_COLORS.length];
        });

        let pos = 0;
        merged.forEach(([start, end, ki]) => {
            if (pos < start) {
                parent.appendChild(document.createTextNode(line.slice(pos, start)));
            }
            const mark = document.createElement("mark");
            mark.className = "highlight";
            mark.style.backgroundColor = colorMap[ki] || HL_COLORS[0];
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
            const resp = await fetch(api("/export", {
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
            const resp = await fetch(api("/analyze", {
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
