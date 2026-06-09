(function () {
  const data = window.SVT_DASHBOARD_DATA || { participants: [], rounds: [], quality: {} };
  const participants = data.participants || [];
  const configuredRounds = (data.rounds || []).length;
  const maxAttempts = Math.max(1, configuredRounds, ...participants.map((participant) => Object.keys(participant.rounds || {}).length));
  const selected = new Set();
  const svgNS = "http://www.w3.org/2000/svg";
  const AVERAGE_ID = "__average__";
  const DEFAULT_PARTICIPANT_ID = "applebanana";
  const MOVING_AVERAGE_WINDOW = 3;
  let selectedTransitionStart = null;
  let compactSelectedTrajectory = false;
  let zoomToSelection = true;
  let autoTransitionActive = false;
  let autoTransitionTimer = null;

  const els = {
    datasetSummary: document.getElementById("datasetSummary"),
    nameSearch: document.getElementById("nameSearch"),
    nameList: document.getElementById("nameList"),
    clearSelection: document.getElementById("clearSelection"),
    selectVisible: document.getElementById("selectVisible"),
    transitionFilter: document.getElementById("transitionFilter"),
    zoomToSelection: document.getElementById("zoomToSelection"),
    arrowChart: document.getElementById("arrowChart"),
    rtOverviewChart: document.getElementById("rtOverviewChart"),
    accuracyOverviewChart: document.getElementById("accuracyOverviewChart"),
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
  function attemptNumber(round) {
    return round?.attemptIndex || round?.round || "";
  }
  function labelWithDate(round) {
    return `${attemptNumber(round)}${round.date ? ` (${round.date})` : ""}`;
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
  function movingAverage(values, windowSize = MOVING_AVERAGE_WINDOW) {
    const radius = Math.floor(windowSize / 2);
    return values.map((_, index) => {
      const from = Math.max(0, index - radius);
      const to = Math.min(values.length, index + radius + 1);
      return mean(values.slice(from, to));
    });
  }
  function movingAverageArrowSeries(series) {
    const smoothedRt = movingAverage(series.map((point) => point.rt));
    const smoothedAccuracy = movingAverage(series.map((point) => point.accuracy));
    return series.map((point, index) => ({
      ...point,
      rt: smoothedRt[index],
      accuracy: smoothedAccuracy[index],
    })).filter((point) => Number.isFinite(point.rt) && Number.isFinite(point.accuracy));
  }
  function movingAverageMetricSeries(series) {
    const smoothed = movingAverage(series.map((point) => point.value));
    return series.map((point, index) => ({
      ...point,
      value: smoothed[index],
    })).filter((point) => Number.isFinite(point.value));
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
        ? { round: attempt, label: `${attempt} 평균`, rt, accuracy, rtSd: sampleSd(rts), accuracySd: sampleSd(accuracies), n: points.length }
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
  function boundedExtent(values, fallback = [0, 1], padRatio = 0.14, minBound = 0, maxBound = Infinity, minSpan = 0) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return fallback;
    let min = Math.min(...clean), max = Math.max(...clean);
    const currentSpan = max - min;
    const targetSpan = Math.max(currentSpan, minSpan);
    if (targetSpan > currentSpan) {
      const mid = (min + max) / 2;
      min = mid - targetSpan / 2;
      max = mid + targetSpan / 2;
    }
    const pad = (max - min) * padRatio;
    min = Math.max(minBound, min - pad);
    max = Math.min(maxBound, max + pad);
    if (max <= min) return fallback;
    return [min, max];
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
    [["arrow-selected", colors.red, .96], ["arrow-average", colors.yellow, .98]].forEach(([id, color, opacity]) => {
      const marker = makeSvg("marker", { id, viewBox: "0 0 10 10", refX: 8.5, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
      marker.append(makeSvg("path", { d: "M0 0 L10 5 L0 10 z", fill: color, "fill-opacity": opacity }));
      defs.append(marker);
    });
    svg.append(defs);
  }
  function isAverageSelected() { return selected.has(AVERAGE_ID); }
  function selectedParticipantId() {
    return Array.from(selected).find((id) => id !== AVERAGE_ID) || "";
  }
  function defaultParticipantId() {
    return participants.some((participant) => participant.id === DEFAULT_PARTICIPANT_ID)
      ? DEFAULT_PARTICIPANT_ID
      : participants[0]?.id || "";
  }
  function setSingleParticipant(id) {
    const keepAverage = isAverageSelected();
    selected.clear();
    if (keepAverage) selected.add(AVERAGE_ID);
    if (id) selected.add(id);
  }
  function emitParticipantSelection() {
    const id = selectedParticipantId();
    window.SVT_SELECTED_PARTICIPANT_ID = id;
    window.dispatchEvent(new CustomEvent("svt:participant-selection-change", { detail: { id } }));
  }
  function selectOnly(id, shouldEmit = true) {
    setSingleParticipant(id);
    renderAll();
    if (shouldEmit) emitParticipantSelection();
  }
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
        return { value: String(start), label: `${start}→${start + 1}` };
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
  }

  function renderArrowChart() {
    clearSvg(els.arrowChart); appendArrowMarkers(els.arrowChart);
    const width = 1040, height = 500;
    const allSeries = participants.map(arrowSeries).filter((s) => s.length);
    const allAverageSeries = averageArrowSeries();
    const averageSeries = filteredTransitionSeries(allAverageSeries);
    const participantEntries = participants.map((participant) => {
      const fullSeries = arrowSeries(participant);
      return {
        participant,
        highlighted: selected.has(participant.id),
        fullSeries,
        selectedSeries: filteredTransitionSeries(fullSeries),
      };
    }).filter((entry) => entry.fullSeries.length);
    participantEntries.forEach((entry) => {
      entry.movingAverageSeries = entry.highlighted ? movingAverageArrowSeries(entry.selectedSeries) : [];
    });
    const averageBounds = allAverageSeries.flatMap((point) => [point.rt - point.rtSd, point.rt, point.rt + point.rtSd]);
    const selectedSeries = participantEntries.filter((entry) => entry.highlighted).flatMap((entry) => entry.selectedSeries);
    const selectedMovingAverageSeries = participantEntries.filter((entry) => entry.highlighted).flatMap((entry) => entry.movingAverageSeries);
    const zoomAverageBounds = isAverageSelected() ? averageSeries.flatMap((point) => [point.rt - point.rtSd, point.rt, point.rt + point.rtSd]) : [];
    const zoomRtValues = [...selectedSeries.map((point) => point.rt), ...selectedMovingAverageSeries.map((point) => point.rt), ...zoomAverageBounds];
    const zoomAccuracyValues = [
      ...selectedSeries.map((point) => point.accuracy),
      ...selectedMovingAverageSeries.map((point) => point.accuracy),
      ...(isAverageSelected() ? averageSeries.flatMap((point) => [point.accuracy - point.accuracySd, point.accuracy, point.accuracy + point.accuracySd]) : []),
    ];
    const canZoom = zoomToSelection && zoomRtValues.length;
    const [xMin, xMax] = canZoom
      ? boundedExtent(zoomRtValues, [0, 8], .22, 0, Infinity, .45)
      : extent([...allSeries.flatMap((s) => s.map((p) => p.rt)), ...averageBounds, ...selectedMovingAverageSeries.map((point) => point.rt)], [0, 8], .1);
    const [yMin, yMax] = canZoom
      ? boundedExtent(zoomAccuracyValues, [0, 1], .24, 0, 1, .08)
      : [0, 1];
    const scales = drawAxes(els.arrowChart, {
      width, height, left: 78, right: 36, top: 30, bottom: 62,
      xMin, xMax, yMin, yMax,
      xTicks: Array.from({ length: 6 }, (_, i) => ({ value: xMin + (xMax - xMin) * i / 5, label: (xMin + (xMax - xMin) * i / 5).toFixed(1) })),
      yTicks: 5, xLabel: "RT", yLabel: "정답률", yFormat: (v) => `${Math.round(v * 100)}%`,
    });
    const pendingRoundLabels = [];
    function appendRoundLabel(label, className, baseX, baseY) {
      const bounds = { left: 84, right: width - 20, top: 32, bottom: height - 52 };
      const x = Math.min(Math.max(baseX, bounds.left), bounds.right);
      const dy = baseY < bounds.top + 18 ? 12 : -12;
      const y = Math.min(Math.max(baseY + dy, bounds.top), bounds.bottom);
      pendingRoundLabels.push({ label, className, x, y });
    }
    function renderRoundLabels() {
      pendingRoundLabels.forEach(({ label, className, x, y }) => {
        const group = makeSvg("g", { class: "round-label-group" });
        group.append(textNode(label, { class: className, x, y, "text-anchor": "middle" }));
        els.arrowChart.append(group);
      });
    }

    function drawParticipantTrajectory({ participant, highlighted, series }) {
      if (!series.length) return;
      for (let i = 0; i < series.length - 1; i += 1) {
        const start = series[i], end = series[i + 1];
        const segment = makeSvg("path", {
          class: "arrow-segment",
          d: `M${scales.x(start.rt).toFixed(1)},${scales.y(start.accuracy).toFixed(1)} L${scales.x(end.rt).toFixed(1)},${scales.y(end.accuracy).toFixed(1)}`,
          stroke: highlighted ? colors.red : colors.blue,
          "stroke-width": highlighted ? (compactSelectedTrajectory ? 1.25 : 1.8) : 1.15,
          "stroke-opacity": highlighted ? .98 : .18,
        });
        segment.addEventListener("click", () => selectOnly(participant.id));
        segment.append(makeSvg("title")); segment.firstChild.textContent = `${participant.nickname}: ${start.label} → ${end.label}`;
        els.arrowChart.append(segment);
      }
      series.forEach((point) => {
        const dot = makeSvg("circle", { class: "arrow-dot", cx: scales.x(point.rt), cy: scales.y(point.accuracy), r: highlighted ? (compactSelectedTrajectory ? 3.2 : 4.6) : 3, fill: highlighted ? colors.red : colors.blue, "fill-opacity": highlighted ? .98 : .34 });
        dot.addEventListener("click", () => selectOnly(participant.id));
        dot.append(makeSvg("title")); dot.firstChild.textContent = `${participant.nickname} ${point.label}: RT ${formatNumber(point.rt, 3)}초 · ${formatPercent(point.accuracy)}`;
        els.arrowChart.append(dot);
        if (highlighted && !compactSelectedTrajectory) appendRoundLabel(String(point.round), "round-label", scales.x(point.rt), scales.y(point.accuracy));
      });
    }
    function drawMovingAverageTrajectory({ participant, series }) {
      if (series.length < 2) return;
      const path = makeSvg("path", {
        class: "arrow-segment moving-average-line",
        d: series.map((point, index) => `${index ? "L" : "M"}${scales.x(point.rt).toFixed(1)},${scales.y(point.accuracy).toFixed(1)}`).join(" "),
        stroke: colors.green,
        "stroke-width": compactSelectedTrajectory ? 2 : 2.7,
        "stroke-opacity": .95,
      });
      path.append(makeSvg("title"));
      path.firstChild.textContent = `${participant.nickname} ${MOVING_AVERAGE_WINDOW}회 이동평균선`;
      els.arrowChart.append(path);
    }

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
        if (!compactSelectedTrajectory) appendRoundLabel(String(point.round), "round-label average-label", scales.x(point.rt), scales.y(point.accuracy));
      });
    }
    participantEntries.filter((entry) => entry.highlighted).forEach((entry) => drawParticipantTrajectory({ participant: entry.participant, highlighted: true, series: entry.selectedSeries }));
    participantEntries.filter((entry) => entry.highlighted).forEach((entry) => drawMovingAverageTrajectory({ participant: entry.participant, series: entry.movingAverageSeries }));
    renderRoundLabels();
  }

  function renderOverview(svg, metric) {
    clearSvg(svg);
    const width = 720, height = 320;
    const values = participants.flatMap((p) => metricSeries(p, metric).map((point) => point.value));
    const [rawMin, rawMax] = metric === "accuracy" ? [0, 1] : extent(values, [0, 8]);
    const xMax = Math.max(1, maxAttempts);
    const scales = drawAxes(svg, { width, height, left: 66, right: 24, top: 24, bottom: 50, xMin: 1, xMax, yMin: rawMin, yMax: rawMax, xTicks: Array.from({ length: xMax }, (_, i) => ({ value: i + 1, label: String(i + 1) })), yTicks: 4, xLabel: "차수", yLabel: metric === "rt" ? "RT" : "정답률", yFormat: metric === "accuracy" ? (v) => `${Math.round(v * 100)}%` : (v) => v.toFixed(1) });
    participants.forEach((participant) => {
      const series = metricSeries(participant, metric);
      if (!series.length) return;
      const highlighted = selected.has(participant.id);
      if (series.length >= 2) svg.append(makeSvg("path", { class: "series-line", d: series.map((p, i) => `${i ? "L" : "M"}${scales.x(p.round).toFixed(1)},${scales.y(p.value).toFixed(1)}`).join(" "), stroke: highlighted ? colors.red : colors.paleBlue, "stroke-width": highlighted ? 1.7 : 1.1, "stroke-opacity": highlighted ? .96 : .78 }));
      if (highlighted) {
        const smoothSeries = movingAverageMetricSeries(series);
        if (smoothSeries.length >= 2) {
          const path = makeSvg("path", {
            class: "series-line moving-average-line",
            d: smoothSeries.map((p, i) => `${i ? "L" : "M"}${scales.x(p.round).toFixed(1)},${scales.y(p.value).toFixed(1)}`).join(" "),
            stroke: colors.green,
            "stroke-width": 2.25,
            "stroke-opacity": .95,
          });
          path.append(makeSvg("title"));
          path.firstChild.textContent = `${participant.nickname} ${metric === "rt" ? "RT" : "정답률"} ${MOVING_AVERAGE_WINDOW}회 이동평균선`;
          svg.append(path);
        }
      }
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
      const input = document.createElement("input"); input.type = "radio"; input.name = "participantSelection"; input.checked = selected.has(participant.id);
      input.addEventListener("change", () => {
        if (input.checked) selectOnly(participant.id);
      });
      const text = document.createElement("span");
      const primary = document.createElement("span"); primary.className = "name-primary"; primary.textContent = participant.nickname;
      const secondary = document.createElement("span"); secondary.className = "name-secondary"; secondary.textContent = `${Object.keys(participant.rounds || {}).length}회 · ${participantIdSourceLabel(participant.idSource)}`;
      text.append(primary, secondary); item.append(input, text); els.nameList.append(item);
    });
  }
  function renderStats() {
    const chosen = participants.filter((p) => selected.has(p.id));
    const cohort = chosen.length ? chosen : participants;
    const roundCounts = cohort.map((p) => Object.keys(p.rounds || {}).length);
    const roundMetrics = cohort.flatMap((p) => Object.values(p.rounds || {}));
    const rts = roundMetrics.map((r) => r.rtMean).filter(Number.isFinite);
    const accs = roundMetrics.map((r) => r.accuracy).filter(Number.isFinite);
    els.selectedRounds.textContent = formatNumber(roundCounts.reduce((a, b) => a + b, 0) / roundCounts.length, 2);
    els.selectedRt.textContent = `${formatNumber(rts.reduce((a, b) => a + b, 0) / rts.length, 2)}s`;
    els.selectedAcc.textContent = formatPercent(accs.reduce((a, b) => a + b, 0) / accs.length);
  }
  function renderZoomControl() {
    if (!els.zoomToSelection) return;
    const selectedCount = Array.from(selected).filter((id) => id !== AVERAGE_ID).length + (isAverageSelected() ? 1 : 0);
    if (selectedCount === 0) zoomToSelection = false;
    els.zoomToSelection.disabled = selectedCount === 0;
    els.zoomToSelection.setAttribute("aria-pressed", zoomToSelection ? "true" : "false");
    els.zoomToSelection.textContent = zoomToSelection ? "전체 보기" : "확대";
    els.zoomToSelection.title = selectedCount ? "선택된 항목이 잘 보이도록 축 범위를 조정" : "확대할 참가자나 평균을 체크하세요";
  }
  function renderAll() { renderNameList(); renderTransitionFilter(); renderZoomControl(); renderArrowChart(); renderOverview(els.rtOverviewChart, "rt"); renderOverview(els.accuracyOverviewChart, "accuracy"); renderStats(); }

  els.datasetSummary.textContent = `${participants.length}명 · ${data.quality?.selectedTrialCount || 0} trials · 공통 ${data.itemCatalog?.commonItems?.length || 0} · 제외 ${data.quality?.ignoredNonComparableTrialCount || 0}`;
  els.nameSearch.addEventListener("input", renderNameList);
  els.clearSelection.addEventListener("click", () => { selected.clear(); zoomToSelection = false; renderAll(); emitParticipantSelection(); });
  els.zoomToSelection?.addEventListener("click", () => { zoomToSelection = !zoomToSelection; renderAll(); });
  els.selectVisible.addEventListener("click", () => {
    const match = visibleParticipants()[0];
    if (match) selectOnly(match.id);
  });
  window.addEventListener("svt:participant-select", (event) => {
    const id = event.detail?.id;
    if (participants.some((participant) => participant.id === id)) selectOnly(id, false);
  });
  const initialParticipantId = defaultParticipantId();
  if (initialParticipantId) selected.add(initialParticipantId);
  renderAll();
  emitParticipantSelection();
})();
