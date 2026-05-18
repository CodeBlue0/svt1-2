(function () {
  const data = window.SVT_ARROW_DATA || { arrows: [], options: [], rtMax: 1, accuracyMin: 0, accuracyMax: 1 };
  data.arrows = data.arrows || data.pairs || [];
  data.options = data.options || data.arrows.filter((arrow) => arrow.nickname);
  const selected = new Set();
  let hoveredId = null;

  const chart = document.getElementById("chart");
  const nameList = document.getElementById("nameList");
  const nameSearch = document.getElementById("nameSearch");
  const clearSelection = document.getElementById("clearSelection");
  const selectionCount = document.getElementById("selectionCount");

  const width = 1100;
  const height = 760;
  const left = 92;
  const right = 40;
  const top = 74;
  const bottom = 86;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const rtMin = 0;
  const rtMax = data.rtMax || 1;
  const accuracyMin = data.accuracyMin ?? 0;
  const accuracyMax = data.accuracyMax ?? 1;
  const svgNS = "http://www.w3.org/2000/svg";

  function xPos(rt) {
    return left + ((rt - rtMin) / (rtMax - rtMin)) * plotWidth;
  }

  function yPos(accuracy) {
    return top + ((accuracyMax - accuracy) / (accuracyMax - accuracyMin)) * plotHeight;
  }

  function makeSvg(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function makeText(text, attrs = {}) {
    const node = makeSvg("text", attrs);
    node.textContent = text;
    return node;
  }

  function renderNameList() {
    const query = nameSearch.value.trim().toLowerCase();
    nameList.textContent = "";

    data.options
      .filter((option) => {
        const haystack = option.nickname.toLowerCase();
        return haystack.includes(query);
      })
      .forEach((option) => {
        const item = document.createElement("label");
        item.className = "name-item";
        item.addEventListener("mouseenter", () => {
          hoveredId = option.id;
          renderChart();
        });
        item.addEventListener("mouseleave", () => {
          if (hoveredId === option.id) {
            hoveredId = null;
            renderChart();
          }
        });
        item.addEventListener("focusin", () => {
          hoveredId = option.id;
          renderChart();
        });
        item.addEventListener("focusout", () => {
          if (hoveredId === option.id) {
            hoveredId = null;
            renderChart();
          }
        });

        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = selected.has(option.id);
        input.addEventListener("change", () => {
          if (input.checked) {
            selected.add(option.id);
          } else {
            selected.delete(option.id);
          }
          renderChart();
          updateSelectionCount();
        });

        const text = document.createElement("span");
        const primary = document.createElement("span");
        primary.className = "name-primary";
        primary.textContent = option.nickname;

        text.append(primary);
        item.append(input, text);
        nameList.append(item);
      });
  }

  function addMarkerDefs() {
    const defs = makeSvg("defs");
    [
      ["arrowhead-blue", "#2563eb"],
      ["arrowhead-red", "#dc2626"],
    ].forEach(([id, color]) => {
      const marker = makeSvg("marker", {
        id,
        markerWidth: 8,
        markerHeight: 6,
        refX: 7,
        refY: 3,
        orient: "auto",
        markerUnits: "strokeWidth",
      });
      marker.append(
        makeSvg("path", {
          d: "M0,0 L8,3 L0,6 Z",
          fill: color,
        }),
      );
      defs.append(marker);
    });
    chart.append(defs);
  }

  function addGrid() {
    const xStep = Math.max(1, Math.ceil(rtMax / 8));
    for (let tick = 0; tick <= rtMax; tick += xStep) {
      const x = xPos(tick);
      chart.append(makeSvg("line", { class: "grid-line", x1: x, y1: top, x2: x, y2: top + plotHeight }));
      chart.append(makeText(String(tick), { class: "tick-text", x, y: top + plotHeight + 24, "text-anchor": "middle" }));
    }

    [0, 0.2, 0.4, 0.6, 0.8, 1.0].forEach((tick) => {
      const y = yPos(tick);
      chart.append(makeSvg("line", { class: "grid-line", x1: left, y1: y, x2: left + plotWidth, y2: y }));
      chart.append(makeText(tick.toFixed(1), { class: "tick-text", x: left - 12, y: y + 4, "text-anchor": "end" }));
    });

    chart.append(makeSvg("line", { class: "axis-line", x1: left, y1: top + plotHeight, x2: left + plotWidth, y2: top + plotHeight }));
    chart.append(makeSvg("line", { class: "axis-line", x1: left, y1: top, x2: left, y2: top + plotHeight }));
    chart.append(makeText("평균 지연시간 RT (초)", { class: "axis-label", x: left + plotWidth / 2, y: height - 28, "text-anchor": "middle" }));
    chart.append(
      makeText("정답률", {
        class: "axis-label",
        transform: `translate(26 ${top + plotHeight / 2}) rotate(-90)`,
        "text-anchor": "middle",
      }),
    );
  }

  function renderChart() {
    chart.textContent = "";
    addMarkerDefs();
    addGrid();

    data.arrows.forEach((arrow) => {
      const isHighlighted = selected.has(arrow.id) || hoveredId === arrow.id;
      const color = isHighlighted ? "#dc2626" : "#2563eb";
      const marker = isHighlighted ? "arrowhead-red" : "arrowhead-blue";
      const line = makeSvg("line", {
        class: "arrow",
        x1: xPos(arrow.svt1.rt).toFixed(1),
        y1: yPos(arrow.svt1.accuracy).toFixed(1),
        x2: xPos(arrow.svt2.rt).toFixed(1),
        y2: yPos(arrow.svt2.accuracy).toFixed(1),
        stroke: color,
        "stroke-width": isHighlighted ? "1.15" : "0.85",
        "stroke-opacity": isHighlighted ? "0.92" : "0.66",
        "marker-end": `url(#${marker})`,
      });
      const title = makeSvg("title");
      title.textContent = `svt_1(${arrow.svt1.rt.toFixed(3)}, ${arrow.svt1.accuracy.toFixed(3)}) → svt_2(${arrow.svt2.rt.toFixed(3)}, ${arrow.svt2.accuracy.toFixed(3)})`;
      line.append(title);
      chart.append(line);
    });
  }

  function updateSelectionCount() {
    selectionCount.textContent = `${selected.size} 선택`;
  }

  nameSearch.addEventListener("input", renderNameList);
  clearSelection.addEventListener("click", () => {
    selected.clear();
    renderNameList();
    renderChart();
    updateSelectionCount();
  });

  renderNameList();
  renderChart();
  updateSelectionCount();
})();
