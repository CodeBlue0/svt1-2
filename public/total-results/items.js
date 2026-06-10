(function () {
  start().catch((error) => {
    const summary = document.getElementById("itemSummary");
    if (summary) summary.textContent = error.message || "데이터를 불러오지 못했습니다.";
    console.error(error);
  });

  async function start() {
  const data = await (window.SVT_DASHBOARD_DATA_READY || Promise.resolve(window.SVT_DASHBOARD_DATA || { participants: [], itemCatalog: {} }));
  const participants = data.participants || [];
  const commonItems = data.itemCatalog?.commonItems || [];
  const datasetLabel = data.datasetLabel || "SVT";
  const datasetKey = data.datasetKey || (String(datasetLabel).toLowerCase() === "svt" ? "svt" : String(datasetLabel).toLowerCase());
  const isSvtDataset = datasetKey === "svt";
  const svgNS = "http://www.w3.org/2000/svg";

  const els = {
    participantSelect: document.getElementById("participantSelect"),
    itemSummary: document.getElementById("itemSummary"),
    title: document.getElementById("selectedParticipantTitle"),
    meta: document.getElementById("selectedParticipantMeta"),
    modelChart: document.getElementById("modelChart"),
    modelEquations: document.getElementById("modelEquations"),
    confusionList: document.getElementById("confusionList"),
    transitionList: document.getElementById("transitionList"),
    transitionLineChart: document.getElementById("transitionLineChart"),
    modelCardTitle: document.getElementById("modelCardTitle"),
    itemMapSection: document.getElementById("itemMapSection"),
    itemMapMode: document.getElementById("itemMapMode"),
    itemMapSummary: document.getElementById("itemMapSummary"),
    itemGrid: document.getElementById("itemGrid"),
  };
  let selectedParticipantId = "";
  let itemMapMode = "global";
  const colors = { red: "#ef4444", blue: "#2563eb", amber: "#f59e0b", darkRed: "#b91c1c" };
  const itemTooltip = document.createElement("div");
  itemTooltip.className = "item-tooltip";
  document.body.append(itemTooltip);

  if (!isSvtDataset) {
    if (els.itemMapSection) els.itemMapSection.hidden = true;
    if (els.modelCardTitle) els.modelCardTitle.textContent = `${datasetLabel} 모델`;
  }

  function makeSvg(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => value !== undefined && value !== null && node.setAttribute(key, value));
    return node;
  }
  function textNode(text, attrs = {}) { const node = makeSvg("text", attrs); node.textContent = text; return node; }
  function clear(node) { if (!node) return; while (node.firstChild) node.removeChild(node.firstChild); }
  function fmtPct(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-"; }
  function fmtNum(value, digits = 2) { return Number.isFinite(value) ? value.toFixed(digits) : "-"; }
  function extent(values, fallback = [0, 1], pad = 0.08) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return fallback;
    let min = Math.min(...clean), max = Math.max(...clean);
    if (min === max) { min -= 1; max += 1; }
    const p = (max - min) * pad;
    return [Math.max(0, min - p), max + p];
  }
  function currentParticipant() {
    return participants.find((participant) => participant.id === selectedParticipantId) || null;
  }
  function participantRounds(participant) {
    return Object.values(participant?.rounds || {}).sort((a, b) => (a.attemptIndex || a.round) - (b.attemptIndex || b.round));
  }
  function labelWithDate(round) {
    return `${round.attemptIndex || round.round}${round.date ? ` (${round.date})` : ""}`;
  }
  function signedTerm(value, suffix = "") {
    if (!Number.isFinite(value)) return "";
    const sign = value < 0 ? "−" : "+";
    return ` ${sign} ${Math.abs(value).toFixed(3)}${suffix}`;
  }
  function exponentialEquation(model) {
    const coeffs = model?.coefficients || [];
    if (coeffs.length < 3) return "없음";
    const offset = Number.isFinite(coeffs[0]) ? coeffs[0].toFixed(3) : "0.000";
    const amplitude = signedTerm(coeffs[1], "");
    const decay = Number.isFinite(coeffs[2]) ? Math.abs(coeffs[2]).toFixed(3) : "0.000";
    const r2 = Number.isFinite(model?.r2) ? ` · R²=${model.r2.toFixed(3)}` : "";
    return `y = ${offset}${amplitude}e^(−${decay}x)${r2}`;
  }
  function renderModelEquations(equations) {
    if (!els.modelEquations) return;
    els.modelEquations.textContent = "";
    if (!equations.length) {
      els.modelEquations.textContent = "모델 없음";
      return;
    }
    equations.forEach(({ label, equation, tone }) => {
      const line = document.createElement("p");
      line.className = tone ? `model-equation ${tone}` : "model-equation";
      const labelNode = document.createElement("strong");
      labelNode.textContent = label;
      const equationNode = document.createElement("code");
      equationNode.textContent = equation;
      line.append(labelNode, equationNode);
      els.modelEquations.append(line);
    });
  }

  function renderModel(participant) {
    clear(els.modelChart);
    const equations = [];
    const panels = [
      { key: "rtByRound", label: "RT", extent: null, format: (value) => value.toFixed(1) },
      { key: "accuracyByRound", label: "Accuracy", extent: [0, 1], format: (value) => `${Math.round(value * 100)}%` },
    ];
    panels.forEach((panel, index) => {
      const offset = index * 360;
      const personRounds = participantRounds(participant);
      const maxAttempt = Math.max(1, ...personRounds.map((round) => round.attemptIndex || round.round));
      const observed = personRounds.map((round) => {
        const value = panel.key === "rtByRound" ? round?.rtMean : round?.accuracy;
        return Number.isFinite(value) ? { x: round.attemptIndex || round.round, y: value } : null;
      }).filter(Boolean);
      const models = participant.models?.[panel.key]?.models || {};
      const modelValues = [models.exponential]
        .flatMap((model) => model?.points || [])
        .map((point) => point.y)
        .filter(Number.isFinite);
      const [yMin, yMax] = panel.extent || extent([...observed.map((point) => point.y), ...modelValues], [0, 8]);
      const left = offset + 54, top = 30, plotW = 288, plotH = 268;
      const x = (value) => left + ((value - 1) / Math.max(1, maxAttempt - 1)) * plotW;
      const y = (value) => top + ((yMax - value) / (yMax - yMin || 1)) * plotH;
      Array.from({ length: maxAttempt }, (_, i) => i + 1).forEach((roundNumber) => {
        els.modelChart.append(makeSvg("line", { class: "grid-line", x1: x(roundNumber), y1: top, x2: x(roundNumber), y2: top + plotH }));
        els.modelChart.append(textNode(String(roundNumber), { class: "tick-text", x: x(roundNumber), y: top + plotH + 20, "text-anchor": "middle" }));
      });
      const blueModel = models.exponential;
      if (blueModel) {
        equations.push({ label: `${panel.label} 지수`, equation: exponentialEquation(blueModel), tone: "blue" });
        const points = (blueModel.points || []).filter((point) => Number.isFinite(point.y));
        if (points.length >= 2) {
          els.modelChart.append(makeSvg("path", {
            class: "series-line",
            d: points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(" "),
            stroke: colors.blue, "stroke-width": 2.2, "stroke-dasharray": "6 5",
          }));
        }
      }
      observed.forEach((point) => {
        els.modelChart.append(makeSvg("circle", { cx: x(point.x), cy: y(point.y), r: 4.5, fill: colors.red, "fill-opacity": 0.82 }));
        els.modelChart.append(textNode(String(point.x), { class: "round-label model-round-label", x: x(point.x), y: y(point.y) - 11, "text-anchor": "middle" }));
      });
      els.modelChart.append(textNode(panel.label, { class: "axis-label", x: left + plotW / 2, y: 18, "text-anchor": "middle" }));
    });
    renderModelEquations(equations);
  }

  function renderConfusion(participant) {
    clear(els.confusionList);
    function appendConfusionCell(grid, label, count, included, tone) {
      const cell = document.createElement("div");
      cell.className = `confusion-matrix-cell ${tone || ""}`.trim();
      const labelNode = document.createElement("span");
      labelNode.className = "confusion-label";
      labelNode.textContent = label;
      const valueNode = document.createElement("strong");
      valueNode.className = "confusion-value";
      valueNode.textContent = `${count ?? 0}개`;
      const percentNode = document.createElement("span");
      percentNode.className = "confusion-percent";
      percentNode.textContent = fmtPct(included ? (count || 0) / included : NaN);
      cell.append(labelNode, valueNode, percentNode);
      grid.append(cell);
    }
    participantRounds(participant).forEach((round) => {
      const confusion = round?.confusion;
      const card = document.createElement("article");
      card.className = "confusion-card";
      const heading = document.createElement("h3");
      heading.textContent = labelWithDate(round);
      card.append(heading);
      if (!confusion) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "없음";
        card.append(empty);
        els.confusionList.append(card);
        return;
      }
      const included = confusion.included || 0;
      const counts = confusion.counts || {};
      const meta = document.createElement("p");
      meta.className = "confusion-meta";
      meta.textContent = `정답률 ${fmtPct(confusion.metrics?.accuracy)} · ${included}문항`;
      card.append(meta);
      const grid = document.createElement("div");
      grid.className = "confusion-matrix";
      [["", "응답 O", "응답 X"], ["정답 O", null, null], ["정답 X", null, null]].forEach((row, rowIndex) => {
        row.forEach((text, colIndex) => {
          if (rowIndex > 0 && colIndex > 0) return;
          const axis = document.createElement("div");
          axis.className = rowIndex === 0 && colIndex === 0 ? "confusion-corner" : "confusion-axis";
          axis.textContent = text || "";
          grid.append(axis);
        });
        if (rowIndex === 1) {
          appendConfusionCell(grid, "O를 O로 응답", counts.tp, included, "correct");
          appendConfusionCell(grid, "O를 X로 응답", counts.fn, included, "wrong");
        } else if (rowIndex === 2) {
          appendConfusionCell(grid, "X를 O로 응답", counts.fp, included, "wrong");
          appendConfusionCell(grid, "X를 X로 응답", counts.tn, included, "correct");
        }
      });
      card.append(grid);
      els.confusionList.append(card);
    });
  }

  function correctnessBucket(result) {
    if (!Number.isFinite(result?.correct)) return null;
    return result.correct >= 0.5 ? "correct" : "wrong";
  }
  function transitionCounts(participant, previousRound, nextRound) {
    const previousResults = participant.itemResults?.[String(previousRound.actualRound || previousRound.round)] || {};
    const nextResults = participant.itemResults?.[String(nextRound.actualRound || nextRound.round)] || {};
    const counts = { wrongToCorrect: 0, wrongToWrong: 0, correctToCorrect: 0, correctToWrong: 0, compared: 0 };
    commonItems.forEach((item) => {
      const previous = correctnessBucket(previousResults[item.id]);
      const next = correctnessBucket(nextResults[item.id]);
      if (!previous || !next) return;
      counts.compared += 1;
      if (previous === "wrong" && next === "correct") counts.wrongToCorrect += 1;
      else if (previous === "wrong" && next === "wrong") counts.wrongToWrong += 1;
      else if (previous === "correct" && next === "correct") counts.correctToCorrect += 1;
      else if (previous === "correct" && next === "wrong") counts.correctToWrong += 1;
    });
    return counts;
  }
  function roundCorrectnessCounts(participant, round) {
    const roundResults = participant.itemResults?.[String(round.actualRound || round.round)] || {};
    const counts = { correct: 0, wrong: 0, total: 0 };
    commonItems.forEach((item) => {
      const bucket = correctnessBucket(roundResults[item.id]);
      if (!bucket) return;
      counts.total += 1;
      if (bucket === "correct") counts.correct += 1;
      else counts.wrong += 1;
    });
    return counts;
  }
  function createRoundSummary(label, counts) {
    const item = document.createElement("div");
    item.className = "transition-round-summary-item";
    const title = document.createElement("span");
    title.className = "transition-round-summary-title";
    title.textContent = label;
    const values = document.createElement("span");
    values.className = "transition-round-summary-values";
    values.innerHTML = `<strong class="green">${counts.correct} 정답</strong><strong class="red">${counts.wrong} 오답</strong>`;
    item.append(title, values);
    return item;
  }
  function appendRoundSummary(container, label, counts) {
    const item = createRoundSummary(label, counts);
    container.append(item);
  }
  function appendTransitionCell(grid, label, value, total, tone) {
    const cell = document.createElement("div");
    cell.className = `transition-cell ${tone || ""}`.trim();
    const labelNode = document.createElement("span");
    labelNode.className = "transition-label";
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.className = "transition-value";
    valueNode.textContent = `${value}개`;
    const percentNode = document.createElement("span");
    percentNode.className = "transition-percent";
    percentNode.textContent = fmtPct(total ? value / total : NaN);
    cell.append(labelNode, valueNode, percentNode);
    grid.append(cell);
  }
  function renderTransitionLineChart(participant, rounds) {
    if (!els.transitionLineChart) return;
    clear(els.transitionLineChart);
    if (!participant || rounds.length < 2) {
      els.transitionLineChart.append(textNode("비교할 다음 회차가 없습니다.", { class: "empty-svg", x: 520, y: 250, "text-anchor": "middle" }));
      return;
    }
    const points = [];
    for (let index = 1; index < rounds.length; index += 1) {
      const previousRound = rounds[index - 1];
      const nextRound = rounds[index];
      const counts = transitionCounts(participant, previousRound, nextRound);
      points.push({
        x: index,
        label: `${previousRound.attemptIndex || previousRound.round}→${nextRound.attemptIndex || nextRound.round}`,
        wrongStay: counts.wrongToWrong,
        correctToWrong: counts.correctToWrong,
      });
    }
    const width = 1040, height = 500;
    const left = 78, right = 36, top = 30, bottom = 62;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const maxCount = Math.max(1, ...points.flatMap((point) => [point.wrongStay, point.correctToWrong]));
    const yMax = Math.max(4, Math.ceil(maxCount * 1.15));
    const x = (index) => points.length === 1 ? left + plotW / 2 : left + ((index - 1) / (points.length - 1)) * plotW;
    const y = (value) => top + ((yMax - value) / yMax) * plotH;
    const ticks = 4;
    for (let tick = 0; tick <= ticks; tick += 1) {
      const value = yMax * tick / ticks;
      const yy = y(value);
      els.transitionLineChart.append(makeSvg("line", { class: "grid-line", x1: left, y1: yy, x2: left + plotW, y2: yy }));
      els.transitionLineChart.append(textNode(String(Math.round(value)), { class: "tick-text", x: left - 10, y: yy + 4, "text-anchor": "end" }));
    }
    points.forEach((point, index) => {
      const xx = x(index + 1);
      els.transitionLineChart.append(makeSvg("line", { class: "grid-line", x1: xx, y1: top, x2: xx, y2: top + plotH, "stroke-opacity": .55 }));
      els.transitionLineChart.append(textNode(point.label, { class: "tick-text", x: xx, y: top + plotH + 24, "text-anchor": "middle" }));
    });
    els.transitionLineChart.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }));
    els.transitionLineChart.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotH }));
    els.transitionLineChart.append(textNode("전환", { class: "axis-label", x: left + plotW / 2, y: height - 10, "text-anchor": "middle" }));
    els.transitionLineChart.append(textNode("개수", { class: "axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, "text-anchor": "middle" }));
    function drawLine(key, color, dash = "") {
      const d = points.map((point, index) => `${index ? "L" : "M"}${x(index + 1).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
      if (points.length >= 2) {
        els.transitionLineChart.append(makeSvg("path", { class: "series-line", d, stroke: color, "stroke-width": 1.7, "stroke-dasharray": dash }));
      }
      points.forEach((point, index) => {
        const dot = makeSvg("circle", { cx: x(index + 1), cy: y(point[key]), r: 4.2, fill: color, "fill-opacity": .95 });
        const title = makeSvg("title");
        title.textContent = `${point.label} · ${key === "wrongStay" ? "모르는 내용(오답 유지)" : "실수(정답→오답)"} ${point[key]}개`;
        dot.append(title);
        els.transitionLineChart.append(dot);
      });
    }
    drawLine("wrongStay", colors.red);
    drawLine("correctToWrong", colors.amber, "6 5");
  }
  function renderAnswerTransitions(participant) {
    clear(els.transitionList);
    const rounds = participantRounds(participant);
    if (rounds.length < 2) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "비교할 다음 회차가 없습니다.";
      els.transitionList.append(empty);
      renderTransitionLineChart(participant, rounds);
      return;
    }

    const roundOverview = document.createElement("div");
    roundOverview.className = "transition-round-overview";
    rounds.forEach((round) => {
      appendRoundSummary(roundOverview, `${round.attemptIndex || round.round}회차`, roundCorrectnessCounts(participant, round));
    });
    els.transitionList.append(roundOverview);
    renderTransitionLineChart(participant, rounds);
    for (let index = 1; index < rounds.length; index += 1) {
      const previousRound = rounds[index - 1];
      const nextRound = rounds[index];
      const counts = transitionCounts(participant, previousRound, nextRound);
      const card = document.createElement("article");
      card.className = "transition-card";
      const heading = document.createElement("h3");
      heading.textContent = `${previousRound.attemptIndex || previousRound.round} → ${nextRound.attemptIndex || nextRound.round}`;
      const meta = document.createElement("p");
      meta.className = "transition-meta";
      meta.textContent = `${counts.compared}/${commonItems.length}문항 비교`;
      const grid = document.createElement("div");
      grid.className = "transition-matrix";
      ["", "유지", "변화"].forEach((text, colIndex) => {
        const axis = document.createElement("div");
        axis.className = colIndex === 0 ? "transition-corner" : "transition-axis";
        axis.textContent = text;
        grid.append(axis);
      });
      const correctAxis = document.createElement("div");
      correctAxis.className = "transition-axis";
      correctAxis.textContent = "이전 정답";
      grid.append(correctAxis);
      appendTransitionCell(grid, "정답 유지", counts.correctToCorrect, counts.compared, "correct");
      appendTransitionCell(grid, "정답 → 오답", counts.correctToWrong, counts.compared, "declined");
      const wrongAxis = document.createElement("div");
      wrongAxis.className = "transition-axis";
      wrongAxis.textContent = "이전 오답";
      grid.append(wrongAxis);
      appendTransitionCell(grid, "오답 유지", counts.wrongToWrong, counts.compared, "wrong");
      appendTransitionCell(grid, "오답 → 정답", counts.wrongToCorrect, counts.compared, "improved");
      card.append(heading, meta, grid);
      els.transitionList.append(card);
    }
  }

  function byCategory(items) {
    return items.reduce((acc, item) => {
      const category = item.itemCategory || "Unknown";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});
  }
  function percentile(sortedValues, p) {
    if (!sortedValues.length) return NaN;
    if (sortedValues.length === 1) return sortedValues[0];
    const index = (sortedValues.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }
  function rtExtentFromValues(values) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return [0, 1];
    const sorted = clean.sort((a, b) => a - b);
    return [percentile(sorted, 0.1), percentile(sorted, 0.9)];
  }
  function personalRtExtent(participant, items = commonItems) {
    const itemIds = new Set(items.map((item) => item.id));
    const values = [];
    Object.values(participant?.itemResults || {}).forEach((roundResults) => {
      Object.entries(roundResults || {}).forEach(([itemId, result]) => {
        if (itemIds.has(itemId) && Number.isFinite(result.rt)) values.push(result.rt);
      });
    });
    return rtExtentFromValues(values);
  }
  function perItemRtExtents(participant, items = commonItems) {
    const valuesByItem = Object.fromEntries(items.map((item) => [item.id, []]));
    Object.values(participant?.itemResults || {}).forEach((roundResults) => {
      Object.entries(roundResults || {}).forEach(([itemId, result]) => {
        if (valuesByItem[itemId] && Number.isFinite(result.rt)) valuesByItem[itemId].push(result.rt);
      });
    });
    return Object.fromEntries(Object.entries(valuesByItem).map(([itemId, values]) => [itemId, rtExtentFromValues(values)]));
  }
  function intensity(rt, minRt, maxRt) {
    if (!Number.isFinite(rt)) return 0.32;
    if (maxRt <= minRt) return 0.85;
    return Math.max(0.28, Math.min(1, 1 - ((rt - minRt) / (maxRt - minRt)) * 0.72));
  }
  function cellColor(result, minRt, maxRt) {
    if (!result || !Number.isFinite(result.correct)) return "#e5e7eb";
    const alpha = intensity(result.rt, minRt, maxRt);
    return result.correct >= 0.5 ? `rgba(22,163,74,${alpha})` : `rgba(220,38,38,${alpha})`;
  }
  function moveTooltip(event) {
    const offset = 14;
    const { offsetWidth: width, offsetHeight: height } = itemTooltip;
    const left = Math.min(window.innerWidth - width - 10, event.clientX + offset);
    const top = Math.min(window.innerHeight - height - 10, event.clientY + offset);
    itemTooltip.style.left = `${Math.max(10, left)}px`;
    itemTooltip.style.top = `${Math.max(10, top)}px`;
  }
  function showTooltip(event, text) {
    itemTooltip.textContent = text;
    itemTooltip.classList.add("is-visible");
    moveTooltip(event);
  }
  function hideTooltip() {
    itemTooltip.classList.remove("is-visible");
  }
  function appendCategoryHeading(section, category, count) {
    const heading = document.createElement("h3");
    heading.textContent = `${category} (${count})`;
    section.append(heading);
  }
  function renderItemGrid(participant, target, rtExtentForItem) {
    clear(target);
    Object.entries(byCategory(commonItems)).forEach(([category, items]) => {
      const section = document.createElement("article");
      section.className = "item-category-card";
      appendCategoryHeading(section, category, items.length);
      participantRounds(participant).forEach((round) => {
        const row = document.createElement("div");
        row.className = "grass-row";
        const label = document.createElement("div");
        label.className = "grass-row-label";
        const roundResults = participant.itemResults?.[String(round.actualRound || round.round)] || {};
        const matchedCount = items.filter((item) => Number.isFinite(roundResults[item.id]?.correct)).length;
        label.textContent = `${round.attemptIndex || round.round} ${matchedCount}/${items.length}`;
        label.title = matchedCount
          ? `${labelWithDate(round)} · 공통 ${matchedCount}/${items.length}개`
          : `${labelWithDate(round)} · 공통 문항 없음`;
        const cells = document.createElement("div");
        cells.className = "grass-cells";
        items.forEach((item) => {
          const result = roundResults[item.id];
          const [minRt, maxRt] = rtExtentForItem(item);
          const cell = document.createElement("span");
          cell.className = "grass-cell";
          cell.style.background = cellColor(result, minRt, maxRt);
          const correctness = Number.isFinite(result?.correct) ? (result.correct >= 0.5 ? "정답" : "오답") : "미실시";
          const rt = Number.isFinite(result?.rt) ? `${result.rt.toFixed(3)}초` : "RT 없음";
          const statement = result?.statement || item.statement || "원문 없음";
          const answer = result?.correctAnswer ? ` · 정답 ${result.correctAnswer}` : "";
          const response = result?.response ? ` · 응답 ${result.response}` : "";
          const tooltip = `${statement}\n${correctness} · ${rt}${answer}${response}`;
          cell.setAttribute("aria-label", tooltip);
          cell.addEventListener("mouseenter", (event) => showTooltip(event, tooltip));
          cell.addEventListener("mousemove", moveTooltip);
          cell.addEventListener("mouseleave", hideTooltip);
          cells.append(cell);
        });
        row.append(label, cells);
        section.append(row);
      });
      target.append(section);
    });
  }
  function renderItemMapModeOptions() {
    if (!els.itemMapMode) return;
    els.itemMapMode.textContent = "";
    const title = document.createElement("span");
    title.className = "transition-filter-title";
    title.textContent = "기준";
    els.itemMapMode.append(title);
    [
      {
        value: "global",
        label: "전체 RT 기준",
        caption: "개인의 모든 공통 문항 RT 범위를 한 번에 비교합니다. 색 진하기가 전체 문제 안에서의 상대 속도를 뜻합니다.",
      },
      {
        value: "perItem",
        label: "문항별 RT 기준",
        caption: "각 문항마다 그 문항의 반복 RT 범위를 따로 비교합니다. 같은 문제 안에서 빨라졌는지 보기 좋습니다.",
      },
    ].forEach((option) => {
      const label = document.createElement("label");
      label.className = "transition-option";
      label.setAttribute("aria-label", `${option.label}: ${option.caption}`);
      label.addEventListener("mouseenter", (event) => showTooltip(event, option.caption));
      label.addEventListener("mousemove", moveTooltip);
      label.addEventListener("mouseleave", hideTooltip);
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "itemMapMode";
      input.value = option.value;
      input.checked = itemMapMode === option.value;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        itemMapMode = option.value;
        renderItemMapModeOptions();
        renderCommonGrid(currentParticipant());
      });
      const text = document.createElement("span");
      text.textContent = option.label;
      label.append(input, text);
      els.itemMapMode.append(label);
    });
  }
  function renderCommonGrid(participant) {
    if (!isSvtDataset) {
      clear(els.itemGrid);
      if (els.itemMapSummary) els.itemMapSummary.textContent = "";
      return;
    }
    if (!participant) {
      clear(els.itemGrid);
      return;
    }
    const globalExtent = personalRtExtent(participant, commonItems);
    if (itemMapMode === "perItem") {
      const itemExtents = perItemRtExtents(participant, commonItems);
      renderItemGrid(participant, els.itemGrid, (item) => itemExtents[item.id] || [0, 1]);
      if (els.itemMapSummary) els.itemMapSummary.textContent = "각 문항의 차수별 RT 범위 기준";
      return;
    }
    renderItemGrid(participant, els.itemGrid, () => globalExtent);
    if (els.itemMapSummary) els.itemMapSummary.textContent = `공통 ${commonItems.length}문항 · 전체 RT 범위 기준`;
  }
  function render() {
    const participant = currentParticipant();
    if (!participant) {
      els.title.textContent = !isSvtDataset ? `${datasetLabel} 반응시간, 정확도 분석 모델` : "반응시간, 정확도 분석";
      els.meta.textContent = "";
      if (els.itemSummary) els.itemSummary.textContent = "";
      if (els.itemMapSummary) els.itemMapSummary.textContent = !isSvtDataset ? "" : "공통 문항 176개";
      [els.modelChart, els.modelEquations, els.confusionList, els.transitionList, els.transitionLineChart, els.itemGrid].forEach(clear);
      return;
    }
    els.title.textContent = !isSvtDataset ? `${datasetLabel} 반응시간, 정확도 분석 모델` : "반응시간, 정확도 분석";
    const completed = Object.keys(participant.rounds || {}).length;
    const trials = Object.values(participant.rounds || {}).reduce((sum, round) => sum + (round.trialCount || 0), 0);
    const emptyCommonRounds = participantRounds(participant).filter((round) => {
      const roundResults = participant.itemResults?.[String(round.actualRound || round.round)] || {};
      return commonItems.every((item) => !Number.isFinite(roundResults[item.id]?.correct));
    }).map((round) => String(round.attemptIndex || round.round));
    const emptyNote = emptyCommonRounds.length ? ` · ${emptyCommonRounds.join(", ")} 공통 없음` : "";
    els.meta.textContent = !isSvtDataset
      ? `${participant.nickname} · ${completed}회 · ${trials} selected trials`
      : `${participant.nickname} · ${completed}회 · ${trials} selected trials · 공통 ${commonItems.length}문항${emptyNote}`;
    renderModel(participant);
    renderConfusion(participant);
    renderAnswerTransitions(participant);
    renderCommonGrid(participant);
  }

  function selectParticipant(id, notify = false) {
    if (!id) {
      selectedParticipantId = "";
      render();
      return;
    }
    if (participants.some((participant) => participant.id === id)) {
      selectedParticipantId = id;
      if (els.participantSelect) els.participantSelect.value = id;
      render();
      if (notify) window.dispatchEvent(new CustomEvent("svt:participant-select", { detail: { id } }));
    }
  }
  if (els.participantSelect) {
    participants.forEach((participant) => {
      const option = document.createElement("option");
      option.value = participant.id;
      option.textContent = participant.nickname;
      els.participantSelect.append(option);
    });
    selectedParticipantId = els.participantSelect.value || participants[0]?.id || "";
    if (selectedParticipantId) els.participantSelect.value = selectedParticipantId;
    els.itemSummary.textContent = `${participants.length}명 · 공통 ${commonItems.length}문항`;
    els.participantSelect.addEventListener("change", () => selectParticipant(els.participantSelect.value, true));
  } else {
    selectedParticipantId = window.SVT_SELECTED_PARTICIPANT_ID || "";
    if (els.itemSummary) els.itemSummary.textContent = "";
  }
  window.addEventListener("svt:participant-selection-change", (event) => selectParticipant(event.detail?.id, false));
  if (isSvtDataset) renderItemMapModeOptions();
  render();
  }
})();
