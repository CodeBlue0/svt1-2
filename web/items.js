(function () {
  const data = window.SVT_DASHBOARD_DATA || { participants: [], itemCatalog: {} };
  const participants = data.participants || [];
  const commonItems = data.itemCatalog?.commonItems || [];
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
    itemGrid: document.getElementById("itemGrid"),
    itemRtGrid: document.getElementById("itemRtGrid"),
  };
  const colors = { red: "#ef4444", blue: "#2563eb" };
  const itemTooltip = document.createElement("div");
  itemTooltip.className = "item-tooltip";
  document.body.append(itemTooltip);

  function makeSvg(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => value !== undefined && value !== null && node.setAttribute(key, value));
    return node;
  }
  function textNode(text, attrs = {}) { const node = makeSvg("text", attrs); node.textContent = text; return node; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
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
  function currentParticipant() { return participants.find((participant) => participant.id === els.participantSelect.value) || participants[0]; }
  function participantRounds(participant) {
    return Object.values(participant?.rounds || {}).sort((a, b) => (a.attemptIndex || a.round) - (b.attemptIndex || b.round));
  }
  function labelWithDate(round) {
    return `${round.displayLabel || `R${round.attemptIndex || round.round}`}${round.date ? ` (${round.date})` : ""}`;
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
        els.modelChart.append(textNode(`R${roundNumber}`, { class: "tick-text", x: x(roundNumber), y: top + plotH + 20, "text-anchor": "middle" }));
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
      observed.forEach((point) => els.modelChart.append(makeSvg("circle", { cx: x(point.x), cy: y(point.y), r: 4.5, fill: colors.red, "fill-opacity": 0.82 })));
      els.modelChart.append(textNode(panel.label, { class: "axis-label", x: left + plotW / 2, y: 18, "text-anchor": "middle" }));
    });
    renderModelEquations(equations);
  }

  function renderConfusion(participant) {
    clear(els.confusionList);
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
      const grid = document.createElement("div");
      grid.className = "confusion-grid";
      [["TP", confusion.cells?.tp], ["FN", confusion.cells?.fn], ["FP", confusion.cells?.fp], ["TN", confusion.cells?.tn]].forEach(([label, value]) => {
        const cell = document.createElement("div");
        cell.className = "confusion-cell";
        const labelNode = document.createElement("span");
        labelNode.className = "confusion-label";
        labelNode.textContent = label;
        const valueNode = document.createElement("strong");
        valueNode.className = "confusion-value";
        valueNode.textContent = fmtPct(value);
        cell.append(labelNode, valueNode);
        grid.append(cell);
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
  function appendTransitionCell(grid, label, value, tone) {
    const cell = document.createElement("div");
    cell.className = `transition-cell ${tone || ""}`.trim();
    const labelNode = document.createElement("span");
    labelNode.className = "transition-label";
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.className = "transition-value";
    valueNode.textContent = `${value}개`;
    cell.append(labelNode, valueNode);
    grid.append(cell);
  }
  function renderAnswerTransitions(participant) {
    clear(els.transitionList);
    const rounds = participantRounds(participant);
    if (rounds.length < 2) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "비교할 다음 회차가 없습니다.";
      els.transitionList.append(empty);
      return;
    }
    for (let index = 1; index < rounds.length; index += 1) {
      const previousRound = rounds[index - 1];
      const nextRound = rounds[index];
      const counts = transitionCounts(participant, previousRound, nextRound);
      const card = document.createElement("article");
      card.className = "transition-card";
      const heading = document.createElement("h3");
      heading.textContent = `${previousRound.displayLabel || `R${previousRound.attemptIndex || previousRound.round}`} → ${nextRound.displayLabel || `R${nextRound.attemptIndex || nextRound.round}`}`;
      const meta = document.createElement("p");
      meta.className = "transition-meta";
      meta.textContent = `${counts.compared}/${commonItems.length}문항 비교`;
      const grid = document.createElement("div");
      grid.className = "transition-grid";
      appendTransitionCell(grid, "이전 오답 → 다음 정답", counts.wrongToCorrect, "green");
      appendTransitionCell(grid, "이전 오답 → 다음 오답", counts.wrongToWrong, "red");
      appendTransitionCell(grid, "이전 정답 → 다음 정답", counts.correctToCorrect, "green");
      appendTransitionCell(grid, "이전 정답 → 다음 오답", counts.correctToWrong, "red");
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
        label.textContent = `${round.displayLabel || `R${round.attemptIndex || round.round}`} ${matchedCount}/${items.length}`;
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
  function renderCommonGrid(participant) {
    const globalExtent = personalRtExtent(participant, commonItems);
    renderItemGrid(participant, els.itemGrid, () => globalExtent);

    const itemExtents = perItemRtExtents(participant, commonItems);
    renderItemGrid(participant, els.itemRtGrid, (item) => itemExtents[item.id] || [0, 1]);
  }
  function render() {
    const participant = currentParticipant();
    if (!participant) return;
    els.title.textContent = participant.nickname;
    const completed = Object.keys(participant.rounds || {}).length;
    const trials = Object.values(participant.rounds || {}).reduce((sum, round) => sum + (round.trialCount || 0), 0);
    const emptyCommonRounds = participantRounds(participant).filter((round) => {
      const roundResults = participant.itemResults?.[String(round.actualRound || round.round)] || {};
      return commonItems.every((item) => !Number.isFinite(roundResults[item.id]?.correct));
    }).map((round) => round.displayLabel || `R${round.attemptIndex || round.round}`);
    const emptyNote = emptyCommonRounds.length ? ` · ${emptyCommonRounds.join(", ")} 공통 없음` : "";
    els.meta.textContent = `${completed}회 · ${trials} selected trials · 공통 ${commonItems.length}문항${emptyNote}`;
    renderModel(participant);
    renderConfusion(participant);
    renderAnswerTransitions(participant);
    renderCommonGrid(participant);
  }

  participants.forEach((participant) => {
    const option = document.createElement("option");
    option.value = participant.id;
    option.textContent = participant.nickname;
    els.participantSelect.append(option);
  });
  els.itemSummary.textContent = `${participants.length}명 · 공통 ${commonItems.length}문항`;
  els.participantSelect.addEventListener("change", render);
  render();
})();
