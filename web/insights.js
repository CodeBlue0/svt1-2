(function () {
  const data = window.SVT_DASHBOARD_DATA || { participants: [], itemCatalog: {} };
  const participants = data.participants || [];
  const commonItems = data.itemCatalog?.commonItems || [];
  const svgNS = "http://www.w3.org/2000/svg";
  const ANALYSIS_ROUNDS = 5;
  const TRANSITIONS = ["1→2", "2→3", "3→4", "4→5"];
  const CLUSTER_TARGET = 22;
  const MIN_CLUSTER_SIZE = 3;
  const DTW_WINDOW = 1;
  const palette = ["#ef4444", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0f766e"];
  let selectedClusterIndex = 0;
  let showGroupAverage = true;
  let selectedMemberIds = new Set();
  let clusters = [];

  const els = {
    clusterSummary: document.getElementById("clusterSummary"),
    groupList: document.getElementById("groupList"),
    groupMemberControls: document.getElementById("groupMemberControls"),
    manifoldLegend: document.getElementById("manifoldLegend"),
    manifoldMap: document.getElementById("manifoldMap"),
    groupArrowChart: document.getElementById("groupArrowChart"),
    groupSelectedRounds: document.getElementById("groupSelectedRounds"),
    groupSelectedRt: document.getElementById("groupSelectedRt"),
    groupSelectedAcc: document.getElementById("groupSelectedAcc"),
    groupRtOverviewChart: document.getElementById("groupRtOverviewChart"),
    groupAccuracyOverviewChart: document.getElementById("groupAccuracyOverviewChart"),
    selectedGroupTitle: document.getElementById("selectedGroupTitle"),
    selectedGroupMeta: document.getElementById("selectedGroupMeta"),
    groupModelChart: document.getElementById("groupModelChart"),
    groupModelEquations: document.getElementById("groupModelEquations"),
    groupConfusionList: document.getElementById("groupConfusionList"),
    groupTransitionList: document.getElementById("groupTransitionList"),
    groupTransitionLineChart: document.getElementById("groupTransitionLineChart"),
  };

  function makeSvg(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => value !== undefined && value !== null && node.setAttribute(key, value));
    return node;
  }
  function textNode(text, attrs = {}) { const node = makeSvg("text", attrs); node.textContent = text; return node; }
  function clear(node) { if (!node) return; while (node.firstChild) node.removeChild(node.firstChild); }
  function mean(values) { const clean = values.filter(Number.isFinite); return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : NaN; }
  function sum(values) { return values.filter(Number.isFinite).reduce((total, value) => total + value, 0); }
  function fmtNum(value, digits = 2) { return Number.isFinite(value) ? value.toFixed(digits) : "-"; }
  function fmtPct(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-"; }
  function fmtPctPoint(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%p` : "-"; }
  function participantRounds(participant) {
    return Object.values(participant.rounds || {}).sort((a, b) => (a.attemptIndex || a.round) - (b.attemptIndex || b.round));
  }
  function roundKey(round) { return String(round.actualRound || round.round); }
  function correctnessBucket(result) {
    if (!result || !Number.isFinite(result.correct)) return null;
    return result.correct >= 0.5 ? "correct" : "wrong";
  }
  function extent(values, fallback = [0, 1], pad = 0.08) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return fallback;
    let min = Math.min(...clean), max = Math.max(...clean);
    if (min === max) { min -= 1; max += 1; }
    const p = (max - min) * pad;
    return [min - p, max + p];
  }
  function boundedExtent(values, fallback = [0, 1], pad = 0.08, minBound = -Infinity, maxBound = Infinity, minSpan = 0) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return fallback;
    let min = Math.min(...clean), max = Math.max(...clean);
    const currentSpan = max - min;
    const targetSpan = Math.max(currentSpan, minSpan);
    if (targetSpan > currentSpan) {
      const center = (min + max) / 2;
      min = center - targetSpan / 2;
      max = center + targetSpan / 2;
    }
    const paddedSpan = max - min;
    min = Math.max(minBound, min - paddedSpan * pad);
    max = Math.min(maxBound, max + paddedSpan * pad);
    if (max <= min) return fallback;
    return [min, max];
  }
  function fmtPctTick(value, span = 1) {
    const digits = span < 0.12 ? 1 : 0;
    return `${(value * 100).toFixed(digits)}%`;
  }
  function rmsScale(values) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return 1;
    return Math.sqrt(mean(clean.map((value) => value ** 2))) || 1;
  }
  function pointDistance(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  }
  function dtwDistance(a, b, window = DTW_WINDOW) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    dp[0][0] = 0;
    for (let i = 1; i <= n; i += 1) {
      const from = Math.max(1, i - window);
      const to = Math.min(m, i + window);
      for (let j = from; j <= to; j += 1) {
        const cost = pointDistance(a[i - 1], b[j - 1]);
        dp[i][j] = cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[n][m] / Math.max(1, n + m);
  }
  function prepareDtwRows(rows) {
    const rtScale = rmsScale(rows.flatMap((row) => row.changeSequence.map((point) => point.rt)));
    const accScale = rmsScale(rows.flatMap((row) => row.changeSequence.map((point) => point.acc)));
    return rows.map((row) => ({
      ...row,
      scaledSequence: row.changeSequence.map((point) => [point.rt / rtScale, point.acc / accScale]),
    }));
  }
  function pairwiseDtwDistances(rows) {
    return rows.map((row, i) => rows.map((other, j) => (
      i === j ? 0 : i < j ? dtwDistance(row.scaledSequence, other.scaledSequence) : null
    ))).map((row, i, matrix) => row.map((value, j) => value ?? matrix[j][i]));
  }
  function averageClusterDistance(a, b, distances) {
    let total = 0, count = 0;
    a.forEach((i) => b.forEach((j) => {
      total += distances[i][j];
      count += 1;
    }));
    return count ? total / count : Infinity;
  }
  function mergeClosestPair(groups, distances, onlySmall = false) {
    let bestA = -1, bestB = -1, bestDistance = Infinity;
    for (let i = 0; i < groups.length; i += 1) {
      if (onlySmall && groups[i].length >= MIN_CLUSTER_SIZE) continue;
      for (let j = 0; j < groups.length; j += 1) {
        if (i === j) continue;
        const distance = averageClusterDistance(groups[i], groups[j], distances);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestA = i;
          bestB = j;
        }
      }
    }
    if (bestA < 0 || bestB < 0) return groups;
    const [keep, remove] = bestA < bestB ? [bestB, bestA] : [bestA, bestB];
    groups[keep] = [...groups[keep], ...groups[remove]];
    groups.splice(remove, 1);
    return groups;
  }
  function hierarchicalCluster(rows, k) {
    const distances = pairwiseDtwDistances(rows);
    let groups = rows.map((_, index) => [index]);
    while (groups.length > k) groups = mergeClosestPair(groups, distances);
    while (groups.length > 1 && groups.some((group) => group.length < MIN_CLUSTER_SIZE)) {
      groups = mergeClosestPair(groups, distances, true);
    }
    const assignments = Array(rows.length).fill(0);
    groups.forEach((group, groupIndex) => group.forEach((rowIndex) => { assignments[rowIndex] = groupIndex; }));
    return assignments;
  }
  function multiplyMatrixVector(matrix, vector) {
    return matrix.map((row) => row.reduce((total, value, index) => total + value * vector[index], 0));
  }
  function vectorNorm(vector) {
    return Math.sqrt(vector.reduce((total, value) => total + value ** 2, 0));
  }
  function dominantEigenpair(matrix, blockedVector = null) {
    const n = matrix.length;
    let vector = Array.from({ length: n }, (_, index) => Math.sin(index + 1) + Math.cos((index + 1) * 1.7));
    if (blockedVector) {
      const projection = vector.reduce((total, value, index) => total + value * blockedVector[index], 0);
      vector = vector.map((value, index) => value - projection * blockedVector[index]);
    }
    let norm = vectorNorm(vector) || 1;
    vector = vector.map((value) => value / norm);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      let next = multiplyMatrixVector(matrix, vector);
      if (blockedVector) {
        const projection = next.reduce((total, value, index) => total + value * blockedVector[index], 0);
        next = next.map((value, index) => value - projection * blockedVector[index]);
      }
      norm = vectorNorm(next);
      if (!norm) break;
      next = next.map((value) => value / norm);
      const delta = vectorNorm(next.map((value, index) => value - vector[index]));
      vector = next;
      if (delta < 1e-9) break;
    }
    const mv = multiplyMatrixVector(matrix, vector);
    const value = vector.reduce((total, item, index) => total + item * mv[index], 0);
    return { value, vector };
  }
  function classicalMds(distances) {
    const n = distances.length;
    if (!n) return [];
    if (n === 1) return [{ x: 0, y: 0 }];
    const squared = distances.map((row) => row.map((value) => value ** 2));
    const rowMeans = squared.map((row) => mean(row));
    const totalMean = mean(rowMeans);
    const centered = squared.map((row, i) => row.map((value, j) => -0.5 * (value - rowMeans[i] - rowMeans[j] + totalMean)));
    const first = dominantEigenpair(centered);
    const deflated = centered.map((row, i) => row.map((value, j) => value - first.value * first.vector[i] * first.vector[j]));
    const second = dominantEigenpair(deflated, first.vector);
    const xScale = Math.sqrt(Math.max(first.value, 0));
    const yScale = Math.sqrt(Math.max(second.value, 0));
    return first.vector.map((value, index) => ({
      x: value * xScale,
      y: second.vector[index] * yScale,
    }));
  }
  function analysisRows() {
    const rows = [], excluded = [];
    participants.forEach((participant) => {
      const rounds = participantRounds(participant);
      if (rounds.length < ANALYSIS_ROUNDS) { excluded.push(participant); return; }
      const firstFive = rounds.slice(0, ANALYSIS_ROUNDS);
      const rtDeltas = [], accDeltas = [];
      for (let index = 1; index < firstFive.length; index += 1) {
        rtDeltas.push(firstFive[index].rtMean - firstFive[index - 1].rtMean);
        accDeltas.push(firstFive[index].accuracy - firstFive[index - 1].accuracy);
      }
      const firstRt = firstFive[0].rtMean;
      const firstAcc = firstFive[0].accuracy;
      const changeSequence = firstFive.map((round) => ({
        rt: firstRt - round.rtMean,
        acc: round.accuracy - firstAcc,
      }));
      const features = changeSequence.flatMap((point) => [point.rt, point.acc]);
      if (features.every(Number.isFinite)) rows.push({ participant, rounds: firstFive, rtDeltas, accDeltas, changeSequence, features });
      else excluded.push(participant);
    });
    return { rows, excluded };
  }
  function describeCluster(members) {
    const totalRtImprovement = mean(members.map((member) => member.changeSequence.at(-1)?.rt));
    const totalAccImprovement = mean(members.map((member) => member.changeSequence.at(-1)?.acc));
    const rtGainFrequency = mean(members.flatMap((member) => member.rtDeltas.map((delta) => delta < 0 ? 1 : 0)));
    const accGainFrequency = mean(members.flatMap((member) => member.accDeltas.map((delta) => delta > 0 ? 1 : 0)));
    const volatility = mean(members.flatMap((member) => [...member.rtDeltas.map(Math.abs), ...member.accDeltas.map((value) => Math.abs(value) * 8)]));
    if (totalRtImprovement > 0.5 && totalAccImprovement > 0.025) return "동반 개선 곡선형";
    if (totalRtImprovement > 0.5 && totalAccImprovement >= -0.01) return "속도 개선 곡선형";
    if (totalAccImprovement > 0.025 && totalRtImprovement >= -0.15) return "정확도 개선 곡선형";
    if (totalRtImprovement > 0.25 && totalAccImprovement < -0.015) return "속도-정확도 교환 곡선형";
    if (volatility > 0.55 || rtGainFrequency < 0.35 || accGainFrequency < 0.2) return "변동 곡선형";
    return "안정 곡선형";
  }
  function buildClusters(rows, assignments) {
    const raw = Array.from({ length: Math.max(...assignments) + 1 }, (_, index) => ({ index, members: [] }));
    rows.forEach((row, rowIndex) => raw[assignments[rowIndex]].members.push(row));
    return raw.filter((cluster) => cluster.members.length).map((cluster) => {
      const rtMeans = TRANSITIONS.map((_, index) => mean(cluster.members.map((member) => member.rtDeltas[index])));
      const accMeans = TRANSITIONS.map((_, index) => mean(cluster.members.map((member) => member.accDeltas[index])));
      const avgRt = mean(rtMeans), avgAcc = mean(accMeans);
      return { ...cluster, rtMeans, accMeans, avgRt, avgAcc, label: describeCluster(cluster.members) };
    }).sort((a, b) => a.avgRt - b.avgRt || b.avgAcc - a.avgAcc);
  }
  function groupRoundMeans(cluster) {
    return Array.from({ length: ANALYSIS_ROUNDS }, (_, roundIndex) => {
      const rounds = cluster.members.map((member) => member.rounds[roundIndex]).filter(Boolean);
      return {
        round: roundIndex + 1,
        rt: mean(rounds.map((round) => round.rtMean)),
        accuracy: mean(rounds.map((round) => round.accuracy)),
        trialCount: sum(rounds.map((round) => round.trialCount || 0)),
      };
    });
  }
  function renderManifoldMap() {
    const svg = els.manifoldMap;
    clear(svg);
    clear(els.manifoldLegend);
    if (!svg || !clusters.length) return;
    clusters.forEach((cluster, index) => {
      const item = document.createElement("span");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = "manifold-legend-dot";
      swatch.style.background = palette[index % palette.length];
      const text = document.createElement("span");
      text.textContent = `그룹 ${index + 1}`;
      item.append(swatch, text);
      els.manifoldLegend?.append(item);
    });
    const points = clusters.flatMap((cluster, clusterIndex) => cluster.members.map((member) => ({
      cluster,
      clusterIndex,
      member,
      x: member.embedding?.x,
      y: member.embedding?.y,
    }))).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!points.length) {
      svg.append(textNode("2D 지도를 계산할 수 없습니다.", { class: "empty-svg", x: 520, y: 280, "text-anchor": "middle" }));
      return;
    }
    const width = 1040, height = 560, left = 68, right = 42, top = 34, bottom = 62;
    const plotW = width - left - right, plotH = height - top - bottom;
    const [xMin, xMax] = extent(points.map((point) => point.x), [-1, 1], .16);
    const [yMin, yMax] = extent(points.map((point) => point.y), [-1, 1], .16);
    const x = (value) => left + ((value - xMin) / (xMax - xMin || 1)) * plotW;
    const y = (value) => top + ((yMax - value) / (yMax - yMin || 1)) * plotH;
    for (let i = 0; i <= 4; i += 1) {
      const gx = left + plotW * i / 4;
      const gy = top + plotH * i / 4;
      svg.append(makeSvg("line", { class: "grid-line", x1: gx, y1: top, x2: gx, y2: top + plotH }));
      svg.append(makeSvg("line", { class: "grid-line", x1: left, y1: gy, x2: left + plotW, y2: gy }));
    }
    if (xMin < 0 && xMax > 0) svg.append(makeSvg("line", { class: "axis-zero", x1: x(0), y1: top, x2: x(0), y2: top + plotH }));
    if (yMin < 0 && yMax > 0) svg.append(makeSvg("line", { class: "axis-zero", x1: left, y1: y(0), x2: left + plotW, y2: y(0) }));
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }));
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotH }));
    svg.append(textNode("MDS 1", { class: "axis-label", x: left + plotW / 2, y: height - 16, "text-anchor": "middle" }));
    svg.append(textNode("MDS 2", { class: "axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, "text-anchor": "middle" }));
    svg.append(textNode("축 자체보다 점 사이 거리와 색상별 군집을 보면 됩니다.", { class: "chart-hint", x: left + 8, y: top + 22 }));

    clusters.forEach((cluster, clusterIndex) => {
      const clusterPoints = points.filter((point) => point.clusterIndex === clusterIndex);
      if (!clusterPoints.length) return;
      const cx = mean(clusterPoints.map((point) => point.x));
      const cy = mean(clusterPoints.map((point) => point.y));
      const radius = Math.max(28, Math.sqrt(mean(clusterPoints.map((point) => (x(point.x) - x(cx)) ** 2 + (y(point.y) - y(cy)) ** 2))) + 18);
      svg.append(makeSvg("circle", {
        class: `manifold-cluster-halo${clusterIndex === selectedClusterIndex ? " is-selected" : ""}`,
        cx: x(cx),
        cy: y(cy),
        r: radius,
        fill: palette[clusterIndex % palette.length],
      }));
    });

    points.forEach((point) => {
      const isSelected = point.clusterIndex === selectedClusterIndex;
      const group = makeSvg("g", {
        class: `manifold-point${isSelected ? " is-selected" : ""}`,
        role: "button",
        tabindex: "0",
      });
      const title = makeSvg("title");
      title.textContent = `${point.member.participant.nickname || point.member.participant.id} · 그룹 ${point.clusterIndex + 1} · ${point.cluster.label}`;
      const dot = makeSvg("circle", {
        cx: x(point.x),
        cy: y(point.y),
        r: isSelected ? 7.2 : 5.4,
        fill: palette[point.clusterIndex % palette.length],
      });
      group.append(title, dot);
      group.addEventListener("click", () => {
        selectedClusterIndex = point.clusterIndex;
        showGroupAverage = true;
        selectedMemberIds = new Set([point.member.participant.id]);
        renderGroupSelector();
        renderSelectedGroup();
        renderManifoldMap();
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          group.dispatchEvent(new MouseEvent("click"));
        }
      });
      svg.append(group);
      if (isSelected) {
        svg.append(textNode(point.member.participant.nickname || point.member.participant.id, {
          class: "manifold-label",
          x: x(point.x) + 10,
          y: y(point.y) - 9,
        }));
      }
    });
  }
  function renderGroupStats(cluster) {
    const points = groupRoundMeans(cluster);
    els.groupSelectedRounds.textContent = fmtNum(ANALYSIS_ROUNDS, 2);
    els.groupSelectedRt.textContent = `${fmtNum(mean(points.map((point) => point.rt)), 2)}s`;
    els.groupSelectedAcc.textContent = fmtPct(mean(points.map((point) => point.accuracy)));
  }
  function renderGroupMemberControls(cluster) {
    clear(els.groupMemberControls);
    if (!els.groupMemberControls) return;
    const avgLabel = document.createElement("label");
    avgLabel.className = `member-filter-option${showGroupAverage ? " is-selected" : ""}`;
    const avgInput = document.createElement("input");
    avgInput.type = "checkbox";
    avgInput.checked = showGroupAverage;
    avgInput.addEventListener("change", () => {
      showGroupAverage = avgInput.checked;
      renderGroupArrowChart(cluster);
      renderGroupMemberControls(cluster);
    });
    const avgText = document.createElement("span");
    avgText.textContent = "그룹 평균";
    avgLabel.append(avgInput, avgText);
    els.groupMemberControls.append(avgLabel);

    cluster.members
      .slice()
      .sort((a, b) => (a.participant.nickname || a.participant.id).localeCompare(b.participant.nickname || b.participant.id, "ko"))
      .forEach((member) => {
        const id = member.participant.id;
        const label = document.createElement("label");
        label.className = `member-filter-option${selectedMemberIds.has(id) ? " is-selected" : ""}`;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = selectedMemberIds.has(id);
        input.addEventListener("change", () => {
          if (input.checked) selectedMemberIds.add(id);
          else selectedMemberIds.delete(id);
          renderGroupArrowChart(cluster);
          renderGroupMemberControls(cluster);
        });
        const text = document.createElement("span");
        text.textContent = member.participant.nickname || id;
        label.append(input, text);
        els.groupMemberControls.append(label);
      });
  }
  function renderGroupArrowChart(cluster) {
    const svg = els.groupArrowChart;
    clear(svg);
    const groupPoints = groupRoundMeans(cluster).filter((point) => Number.isFinite(point.rt) && Number.isFinite(point.accuracy));
    const memberSeries = cluster.members
      .filter((member) => selectedMemberIds.has(member.participant.id))
      .map((member) => ({
        member,
        points: member.rounds.map((round, index) => ({
          round: index + 1,
          rt: round.rtMean,
          accuracy: round.accuracy,
        })).filter((point) => Number.isFinite(point.rt) && Number.isFinite(point.accuracy)),
      }))
      .filter((series) => series.points.length);
    const allPoints = [
      ...(showGroupAverage ? groupPoints : []),
      ...memberSeries.flatMap((series) => series.points),
    ];
    if (!allPoints.length) {
      svg.append(textNode("그래프에 표시할 평균 또는 개인을 선택하세요.", { class: "empty-svg", x: 520, y: 250, "text-anchor": "middle" }));
      return;
    }
    const width = 1040, height = 500, left = 78, right = 36, top = 30, bottom = 62;
    const plotW = width - left - right, plotH = height - top - bottom;
    const [xMin, xMax] = extent(allPoints.map((point) => point.rt), [0, 8], .18);
    const [yMin, yMax] = boundedExtent(allPoints.map((point) => point.accuracy), [0, 1], .3, 0, 1, .05);
    const x = (value) => left + ((value - xMin) / (xMax - xMin || 1)) * plotW;
    const y = (value) => top + ((yMax - value) / (yMax - yMin || 1)) * plotH;
    for (let i = 0; i <= 5; i += 1) {
      const rt = xMin + (xMax - xMin) * i / 5;
      const acc = yMin + (yMax - yMin) * i / 5;
      svg.append(makeSvg("line", { class: "grid-line", x1: x(rt), y1: top, x2: x(rt), y2: top + plotH }));
      svg.append(makeSvg("line", { class: "grid-line", x1: left, y1: y(acc), x2: left + plotW, y2: y(acc) }));
      svg.append(textNode(rt.toFixed(1), { class: "tick-text", x: x(rt), y: top + plotH + 24, "text-anchor": "middle" }));
      svg.append(textNode(fmtPctTick(acc, yMax - yMin), { class: "tick-text", x: left - 10, y: y(acc) + 4, "text-anchor": "end" }));
    }
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }));
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotH }));
    svg.append(textNode("RT", { class: "axis-label", x: left + plotW / 2, y: height - 10, "text-anchor": "middle" }));
    svg.append(textNode("정답률", { class: "axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, "text-anchor": "middle" }));

    memberSeries.forEach((series) => {
      if (series.points.length >= 2) {
        svg.append(makeSvg("path", {
          class: "arrow-segment",
          d: series.points.map((point, index) => `${index ? "L" : "M"}${x(point.rt).toFixed(1)},${y(point.accuracy).toFixed(1)}`).join(" "),
          stroke: "#2563eb",
          "stroke-width": 1.15,
          "stroke-opacity": .46,
        }));
      }
      series.points.forEach((point) => {
        const dot = makeSvg("circle", { class: "arrow-dot", cx: x(point.rt), cy: y(point.accuracy), r: 3.2, fill: "#2563eb", "fill-opacity": .62 });
        const title = makeSvg("title");
        title.textContent = `${series.member.participant.nickname || series.member.participant.id} ${point.round}회차 · RT ${fmtNum(point.rt, 3)}s · ${fmtPct(point.accuracy)}`;
        dot.append(title);
        svg.append(dot);
        svg.append(textNode(String(point.round), { class: "round-label member-round-label", x: x(point.rt), y: y(point.accuracy) + 13, "text-anchor": "middle" }));
      });
    });

    if (showGroupAverage) {
      if (groupPoints.length >= 2) {
        svg.append(makeSvg("path", {
          class: "arrow-segment",
          d: groupPoints.map((point, index) => `${index ? "L" : "M"}${x(point.rt).toFixed(1)},${y(point.accuracy).toFixed(1)}`).join(" "),
          stroke: "#ef4444",
          "stroke-width": 1.8,
          "stroke-opacity": .98,
        }));
      }
      groupPoints.forEach((point) => {
        svg.append(makeSvg("circle", { class: "arrow-dot", cx: x(point.rt), cy: y(point.accuracy), r: 4.6, fill: "#ef4444", "fill-opacity": .98 }));
        svg.append(textNode(String(point.round), { class: "round-label", x: x(point.rt), y: y(point.accuracy) - 12, "text-anchor": "middle" }));
      });
    }
  }
  function renderGroupOverview(svg, cluster, metric) {
    clear(svg);
    const points = groupRoundMeans(cluster).map((point) => ({ round: point.round, value: point[metric] })).filter((point) => Number.isFinite(point.value));
    if (!points.length) return;
    const width = 720, height = 320, left = 66, right = 24, top = 24, bottom = 50;
    const plotW = width - left - right, plotH = height - top - bottom;
    const [yMin, yMax] = metric === "accuracy"
      ? boundedExtent(points.map((point) => point.value), [0, 1], .32, 0, 1, .05)
      : extent(points.map((point) => point.value), [0, 8]);
    const x = (round) => left + ((round - 1) / Math.max(1, ANALYSIS_ROUNDS - 1)) * plotW;
    const y = (value) => top + ((yMax - value) / (yMax - yMin || 1)) * plotH;
    for (let round = 1; round <= ANALYSIS_ROUNDS; round += 1) {
      svg.append(makeSvg("line", { class: "grid-line", x1: x(round), y1: top, x2: x(round), y2: top + plotH }));
      svg.append(textNode(String(round), { class: "tick-text", x: x(round), y: top + plotH + 24, "text-anchor": "middle" }));
    }
    for (let i = 0; i <= 4; i += 1) {
      const value = yMin + (yMax - yMin) * i / 4;
      svg.append(makeSvg("line", { class: "grid-line", x1: left, y1: y(value), x2: left + plotW, y2: y(value) }));
      svg.append(textNode(metric === "accuracy" ? fmtPctTick(value, yMax - yMin) : value.toFixed(1), { class: "tick-text", x: left - 9, y: y(value) + 4, "text-anchor": "end" }));
    }
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }));
    svg.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotH }));
    svg.append(textNode("차수", { class: "axis-label", x: left + plotW / 2, y: height - 10, "text-anchor": "middle" }));
    svg.append(textNode(metric === "accuracy" ? "정답률" : "RT", { class: "axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, "text-anchor": "middle" }));
    if (points.length >= 2) svg.append(makeSvg("path", { class: "series-line", d: points.map((point, index) => `${index ? "L" : "M"}${x(point.round).toFixed(1)},${y(point.value).toFixed(1)}`).join(" "), stroke: "#ef4444", "stroke-width": 1.7, "stroke-opacity": .96 }));
    points.forEach((point) => svg.append(makeSvg("circle", { cx: x(point.round), cy: y(point.value), r: 4.2, fill: "#ef4444", "fill-opacity": .96 })));
  }
  function renderGroupSelector() {
    clear(els.groupList);
    clusters.forEach((cluster, index) => {
      const label = document.createElement("label");
      label.className = `group-select-option${index === selectedClusterIndex ? " is-selected" : ""}`;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "groupSelection";
      input.checked = index === selectedClusterIndex;
      input.addEventListener("change", () => {
        selectedClusterIndex = index;
        showGroupAverage = true;
        selectedMemberIds = new Set();
        renderSelectedGroup();
        renderGroupSelector();
        renderManifoldMap();
      });
      const color = document.createElement("span");
      color.className = "group-select-color";
      color.style.background = palette[index % palette.length];
      const text = document.createElement("span");
      text.textContent = `그룹 ${index + 1} · ${cluster.label} · ${cluster.members.length}명`;
      label.append(input, color, text);
      els.groupList.append(label);
    });
  }
  function renderModel(cluster) {
    clear(els.groupModelChart);
    clear(els.groupModelEquations);
    const panels = [
      { label: "RT", key: "rt", format: (value) => value.toFixed(1), extent: null },
      { label: "Accuracy", key: "accuracy", format: (value) => fmtPctTick(value, 0), extent: (values) => boundedExtent(values, [0, 1], .32, 0, 1, .05) },
    ];
    const points = groupRoundMeans(cluster);
    panels.forEach((panel, panelIndex) => {
      const offset = panelIndex * 360;
      const left = offset + 54, top = 30, plotW = 288, plotH = 268;
      const values = points.map((point) => point[panel.key]).filter(Number.isFinite);
      const [yMin, yMax] = typeof panel.extent === "function" ? panel.extent(values) : panel.extent || extent(values, [0, 8]);
      const x = (round) => left + ((round - 1) / (ANALYSIS_ROUNDS - 1)) * plotW;
      const y = (value) => top + ((yMax - value) / (yMax - yMin || 1)) * plotH;
      for (let round = 1; round <= ANALYSIS_ROUNDS; round += 1) {
        els.groupModelChart.append(makeSvg("line", { class: "grid-line", x1: x(round), y1: top, x2: x(round), y2: top + plotH }));
        els.groupModelChart.append(textNode(String(round), { class: "tick-text", x: x(round), y: top + plotH + 20, "text-anchor": "middle" }));
      }
      const valid = points.filter((point) => Number.isFinite(point[panel.key]));
      if (valid.length >= 2) {
        els.groupModelChart.append(makeSvg("path", { class: "series-line", d: valid.map((point, index) => `${index ? "L" : "M"}${x(point.round).toFixed(1)},${y(point[panel.key]).toFixed(1)}`).join(" "), stroke: "#2563eb", "stroke-width": 1.7 }));
      }
      valid.forEach((point) => els.groupModelChart.append(makeSvg("circle", { cx: x(point.round), cy: y(point[panel.key]), r: 4.5, fill: "#ef4444", "fill-opacity": .9 })));
      els.groupModelChart.append(textNode(panel.label, { class: "axis-label", x: left + plotW / 2, y: 18, "text-anchor": "middle" }));
    });
    const first = points[0], last = points.at(-1);
    const rtLine = document.createElement("p");
    rtLine.className = "model-equation blue";
    rtLine.innerHTML = `<strong>RT 평균 변화</strong><code>${fmtNum(first.rt, 2)}s → ${fmtNum(last.rt, 2)}s (${fmtNum(last.rt - first.rt, 2)}s)</code>`;
    const accLine = document.createElement("p");
    accLine.innerHTML = `<strong>정답률 평균 변화</strong><code>${fmtPct(first.accuracy)} → ${fmtPct(last.accuracy)} (${fmtPctPoint(last.accuracy - first.accuracy)})</code>`;
    els.groupModelEquations.append(rtLine, accLine);
  }
  function aggregateConfusion(cluster, roundIndex) {
    const counts = { tp: 0, fn: 0, fp: 0, tn: 0, included: 0 };
    cluster.members.forEach((member) => {
      const confusion = member.rounds[roundIndex]?.confusion;
      if (!confusion) return;
      counts.tp += confusion.counts?.tp || 0;
      counts.fn += confusion.counts?.fn || 0;
      counts.fp += confusion.counts?.fp || 0;
      counts.tn += confusion.counts?.tn || 0;
      counts.included += confusion.included || 0;
    });
    return counts;
  }
  function appendConfusionCell(grid, label, count, included, tone) {
    const cell = document.createElement("div");
    cell.className = `confusion-matrix-cell ${tone}`;
    const labelNode = document.createElement("span");
    labelNode.className = "confusion-label";
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.className = "confusion-value";
    valueNode.textContent = `${count}개`;
    const percentNode = document.createElement("span");
    percentNode.className = "confusion-percent";
    percentNode.textContent = fmtPct(included ? count / included : NaN);
    cell.append(labelNode, valueNode, percentNode);
    grid.append(cell);
  }
  function renderConfusion(cluster) {
    clear(els.groupConfusionList);
    for (let roundIndex = 0; roundIndex < ANALYSIS_ROUNDS; roundIndex += 1) {
      const counts = aggregateConfusion(cluster, roundIndex);
      const card = document.createElement("article");
      card.className = "confusion-card";
      const heading = document.createElement("h3");
      heading.textContent = `${roundIndex + 1}회차 평균`;
      const meta = document.createElement("p");
      meta.className = "confusion-meta";
      meta.textContent = `정답률 ${fmtPct(counts.included ? (counts.tp + counts.tn) / counts.included : NaN)} · ${counts.included}응답`;
      const matrix = document.createElement("div");
      matrix.className = "confusion-matrix";
      ["", "응답 O", "응답 X", "정답 O"].forEach((text, index) => {
        const axis = document.createElement("div");
        axis.className = index === 0 ? "confusion-corner" : "confusion-axis";
        axis.textContent = text;
        matrix.append(axis);
      });
      appendConfusionCell(matrix, "맞음", counts.tp, counts.included, "correct");
      appendConfusionCell(matrix, "놓침", counts.fn, counts.included, "wrong");
      const xAxis = document.createElement("div");
      xAxis.className = "confusion-axis";
      xAxis.textContent = "정답 X";
      matrix.append(xAxis);
      appendConfusionCell(matrix, "오경보", counts.fp, counts.included, "wrong");
      appendConfusionCell(matrix, "맞음", counts.tn, counts.included, "correct");
      card.append(heading, meta, matrix);
      els.groupConfusionList.append(card);
    }
  }
  function roundCorrectnessCounts(cluster, roundIndex) {
    const counts = { correct: 0, wrong: 0, total: 0 };
    cluster.members.forEach((member) => {
      const round = member.rounds[roundIndex];
      const results = member.participant.itemResults?.[roundKey(round)] || {};
      commonItems.forEach((item) => {
        const bucket = correctnessBucket(results[item.id]);
        if (!bucket) return;
        counts.total += 1;
        if (bucket === "correct") counts.correct += 1;
        else counts.wrong += 1;
      });
    });
    return counts;
  }
  function transitionCounts(cluster, transitionIndex) {
    const counts = { wrongToCorrect: 0, wrongToWrong: 0, correctToCorrect: 0, correctToWrong: 0, compared: 0 };
    cluster.members.forEach((member) => {
      const prev = member.rounds[transitionIndex];
      const next = member.rounds[transitionIndex + 1];
      const prevResults = member.participant.itemResults?.[roundKey(prev)] || {};
      const nextResults = member.participant.itemResults?.[roundKey(next)] || {};
      commonItems.forEach((item) => {
        const previous = correctnessBucket(prevResults[item.id]);
        const following = correctnessBucket(nextResults[item.id]);
        if (!previous || !following) return;
        counts.compared += 1;
        if (previous === "wrong" && following === "correct") counts.wrongToCorrect += 1;
        else if (previous === "wrong" && following === "wrong") counts.wrongToWrong += 1;
        else if (previous === "correct" && following === "correct") counts.correctToCorrect += 1;
        else if (previous === "correct" && following === "wrong") counts.correctToWrong += 1;
      });
    });
    return counts;
  }
  function appendRoundSummary(container, label, counts) {
    const item = document.createElement("div");
    item.className = "transition-round-summary-item";
    const title = document.createElement("span");
    title.className = "transition-round-summary-title";
    title.textContent = label;
    const values = document.createElement("span");
    values.className = "transition-round-summary-values";
    values.innerHTML = `<strong class="green">${counts.correct} 정답</strong><strong class="red">${counts.wrong} 오답</strong>`;
    item.append(title, values);
    container.append(item);
  }
  function appendTransitionCell(grid, label, value, total, tone) {
    const cell = document.createElement("div");
    cell.className = `transition-cell ${tone}`;
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
  function renderTransitionLine(cluster) {
    clear(els.groupTransitionLineChart);
    const points = TRANSITIONS.map((label, index) => ({ label, ...transitionCounts(cluster, index) }));
    const width = 1040, height = 500, left = 78, right = 36, top = 30, bottom = 62;
    const plotW = width - left - right, plotH = height - top - bottom;
    const maxCount = Math.max(1, ...points.flatMap((point) => [point.wrongToWrong, point.correctToWrong]));
    const yMax = Math.max(4, Math.ceil(maxCount * 1.15));
    const x = (index) => left + (index / Math.max(1, points.length - 1)) * plotW;
    const y = (value) => top + ((yMax - value) / yMax) * plotH;
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = yMax * tick / 4;
      const yy = y(value);
      els.groupTransitionLineChart.append(makeSvg("line", { class: "grid-line", x1: left, y1: yy, x2: left + plotW, y2: yy }));
      els.groupTransitionLineChart.append(textNode(String(Math.round(value)), { class: "tick-text", x: left - 10, y: yy + 4, "text-anchor": "end" }));
    }
    points.forEach((point, index) => {
      const xx = x(index);
      els.groupTransitionLineChart.append(makeSvg("line", { class: "grid-line", x1: xx, y1: top, x2: xx, y2: top + plotH, "stroke-opacity": .55 }));
      els.groupTransitionLineChart.append(textNode(point.label, { class: "tick-text", x: xx, y: top + plotH + 24, "text-anchor": "middle" }));
    });
    els.groupTransitionLineChart.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }));
    els.groupTransitionLineChart.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotH }));
    els.groupTransitionLineChart.append(textNode("전환", { class: "axis-label", x: left + plotW / 2, y: height - 10, "text-anchor": "middle" }));
    els.groupTransitionLineChart.append(textNode("개수", { class: "axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, "text-anchor": "middle" }));
    function draw(key, color, dash = "") {
      const d = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
      els.groupTransitionLineChart.append(makeSvg("path", { class: "series-line", d, stroke: color, "stroke-width": 1.7, "stroke-dasharray": dash }));
      points.forEach((point, index) => els.groupTransitionLineChart.append(makeSvg("circle", { cx: x(index), cy: y(point[key]), r: 4.2, fill: color, "fill-opacity": .96 })));
    }
    draw("wrongToWrong", "#ef4444");
    draw("correctToWrong", "#f59e0b", "6 5");
  }
  function renderTransitions(cluster) {
    clear(els.groupTransitionList);
    const overview = document.createElement("div");
    overview.className = "transition-round-overview";
    for (let roundIndex = 0; roundIndex < ANALYSIS_ROUNDS; roundIndex += 1) {
      appendRoundSummary(overview, `${roundIndex + 1}회차`, roundCorrectnessCounts(cluster, roundIndex));
    }
    els.groupTransitionList.append(overview);
    TRANSITIONS.forEach((label, index) => {
      const counts = transitionCounts(cluster, index);
      const card = document.createElement("article");
      card.className = "transition-card";
      const heading = document.createElement("h3");
      heading.textContent = label;
      const meta = document.createElement("p");
      meta.className = "transition-meta";
      meta.textContent = `${counts.compared}응답 비교`;
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
      els.groupTransitionList.append(card);
    });
    renderTransitionLine(cluster);
  }
  function renderSelectedGroup() {
    const cluster = clusters[selectedClusterIndex] || clusters[0];
    if (!cluster) return;
    renderGroupStats(cluster);
    renderGroupMemberControls(cluster);
    renderGroupArrowChart(cluster);
    renderGroupOverview(els.groupRtOverviewChart, cluster, "rt");
    renderGroupOverview(els.groupAccuracyOverviewChart, cluster, "accuracy");
    els.selectedGroupTitle.textContent = `그룹 ${selectedClusterIndex + 1} · ${cluster.label}`;
    els.selectedGroupMeta.textContent = `${cluster.members.length}명 · 5회 기준 · 평균 RT 변화 ${fmtNum(cluster.avgRt, 3)}초 · 평균 정답률 변화 ${fmtPctPoint(cluster.avgAcc)}`;
    renderModel(cluster);
    renderConfusion(cluster);
    renderTransitions(cluster);
  }
  function init() {
    const { rows, excluded } = analysisRows();
    const k = Math.min(CLUSTER_TARGET, rows.length);
    els.clusterSummary.textContent = `5회 이상 제출자 ${rows.length}명 포함 · 5회 미만 ${excluded.length}명 제외 · baseline 변화 곡선 DTW(window=${DTW_WINDOW}) · 세부 군집 최소 ${MIN_CLUSTER_SIZE}명`;
    if (rows.length < 2) return;
    const dtwRows = prepareDtwRows(rows);
    const coordinates = classicalMds(pairwiseDtwDistances(dtwRows));
    dtwRows.forEach((row, index) => { row.embedding = coordinates[index] || { x: 0, y: 0 }; });
    const assignments = hierarchicalCluster(dtwRows, k);
    clusters = buildClusters(dtwRows, assignments);
    selectedClusterIndex = 0;
    renderGroupSelector();
    renderSelectedGroup();
    renderManifoldMap();
  }

  init();
})();
