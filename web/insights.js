(function () {
  const data = window.SVT_DASHBOARD_DATA || { participants: [], rounds: [], itemCatalog: {}, quality: {} };
  const participants = data.participants || [];
  const maxAttempts = Math.max(1, ...participants.map((participant) => Object.keys(participant.rounds || {}).length));
  const commonItems = data.itemCatalog?.commonItems || [];
  const svgNS = "http://www.w3.org/2000/svg";

  const els = {
    insightSummary: document.getElementById("insightSummary"),
    cohortParticipants: document.getElementById("cohortParticipants"),
    avgRounds: document.getElementById("avgRounds"),
    completeRate: document.getElementById("completeRate"),
    trialCount: document.getElementById("trialCount"),
    attendanceBars: document.getElementById("attendanceBars"),
    roundInsightList: document.getElementById("roundInsightList"),
    speedAccuracyChart: document.getElementById("speedAccuracyChart"),
    categoryInsightList: document.getElementById("categoryInsightList"),
    riskList: document.getElementById("riskList"),
  };

  const colors = {
    blue: "#2563eb",
    green: "#059669",
    red: "#ef4444",
    amber: "#d97706",
    muted: "#667789",
    grid: "#d9e2ec",
    ink: "#17212b",
  };

  function makeSvg(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => value !== undefined && value !== null && node.setAttribute(key, value));
    return node;
  }
  function textNode(text, attrs = {}) { const node = makeSvg("text", attrs); node.textContent = text; return node; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function avg(values) { const clean = values.filter(Number.isFinite); return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null; }
  function fmtNum(value, digits = 2) { return Number.isFinite(value) ? value.toFixed(digits) : "-"; }
  function fmtPct(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-"; }
  function roundCount(participant) { return Object.keys(participant.rounds || {}).length; }
  function participantMean(participant) {
    const roundValues = Object.values(participant.rounds || {});
    return {
      id: participant.id,
      nickname: participant.nickname,
      rounds: roundValues.length,
      rt: avg(roundValues.map((round) => round.rtMean)),
      accuracy: avg(roundValues.map((round) => round.accuracy)),
    };
  }
  function barRow(label, value, max, detail, tone = "blue") {
    const row = document.createElement("article");
    row.className = "bar-row";
    const labelNode = document.createElement("div");
    labelNode.className = "bar-label";
    labelNode.textContent = label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = `bar-fill ${tone}`;
    fill.style.width = `${max > 0 ? Math.max(3, (value / max) * 100) : 0}%`;
    track.append(fill);
    const detailNode = document.createElement("strong");
    detailNode.className = "bar-value";
    detailNode.textContent = detail;
    row.append(labelNode, track, detailNode);
    return row;
  }

  function renderStats() {
    const counts = participants.map(roundCount);
    const full = counts.filter((count) => count >= maxAttempts).length;
    els.cohortParticipants.textContent = `${participants.length}명`;
    els.avgRounds.textContent = fmtNum(avg(counts), 2);
    els.completeRate.textContent = fmtPct(participants.length ? full / participants.length : null);
    els.trialCount.textContent = `${(data.quality?.selectedTrialCount || 0).toLocaleString()}개`;
    els.insightSummary.textContent = `${participants.length}명 · 원본 ${data.quality?.sourceFileCount || 0}파일 · 중복 제거 ${data.quality?.duplicateFileCount || 0}파일 · 제외 ${data.quality?.ignoredNonComparableTrialCount || 0}trial`;
  }

  function renderAttendance() {
    clear(els.attendanceBars);
    const buckets = Array.from({ length: maxAttempts }, (_, i) => i + 1)
      .map((count) => ({ count, people: participants.filter((participant) => roundCount(participant) === count).length }));
    const max = Math.max(1, ...buckets.map((bucket) => bucket.people));
    buckets.forEach((bucket) => {
      els.attendanceBars.append(barRow(`${bucket.count}회`, bucket.people, max, `${bucket.people}명`, bucket.count >= maxAttempts ? "green" : bucket.count === 1 ? "red" : "blue"));
    });
  }

  function participantRounds(participant) {
    return Object.values(participant.rounds || {}).sort((a, b) => (a.attemptIndex || a.round) - (b.attemptIndex || b.round));
  }
  function roundStats(roundNumber) {
    const values = participants.map((participant) => participantRounds(participant).find((round) => (round.attemptIndex || round.round) === roundNumber)).filter(Boolean);
    return {
      round: roundNumber,
      people: values.length,
      rt: avg(values.map((round) => round.rtMean)),
      accuracy: avg(values.map((round) => round.accuracy)),
      trials: values.reduce((sum, round) => sum + (round.trialCount || 0), 0),
    };
  }

  function renderRoundLandscape() {
    clear(els.roundInsightList);
    Array.from({ length: maxAttempts }, (_, i) => roundStats(i + 1)).forEach((stat) => {
      const card = document.createElement("article");
      card.className = "round-insight-card";
      const title = document.createElement("h3");
      title.textContent = `R${stat.round}`;
      const meta = document.createElement("p");
      meta.textContent = `${stat.people}명 · ${stat.trials.toLocaleString()} trials`;
      const rt = document.createElement("strong");
      rt.textContent = `${fmtNum(stat.rt, 2)}s`;
      const acc = document.createElement("span");
      acc.textContent = fmtPct(stat.accuracy);
      const meter = document.createElement("div");
      meter.className = "dual-meter";
      const accFill = document.createElement("span");
      accFill.className = "accuracy-fill";
      accFill.style.width = `${Math.max(0, Math.min(100, (stat.accuracy || 0) * 100))}%`;
      meter.append(accFill);
      card.append(title, meta, rt, acc, meter);
      els.roundInsightList.append(card);
    });
  }

  function renderScatter() {
    const svg = els.speedAccuracyChart;
    clear(svg);
    const width = 1040, height = 500, left = 76, right = 36, top = 34, bottom = 64;
    const plotW = width - left - right, plotH = height - top - bottom;
    const points = participants.map(participantMean).filter((point) => Number.isFinite(point.rt) && Number.isFinite(point.accuracy));
    const rtValues = points.map((point) => point.rt);
    let rtMin = Math.min(...rtValues), rtMax = Math.max(...rtValues);
    if (!Number.isFinite(rtMin) || rtMin === rtMax) { rtMin = 0; rtMax = 8; }
    const pad = (rtMax - rtMin) * 0.08;
    rtMin = Math.max(0, rtMin - pad); rtMax += pad;
    const accMin = 0;
    const accMax = 1;
    const x = (value) => left + ((value - rtMin) / (rtMax - rtMin || 1)) * plotW;
    const y = (value) => top + ((accMax - value) / (accMax - accMin || 1)) * plotH;
    for (let i = 0; i <= 5; i += 1) {
      const rt = rtMin + (rtMax - rtMin) * i / 5;
      const acc = accMin + (accMax - accMin) * i / 5;
      svg.append(makeSvg("line", { class: "grid-line", x1: x(rt), y1: top, x2: x(rt), y2: top + plotH }));
      svg.append(makeSvg("line", { class: "grid-line", x1: left, y1: y(acc), x2: left + plotW, y2: y(acc) }));
      svg.append(textNode(rt.toFixed(1), { class: "tick-text", x: x(rt), y: top + plotH + 24, "text-anchor": "middle" }));
      svg.append(textNode(`${Math.round(acc * 100)}%`, { class: "tick-text", x: left - 10, y: y(acc) + 4, "text-anchor": "end" }));
    }
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }));
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotH }));
    svg.append(textNode("RT", { class: "axis-label", x: left + plotW / 2, y: height - 18, "text-anchor": "middle" }));
    svg.append(textNode("정답률", { class: "axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, "text-anchor": "middle" }));
    const rtAvg = avg(points.map((point) => point.rt));
    const accAvg = avg(points.map((point) => point.accuracy));
    if (Number.isFinite(rtAvg)) svg.append(makeSvg("line", { class: "quadrant-line", x1: x(rtAvg), y1: top, x2: x(rtAvg), y2: top + plotH }));
    if (Number.isFinite(accAvg)) svg.append(makeSvg("line", { class: "quadrant-line", x1: left, y1: y(accAvg), x2: left + plotW, y2: y(accAvg) }));
    points.forEach((point) => {
      const highAccuracy = point.accuracy >= (accAvg || 0);
      const fast = point.rt <= (rtAvg || Infinity);
      const dot = makeSvg("circle", {
        class: "scatter-dot",
        cx: x(point.rt), cy: y(point.accuracy), r: 3 + point.rounds * 1.4,
        fill: highAccuracy && fast ? colors.green : highAccuracy ? colors.blue : fast ? colors.amber : colors.red,
        "fill-opacity": 0.72,
      });
      const title = makeSvg("title");
      title.textContent = `${point.nickname}: ${fmtNum(point.rt, 3)}s · ${fmtPct(point.accuracy)} · ${point.rounds}회`;
      dot.append(title);
      svg.append(dot);
    });
  }

  function categoryStats() {
    const byCategory = new Map();
    commonItems.forEach((item) => {
      const stat = byCategory.get(item.itemCategory || "Unknown") || { category: item.itemCategory || "Unknown", items: 0, attempts: 0, correct: 0, rts: [] };
      stat.items += 1;
      participants.forEach((participant) => {
        Object.values(participant.itemResults || {}).forEach((roundResults) => {
          const result = roundResults?.[item.id];
          if (!result || !Number.isFinite(result.correct)) return;
          stat.attempts += 1;
          stat.correct += result.correct >= 0.5 ? 1 : 0;
          if (Number.isFinite(result.rt)) stat.rts.push(result.rt);
        });
      });
      byCategory.set(stat.category, stat);
    });
    return [...byCategory.values()].map((stat) => ({ ...stat, accuracy: stat.attempts ? stat.correct / stat.attempts : null, rt: avg(stat.rts) })).sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1));
  }

  function renderCategoryInsights() {
    clear(els.categoryInsightList);
    const stats = categoryStats();
    const maxRt = Math.max(1, ...stats.map((stat) => stat.rt || 0));
    stats.forEach((stat) => {
      const card = document.createElement("article");
      card.className = "category-card";
      const heading = document.createElement("div");
      heading.className = "category-heading";
      const title = document.createElement("h3");
      title.textContent = stat.category;
      const meta = document.createElement("span");
      meta.textContent = `${stat.items}문항 · ${stat.attempts.toLocaleString()}회`;
      heading.append(title, meta);
      const acc = barRow("정답률", (stat.accuracy || 0) * 100, 100, fmtPct(stat.accuracy), "green");
      const rt = barRow("RT", stat.rt || 0, maxRt, `${fmtNum(stat.rt, 2)}s`, "amber");
      card.append(heading, acc, rt);
      els.categoryInsightList.append(card);
    });
  }

  function itemRiskStats() {
    return commonItems.map((item) => {
      let attempts = 0, correct = 0;
      const rts = [];
      participants.forEach((participant) => {
        Object.values(participant.itemResults || {}).forEach((roundResults) => {
          const result = roundResults?.[item.id];
          if (!result || !Number.isFinite(result.correct)) return;
          attempts += 1;
          correct += result.correct >= 0.5 ? 1 : 0;
          if (Number.isFinite(result.rt)) rts.push(result.rt);
        });
      });
      return { item, attempts, accuracy: attempts ? correct / attempts : null, rt: avg(rts) };
    }).filter((stat) => stat.attempts >= Math.max(8, participants.length * 0.35)).sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1)).slice(0, 12);
  }

  function renderRiskList() {
    clear(els.riskList);
    itemRiskStats().forEach((stat, index) => {
      const card = document.createElement("article");
      card.className = "risk-card";
      const rank = document.createElement("span");
      rank.className = "risk-rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = stat.item.id;
      const meta = document.createElement("p");
      meta.textContent = `${stat.item.itemCategory || "Unknown"} · 정답률 ${fmtPct(stat.accuracy)} · RT ${fmtNum(stat.rt, 2)}s · ${stat.attempts}회`;
      body.append(title, meta);
      card.append(rank, body);
      els.riskList.append(card);
    });
  }

  renderStats();
  renderAttendance();
  renderRoundLandscape();
  renderScatter();
  renderCategoryInsights();
  renderRiskList();
})();
