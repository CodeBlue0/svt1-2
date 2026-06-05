(function () {
  const data = window.SVT_DASHBOARD_DATA || { participants: [], rounds: [], quality: {} };
  const participants = data.participants || [];
  const configuredRounds = (data.rounds || []).length;
  const maxAttempts = Math.max(1, configuredRounds, ...participants.map((participant) => Object.keys(participant.rounds || {}).length));
  const selected = new Set();
  const svgNS = "http://www.w3.org/2000/svg";
  const AVERAGE_ID = "__average__";
  let selectedTransitionStart = null;
  let compactSelectedTrajectory = false;
  let showAllTrajectories = false;
  let autoTransitionActive = false;
  let autoTransitionTimer = null;

  const els = {
    datasetSummary: document.getElementById("datasetSummary"),
    nameSearch: document.getElementById("nameSearch"),
    nameList: document.getElementById("nameList"),
    clearSelection: document.getElementById("clearSelection"),
    selectVisible: document.getElementById("selectVisible"),
    selectionCount: document.getElementById("selectionCount"),
    transitionFilter: document.getElementById("transitionFilter"),
    arrowChart: document.getElementById("arrowChart"),
    rtOverviewChart: document.getElementById("rtOverviewChart"),
    accuracyOverviewChart: document.getElementById("accuracyOverviewChart"),
    selectedPeople: document.getElementById("selectedPeople"),
    selectedRounds: document.getElementById("selectedRounds"),
    selectedRt: document.getElementById("selectedRt"),
    selectedAcc: document.getElementById("selectedAcc"),
  };

  const colors = {
    blue: "#2563eb",
    paleBlue: "rgba(37,99,235,.22)",
    red: "#ef4444",
    yellow: "#f59e0b",
    yellowDark: "#92400e",
    yellowSoft: "rgba(245,158,11,.2)",
    green: "#059669",
    grid: "#d9e2ec",
    ink: "#17212b",
    muted: "#667789",
  };

  function makeSvg(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => value !== undefined && value !== null && node.setAttribute(key, value));
    return node;
  }
  function textNode(text, attrs = {}) { const node = makeSvg("text", attrs); node.textContent = text; return node; }
  function clearSvg(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function formatPercent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-"; }
  function formatNumber(value, digits = 2) { return Number.isFinite(value) ? value.toFixed(digits) : "-"; }
  function participantHaystack(p) { return [p.nickname, p.id, p.idSource].join(" ").toLowerCase(); }
  function participantIdSourceLabel(source) {
    if (source === "participant_id") return "ID";
    if (source === "student_id") return "학번";
    return "fallback";
  }
  function visibleParticipants() {
    const query = els.nameSearch.value.trim().toLowerCase();
    return participants.filter((p) => participantHaystack(p).includes(query));
  }
  function participantRounds(participant) {
    return Object.values(participant.rounds || {}).sort((a, b) => (a.attemptIndex || a.round) - (b.attemptIndex || b.round));
  }
  function labelWithDate(round) {
    return `${round.displayLabel || `R${round.attemptIndex || round.round}`}${round.date ? ` (${round.date})` : ""}`;
  }
  function metricSeries(participant, metric) {
    return participantRounds(participant).map((round) => {
      const value = metric === "rt" ? round.rtMean : round.accuracy;
      return Number.isFinite(value) ? { round: round.attemptIndex || round.round, label: labelWithDate(round), value, payload: round } : null;
    }).filter(Boolean);
  }
  function arrowSeries(participant) {
    return participantRounds(participant).map((round) => {
      if (!round || !Number.isFinite(round.rtMean) || !Number.isFinite(round.accuracy)) return null;
      return { round: round.attemptIndex || round.round, label: labelWithDate(round), rt: round.rtMean, accuracy: round.accuracy, trialCount: round.trialCount || 0 };
    }).filter(Boolean);
  }
  function mean(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
  }
  function sampleSd(values) {
    const clean = values.filter(Number.isFinite);
    if (clean.length < 2) return 0;
    const avg = mean(clean);
    return Math.sqrt(clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (clean.length - 1));
  }
  function averageArrowSeries() {
    return Array.from({ length: maxAttempts }, (_, i) => i + 1).map((attempt) => {
      const points = participants.map(arrowSeries).map((series) => series.find((point) => point.round === attempt)).filter(Boolean);
      const rts = points.map((point) => point.rt);
      const accuracies = points.map((point) => point.accuracy);
      const rt = mean(rts);
      const accuracy = mean(accuracies);
      return Number.isFinite(rt) && Number.isFinite(accuracy)
        ? { round: attempt, label: `R${attempt} 평균`, rt, accuracy, rtSd: sampleSd(rts), accuracySd: sampleSd(accuracies), n: points.length }
        : null;
    }).filter(Boolean);
  }
  function extent(values, fallback = [0, 1], padRatio = 0.08) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return fallback;
    let min = Math.min(...clean), max = Math.max(...clean);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * padRatio;
    return [Math.max(0, min - pad), max + pad];
  }
  function drawAxes(svg, cfg) {
    const { width, height, left, right, top, bottom, xMin, xMax, yMin, yMax, xTicks, yTicks, xLabel, yLabel, yFormat } = cfg;
    const plotW = width - left - right, plotH = height - top - bottom;
    const x = (value) => left + ((value - xMin) / (xMax - xMin || 1)) * plotW;
    const y = (value) => top + ((yMax - value) / (yMax - yMin || 1)) * plotH;
    xTicks.forEach((tick) => {
      const px = x(tick.value);
      svg.append(makeSvg("line", { class: "grid-line", x1: px, y1: top, x2: px, y2: top + plotH }));
      svg.append(textNode(tick.label, { class: "tick-text", x: px, y: top + plotH + 24, "text-anchor": "middle" }));
    });
    for (let i = 0; i <= yTicks; i += 1) {
      const value = yMin + (yMax - yMin) * i / yTicks;
      const py = y(value);
      svg.append(makeSvg("line", { class: "grid-line", x1: left, y1: py, x2: left + plotW, y2: py }));
      svg.append(textNode(yFormat(value), { class: "tick-text", x: left - 9, y: py + 4, "text-anchor": "end" }));
    }
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }));
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotH }));
    svg.append(textNode(yLabel, { class: "axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, "text-anchor": "middle" }));
    svg.append(textNode(xLabel, { class: "axis-label", x: left + plotW / 2, y: height - 10, "text-anchor": "middle" }));
    return { x, y };
  }
  function appendArrowMarkers(svg) {
    const defs = makeSvg("defs");
    [["arrow-all", colors.blue, .48], ["arrow-selected", colors.red, .96], ["arrow-average", colors.yellow, .98]].forEach(([id, color, opacity]) => {
      const marker = makeSvg("marker", { id, viewBox: "0 0 10 10", refX: 8.5, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
      marker.append(makeSvg("path", { d: "M0 0 L10 5 L0 10 z", fill: color, "fill-opacity": opacity }));
      defs.append(marker);
    });
    svg.append(defs);
  }
  function selectOnly(id) { selected.clear(); selected.add(id); renderAll(); }
  function isAverageSelected() { return selected.has(AVERAGE_ID); }
  function filteredTransitionSeries(series) {
    if (selectedTransitionStart === null) return series;
    const start = series.find((point) => point.round === selectedTransitionStart);
    const end = series.find((point) => point.round === selectedTransitionStart + 1);
    return start && end ? [start, end] : [];
  }
  function lastTransitionStart() {
    return Math.max(1, maxAttempts - 1);
  }
  function stopAutoTransition() {
    autoTransitionActive = false;
    if (autoTransitionTimer) {
      clearInterval(autoTransitionTimer);
      autoTransitionTimer = null;
    }
  }
  function advanceAutoTransition() {
    const lastStart = lastTransitionStart();
    selectedTransitionStart = selectedTransitionStart && selectedTransitionStart < lastStart
      ? selectedTransitionStart + 1
      : 1;
  }
  function startAutoTransition() {
    autoTransitionActive = true;
    if (!Number.isFinite(selectedTransitionStart) || selectedTransitionStart < 1 || selectedTransitionStart > lastTransitionStart()) {
      selectedTransitionStart = 1;
    }
    if (autoTransitionTimer) return;
    autoTransitionTimer = setInterval(() => {
      advanceAutoTransition();
      renderAll();
    }, 1400);
  }
  function setAutoTransition(enabled) {
    if (enabled) startAutoTransition();
    else stopAutoTransition();
  }
  function renderTransitionFilter() {
    if (!els.transitionFilter) return;
    els.transitionFilter.textContent = "";
    const title = document.createElement("span");
    title.className = "transition-filter-title";
    title.textContent = "구간";
    els.transitionFilter.append(title);
    const options = [
      { value: "all", label: "전체" },
      ...(maxAttempts > 1 ? [{ value: "auto", label: "Auto" }] : []),
      ...Array.from({ length: Math.max(0, maxAttempts - 1) }, (_, i) => {
        const start = i + 1;
        return { value: String(start), label: `R${start}→R${start + 1}` };
      }),
    ];
    options.forEach((option) => {
      const label = document.createElement("label");
      label.className = "transition-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "trajectory-transition";
      input.value = option.value;
      input.checked = option.value === "auto"
        ? autoTransitionActive
        : !autoTransitionActive && (option.value === "all" ? selectedTransitionStart === null : selectedTransitionStart === Number(option.value));
      input.addEventListener("change", () => {
        if (!input.checked) return;
        if (option.value === "auto") {
          selectedTransitionStart = 1;
          setAutoTransition(true);
          renderAll();
          return;
        }
        setAutoTransition(false);
        selectedTransitionStart = option.value === "all" ? null : Number(option.value);
        renderAll();
      });
      const text = document.createElement("span");
      text.textContent = option.label;
      label.append(input, text);
      els.transitionFilter.append(label);
    });
    const compactLabel = document.createElement("label");
    compactLabel.className = "transition-option transition-option-compact";
    const compactInput = document.createElement("input");
    compactInput.type = "checkbox";
    compactInput.checked = compactSelectedTrajectory;
    compactInput.addEventListener("change", () => {
      compactSelectedTrajectory = compactInput.checked;
      renderAll();
    });
    const compactText = document.createElement("span");
    compactText.textContent = "작게";
    compactLabel.append(compactInput, compactText);
    els.transitionFilter.append(compactLabel);

    const blueToggleLabel = document.createElement("label");
    blueToggleLabel.className = "transition-option transition-option-blue-toggle";
    const blueToggleInput = document.createElement("input");
    blueToggleInput.type = "checkbox";
    blueToggleInput.checked = showAllTrajectories;
    blueToggleInput.addEventListener("change", () => {
      showAllTrajectories = blueToggleInput.checked;
      renderAll();
    });
    const blueToggleText = document.createElement("span");
    blueToggleText.textContent = "파랑 표시";
    blueToggleLabel.append(blueToggleInput, blueToggleText);
    els.transitionFilter.append(blueToggleLabel);
  }

  function renderArrowChart() {
    clearSvg(els.arrowChart); appendArrowMarkers(els.arrowChart);
    const width = 1040, height = 500;
    const allSeries = participants.map(arrowSeries).filter((s) => s.length);
    const allAverageSeries = averageArrowSeries();
    const averageSeries = filteredTransitionSeries(allAverageSeries);
    const averageBounds = allAverageSeries.flatMap((point) => [point.rt - point.rtSd, point.rt, point.rt + point.rtSd]);
    const [xMin, xMax] = extent([...allSeries.flatMap((s) => s.map((p) => p.rt)), ...averageBounds], [0, 8], .1);
    const yMin = 0;
    const scales = drawAxes(els.arrowChart, {
      width, height, left: 78, right: 36, top: 30, bottom: 62,
      xMin, xMax, yMin, yMax: 1,
      xTicks: Array.from({ length: 6 }, (_, i) => ({ value: xMin + (xMax - xMin) * i / 5, label: (xMin + (xMax - xMin) * i / 5).toFixed(1) })),
      yTicks: 5, xLabel: "RT", yLabel: "정답률", yFormat: (v) => `${Math.round(v * 100)}%`,
    });
    const roundLabelBoxes = [];
    const roundLabelOffsets = [[10, -10], [10, 20], [-30, -10], [-30, 20], [18, 4], [-38, 4], [-8, -24], [-8, 32], [28, -20], [-44, -20]];
    function appendRoundLabel(label, className, baseX, baseY) {
      const w = Math.max(24, label.length * 8 + 10);
      const h = 18;
      const bounds = { left: 82, right: width - 18, top: 24, bottom: height - 48 };
      const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      let chosen = null;
      for (const [dx, dy] of roundLabelOffsets) {
        const x = Math.min(Math.max(baseX + dx, bounds.left), bounds.right - w);
        const y = Math.min(Math.max(baseY + dy, bounds.top + h), bounds.bottom);
        const box = { x: x - 4, y: y - h + 3, w, h };
        if (!roundLabelBoxes.some((placed) => overlaps(box, placed))) {
          chosen = { x, y, box };
          break;
        }
        if (!chosen) chosen = { x, y, box };
      }
      roundLabelBoxes.push(chosen.box);
      els.arrowChart.append(textNode(label, { class: className, x: chosen.x, y: chosen.y }));
    }

    const participantEntries = participants.map((participant) => {
      const fullSeries = arrowSeries(participant);
      return {
        participant,
        highlighted: selected.has(participant.id),
        fullSeries,
        selectedSeries: filteredTransitionSeries(fullSeries),
      };
    }).filter((entry) => entry.fullSeries.length);

    function drawParticipantTrajectory({ participant, highlighted, series }) {
      if (!series.length) return;
      for (let i = 0; i < series.length - 1; i += 1) {
        const start = series[i], end = series[i + 1];
        const segment = makeSvg("path", {
          class: "arrow-segment",
          d: `M${scales.x(start.rt).toFixed(1)},${scales.y(start.accuracy).toFixed(1)} L${scales.x(end.rt).toFixed(1)},${scales.y(end.accuracy).toFixed(1)}`,
          stroke: highlighted ? colors.red : colors.blue,
          "stroke-width": highlighted ? (compactSelectedTrajectory ? 1.9 : 2.8) : 1.15,
          "stroke-opacity": highlighted ? .98 : .18,
        });
        segment.addEventListener("click", () => selectOnly(participant.id));
        segment.append(makeSvg("title")); segment.firstChild.textContent = `${participant.nickname}: ${start.label} → ${end.label}`;
        els.arrowChart.append(segment);
      }
      series.forEach((point) => {
        const dot = makeSvg("circle", { class: "arrow-dot", cx: scales.x(point.rt), cy: scales.y(point.accuracy), r: highlighted ? (compactSelectedTrajectory ? 3.6 : 5.4) : 3, fill: highlighted ? colors.red : colors.blue, "fill-opacity": highlighted ? .98 : .34 });
        dot.addEventListener("click", () => selectOnly(participant.id));
        dot.append(makeSvg("title")); dot.firstChild.textContent = `${participant.nickname} ${point.label}: RT ${formatNumber(point.rt, 3)}초 · ${formatPercent(point.accuracy)}`;
        els.arrowChart.append(dot);
        if (highlighted && !compactSelectedTrajectory) appendRoundLabel(`R${point.round}`, "round-label", scales.x(point.rt), scales.y(point.accuracy));
      });
    }

    if (showAllTrajectories) participantEntries.forEach((entry) => drawParticipantTrajectory({ participant: entry.participant, highlighted: false, series: entry.selectedSeries }));
    if (isAverageSelected() && averageSeries.length) {
      if (!compactSelectedTrajectory) {
        averageSeries.forEach((point) => {
          const cx = scales.x(point.rt);
          const cy = scales.y(point.accuracy);
          const rx = Math.max(7, Math.abs(scales.x(point.rt + point.rtSd) - cx));
          const ry = Math.max(7, Math.abs(scales.y(Math.max(0, point.accuracy - point.accuracySd)) - cy));
          const region = makeSvg("ellipse", {
            cx, cy, rx, ry,
            fill: colors.yellowSoft,
            stroke: colors.yellow,
            "stroke-opacity": .55,
            "stroke-width": 1.2,
          });
          region.append(makeSvg("title"));
          region.firstChild.textContent = `${point.label}: n=${point.n}, RT SD ${formatNumber(point.rtSd, 3)}초 · 정답률 SD ${formatPercent(point.accuracySd)}`;
          els.arrowChart.append(region);
        });
      }
      for (let i = 0; i < averageSeries.length - 1; i += 1) {
        const start = averageSeries[i], end = averageSeries[i + 1];
        const segment = makeSvg("path", {
          class: "arrow-segment average-arrow",
          d: `M${scales.x(start.rt).toFixed(1)},${scales.y(start.accuracy).toFixed(1)} L${scales.x(end.rt).toFixed(1)},${scales.y(end.accuracy).toFixed(1)}`,
          stroke: colors.yellow,
          "stroke-width": compactSelectedTrajectory ? 2.1 : 4,
          "stroke-opacity": .98,
        });
        segment.append(makeSvg("title"));
        segment.firstChild.textContent = `평균: ${start.label} → ${end.label}`;
        els.arrowChart.append(segment);
      }
      averageSeries.forEach((point) => {
        const dot = makeSvg("circle", {
          class: "arrow-dot average-dot",
          cx: scales.x(point.rt),
          cy: scales.y(point.accuracy),
          r: compactSelectedTrajectory ? 4.2 : 6.6,
          fill: colors.yellowDark,
          stroke: "#fff7ed",
          "stroke-width": compactSelectedTrajectory ? 1.2 : 2,
        });
        dot.append(makeSvg("title"));
        dot.firstChild.textContent = `${point.label}: RT ${formatNumber(point.rt, 3)}초 · ${formatPercent(point.accuracy)} · n=${point.n}`;
        els.arrowChart.append(dot);
        if (!compactSelectedTrajectory) appendRoundLabel(`R${point.round}`, "round-label average-label", scales.x(point.rt), scales.y(point.accuracy));
      });
    }
    participantEntries.filter((entry) => entry.highlighted).forEach((entry) => drawParticipantTrajectory({ participant: entry.participant, highlighted: true, series: entry.selectedSeries }));
  }

  function renderOverview(svg, metric) {
    clearSvg(svg);
    const width = 720, height = 320;
    const values = participants.flatMap((p) => metricSeries(p, metric).map((point) => point.value));
    const [rawMin, rawMax] = metric === "accuracy" ? [0, 1] : extent(values, [0, 8]);
    const xMax = Math.max(1, maxAttempts);
    const scales = drawAxes(svg, { width, height, left: 66, right: 24, top: 24, bottom: 50, xMin: 1, xMax, yMin: rawMin, yMax: rawMax, xTicks: Array.from({ length: xMax }, (_, i) => ({ value: i + 1, label: `R${i + 1}` })), yTicks: 4, xLabel: "차수", yLabel: metric === "rt" ? "RT" : "정답률", yFormat: metric === "accuracy" ? (v) => `${Math.round(v * 100)}%` : (v) => v.toFixed(1) });
    participants.forEach((participant) => {
      const series = metricSeries(participant, metric);
      if (!series.length) return;
      const highlighted = selected.has(participant.id);
      if (series.length >= 2) svg.append(makeSvg("path", { class: "series-line", d: series.map((p, i) => `${i ? "L" : "M"}${scales.x(p.round).toFixed(1)},${scales.y(p.value).toFixed(1)}`).join(" "), stroke: highlighted ? colors.red : colors.paleBlue, "stroke-width": highlighted ? 2.3 : 1.1, "stroke-opacity": highlighted ? .96 : .78 }));
      series.forEach((point) => {
        const dot = makeSvg("circle", { cx: scales.x(point.round), cy: scales.y(point.value), r: highlighted ? 4.2 : 2.4, fill: highlighted ? colors.red : colors.blue, "fill-opacity": highlighted ? .96 : .35 });
        dot.addEventListener("click", () => selectOnly(participant.id));
        svg.append(dot);
      });
    });
  }
  function renderNameList() {
    const visible = visibleParticipants();
    els.nameList.textContent = "";
    const averageItem = document.createElement("label");
    averageItem.className = `name-item average-item${isAverageSelected() ? " is-selected" : ""}`;
    const averageInput = document.createElement("input");
    averageInput.type = "checkbox";
    averageInput.checked = isAverageSelected();
    averageInput.addEventListener("change", () => { averageInput.checked ? selected.add(AVERAGE_ID) : selected.delete(AVERAGE_ID); renderAll(); });
    const averageText = document.createElement("span");
    const averagePrimary = document.createElement("span");
    averagePrimary.className = "name-primary";
    averagePrimary.textContent = "평균";
    const averageSecondary = document.createElement("span");
    averageSecondary.className = "name-secondary";
    averageSecondary.textContent = "평균";
    averageText.append(averagePrimary, averageSecondary);
    averageItem.append(averageInput, averageText);
    els.nameList.append(averageItem);
    visible.forEach((participant) => {
      const item = document.createElement("label");
      item.className = `name-item${selected.has(participant.id) ? " is-selected" : ""}`;
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = selected.has(participant.id);
      input.addEventListener("change", () => { input.checked ? selected.add(participant.id) : selected.delete(participant.id); renderAll(); });
      const text = document.createElement("span");
      const primary = document.createElement("span"); primary.className = "name-primary"; primary.textContent = participant.nickname;
      const secondary = document.createElement("span"); secondary.className = "name-secondary"; secondary.textContent = `${Object.keys(participant.rounds || {}).length}회 · ${participantIdSourceLabel(participant.idSource)}`;
      text.append(primary, secondary); item.append(input, text); els.nameList.append(item);
    });
  }
  function renderStats() {
    const chosen = participants.filter((p) => selected.has(p.id));
    const averageSelected = isAverageSelected();
    const cohort = chosen.length ? chosen : participants;
    const roundCounts = cohort.map((p) => Object.keys(p.rounds || {}).length);
    const roundMetrics = cohort.flatMap((p) => Object.values(p.rounds || {}));
    const rts = roundMetrics.map((r) => r.rtMean).filter(Number.isFinite);
    const accs = roundMetrics.map((r) => r.accuracy).filter(Number.isFinite);
    els.selectedPeople.textContent = chosen.length ? `${chosen.length}명${averageSelected ? " + 평균" : ""}` : (averageSelected ? "평균" : "전체");
    els.selectedRounds.textContent = formatNumber(roundCounts.reduce((a, b) => a + b, 0) / roundCounts.length, 2);
    els.selectedRt.textContent = `${formatNumber(rts.reduce((a, b) => a + b, 0) / rts.length, 2)}s`;
    els.selectedAcc.textContent = formatPercent(accs.reduce((a, b) => a + b, 0) / accs.length);
    const personSelectionCount = Array.from(selected).filter((id) => id !== AVERAGE_ID).length;
    els.selectionCount.textContent = `${personSelectionCount}명${averageSelected ? " + 평균" : ""} 선택`;
  }
  function renderAll() { renderNameList(); renderTransitionFilter(); renderArrowChart(); renderOverview(els.rtOverviewChart, "rt"); renderOverview(els.accuracyOverviewChart, "accuracy"); renderStats(); }

  els.datasetSummary.textContent = `${participants.length}명 · ${data.quality?.selectedTrialCount || 0} trials · 공통 ${data.itemCatalog?.commonItems?.length || 0} · 제외 ${data.quality?.ignoredNonComparableTrialCount || 0}`;
  els.nameSearch.addEventListener("input", renderNameList);
  els.clearSelection.addEventListener("click", () => { selected.clear(); renderAll(); });
  els.selectVisible.addEventListener("click", () => { visibleParticipants().forEach((p) => selected.add(p.id)); renderAll(); });
  renderAll();
})();
