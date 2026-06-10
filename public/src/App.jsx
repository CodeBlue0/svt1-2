import React, { createElement as h, useEffect, useMemo, useRef, useState } from "react";
  const FALLBACK_DATA_SCRIPT = "./total-results/data.js";
  const CHART = { width: 990, height: 504, left: 74, right: 36, top: 32, bottom: 61 };
  const SCRIPT_LOADS = new Map();
  const MOVING_AVERAGE_WINDOW = 3;
  const ANALYSIS_COURSE_ORDER = ["rt-accuracy", "forecast", "ox", "change", "item-map", "item-map-full", "summary"];
  const VALID_FILE_EXTENSIONS = [".xlsx", ".csv", ".numbers"];
  const PAGE_SIZE = 1000;
  const EXPORT_CONFIG = {
    SVT: {
      table: "svt_trials",
      headers: [
        "student_id", "participant_id", "age", "nationality", "dominant_hand", "current_education",
        "task", "condition_group", "session_phase", "list_id", "session_number", "session_id",
        "trial_index", "stimulus_id", "phrase_type", "response", "correct", "rt", "timestamp",
        "item_category", "statement", "correct_answer", "response_key", "response_key_setting",
        "response_key_mapping", "date", "expName", "psychopyVersion",
      ],
    },
    MAZE: {
      table: "maze_trials",
      headers: [
        "student_id", "participant_id", "age", "nationality", "dominant_hand", "current_education",
        "task", "condition_group", "session_phase", "list_id", "session_number", "session_id",
        "trial_index", "stimulus_id", "phrase_type", "response", "correct", "rt", "response_time",
        "response_key_setting", "response_key_mapping", "timestamp", "block_order", "korean_phrase",
        "english_phrase", "step_index", "prefix", "correct_word", "distractor_word", "foil_phrase",
        "foil_replaced_position", "foil_word", "left_choice", "right_choice", "response_key",
        "selected_word", "selected_phrase", "attempt", "rsvp_word_duration", "rsvp_blank_duration",
        "date", "expName", "psychopyVersion",
      ],
    },
  };
  const EXPORT_COLUMN_MAP = {
    timestamp: "event_timestamp",
    date: "experiment_datetime",
    expName: "exp_name",
    psychopyVersion: "psychopy_version",
  };
  const EXPORT_PROFILE_HEADERS = [
    "student_id",
    "participant_id",
    "age",
    "nationality",
    "dominant_hand",
    "current_education",
  ];
  const FIXED_DECIMAL_COLUMNS = new Set(["rt", "response_time", "rsvp_word_duration", "rsvp_blank_duration"]);
  let totalResultsPrefetchPromise = null;
  const FALLBACK_FILES = [
    {
      id: "fallback-svt",
      type: "SVT",
      round: 1,
      title: "SVT 제출현황 통합 파일",
      status: "ready",
      sortDate: Date.parse("2026-06-09T00:00:00"),
      dateLabel: "2026. 6. 9.",
      downloadUrl: "./files/svt-submissions.xlsx",
    },
    {
      id: "fallback-maze",
      type: "MAZE",
      round: 1,
      title: "MAZE 제출현황 통합 파일",
      status: "ready",
      sortDate: Date.parse("2026-06-09T00:00:00"),
      dateLabel: "2026. 6. 9.",
      downloadUrl: "./files/maze-submissions.xlsx",
    },
  ];

  function configuredSupabase() {
    const config = window.SVT_SUPABASE_CONFIG || {};
    return Boolean(config.url && config.anonKey && window.supabase?.createClient);
  }

  function prefetchTotalResults() {
    if (totalResultsPrefetchPromise) return totalResultsPrefetchPromise;
    const warmCache = (url) => fetch(url, { cache: "force-cache" }).catch(() => null);
    totalResultsPrefetchPromise = Promise.allSettled([
      warmCache("./total-results/index.html"),
      warmCache("./total-results/data.js"),
    ]);
    return totalResultsPrefetchPromise;
  }

  function normalizeParticipant(row) {
    const config = window.SVT_SUPABASE_CONFIG || {};
    const displayColumn = config.participantDisplayColumn || "participant";
    const keyColumn = config.participantKeyColumn || config.participantIdColumn || displayColumn;
    const studentIdColumn = config.participantStudentIdColumn || "student_id";
    const aliasesColumn = config.participantAliasesColumn || "aliases";
    const aliases = Array.isArray(row[aliasesColumn])
      ? row[aliasesColumn].map((alias) => String(alias || "").trim()).filter(Boolean)
      : [];
    const nicknameValue = aliases[0] || row[displayColumn] || row.participant || row.nickname || row.participant_id || "";
    const studentId = row[studentIdColumn] || row.student_id || "";
    const displayName = nicknameValue || studentId;
    const participantKey = row[keyColumn] || studentId || nicknameValue;
    return {
      id: String(participantKey || displayName),
      displayName: String(displayName || participantKey),
      participantKey: String(participantKey || displayName),
      aliases,
      studentId: String(studentId || ""),
    };
  }

  function expandAliasVariants(aliases) {
    const values = new Set();
    (aliases || []).forEach((alias) => {
      const trimmed = String(alias || "").trim();
      if (!trimmed) return;
      [
        trimmed,
        trimmed.toLowerCase(),
        trimmed.replace(/_/g, " "),
        trimmed.replace(/\s+/g, "_"),
      ].forEach((value) => {
        const clean = String(value || "").trim();
        if (clean) values.add(clean);
        if (clean) values.add(clean.toLowerCase());
      });
    });
    return Array.from(values);
  }

  function normalizeExperimentFile(row, client, config) {
    const typeSource = `${row[config.fileTaskColumn] || row.experiment_type || row.type || row.kind || row.task || ""}`.toUpperCase();
    const round = Number(row.round || row.attempt_index || row.attempt || row.session || 1);
    const dateValue = row[config.fileDateColumn] || row.file_date || row.test_date || row.date || "";
    const parsedDate = parseDateValue(dateValue, "", row[config.fileLoadedAtColumn] || row.loaded_at || row.created_at);
    return {
      id: String(row.id || row.file_id || `${row.participant || ""}-${typeSource || "experiment"}-${dateValue || ""}`),
      manifestId: row.id || row.manifest_id || "",
      participantKey: row[config.fileParticipantColumn] || row.participant || "",
      type: typeSource.includes("MAZE") ? "MAZE" : "SVT",
      round: Number.isFinite(round) ? round : 1,
      status: row.status || "ready",
      sortDate: parsedDate.timestamp,
      dateLabel: parsedDate.label,
      downloadUrl: "",
    };
  }

  function parseDateValue(dateValue, fallbackText, fallbackDate) {
    const dateText = String(dateValue || "");
    const timestampText = dateText.includes("T") || dateText.includes(" ")
      ? dateText
      : `${dateText}T00:00:00`;
    const normalizedDate = dateText && dateText !== "undated" ? Date.parse(timestampText) : NaN;
    if (Number.isFinite(normalizedDate)) {
      return { timestamp: normalizedDate, label: formatDateLabel(normalizedDate) };
    }
    const parsedFromText = parseDateFromText(fallbackText);
    if (parsedFromText) return parsedFromText;
    const parsedFallback = fallbackDate ? Date.parse(fallbackDate) : NaN;
    if (Number.isFinite(parsedFallback)) {
      return { timestamp: parsedFallback, label: formatDateLabel(parsedFallback) };
    }
    return { timestamp: Number.MAX_SAFE_INTEGER, label: "날짜 미확인" };
  }

  function parseDateFromText(text) {
    const match = String(text || "").match(/(20\d{2})[-_. ]?(0?[1-9]|1[0-2])[-_. ]?(0?[1-9]|[12]\d|3[01])/);
    if (!match) return null;
    const [, year, month, day] = match;
    const timestamp = Date.parse(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`);
    return Number.isFinite(timestamp) ? { timestamp, label: formatDateLabel(timestamp) } : null;
  }

  function formatDateForFileName(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp === Number.MAX_SAFE_INTEGER) return "undated";
    const date = new Date(timestamp);
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function sanitizeFileNamePart(value, fallback) {
    return String(value || fallback)
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/_+/g, "-")
      || fallback;
  }

  function experimentFileName(nickname, file) {
    const cleanNickname = sanitizeFileNamePart(nickname, "nickname");
    const date = formatDateForFileName(file?.sortDate);
    const type = sanitizeFileNamePart(file?.type || "experiment", "experiment").toUpperCase();
    return `${cleanNickname}_${date}_${type}.csv`;
  }

  function analysisLinkFor(type, participantKey) {
    const params = new URLSearchParams();
    if (type === "MAZE") params.set("dataset", "maze");
    if (participantKey) params.set("participant", participantKey);
    const query = params.toString();
    return `./total-results/${query ? `?${query}` : ""}`;
  }

  function fileExtension(fileName) {
    const dotIndex = fileName.lastIndexOf(".");
    return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
  }

  function parseFileDate(file) {
    const name = file.name;
    const dashed = name.match(/(20\d{2})[-_. ]?(0?[1-9]|1[0-2])[-_. ]?(0?[1-9]|[12]\d|3[01])/);
    if (dashed) {
      const [, year, month, day] = dashed;
      const timestamp = Date.parse(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`);
      if (Number.isFinite(timestamp)) {
        return { timestamp, label: formatDateLabel(timestamp), source: "파일명 날짜" };
      }
    }
    const modified = file.lastModified || Date.now();
    return { timestamp: modified, label: formatDateLabel(modified), source: "파일 수정일" };
  }

  function formatDateLabel(timestamp) {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "numeric", day: "numeric" }).format(timestamp);
  }

  function uploadStepsFor(file, cleanName) {
    const extension = fileExtension(file.name);
    const formatOk = VALID_FILE_EXTENSIONS.includes(extension);
    const parsedDate = parseFileDate(file);
    const nameOk = file.name.toLowerCase().includes(cleanName.toLowerCase());
    return {
      formatOk,
      parsedDate,
      steps: [
        {
          id: "format",
          label: "파일 형식 확인",
          detail: formatOk ? `${extension.replace(".", "").toUpperCase()} 형식입니다.` : "xlsx, csv, numbers 파일만 추가할 수 있습니다.",
        },
        {
          id: "identity",
          label: "날짜와 별명 확인",
          detail: nameOk
            ? `${parsedDate.label} · ${cleanName} 별명을 확인했습니다.`
            : `${parsedDate.label} · 별명은 파일명에서 찾지 못해 현재 닉네임으로 연결합니다.`,
        },
        {
          id: "order",
          label: "날짜 순서 배치",
          detail: `${parsedDate.source} 기준으로 올바른 위치에 넣습니다.`,
        },
      ],
    };
  }

  function loadScriptOnce(src) {
    if (SCRIPT_LOADS.has(src)) return SCRIPT_LOADS.get(src);
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") return Promise.resolve();
    const promise = new Promise((resolve, reject) => {
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = reject;
      document.body.append(script);
    });
    SCRIPT_LOADS.set(src, promise);
    return promise;
  }

  async function loadDashboardData() {
    await loadScriptOnce(FALLBACK_DATA_SCRIPT);
    return window.SVT_DASHBOARD_DATA || { participants: [], rounds: [] };
  }

  function participantRounds(participant) {
    return Object.values(participant?.rounds || {})
      .sort((a, b) => (a.attemptIndex || a.round || 0) - (b.attemptIndex || b.round || 0));
  }

  function arrowSeries(participant) {
    return participantRounds(participant)
      .map((round) => {
        const rt = Number(round?.rtMean);
        const accuracy = Number(round?.accuracy);
        if (!Number.isFinite(rt) || !Number.isFinite(accuracy)) return null;
        return {
          round: round.attemptIndex || round.round,
          rt,
          accuracy,
          trialCount: round.trialCount || 0,
        };
      })
      .filter(Boolean);
  }

  function mean(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : NaN;
  }

  function movingAverage(values, windowSize = MOVING_AVERAGE_WINDOW) {
    return values.map((_, index) => {
      const start = Math.max(0, index - windowSize + 1);
      return mean(values.slice(start, index + 1));
    });
  }

  function extent(values, fallback = [0, 1], padRatio = 0.1) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return fallback;
    let min = Math.min(...clean);
    let max = Math.max(...clean);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * padRatio;
    return [Math.max(0, min - pad), max + pad];
  }

  function formatSeconds(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}초` : "-";
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
  }

  function participantTokenVariants(value) {
    return expandAliasVariants([value]).map((token) => token.toLowerCase());
  }

  function participantMatches(participant, values) {
    const haystack = new Set([
      ...participantTokenVariants(participant?.id),
      ...participantTokenVariants(participant?.nickname),
      ...participantTokenVariants(participant?.idSource),
    ]);
    return values.some((value) => participantTokenVariants(value).some((token) => haystack.has(token)));
  }

  function findDashboardParticipant(data, submittedName, participantKey) {
    const participants = data?.participants || [];
    const values = [participantKey, submittedName];
    return participants.find((participant) => participantMatches(participant, values)) || null;
  }

  function averageArrowSeries(data) {
    const participants = data?.participants || [];
    const maxRound = Math.max(1, ...(data?.rounds || []).map((round) => round.round || 0), ...participants.map((participant) => participantRounds(participant).length));
    return Array.from({ length: maxRound }, (_, index) => index + 1)
      .map((roundNumber) => {
        const points = participants
          .map(arrowSeries)
          .map((series) => series.find((point) => point.round === roundNumber))
          .filter(Boolean);
        const rt = mean(points.map((point) => point.rt));
        const accuracy = mean(points.map((point) => point.accuracy));
        return Number.isFinite(rt) && Number.isFinite(accuracy)
          ? { round: roundNumber, rt, accuracy, n: points.length }
          : null;
      })
      .filter(Boolean);
  }

  function roundOptionsFor(participant) {
    const rounds = arrowSeries(participant)
      .map((point) => String(point.round))
      .filter(Boolean);
    return ["all", ...Array.from(new Set(rounds))];
  }

  function linePath(points, x, y) {
    return points.map((point, index) => `${index ? "L" : "M"}${x(point.rt).toFixed(1)},${y(point.accuracy).toFixed(1)}`).join(" ");
  }

  function linePathBy(points, x, y, valueKey) {
    return points.map((point, index) => `${index ? "L" : "M"}${x(point.round).toFixed(1)},${y(point[valueKey]).toFixed(1)}`).join(" ");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function roundFloat(value, digits = 6) {
    if (!Number.isFinite(value)) return value;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function solveLinearSystem(matrix, vector) {
    const n = vector.length;
    const augmented = matrix.map((row, index) => [...row, vector[index]]);
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < n; row += 1) {
        if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
      }
      if (Math.abs(augmented[pivot][col]) < 1e-12) return null;
      [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
      const divisor = augmented[col][col];
      for (let index = col; index <= n; index += 1) augmented[col][index] /= divisor;
      for (let row = 0; row < n; row += 1) {
        if (row === col) continue;
        const factor = augmented[row][col];
        for (let index = col; index <= n; index += 1) augmented[row][index] -= factor * augmented[col][index];
      }
    }
    return augmented.map((row) => row[n]);
  }

  function linearFeatureFit(features, yValues) {
    const n = features[0]?.length || 0;
    if (!n || features.length !== yValues.length) return null;
    const xtx = Array.from({ length: n }, () => Array(n).fill(0));
    const xty = Array(n).fill(0);
    features.forEach((row, rowIndex) => {
      row.forEach((left, i) => {
        xty[i] += left * yValues[rowIndex];
        row.forEach((right, j) => {
          xtx[i][j] += left * right;
        });
      });
    });
    const coefficients = solveLinearSystem(xtx, xty);
    if (!coefficients) return null;
    const predictions = features.map((row) => row.reduce((sum, value, index) => sum + value * coefficients[index], 0));
    const avgY = mean(yValues);
    const ssTot = yValues.reduce((sum, value) => sum + (value - avgY) ** 2, 0);
    const ssRes = yValues.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
    return { coefficients, r2: ssTot === 0 ? 1 : Math.max(-1, 1 - ssRes / ssTot) };
  }

  function fitWebExponentialModel(points, metric, maxRoundOverride) {
    const clean = points
      .map((point) => ({ x: Number(point.round), y: Number(point[metric]) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (clean.length < 3) return null;
    const xs = clean.map((point) => point.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (minX === maxX) return null;
    const sampleMax = Number.isFinite(maxRoundOverride) ? maxRoundOverride : maxX;
    const sampleXs = Array.from({ length: 25 }, (_, index) => minX + (sampleMax - minX) * index / 24);
    const yValues = clean.map((point) => point.y);
    let best = null;
    for (let step = 1; step <= 120; step += 1) {
      const decay = step / 50;
      const features = clean.map((point) => [1, Math.exp(-decay * point.x)]);
      const fit = linearFeatureFit(features, yValues);
      if (!fit) continue;
      if (!best || fit.r2 > best.r2) {
        const [offset, amplitude] = fit.coefficients;
        best = { offset, amplitude, decay, r2: fit.r2 };
      }
    }
    if (!best) return null;
    const predict = (xValue) => best.offset + best.amplitude * Math.exp(-best.decay * xValue);
    return {
      coefficients: [roundFloat(best.offset), roundFloat(best.amplitude), roundFloat(best.decay)],
      r2: roundFloat(best.r2, 4),
      predict,
      points: sampleXs.map((xValue) => ({ round: roundFloat(xValue, 3), value: roundFloat(predict(xValue)) })),
    };
  }

  function webExponentialEquation(model) {
    const coeffs = model?.coefficients || [];
    if (coeffs.length < 3) return "계산 불가";
    const offset = Number.isFinite(coeffs[0]) ? coeffs[0].toFixed(3) : "0.000";
    const sign = coeffs[1] < 0 ? "−" : "+";
    const amplitude = Number.isFinite(coeffs[1]) ? Math.abs(coeffs[1]).toFixed(3) : "0.000";
    const decay = Number.isFinite(coeffs[2]) ? Math.abs(coeffs[2]).toFixed(3) : "0.000";
    const r2 = Number.isFinite(model?.r2) ? ` · R²=${model.r2.toFixed(3)}` : "";
    return `y = ${offset} ${sign} ${amplitude}e^(−${decay}x)${r2}`;
  }

  function predictWebExponential(model, round) {
    const coeffs = model?.coefficients || [];
    if (coeffs.length < 3) return NaN;
    const [offset, amplitude, decay] = coeffs.map(Number);
    if (![offset, amplitude, decay, round].every(Number.isFinite)) return NaN;
    return offset + amplitude * Math.exp(-decay * round);
  }

  function exponentialForecast(series, metric, participant) {
    const points = series
      .map((point) => ({
        round: Number(point.round),
        value: Number(point[metric]),
      }))
      .filter((point) => Number.isFinite(point.round) && Number.isFinite(point.value) && point.value > 0)
      .sort((a, b) => a.round - b.round);
    const last = points[points.length - 1] || null;
    const nextRound = (last?.round || 0) + 1;
    const modelKey = metric === "rt" ? "rtByRound" : "accuracyByRound";
    const existingModel = participant?.models?.[modelKey]?.models?.exponential || null;
    const webModel = existingModel || fitWebExponentialModel(series, metric, nextRound);
    if (webModel) {
      const fitted = (webModel.points || []).map((point) => ({
        round: Number(point.round ?? point.x),
        value: metric === "accuracy" ? clamp(Number(point.value ?? point.y), 0, 1) : Math.max(0, Number(point.value ?? point.y)),
      })).filter((point) => Number.isFinite(point.round) && Number.isFinite(point.value));
      const rawNext = webModel.predict
        ? webModel.predict(nextRound)
        : predictWebExponential(webModel, nextRound);
      const decay = Number(webModel.coefficients?.[2]);
      return {
        nextRound,
        nextValue: metric === "accuracy" ? clamp(rawNext, 0, 1) : Math.max(0, rawNext),
        fitted,
        slope: Number.isFinite(decay) ? -decay : 0,
        trendPercent: Number.isFinite(decay) ? (Math.exp(-decay) - 1) * 100 : 0,
        enoughData: true,
        equation: webExponentialEquation(webModel),
      };
    }
    if (points.length < 2) {
      const value = metric === "accuracy" ? clamp(last?.value || 0, 0, 1) : Math.max(0, last?.value || 0);
      return {
        nextRound,
        nextValue: value,
        fitted: points,
        slope: 0,
        trendPercent: 0,
        enoughData: false,
        equation: "계산 불가",
      };
    }
    return {
      nextRound,
      nextValue: metric === "accuracy" ? clamp(last?.value || 0, 0, 1) : Math.max(0, last?.value || 0),
      fitted: [],
      slope: 0,
      trendPercent: 0,
      enoughData: false,
      equation: "계산 불가",
    };
  }

  function distributionValueFor(participant, metric, selectedRound) {
    const series = arrowSeries(participant);
    if (selectedRound !== "all") {
      const point = series.find((item) => String(item.round) === String(selectedRound));
      return metric === "rt" ? point?.rt : point?.accuracy;
    }
    return mean(series.map((point) => metric === "rt" ? point.rt : point.accuracy));
  }

  function renderDistributionChart(title, metric, participants, participant, selectedRound) {
    const width = 480;
    const height = 294;
    const left = 44;
    const right = 24;
    const top = 40;
    const bottom = 44;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const values = participants
      .map((person) => distributionValueFor(person, metric, selectedRound))
      .filter(Number.isFinite);
    const personalValue = distributionValueFor(participant, metric, selectedRound);
    const [xMin, xMax] = metric === "accuracy" ? [0, 1] : extent(values, [0, 8], 0.16);
    const bucketCount = 14;
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      index,
      count: 0,
      from: xMin + (xMax - xMin) * index / bucketCount,
      to: xMin + (xMax - xMin) * (index + 1) / bucketCount,
    }));
    values.forEach((value) => {
      const rawIndex = Math.floor(((value - xMin) / (xMax - xMin || 1)) * bucketCount);
      const index = Math.max(0, Math.min(bucketCount - 1, rawIndex));
      buckets[index].count += 1;
    });
    const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
    const x = (value) => metric === "accuracy"
      ? left + ((xMax - value) / (xMax - xMin || 1)) * plotW
      : left + ((value - xMin) / (xMax - xMin || 1)) * plotW;
    const y = (count) => top + plotH - (count / maxCount) * plotH;
    const ticks = metric === "accuracy"
      ? [1, 0.75, 0.5, 0.25, 0]
      : Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4);
    const personalX = Number.isFinite(personalValue) ? x(personalValue) : null;
    const averageValue = mean(values);
    const averageX = Number.isFinite(averageValue) ? x(averageValue) : null;
    const format = metric === "accuracy" ? formatPercent : formatSeconds;
    const curvePoints = buckets.map((bucket) => ({
      x: x((bucket.from + bucket.to) / 2),
      y: y(bucket.count),
    }));
    const baseline = top + plotH;
    function smoothPath(points) {
      if (!points.length) return "";
      if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
      return points.reduce((path, point, index) => {
        if (index === 0) return `M${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        const previous = points[index - 1];
        const midX = (previous.x + point.x) / 2;
        const midY = (previous.y + point.y) / 2;
        return `${path} Q${previous.x.toFixed(1)},${previous.y.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
      }, "") + ` T${points[points.length - 1].x.toFixed(1)},${points[points.length - 1].y.toFixed(1)}`;
    }
    const curvePath = smoothPath(curvePoints);
    const areaPath = curvePoints.length
      ? `M${curvePoints[0].x.toFixed(1)},${baseline} L${curvePoints[0].x.toFixed(1)},${curvePoints[0].y.toFixed(1)} ${curvePath.slice(1)} L${curvePoints[curvePoints.length - 1].x.toFixed(1)},${baseline} Z`
      : "";

    return h("article", { className: "distribution-card" },
      h("div", { className: "distribution-card-heading" },
        h("h4", null, title),
        h("span", null, Number.isFinite(personalValue) ? `나 ${format(personalValue)}` : "나 -")
      ),
      h("svg", { className: "distribution-chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${title} 분포 그래프` },
        ticks.map((tick) => h("g", { key: `${metric}-tick-${tick}` },
          h("line", { className: "guide-grid", x1: x(tick), y1: top, x2: x(tick), y2: top + plotH }),
          h("text", { className: "guide-tick", x: x(tick), y: height - 14, textAnchor: "middle" }, metric === "accuracy" ? `${Math.round(tick * 100)}%` : tick.toFixed(1))
        )),
        h("line", { className: "guide-axis", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }),
        h("line", { className: "guide-axis", x1: left, y1: top, x2: left, y2: top + plotH }),
        areaPath && h("path", { className: "distribution-area", d: areaPath }),
        curvePath && h("path", { className: "distribution-curve", d: curvePath }),
        averageX !== null && h("line", {
          className: "distribution-average-line",
          x1: averageX,
          y1: top - 8,
          x2: averageX,
          y2: top + plotH + 8,
        }),
        personalX !== null && h("line", {
          className: "distribution-personal-line",
          x1: personalX,
          y1: top - 8,
          x2: personalX,
          y2: top + plotH + 8,
        }),
        personalX !== null && h("circle", {
          className: "distribution-personal-dot",
          cx: personalX,
          cy: top + plotH,
          r: 5.5,
        })
      )
    );
  }

  function renderForecastMetricChart(title, metric, series, forecast) {
    const width = 480;
    const height = 306;
    const left = 54;
    const right = 24;
    const top = 34;
    const bottom = 48;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const actualPoints = series
      .map((point) => ({ round: Number(point.round), value: Number(point[metric]) }))
      .filter((point) => Number.isFinite(point.round) && Number.isFinite(point.value));
    const nextPoint = { round: forecast.nextRound, value: forecast.nextValue };
    const fittedWithPrediction = [...(forecast.fitted || []), nextPoint]
      .filter((point) => Number.isFinite(point.round) && Number.isFinite(point.value))
      .reduce((points, point) => {
        const existingIndex = points.findIndex((item) => item.round === point.round);
        if (existingIndex >= 0) points[existingIndex] = point;
        else points.push(point);
        return points;
      }, [])
      .sort((a, b) => a.round - b.round);
    const valueDomain = metric === "accuracy"
      ? [0, 1]
      : extent([...actualPoints, ...fittedWithPrediction, nextPoint].map((point) => point.value), [0, 8], 0.18);
    const roundDomain = extent([...actualPoints, ...fittedWithPrediction, nextPoint].map((point) => point.round), [1, forecast.nextRound || 2], 0.08);
    const x = (value) => left + ((value - roundDomain[0]) / (roundDomain[1] - roundDomain[0] || 1)) * plotW;
    const y = (value) => top + ((valueDomain[1] - value) / (valueDomain[1] - valueDomain[0] || 1)) * plotH;
    const xTicks = Array.from(new Set([...actualPoints.map((point) => point.round), forecast.nextRound]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const yTicks = metric === "accuracy"
      ? [0, 0.25, 0.5, 0.75, 1]
      : Array.from({ length: 5 }, (_, index) => valueDomain[0] + (valueDomain[1] - valueDomain[0]) * index / 4);
    const format = metric === "accuracy" ? formatPercent : formatSeconds;

    return h("article", { className: "forecast-metric" },
      h("div", { className: "forecast-metric-heading" },
        h("h4", null, title),
        h("span", null, `${forecast.nextRound}회 예측 ${format(forecast.nextValue)}`)
      ),
      h("svg", { className: "forecast-chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${title} 지수 추세 예측 그래프` },
        yTicks.map((tick) => h("g", { key: `${metric}-y-${tick}` },
          h("line", { className: "guide-grid", x1: left, y1: y(tick), x2: left + plotW, y2: y(tick) }),
          h("text", { className: "guide-tick", x: left - 9, y: y(tick) + 4, textAnchor: "end" }, metric === "accuracy" ? `${Math.round(tick * 100)}%` : tick.toFixed(1))
        )),
        xTicks.map((tick) => h("g", { key: `${metric}-x-${tick}` },
          h("line", { className: "guide-grid", x1: x(tick), y1: top, x2: x(tick), y2: top + plotH }),
          h("text", { className: "guide-tick", x: x(tick), y: height - 14, textAnchor: "middle" }, `${tick}회`)
        )),
        h("line", { className: "guide-axis", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }),
        h("line", { className: "guide-axis", x1: left, y1: top, x2: left, y2: top + plotH }),
        actualPoints.length > 1 && h("path", {
          className: "forecast-actual-line",
          d: linePathBy(actualPoints, x, y, "value"),
        }),
        fittedWithPrediction.length > 1 && h("path", {
          className: "forecast-trend-line",
          d: linePathBy(fittedWithPrediction, x, y, "value"),
        }),
        actualPoints.map((point) => h("circle", {
          key: `${metric}-actual-${point.round}`,
          className: "forecast-actual-dot",
          cx: x(point.round),
          cy: y(point.value),
          r: 4.2,
        })),
        h("circle", {
          className: "forecast-prediction-dot",
          cx: x(nextPoint.round),
          cy: y(nextPoint.value),
          r: 6.2,
        }),
        h("text", {
          className: "forecast-prediction-label",
          x: x(nextPoint.round),
          y: Math.max(18, y(nextPoint.value) - 14),
          textAnchor: "middle",
        }, "예측")
      ),
      h("div", { className: "model-equations" },
        h("p", { className: metric === "rt" ? "model-equation blue" : "model-equation green" },
          h("strong", null, `${title} 지수`),
          h("code", null, forecast.equation || "계산 불가")
        )
      )
    );
  }

  function buildForecastExplanation(series, rtForecast, accuracyForecast) {
    if (!series.length) return "다음 회차를 예측할 데이터가 아직 충분하지 않습니다.";
    const last = series[series.length - 1];
    const rtTrend = rtForecast.trendPercent < -1
      ? "반응시간은 회차가 지날수록 짧아지는 추세"
      : rtForecast.trendPercent > 1
        ? "반응시간은 회차가 지날수록 길어지는 추세"
        : "반응시간은 큰 변화 없이 안정적인 추세";
    const accuracyTrend = accuracyForecast.trendPercent > 1
      ? "정확도는 상승하는 흐름"
      : accuracyForecast.trendPercent < -1
        ? "정확도는 약간 내려가는 흐름"
        : "정확도는 안정적으로 유지되는 흐름";
    const caveat = rtForecast.enoughData && accuracyForecast.enoughData
      ? "이 값은 현재까지의 지수 추세를 연장한 참고 예측입니다."
      : "데이터가 적어서 최근 값에 가까운 보수적 예측으로 표시했습니다.";
    return `최근 ${series.length}개 회차를 기준으로 보면 ${rtTrend}이고, ${accuracyTrend}입니다. ${last.round}회차의 실제 값은 RT ${formatSeconds(last.rt)}, 정확도 ${formatPercent(last.accuracy)}였고, 같은 지수 추세가 이어진다면 ${rtForecast.nextRound}회차는 RT ${formatSeconds(rtForecast.nextValue)}, 정확도 ${formatPercent(accuracyForecast.nextValue)} 정도로 예상됩니다. ${caveat}`;
  }

  function itemAttempts(participant) {
    return Object.entries(participant?.itemResults || {})
      .flatMap(([roundKey, itemMap]) => Object.entries(itemMap || {}).map(([itemId, item]) => ({
        itemId,
        round: Number(item.attemptIndex || roundKey),
        trialIndex: Number(item.trialIndex || 0),
        category: item.itemCategory || "기타",
        statement: item.statement || itemId,
        response: String(item.response || "").toUpperCase(),
        correctAnswer: String(item.correctAnswer || "").toUpperCase(),
        correct: Number(item.correct) === 1,
        rt: Number(item.rt),
      })))
      .filter((item) => Number.isFinite(item.round))
      .sort((a, b) => a.round - b.round || a.trialIndex - b.trialIndex);
  }

  function groupedByRound(attempts) {
    const rounds = new Map();
    attempts.forEach((item) => {
      if (!rounds.has(item.round)) rounds.set(item.round, []);
      rounds.get(item.round).push(item);
    });
    return Array.from(rounds.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, items]) => ({ round, items }));
  }

  function groupedByCategory(attempts) {
    const categories = new Map();
    attempts.forEach((item) => {
      if (!categories.has(item.category)) categories.set(item.category, []);
      categories.get(item.category).push(item);
    });
    return Array.from(categories.entries())
      .map(([category, items]) => ({
        category,
        items,
        accuracy: mean(items.map((item) => item.correct ? 1 : 0)),
        rt: mean(items.map((item) => item.rt)),
        wrongCount: items.filter((item) => !item.correct).length,
      }))
      .sort((a, b) => a.accuracy - b.accuracy || b.wrongCount - a.wrongCount);
  }

  function mostMissedItemForCategory(items) {
    const byItem = new Map();
    items
      .filter((item) => !item.correct)
      .forEach((item) => {
        const key = item.itemId || item.statement;
        const current = byItem.get(key) || {
          ...item,
          wrongCount: 0,
          rounds: [],
          responses: new Set(),
        };
        current.wrongCount += 1;
        current.rounds.push(item.round);
        if (item.response) current.responses.add(item.response);
        byItem.set(key, current);
      });
    return Array.from(byItem.values())
      .sort((a, b) => b.wrongCount - a.wrongCount || Math.min(...a.rounds) - Math.min(...b.rounds) || a.trialIndex - b.trialIndex)[0] || null;
  }

  function mostMissedItemsByCategory(attempts) {
    return groupedByCategory(attempts)
      .map((category) => {
        const item = mostMissedItemForCategory(category.items);
        return item ? {
          ...item,
          category: category.category,
          categoryAccuracy: category.accuracy,
        } : null;
      })
      .filter(Boolean);
  }

  function itemCatalogForParticipant(participant) {
    const items = new Map();
    Object.values(participant?.itemResults || {}).forEach((roundResults) => {
      Object.entries(roundResults || {}).forEach(([itemId, result]) => {
        if (!items.has(itemId)) {
          items.set(itemId, {
            id: itemId,
            category: result.itemCategory || "기타",
            statement: result.statement || itemId,
          });
        }
      });
    });
    return Array.from(items.values())
      .sort((a, b) => a.category.localeCompare(b.category, "ko") || a.statement.localeCompare(b.statement, "ko"));
  }

  function groupedItemCatalog(participant) {
    const groups = new Map();
    itemCatalogForParticipant(participant).forEach((item) => {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    });
    return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
  }

  function itemResultForRound(participant, round, itemId) {
    return participant?.itemResults?.[String(round.actualRound || round.round)]?.[itemId]
      || participant?.itemResults?.[String(round.attemptIndex || round.round)]?.[itemId]
      || null;
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

  function personalRtExtent(participant, items) {
    const itemIds = new Set(items.map((item) => item.id));
    const values = [];
    Object.values(participant?.itemResults || {}).forEach((roundResults) => {
      Object.entries(roundResults || {}).forEach(([itemId, result]) => {
        if (itemIds.has(itemId) && Number.isFinite(Number(result.rt))) values.push(Number(result.rt));
      });
    });
    return rtExtentFromValues(values);
  }

  function intensity(rt, minRt, maxRt) {
    if (!Number.isFinite(rt)) return 0.32;
    if (maxRt <= minRt) return 0.85;
    return Math.max(0.28, Math.min(1, 1 - ((rt - minRt) / (maxRt - minRt)) * 0.72));
  }

  function cellColor(result, minRt, maxRt) {
    if (!result || !Number.isFinite(Number(result.correct))) return "#e5e7eb";
    const alpha = intensity(Number(result.rt), minRt, maxRt);
    return Number(result.correct) >= 0.5 ? `rgba(22,163,74,${alpha})` : `rgba(220,38,38,${alpha})`;
  }

  function itemMapCellClass(result) {
    if (!result || !Number.isFinite(Number(result.correct))) return "full-map-cell missing";
    return Number(result.correct) >= 0.5 ? "full-map-cell correct" : "full-map-cell wrong";
  }

  function responseRoundStats(participant) {
    return groupedByRound(itemAttempts(participant)).map(({ round, items }) => {
      const counts = { oCorrect: 0, oWrong: 0, xCorrect: 0, xWrong: 0 };
      items.forEach((item) => {
        const isO = item.response === "O";
        if (isO && item.correct) counts.oCorrect += 1;
        else if (isO) counts.oWrong += 1;
        else if (item.correct) counts.xCorrect += 1;
        else counts.xWrong += 1;
      });
      return { round, total: items.length, ...counts };
    });
  }

  function correctnessTransitions(participant) {
    const rounds = groupedByRound(itemAttempts(participant));
    return rounds.slice(1).map((currentRound, index) => {
      const previousRound = rounds[index];
      const previousByItem = new Map(previousRound.items.map((item) => [item.itemId, item]));
      const counts = { keptCorrect: 0, improved: 0, regressed: 0, keptWrong: 0 };
      currentRound.items.forEach((item) => {
        const previous = previousByItem.get(item.itemId);
        if (!previous) return;
        if (previous.correct && item.correct) counts.keptCorrect += 1;
        else if (!previous.correct && item.correct) counts.improved += 1;
        else if (previous.correct && !item.correct) counts.regressed += 1;
        else counts.keptWrong += 1;
      });
      return {
        label: `${previousRound.round}->${currentRound.round}`,
        from: previousRound.round,
        to: currentRound.round,
        total: counts.keptCorrect + counts.improved + counts.regressed + counts.keptWrong,
        ...counts,
      };
    });
  }

  function renderCourseNav(label, onPrevious, onNext, nextDisabled = false) {
    return h("div", { className: "analysis-step-nav", "aria-label": "분석 단계 이동" },
      h("button", { className: "step-nav-button", type: "button", onClick: onPrevious }, "이전"),
      h("span", null, label),
      h("button", {
        className: "step-nav-button primary",
        type: "button",
        disabled: nextDisabled,
        onClick: onNext,
      }, "다음")
    );
  }

  function renderOxResponseChart(stats) {
    const width = 990;
    const height = 382;
    const left = 58;
    const right = 28;
    const top = 30;
    const bottom = 48;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const maxWrong = Math.max(1, ...stats.flatMap((round) => [round.oWrong, round.xWrong]));
    const groupGap = 28;
    const groupW = Math.max(54, (plotW - groupGap * Math.max(0, stats.length - 1)) / Math.max(1, stats.length));
    const barGap = 8;
    const barW = Math.max(18, (groupW - barGap) / 2);
    const yValue = (value) => top + plotH - (value / maxWrong) * plotH;
    return h("svg", { className: "wide-analysis-chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "O X 오답 비교 그래프" },
      [0, 0.25, 0.5, 0.75, 1].map((tick) => h("g", { key: `ox-y-${tick}` },
        h("line", { className: "guide-grid", x1: left, y1: top + plotH - plotH * tick, x2: left + plotW, y2: top + plotH - plotH * tick }),
        h("text", { className: "guide-tick", x: left - 9, y: top + plotH - plotH * tick + 4, textAnchor: "end" }, `${Math.round(maxWrong * tick)}`)
      )),
      stats.map((round, index) => {
        const groupX = left + index * (groupW + groupGap);
        const oHeight = top + plotH - yValue(round.oWrong);
        const xHeight = top + plotH - yValue(round.xWrong);
        return h("g", { key: `ox-round-${round.round}` },
          h("rect", {
            className: "ox-o-wrong",
            x: groupX,
            y: yValue(round.oWrong),
            width: barW,
            height: Math.max(0, oHeight),
            rx: 5,
          }),
          h("rect", {
            className: "ox-x-wrong",
            x: groupX + barW + barGap,
            y: yValue(round.xWrong),
            width: barW,
            height: Math.max(0, xHeight),
            rx: 5,
          }),
          h("text", { className: "guide-tick", x: groupX + groupW / 2, y: height - 14, textAnchor: "middle" }, `${round.round}회`)
        );
      }),
      h("line", { className: "guide-axis", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }),
      h("line", { className: "guide-axis", x1: left, y1: top, x2: left, y2: top + plotH })
    );
  }

  function renderTransitionChart(transitions) {
    const width = 1040;
    const height = 500;
    const left = 78;
    const right = 36;
    const top = 30;
    const bottom = 62;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const keptWrongMovingAverage = movingAverage(transitions.map((item) => item.keptWrong));
    const regressedMovingAverage = movingAverage(transitions.map((item) => item.regressed));
    const maxCount = Math.max(1, ...transitions.flatMap((item) => [item.keptWrong, item.regressed]), ...keptWrongMovingAverage, ...regressedMovingAverage);
    const yMax = Math.max(4, Math.ceil(maxCount * 1.15));
    const x = (index) => transitions.length === 1
      ? left + plotW / 2
      : left + (index / (transitions.length - 1)) * plotW;
    const y = (value) => top + ((yMax - value) / yMax) * plotH;
    const linePathFor = (key) => transitions
      .map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`)
      .join(" ");
    const movingAveragePathFor = (values) => values
      .map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
      .join(" ");
    return h("svg", { className: "wide-analysis-chart change-only-chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "이전 다음 정오답 변화 그래프" },
      Array.from({ length: 5 }, (_, index) => yMax * index / 4).map((tick) => h("g", { key: `change-y-${tick}` },
        h("line", { className: "guide-grid", x1: left, y1: y(tick), x2: left + plotW, y2: y(tick) }),
        h("text", { className: "guide-tick", x: left - 10, y: y(tick) + 4, textAnchor: "end" }, `${Math.round(tick)}`)
      )),
      transitions.map((transition, index) => h("g", { key: `change-axis-${transition.label}` },
        h("line", { className: "guide-grid", x1: x(index), y1: top, x2: x(index), y2: top + plotH, "strokeOpacity": .55 }),
        h("text", { className: "guide-tick", x: x(index), y: top + plotH + 24, textAnchor: "middle" }, transition.label)
      )),
      h("line", { className: "guide-axis", x1: left, y1: top + plotH, x2: left + plotW, y2: top + plotH }),
      h("line", { className: "guide-axis", x1: left, y1: top, x2: left, y2: top + plotH }),
      h("text", { className: "guide-axis-label", x: left + plotW / 2, y: height - 10, textAnchor: "middle" }, "전환"),
      h("text", { className: "guide-axis-label", transform: `translate(24 ${top + plotH / 2}) rotate(-90)`, textAnchor: "middle" }, "개수"),
      transitions.length >= 2 && h("path", {
        className: "transition-line-wrong-stay",
        d: linePathFor("keptWrong"),
      }),
      transitions.length >= 2 && h("path", {
        className: "transition-line-regressed",
        d: linePathFor("regressed"),
      }),
      transitions.length >= 2 && h("path", {
        className: "transition-line-moving-average",
        d: movingAveragePathFor(keptWrongMovingAverage),
      }, h("title", null, `모르는 내용 ${MOVING_AVERAGE_WINDOW}구간 이동평균선`)),
      transitions.length >= 2 && h("path", {
        className: "transition-line-moving-average regressed-average",
        d: movingAveragePathFor(regressedMovingAverage),
      }, h("title", null, `실수 ${MOVING_AVERAGE_WINDOW}구간 이동평균선`)),
      transitions.flatMap((transition, index) => [
        h("circle", {
          key: `wrong-stay-${transition.label}`,
          className: "transition-dot-wrong-stay",
          cx: x(index),
          cy: y(transition.keptWrong),
          r: 4.2,
        }, h("title", null, `${transition.label} · 모르는 내용(오답 유지) ${transition.keptWrong}개`)),
        h("circle", {
          key: `regressed-${transition.label}`,
          className: "transition-dot-regressed",
          cx: x(index),
          cy: y(transition.regressed),
          r: 4.2,
        }, h("title", null, `${transition.label} · 실수(정답→오답) ${transition.regressed}개`)),
      ])
    );
  }

  function buildOxExplanation(participant) {
    const stats = responseRoundStats(participant);
    if (!stats.length) return "O/X 응답을 분석할 문항 데이터가 아직 충분하지 않습니다.";
    const totals = stats.reduce((sum, round) => ({
      o: sum.o + round.oCorrect + round.oWrong,
      x: sum.x + round.xCorrect + round.xWrong,
      oWrong: sum.oWrong + round.oWrong,
      xWrong: sum.xWrong + round.xWrong,
      total: sum.total + round.total,
    }), { o: 0, x: 0, oWrong: 0, xWrong: 0, total: 0 });
    const bias = totals.o > totals.x * 1.12
      ? "O 응답을 더 자주 선택하는 편"
      : totals.x > totals.o * 1.12
        ? "X 응답을 더 자주 선택하는 편"
        : "O와 X 응답 비율이 비교적 균형적";
    const fragile = totals.oWrong > totals.xWrong
      ? "오답은 O로 답한 문항에서 더 많이 발생했습니다"
      : totals.xWrong > totals.oWrong
        ? "오답은 X로 답한 문항에서 더 많이 발생했습니다"
        : "오답은 O와 X 응답에 비슷하게 나뉘었습니다";
    return `전체 ${totals.total}개 응답 중 틀린 응답만 보면, ${bias}입니다. ${fragile}. 이 그래프는 맞은 결과를 제외하고 O로 틀린 경우와 X로 틀린 경우만 나란히 비교합니다.`;
  }

  function buildItemMapSummary(participant) {
    const categories = groupedByCategory(itemAttempts(participant));
    if (!categories.length) return "문항별 결과를 아직 충분히 찾지 못했습니다.";
    const weakest = categories[0];
    const strongest = categories[categories.length - 1];
    return `문항지도에서는 범주별 정답률과 오답이 누적된 문항을 함께 봅니다. 현재 가장 점검이 필요한 범주는 ${weakest.category}이며 정답률은 ${formatPercent(weakest.accuracy)}입니다. 가장 안정적인 범주는 ${strongest.category}로 정답률 ${formatPercent(strongest.accuracy)}를 보입니다.`;
  }

  function buildFinalSummary(participant) {
    const series = arrowSeries(participant);
    const attempts = itemAttempts(participant);
    if (!series.length || !attempts.length) return "총평을 만들 데이터가 아직 충분하지 않습니다.";
    const first = series[0];
    const last = series[series.length - 1];
    const accuracy = mean(attempts.map((item) => item.correct ? 1 : 0));
    const categories = groupedByCategory(attempts);
    const weakest = categories[0];
    const rtText = last.rt < first.rt ? "반응시간은 전반적으로 빨라졌고" : last.rt > first.rt ? "반응시간은 다소 느려졌고" : "반응시간은 안정적으로 유지됐고";
    const accText = last.accuracy > first.accuracy ? "정확도는 좋아졌습니다" : last.accuracy < first.accuracy ? "정확도는 조금 흔들렸습니다" : "정확도는 비슷하게 유지됐습니다";
    return `${series.length}개 회차와 ${attempts.length}개 문항 응답을 종합하면, ${rtText} ${accText}. 전체 문항 정답률은 ${formatPercent(accuracy)}이며, 다음 학습에서는 ${weakest?.category || "취약 범주"} 문항을 먼저 점검하는 것이 좋습니다.`;
  }

  function buildGraphExplanation(participant, selectedRound, averageSeries) {
    const series = arrowSeries(participant);
    if (!series.length) return "분석할 RT와 정답률 데이터가 아직 충분하지 않습니다.";
    const first = series[0];
    const last = series[series.length - 1];
    const rtDelta = last.rt - first.rt;
    const accDelta = last.accuracy - first.accuracy;
    if (selectedRound !== "all") {
      const current = series.find((point) => String(point.round) === String(selectedRound));
      const average = averageSeries.find((point) => String(point.round) === String(selectedRound));
      if (!current) return "선택한 회차의 개인 데이터가 아직 없습니다.";
      const speedText = average && current.rt < average.rt
        ? "전체 평균보다 빠른 반응속도"
        : average && current.rt > average.rt
          ? "전체 평균보다 느린 반응속도"
          : "평균권의 반응속도";
      const accuracyText = average && current.accuracy > average.accuracy
        ? "정답률은 평균보다 높은 편입니다"
        : average && current.accuracy < average.accuracy
          ? "정답률은 평균보다 낮은 편입니다"
          : "정답률은 평균권입니다";
      return `${current.round}회차에서는 ${speedText}를 보이며, ${accuracyText}. 이 회차의 위치는 RT ${formatSeconds(current.rt)}, 정답률 ${formatPercent(current.accuracy)}입니다.`;
    }
    const speedTrend = rtDelta < -0.08
      ? "전반적으로 반응속도가 빨라지는 경향"
      : rtDelta > 0.08
        ? "후반으로 갈수록 반응속도가 느려지는 경향"
        : "반응속도가 비교적 안정적인 경향";
    const accuracyTrend = accDelta > 0.02
      ? "정답률도 함께 개선되고 있습니다"
      : accDelta < -0.02
        ? "다만 정답률은 조금 흔들리고 있습니다"
        : "정답률은 큰 변화 없이 유지되고 있습니다";
    return `당신의 그래프는 ${speedTrend}을 보입니다. ${accuracyTrend}. 처음과 마지막을 비교하면 RT는 ${formatSeconds(first.rt)}에서 ${formatSeconds(last.rt)}로, 정답률은 ${formatPercent(first.accuracy)}에서 ${formatPercent(last.accuracy)}로 이동했습니다.`;
  }

  function buildDeepSeekAnalysisPayload(participant, averageSeries, submittedName) {
    const roundAnalyses = arrowSeries(participant)
      .filter((point) => Number(point.round) >= 1 && Number(point.round) <= 9)
      .map((point) => {
        return {
          round: point.round,
          text: buildGraphExplanation(participant, String(point.round), averageSeries),
        };
      });
    return {
      participantName: "익명 참여자",
      experiment: "SVT",
      chart: "RT x accuracy",
      roundAnalyses,
      promptInstruction: "1~9회차별 텍스트 분석을 입력으로 삼아 전체 흐름을 한국어로 종합하세요. 개별 값이나 수치 나열보다 초반-중반-후반의 변화, 추세, 안정성, 반응속도와 정확도 사이의 균형에 더 집중하세요. 평균 대비 특징도 단순 비교보다 흐름 속 의미를 중심으로 설명하고, 숫자를 새로 계산하지 마세요. 3~5문장으로 담백하게 작성하세요.",
    };
  }

  function buildTransitionMovingAverageAnalysisPayload(participant) {
    const transitions = correctnessTransitions(participant);
    const keptWrongMovingAverage = movingAverage(transitions.map((item) => item.keptWrong));
    const regressedMovingAverage = movingAverage(transitions.map((item) => item.regressed));
    const roundAnalyses = transitions.map((transition, index) => ({
      round: transition.label,
      text: `${transition.label} 구간에서 모르는 내용(오답 유지)은 실제 ${transition.keptWrong}개, 이동평균 ${keptWrongMovingAverage[index].toFixed(2)}개입니다. 실수(정답→오답)는 실제 ${transition.regressed}개, 이동평균 ${regressedMovingAverage[index].toFixed(2)}개입니다.`,
    }));
    return {
      participantName: "익명 참여자",
      experiment: "SVT",
      chart: "correctness transition moving average",
      roundAnalyses,
      promptInstruction: "이전/다음 회차 정오답 변화 그래프의 실제 값과 이동평균 값을 함께 참고해 한국어 응답 설명을 작성하세요. 실제 값은 특정 구간의 급격한 변화를, 이동평균은 전체 추세를 보는 보조선으로 해석하세요. 개별 값 나열보다 모르는 내용(오답 유지)과 실수(정답→오답)가 초반-중반-후반에 어떻게 변하는지, 두 흐름이 함께 줄거나 늘어나는지, 어느 쪽이 더 안정적이거나 흔들리는지 같은 추세를 중심으로 설명하세요. 숫자는 필요한 경우에만 보조적으로 언급하고, 3~5문장으로 담백하게 작성하세요.",
    };
  }

  function buildOverallSummaryPayload(participant, graphAnalysis, transitionText) {
    const series = arrowSeries(participant);
    const rtForecast = exponentialForecast(series, "rt", participant);
    const accuracyForecast = exponentialForecast(series, "accuracy", participant);
    const responseAnalyses = [
      {
        round: "실험 그래프",
        text: graphAnalysis || buildGraphExplanation(participant, "all", []),
      },
      {
        round: "반응시간 및 정확도 예측",
        text: buildForecastExplanation(series, rtForecast, accuracyForecast),
      },
      {
        round: "O/X 응답 선택",
        text: buildOxExplanation(participant),
      },
      {
        round: "실수 및 모르는 내용",
        text: transitionText || "실수 및 모르는 내용의 이동평균 분석은 아직 준비되지 않았습니다.",
      },
      {
        round: "문항지도",
        text: buildItemMapSummary(participant),
      },
    ].filter((item) => item.text && !String(item.text).includes("아직 충분"));

    return {
      participantName: "익명 참여자",
      experiment: "SVT",
      chart: "overall response summary",
      roundAnalyses: responseAnalyses,
      promptInstruction: "이전 코스들의 응답 설명 전체를 입력으로 삼아 최종 총평을 한국어로 작성하세요. 각 설명을 단순히 반복하지 말고, 속도-정확도 흐름, 예측 방향, 응답 선택 패턴, 실수 및 모르는 내용의 변화, 취약 문항 범주가 서로 어떻게 연결되는지 종합하세요. 값 나열보다 학습/점검 방향과 전체 추세를 중심으로 4~6문장으로 담백하게 작성하세요. 진단이나 의학적 판단은 하지 마세요.",
    };
  }

  async function requestDeepSeekPayload(payload) {
    const config = window.SVT_SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) {
      throw new Error("Supabase 설정이 없어 DeepSeek 분석을 요청할 수 없습니다.");
    }
    const functionName = config.deepseekAnalysisFunction || "analyze-svt-flow";
    const endpoint = `${String(config.url).replace(/\/$/, "")}/functions/v1/${functionName}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
        "apikey": config.anonKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "DeepSeek 분석 요청에 실패했습니다.");
    }
    const analysis = data?.analysis || data?.text || "";
    if (!analysis) throw new Error("DeepSeek 분석 응답이 비어 있습니다.");
    return String(analysis);
  }

  async function requestDeepSeekAnalysis(participant, averageSeries, submittedName) {
    return requestDeepSeekPayload(buildDeepSeekAnalysisPayload(participant, averageSeries, submittedName));
  }

  async function requestTransitionMovingAverageAnalysis(participant) {
    return requestDeepSeekPayload(buildTransitionMovingAverageAnalysisPayload(participant));
  }

  async function requestOverallSummaryAnalysis(participant, graphAnalysis, transitionText) {
    return requestDeepSeekPayload(buildOverallSummaryPayload(participant, graphAnalysis, transitionText));
  }

  function renderRtAccuracyPreview(data, participant, selectedRound, setSelectedRound, graphMode, setGraphMode, onExitAnalysis, submittedName, deepSeekAnalysis, onGoForecast) {
    const participants = data?.participants || [];
    const series = arrowSeries(participant);
    if (!participant || !series.length) {
      return h("section", { className: "analysis-guide-panel" },
        h("p", { className: "guide-empty" }, "이 닉네임의 SVT 그래프 데이터를 아직 찾지 못했습니다.")
      );
    }

    const options = roundOptionsFor(participant);
    const safeRound = options.includes(String(selectedRound)) ? selectedRound : "all";
    const canGoNext = Boolean(onGoForecast);
    const canGoPrevious = Boolean(onExitAnalysis);
    const allPoints = participants.flatMap(arrowSeries);
    const averages = averageArrowSeries(data);
    const roundPoints = safeRound === "all"
      ? []
      : participants.map((person) => arrowSeries(person).find((point) => String(point.round) === String(safeRound))).filter(Boolean);
    const selectedPoint = safeRound === "all" ? null : series.find((point) => String(point.round) === String(safeRound));
    const selectedAverage = safeRound === "all" ? null : averages.find((point) => String(point.round) === String(safeRound));
    const zoomedAll = safeRound === "all";
    const visiblePoints = safeRound === "all" ? series : [...roundPoints, selectedAverage, selectedPoint].filter(Boolean);
    const xDomainPoints = zoomedAll ? series : [...allPoints, ...visiblePoints];
    const yDomainPoints = zoomedAll ? series : [...allPoints, ...series];
    const [xMin, xMax] = extent(xDomainPoints.map((point) => point.rt), [0, 8], zoomedAll ? 0.24 : 0.11);
    const [yMin, yMax] = safeRound === "all"
      ? extent(yDomainPoints.map((point) => point.accuracy), [0, 1], zoomedAll ? 0.28 : 0.12)
      : [0, 1];
    const plotW = CHART.width - CHART.left - CHART.right;
    const plotH = CHART.height - CHART.top - CHART.bottom;
    const x = (value) => CHART.left + ((value - xMin) / (xMax - xMin || 1)) * plotW;
    const y = (value) => CHART.top + ((yMax - value) / (yMax - yMin || 1)) * plotH;
    const xTicks = Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4);
    const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yMax - yMin) * index / 4);
    const fallbackExplanation = buildGraphExplanation(participant, safeRound, averages);
    const isDistributionMode = graphMode === "distribution";
    const isDeepSeekLoading = safeRound === "all" && deepSeekAnalysis?.status === "loading";
    const explanation = safeRound !== "all"
      ? fallbackExplanation
      : deepSeekAnalysis?.status === "done"
      ? deepSeekAnalysis.text
      : isDeepSeekLoading
        ? ""
        : deepSeekAnalysis?.status === "error"
          ? `DeepSeek 분석을 불러오지 못해 기본 분석을 표시합니다. ${fallbackExplanation}`
          : fallbackExplanation;

    return h("section", { className: "analysis-guide-panel" },
      h("div", { className: "analysis-guide-heading selector-only" },
        h("div", { className: "course-intro inline-course-intro" },
          h("span", null, "첫 번째 코스"),
          h("strong", null, `${submittedName}님의 실험 그래프부터 보겠습니다.`),
          h("p", null, "전체 흐름을 먼저 보고, 회차별 점을 하나씩 짚으면서 반응속도와 정확도의 균형을 해석합니다.")
        ),
        h("div", { className: "round-selector", role: "radiogroup", "aria-label": "그래프 회차 선택" },
          options.map((option) => h("button", {
            key: option,
            className: safeRound === option ? "round-choice active" : "round-choice",
            type: "button",
            onClick: () => setSelectedRound(option),
            "aria-pressed": safeRound === option ? "true" : "false",
          }, option === "all" ? "전체" : option))
        ),
        h("div", { className: "guide-mode-toggle", role: "radiogroup", "aria-label": "그래프 보기 방식" },
          [
            { value: "trajectory", label: "흐름" },
            { value: "distribution", label: "분포" },
          ].map((option) => h("button", {
            key: option.value,
            className: isDistributionMode === (option.value === "distribution") ? "guide-mode-choice active" : "guide-mode-choice",
            type: "button",
            onClick: () => setGraphMode(option.value),
            "aria-pressed": graphMode === option.value ? "true" : "false",
          }, option.label))
        )
      ),
      h("div", { className: "guide-legend", "aria-label": "그래프 범례" },
        isDistributionMode
          ? [
            h("span", { key: "dist" }, h("i", { className: "legend-blue-bar" }), "전체 분포"),
            h("span", { key: "avg" }, h("i", { className: "legend-yellow-line" }), "평균"),
            h("span", { key: "me" }, h("i", { className: "legend-red-line" }), "나의 위치"),
          ]
          : safeRound === "all"
          ? h("span", null, h("i", { className: "legend-red" }), "나의 전체 흐름")
          : [
            h("span", { key: "others" }, h("i", { className: "legend-blue" }), "같은 회차 참가자"),
            h("span", { key: "me" }, h("i", { className: "legend-red" }), "나"),
            h("span", { key: "avg" }, h("i", { className: "legend-yellow-line" }), "평균선"),
          ]
      ),
      isDistributionMode
        ? h("div", { className: "distribution-grid" },
          renderDistributionChart("정답률 분포", "accuracy", participants, participant, safeRound),
          renderDistributionChart("반응 시간 분포", "rt", participants, participant, safeRound)
        )
        : h("div", { className: "guide-chart-frame" },
        h("svg", { className: "guide-chart", viewBox: `0 0 ${CHART.width} ${CHART.height}`, role: "img", "aria-label": "RT 정답률 안내 그래프" },
          xTicks.map((tick) => h("g", { key: `x-${tick}` },
            h("line", { className: "guide-grid", x1: x(tick), y1: CHART.top, x2: x(tick), y2: CHART.top + plotH }),
            h("text", { className: "guide-tick", x: x(tick), y: CHART.top + plotH + 28, textAnchor: "middle" }, tick.toFixed(1))
          )),
          yTicks.map((tick) => h("g", { key: `y-${tick}` },
            h("line", { className: "guide-grid", x1: CHART.left, y1: y(tick), x2: CHART.left + plotW, y2: y(tick) }),
            h("text", { className: "guide-tick", x: CHART.left - 9, y: y(tick) + 4, textAnchor: "end" }, `${Math.round(tick * 100)}%`)
          )),
          h("line", { className: "guide-axis", x1: CHART.left, y1: CHART.top + plotH, x2: CHART.left + plotW, y2: CHART.top + plotH }),
          h("line", { className: "guide-axis", x1: CHART.left, y1: CHART.top, x2: CHART.left, y2: CHART.top + plotH }),
          h("text", { className: "guide-axis-label", x: CHART.left + plotW / 2, y: CHART.height - 10, textAnchor: "middle" }, "RT"),
          h("text", { className: "guide-axis-label", transform: `translate(18 ${CHART.top + plotH / 2}) rotate(-90)`, textAnchor: "middle" }, "정답률"),
          selectedAverage && h("line", {
            className: "average-preview-line",
            x1: x(selectedAverage.rt),
            y1: CHART.top,
            x2: x(selectedAverage.rt),
            y2: CHART.top + plotH,
          }),
          selectedAverage && h("line", {
            className: "average-preview-line",
            x1: CHART.left,
            y1: y(selectedAverage.accuracy),
            x2: CHART.left + plotW,
            y2: y(selectedAverage.accuracy),
          }),
          safeRound !== "all" && roundPoints.map((point, index) => h("circle", {
            key: `blue-${index}`,
            className: "cohort-preview-dot",
            cx: x(point.rt),
            cy: y(point.accuracy),
            r: 3.2,
          })),
          safeRound === "all" && series.length > 1 && h("path", {
            className: "personal-preview-line",
            d: linePath(series, x, y),
          }),
          safeRound === "all" && series.map((point) => h("circle", {
            key: `red-all-${point.round}`,
            className: "personal-preview-dot",
            cx: x(point.rt),
            cy: y(point.accuracy),
            r: 4.4,
          })),
          safeRound === "all" && series.map((point) => h("text", {
            key: `red-label-${point.round}`,
            className: "guide-round-label",
            x: x(point.rt),
            y: Math.max(18, y(point.accuracy) - 13),
            textAnchor: "middle",
          }, `${point.round}회`)),
          selectedPoint && h("circle", {
            className: "personal-preview-dot selected",
            cx: x(selectedPoint.rt),
            cy: y(selectedPoint.accuracy),
            r: 7.2,
          })
        )
      ),
      h("article", { className: "llm-guide-card" },
        h("span", null, "텍스트 분석"),
        isDeepSeekLoading
          ? h("div", { className: "analysis-skeleton", "aria-label": "텍스트 분석 로딩 중" },
            h("i", null),
            h("i", null),
            h("i", null)
          )
          : h("p", null, explanation)
      ),
      h("div", { className: "analysis-step-nav", "aria-label": "분석 단계 이동" },
        h("button", {
          className: "step-nav-button",
          type: "button",
          disabled: !canGoPrevious,
          onClick: () => onExitAnalysis?.(),
        }, "이전"),
        h("span", null, "실험그래프"),
        h("button", {
          className: "step-nav-button primary",
          type: "button",
          disabled: !canGoNext,
          onClick: () => onGoForecast?.(),
        }, "다음")
      )
    );
  }

  function renderForecastPreview(participant, onBackToRounds, onNextCourse) {
    const series = arrowSeries(participant);
    if (!participant || !series.length) {
      return h("section", { className: "analysis-guide-panel" },
        h("p", { className: "guide-empty" }, "다음 회차를 예측할 SVT 그래프 데이터를 아직 찾지 못했습니다."),
        renderCourseNav("예측", onBackToRounds, onNextCourse)
      );
    }
    const rtForecast = exponentialForecast(series, "rt", participant);
    const accuracyForecast = exponentialForecast(series, "accuracy", participant);
    const explanation = buildForecastExplanation(series, rtForecast, accuracyForecast);
    return h("section", { className: "analysis-guide-panel forecast-panel" },
      h("div", { className: "analysis-guide-heading selector-only forecast-heading" },
        h("div", { className: "course-intro inline-course-intro" },
          h("span", null, "두 번째 코스"),
          h("strong", null, "반응시간, 정확도 분석입니다."),
          h("p", null, "현재까지의 흐름을 지수 추세로 맞추고, 다음 회차에서 기대되는 RT와 정확도를 함께 봅니다.")
        )
      ),
      h("div", { className: "guide-legend", "aria-label": "예측 그래프 범례" },
        h("span", null, h("i", { className: "legend-blue" }), "실제값"),
        h("span", null, h("i", { className: "legend-yellow-line" }), "지수 추세"),
        h("span", null, h("i", { className: "legend-red" }), "다음 회차 예측")
      ),
      h("div", { className: "forecast-grid" },
        renderForecastMetricChart("반응시간 분석", "rt", series, rtForecast),
        renderForecastMetricChart("정확도 분석", "accuracy", series, accuracyForecast)
      ),
      h("article", { className: "llm-guide-card" },
        h("span", null, "예측 설명"),
        h("p", null, explanation)
      ),
      renderCourseNav("예측", onBackToRounds, onNextCourse)
    );
  }

  function renderOxResponsePreview(participant, onPrevious, onNext) {
    const stats = responseRoundStats(participant);
    const explanation = buildOxExplanation(participant);
    return h("section", { className: "analysis-guide-panel" },
      h("div", { className: "analysis-guide-heading selector-only forecast-heading" },
        h("div", { className: "course-intro inline-course-intro" },
          h("span", null, "세 번째 코스"),
          h("strong", null, "O/X 응답 선택 패턴을 봅니다."),
          h("p", null, "맞은 결과는 제외하고, O로 틀린 경우와 X로 틀린 경우만 회차별 이중 막대로 비교합니다.")
        )
      ),
      h("div", { className: "guide-legend", "aria-label": "O X 응답 범례" },
        h("span", null, h("i", { className: "legend-ox-o-wrong" }), "O 오답"),
        h("span", null, h("i", { className: "legend-ox-x-wrong" }), "X 오답")
      ),
      stats.length ? renderOxResponseChart(stats) : h("p", { className: "guide-empty" }, "O/X 응답 데이터를 아직 찾지 못했습니다."),
      h("article", { className: "llm-guide-card" },
        h("span", null, "응답 설명"),
        h("p", null, explanation)
      ),
      renderCourseNav("O/X", onPrevious, onNext)
    );
  }

  function renderCorrectnessChangePreview(participant, onPrevious, onNext, transitionAnalysis) {
    const transitions = correctnessTransitions(participant);
    const fallbackExplanation = "초록 이동평균선은 회차 사이의 일시적 출렁임보다 전반적인 변화 방향을 보기 위한 선입니다. 모르는 내용과 실수의 이동평균이 함께 내려가면 안정화 흐름으로, 한쪽만 내려가면 특정 오류 유형이 먼저 정리되는 흐름으로 해석할 수 있습니다.";
    const isLoading = transitionAnalysis?.status === "loading";
    const explanation = transitionAnalysis?.status === "done"
      ? transitionAnalysis.text
      : transitionAnalysis?.status === "error"
        ? `이동평균 분석을 불러오지 못해 기본 설명을 표시합니다. ${fallbackExplanation}`
        : fallbackExplanation;
    return h("section", { className: "analysis-guide-panel" },
      h("div", { className: "analysis-guide-heading selector-only forecast-heading" },
        h("div", { className: "course-intro inline-course-intro" },
          h("span", null, "네 번째 코스"),
          h("strong", null, "실수 및 모르는 내용의 변화입니다."),
          h("p", null, "전체 데이터 분석과 같이 같은 문항이 이전 회차에서 다음 회차로 넘어갈 때 모르는 내용(오답 유지)과 실수(정답→오답)만 그래프로 봅니다.")
        )
      ),
      h("div", { className: "guide-legend", "aria-label": "정오답 변화 범례" },
        h("span", null, h("i", { className: "legend-change-kept-wrong" }), "모르는 내용 (오답 유지)"),
        h("span", null, h("i", { className: "legend-change-regressed" }), "실수 (정답→오답)"),
        h("span", null, h("i", { className: "legend-change-moving-average" }), "이동평균선")
      ),
      transitions.length ? renderTransitionChart(transitions) : h("p", { className: "guide-empty" }, "비교할 이전/다음 회차 데이터가 아직 충분하지 않습니다."),
      transitions.length ? h("article", { className: "llm-guide-card" },
        h("span", null, "응답 설명"),
        isLoading
          ? h("div", { className: "analysis-skeleton", "aria-label": "응답 설명 로딩 중" },
            h("i", null),
            h("i", null),
            h("i", null)
          )
          : h("p", null, explanation)
      ) : null,
      renderCourseNav("변화", onPrevious, onNext)
    );
  }

  function renderItemMapPreview(participant, onPrevious, onNext) {
    const attempts = itemAttempts(participant);
    const categories = groupedByCategory(attempts).slice(0, 8);
    const weakItems = mostMissedItemsByCategory(attempts).slice(0, 8);
    return h("section", { className: "analysis-guide-panel item-map-panel" },
      h("div", { className: "analysis-guide-heading selector-only forecast-heading" },
        h("div", { className: "course-intro inline-course-intro" },
          h("span", null, "다섯 번째 코스"),
          h("strong", null, "문항지도로 취약 범주와 문항을 확인합니다."),
          h("p", null, "문법 범주별 정답률과 실제로 틀린 문항을 한 화면에 모아 봅니다.")
        )
      ),
      h("div", { className: "item-map-grid" },
        categories.map((category) => h("article", { className: "item-map-cell", key: category.category },
          h("div", { className: "item-map-cell-head" },
            h("strong", null, category.category),
            h("span", null, formatPercent(category.accuracy))
          ),
          h("div", { className: "item-map-bar" },
            h("i", { style: { width: `${clamp(category.accuracy, 0, 1) * 100}%` } })
          ),
          h("small", null, `오답 ${category.wrongCount}개 · 평균 RT ${formatSeconds(category.rt)}`)
        ))
      ),
      h("div", { className: "weak-item-list" },
        weakItems.length
          ? weakItems.map((item) => h("article", { className: "weak-item", key: `${item.category}-${item.itemId}` },
            h("span", null, `${item.category} · 최다 오답 ${item.wrongCount}회`),
            h("p", null, item.statement),
            h("small", null, `응답 ${item.response || "-"} / 정답 ${item.correctAnswer || "-"}`)
          ))
          : h("p", { className: "guide-empty" }, "표시할 오답 문항이 없습니다.")
      ),
      h("article", { className: "llm-guide-card" },
        h("span", null, "문항지도 설명"),
        h("p", null, buildItemMapSummary(participant))
      ),
      renderCourseNav("문항지도", onPrevious, onNext)
    );
  }

  function renderFullItemMapPreview(participant, onPrevious, onNext, tooltipHandlers) {
    const rounds = participantRounds(participant);
    const groups = groupedItemCatalog(participant);
    const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
    return h("section", { className: "analysis-guide-panel item-map-panel full-item-map-panel" },
      h("div", { className: "analysis-guide-heading selector-only forecast-heading" },
        h("div", { className: "course-intro inline-course-intro" },
          h("span", null, "여섯 번째 코스"),
          h("strong", null, "문항지도 전체입니다."),
          h("p", null, `${rounds.length}개 회차와 ${itemCount}개 문항을 범주별로 펼쳐 정답과 오답 흐름을 봅니다.`)
        )
      ),
      h("div", { className: "guide-legend item-map-full-legend", "aria-label": "문항지도 전체 범례" },
        h("span", null, h("i", { className: "full-map-swatch correct" }), "정답"),
        h("span", null, h("i", { className: "full-map-swatch wrong" }), "오답"),
        h("span", null, h("i", { className: "full-map-swatch missing" }), "미실시")
      ),
      groups.length ? h("div", { className: "full-item-map-grid" },
        groups.map((group) => {
          const [minRt, maxRt] = personalRtExtent(participant, group.items);
          return h("article", { className: "full-item-category-card", key: group.category },
            h("h3", null, `${group.category} (${group.items.length})`),
            rounds.map((round) => {
              const matchedCount = group.items.filter((item) => {
                const result = itemResultForRound(participant, round, item.id);
                return Number.isFinite(Number(result?.correct));
              }).length;
              return h("div", { className: "full-map-row", key: `${group.category}-${round.round}` },
                h("div", {
                  className: "full-map-row-label",
                  title: `${round.attemptIndex || round.round}회차 · 공통 ${matchedCount}/${group.items.length}개`,
                }, `${round.attemptIndex || round.round} ${matchedCount}/${group.items.length}`),
                h("div", { className: "full-map-cells", style: { gridTemplateColumns: `repeat(${Math.min(16, Math.max(1, group.items.length))}, 10px)` } },
                  group.items.map((item) => {
                    const result = itemResultForRound(participant, round, item.id);
                    const correctness = result && Number.isFinite(Number(result.correct))
                      ? Number(result.correct) >= 0.5 ? "정답" : "오답"
                      : "미실시";
                    const rt = Number.isFinite(Number(result?.rt)) ? `${Number(result.rt).toFixed(3)}초` : "RT 없음";
                    const statement = result?.statement || item.statement || "원문 없음";
                    const answer = result?.correctAnswer ? ` · 정답 ${String(result.correctAnswer).toUpperCase()}` : "";
                    const response = result?.response ? ` · 응답 ${String(result.response).toUpperCase()}` : "";
                    const tooltip = `${statement}\n${correctness} · ${rt}${answer}${response}`;
                    return h("span", {
                      className: itemMapCellClass(result),
                      key: item.id,
                      style: { background: cellColor(result, minRt, maxRt) },
                      onMouseEnter: (event) => tooltipHandlers.show(event, tooltip),
                      onMouseMove: (event) => tooltipHandlers.move(event, tooltip),
                      onMouseLeave: tooltipHandlers.hide,
                      "aria-label": tooltip,
                    });
                  })
                )
              );
            })
          );
        })
      ) : h("p", { className: "guide-empty" }, "표시할 문항 데이터가 없습니다."),
      renderCourseNav("문항지도전체", onPrevious, onNext)
    );
  }

  function renderFinalSummaryPreview(participant, onPrevious, onExit, summaryAnalysis) {
    const series = arrowSeries(participant);
    const attempts = itemAttempts(participant);
    const accuracy = mean(attempts.map((item) => item.correct ? 1 : 0));
    const rt = mean(attempts.map((item) => item.rt));
    const categories = groupedByCategory(attempts);
    const weakest = categories[0];
    const fallbackSummary = buildFinalSummary(participant);
    const isLoading = summaryAnalysis?.status === "loading";
    const summaryText = summaryAnalysis?.status === "done"
      ? summaryAnalysis.text
      : summaryAnalysis?.status === "error"
        ? `LLM 총평을 불러오지 못해 기본 총평을 표시합니다. ${fallbackSummary}`
        : fallbackSummary;
    return h("section", { className: "analysis-guide-panel final-summary-panel" },
      h("div", { className: "analysis-guide-heading selector-only forecast-heading" },
        h("div", { className: "course-intro inline-course-intro" },
          h("span", null, "마지막 코스"),
          h("strong", null, "전체 분석 총평입니다."),
          h("p", null, "속도, 정확도, 응답 방향, 문항 범주를 합쳐 다음 학습 방향을 정리합니다.")
        )
      ),
      h("div", { className: "summary-metric-grid" },
        h("article", null, h("span", null, "회차"), h("strong", null, `${series.length}개`)),
        h("article", null, h("span", null, "문항 응답"), h("strong", null, `${attempts.length}개`)),
        h("article", null, h("span", null, "전체 정답률"), h("strong", null, formatPercent(accuracy))),
        h("article", null, h("span", null, "평균 RT"), h("strong", null, formatSeconds(rt))),
        h("article", null, h("span", null, "우선 점검"), h("strong", null, weakest?.category || "-"))
      ),
      h("article", { className: "llm-guide-card" },
        h("span", null, "총평"),
        isLoading
          ? h("div", { className: "analysis-skeleton", "aria-label": "총평 로딩 중" },
            h("i", null),
            h("i", null),
            h("i", null)
          )
          : h("p", null, summaryText)
      ),
      h("div", { className: "analysis-step-nav", "aria-label": "분석 단계 이동" },
        h("button", { className: "step-nav-button", type: "button", onClick: onPrevious }, "이전"),
        h("span", null, "총평"),
        h("button", { className: "step-nav-button primary", type: "button", onClick: onExit }, "메인페이지로")
      )
    );
  }

  async function loadFallbackParticipants() {
    await loadScriptOnce(FALLBACK_DATA_SCRIPT);
    const payload = window.SVT_DASHBOARD_DATA || { participants: [] };
    return (payload.participants || [])
      .map((participant) => normalizeParticipant({
        participant: participant.nickname || "",
        student_id: participant.idSource === "student_id" ? participant.id : "",
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
  }

  async function loadParticipants() {
    if (!configuredSupabase()) return loadFallbackParticipants();
    const config = window.SVT_SUPABASE_CONFIG;
    const client = window.supabase.createClient(config.url, config.anonKey);
    if (config.participantLookupFunction) {
      const { data, error } = await client.rpc(config.participantLookupFunction);
      if (error) throw error;
      return participantsFromProfiles(data || []);
    }
    const displayColumn = config.participantDisplayColumn || "participant";
    const keyColumn = config.participantKeyColumn || config.participantIdColumn || displayColumn;
    const studentIdColumn = config.participantStudentIdColumn || "";
    const aliasesColumn = config.participantAliasesColumn || "";
    const selectColumns = Array.from(new Set([displayColumn, keyColumn, studentIdColumn, aliasesColumn].filter(Boolean))).join(",");
    const { data, error } = await client.from(config.participantsTable).select(selectColumns).limit(2000);
    if (error) throw error;
    return participantsFromProfiles(data || []);
  }

  function participantsFromProfiles(rows) {
    const unique = new Map();
    (rows || []).map(normalizeParticipant).forEach((profile) => {
      const aliases = profile.aliases.length ? profile.aliases : [profile.displayName].filter(Boolean);
      aliases.forEach((alias) => {
        const displayName = String(alias || "").trim();
        if (!displayName) return;
        const key = displayName.toLowerCase();
        if (!unique.has(key)) {
          unique.set(key, {
            ...profile,
            id: `${profile.participantKey}:${displayName}`,
            displayName,
          });
        }
      });
    });
    return Array.from(unique.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
  }

  async function resolveParticipantAliases(client, participantKey) {
    const config = window.SVT_SUPABASE_CONFIG || {};
    const fallbackAliases = expandAliasVariants([participantKey]);
    const resolverFunction = config.participantResolverFunction || "";
    if (resolverFunction && participantKey) {
      const { data, error } = await client.rpc(resolverFunction, { participant_key: participantKey });
      if (error) throw error;
      const profile = Array.isArray(data) ? data[0] : data;
      if (profile) {
        return expandAliasVariants([...(profile.aliases || []), profile.student_id, participantKey]);
      }
    }
    if (!config.participantAliasesColumn) return fallbackAliases;
    const profilesTable = config.participantsTable || "";
    const studentIdColumn = config.participantStudentIdColumn || config.participantIdColumn || "student_id";
    const aliasesColumn = config.participantAliasesColumn || "aliases";
    if (!profilesTable || !participantKey) return fallbackAliases;

    const selectColumns = Array.from(new Set([studentIdColumn, aliasesColumn].filter(Boolean))).join(",");
    const byStudent = await client
      .from(profilesTable)
      .select(selectColumns)
      .eq(studentIdColumn, participantKey)
      .maybeSingle();
    if (byStudent.error) throw byStudent.error;
    if (byStudent.data) {
      return expandAliasVariants([...(byStudent.data[aliasesColumn] || []), participantKey]);
    }

    const byAlias = await client
      .from(profilesTable)
      .select(selectColumns)
      .contains(aliasesColumn, [participantKey])
      .maybeSingle();
    if (byAlias.error) throw byAlias.error;
    if (byAlias.data) {
      return expandAliasVariants([...(byAlias.data[aliasesColumn] || []), byAlias.data[studentIdColumn], participantKey]);
    }
    return fallbackAliases;
  }

  async function loadExperimentFiles(participantKey) {
    if (!configuredSupabase()) return FALLBACK_FILES;
    if (!participantKey) return [];
    const config = window.SVT_SUPABASE_CONFIG;
    const client = window.supabase.createClient(config.url, config.anonKey);
    const participantColumn = config.fileParticipantColumn || config.participantIdColumn || "participant_id";
    const participantAliases = await resolveParticipantAliases(client, participantKey);
    const { data, error } = await client
      .from(config.filesTable || "experiment_files")
      .select("*")
      .in(participantColumn, participantAliases)
      .limit(200);
    if (error) throw error;
    return (data || []).map((row) => normalizeExperimentFile(row, client, config));
  }

  async function fetchTrialRows(client, table, file) {
    if (!file?.manifestId) {
      throw new Error("manifest_id가 없는 파일은 CSV를 생성할 수 없습니다.");
    }
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await client
        .from(table)
        .select("*")
        .eq("manifest_id", file.manifestId)
        .order("row_number", { ascending: true })
        .range(from, to);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async function fetchExportProfile(client, participantKey) {
    const config = window.SVT_SUPABASE_CONFIG || {};
    const functionName = config.participantProfileFunction ?? "get_participant_export_profile";
    const fallbackProfile = {
      participant_id: participantKey || "",
    };
    if (!participantKey || !functionName) return fallbackProfile;

    const { data, error } = await client.rpc(functionName, { participant_key: participantKey });
    if (error) {
      return fallbackProfile;
    }
    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile) return fallbackProfile;
    return {
      student_id: profile.student_id || "",
      participant_id: profile.participant_id || participantKey || "",
      age: profile.age ?? "",
      nationality: profile.nationality || "",
      dominant_hand: profile.dominant_hand || "",
      current_education: profile.current_education || "",
    };
  }

  function mergeExportProfile(row, profile) {
    const enriched = { ...row };
    EXPORT_PROFILE_HEADERS.forEach((header) => {
      if (enriched[header] === undefined || enriched[header] === null || enriched[header] === "") {
        enriched[header] = profile[header] ?? "";
      }
    });
    return enriched;
  }

  function valueForHeader(row, header) {
    const column = EXPORT_COLUMN_MAP[header] || header;
    const value = row[column];
    if (value === null || value === undefined) return "";
    if (header === "timestamp") return formatTimestampForCsv(value);
    if (FIXED_DECIMAL_COLUMNS.has(header) && value !== "") {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) ? numberValue.toFixed(6) : value;
    }
    return value;
  }

  function formatTimestampForCsv(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return value;
    return new Date(parsed).toISOString();
  }

  function csvEscape(value) {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildCsv(rows, headers) {
    const lines = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvEscape(valueForHeader(row, header))).join(",")),
    ];
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  function downloadCsv(fileName, csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function App() {
    const fileInputRef = useRef(null);
    const [nickname, setNickname] = useState("");
    const [submittedName, setSubmittedName] = useState("");
    const [submittedParticipantKey, setSubmittedParticipantKey] = useState("");
    const [phase, setPhase] = useState("idle");
    const [participants, setParticipants] = useState([]);
    const [customNames, setCustomNames] = useState([]);
    const [isFocused, setIsFocused] = useState(false);
    const [status, setStatus] = useState("닉네임 목록을 불러오는 중입니다.");
    const [experimentFiles, setExperimentFiles] = useState([]);
    const [activeType, setActiveType] = useState("SVT");
    const [dashboardData, setDashboardData] = useState(null);
    const [selectedPreviewRound, setSelectedPreviewRound] = useState("all");
    const [previewGraphMode, setPreviewGraphMode] = useState("trajectory");
    const [analysisCourse, setAnalysisCourse] = useState("rt-accuracy");
    const [analysisCourseDirection, setAnalysisCourseDirection] = useState("forward");
    const [analysisStarted, setAnalysisStarted] = useState(false);
    const [deepSeekAnalysis, setDeepSeekAnalysis] = useState({ status: "idle", text: "" });
    const [transitionAnalysis, setTransitionAnalysis] = useState({ status: "idle", text: "" });
    const [summaryAnalysis, setSummaryAnalysis] = useState({ status: "idle", text: "" });
    const [itemMapTooltip, setItemMapTooltip] = useState({ visible: false, text: "", x: 0, y: 0 });
    const itemMapTooltipRef = useRef(null);
    const [uploadReview, setUploadReview] = useState(null);
    const [csvExport, setCsvExport] = useState({ id: "", status: "idle", message: "" });

    useEffect(() => {
      let active = true;
      loadDashboardData()
        .then((payload) => {
          if (active) setDashboardData(payload);
        })
        .catch(() => {
          if (active) setDashboardData({ participants: [], rounds: [] });
        });
      loadParticipants()
        .then((people) => {
          if (!active) return;
          setParticipants(people);
          setStatus(people.length ? `${people.length}개의 닉네임을 불러왔습니다.` : "아직 등록된 닉네임이 없습니다.");
        })
        .catch((error) => {
          if (!active) return;
          setStatus(error.message || "닉네임 목록을 불러오지 못했습니다.");
        });
      return () => { active = false; };
    }, []);

    useEffect(() => {
      const start = () => prefetchTotalResults();
      if ("requestIdleCallback" in window) {
        const idleId = window.requestIdleCallback(start, { timeout: 2500 });
        return () => window.cancelIdleCallback?.(idleId);
      }
      const timeoutId = window.setTimeout(start, 1200);
      return () => window.clearTimeout(timeoutId);
    }, []);

    useEffect(() => {
      setSelectedPreviewRound("all");
      setPreviewGraphMode("trajectory");
      setAnalysisCourse("rt-accuracy");
      setAnalysisCourseDirection("forward");
      setAnalysisStarted(false);
      setDeepSeekAnalysis({ status: "idle", text: "" });
      setTransitionAnalysis({ status: "idle", text: "" });
      setSummaryAnalysis({ status: "idle", text: "" });
    }, [submittedName, submittedParticipantKey, activeType]);

    useEffect(() => {
      if (!submittedName) return undefined;
      let active = true;
      setPhase("welcome");
      const checkingTimer = setTimeout(() => {
        if (active) setPhase("checking");
      }, 1050);
      const fileTimer = setTimeout(() => {
        loadExperimentFiles(submittedParticipantKey || submittedName)
          .then((files) => {
            if (!active) return;
            setExperimentFiles(files);
            setPhase("files");
          })
          .catch(() => {
            if (!active) return;
            setExperimentFiles(FALLBACK_FILES);
            setPhase("files");
          });
      }, 2250);
      return () => {
        active = false;
        clearTimeout(checkingTimer);
        clearTimeout(fileTimer);
      };
    }, [submittedName, submittedParticipantKey]);

    const availableNicknames = useMemo(() => {
      const merged = [...participants.map((participant) => participant.displayName), ...customNames];
      return Array.from(new Set(merged.filter(Boolean)));
    }, [participants, customNames]);

    const suggestions = useMemo(() => {
      const query = nickname.trim().toLowerCase();
      if (!query) return availableNicknames.slice(0, 5);
      return availableNicknames.filter((candidate) => candidate.toLowerCase().includes(query)).slice(0, 6);
    }, [availableNicknames, nickname]);

    const isKnownNickname = Boolean(nickname.trim())
      && availableNicknames.some((candidate) => candidate.toLowerCase() === nickname.trim().toLowerCase());

    const canAddNickname = Boolean(nickname.trim())
      && !isKnownNickname;

    const rounds = useMemo(() => {
      const activeFiles = experimentFiles
        .filter((file) => file.type === activeType)
        .slice()
        .sort((a, b) => (a.sortDate || 0) - (b.sortDate || 0) || String(a.id).localeCompare(String(b.id), "ko"));
      return activeFiles.map((file, index) => {
        const round = index + 1;
        const fileName = experimentFileName(submittedName, file);
        return {
          round,
          file,
          label: fileName,
          downloadName: fileName,
        };
      });
    }, [activeType, experimentFiles, submittedName]);

    const analysisOverview = useMemo(() => {
      const typeFiles = experimentFiles.filter((file) => file.type === activeType);
      const readyCount = typeFiles.filter((file) => file.status !== "failed").length;
      const pendingCount = typeFiles.filter((file) => file.status === "pending").length;
      const dateLabels = typeFiles
        .map((file) => file.dateLabel)
        .filter((label) => label && label !== "날짜 미확인");
      const rangeLabel = dateLabels.length
        ? `${dateLabels[0]} - ${dateLabels[dateLabels.length - 1]}`
        : "날짜 미확인";
      return {
        fileCount: typeFiles.length,
        readyCount,
        pendingCount,
        rangeLabel,
        canAnalyze: readyCount > 0,
        link: analysisLinkFor(activeType, submittedParticipantKey || submittedName),
      };
    }, [activeType, experimentFiles, submittedName, submittedParticipantKey]);

    const dashboardParticipant = useMemo(() => (
      activeType === "SVT" && dashboardData
        ? findDashboardParticipant(dashboardData, submittedName, submittedParticipantKey)
        : null
    ), [activeType, dashboardData, submittedName, submittedParticipantKey]);

    useEffect(() => {
      if (!analysisStarted || activeType !== "SVT" || !dashboardData || !dashboardParticipant) {
        setDeepSeekAnalysis((current) => current.status === "idle" ? current : { status: "idle", text: "" });
        return undefined;
      }
      let active = true;
      const averages = averageArrowSeries(dashboardData);
      setDeepSeekAnalysis({ status: "loading", text: "" });
      requestDeepSeekAnalysis(dashboardParticipant, averages, submittedName)
        .then((text) => {
          if (active) setDeepSeekAnalysis({ status: "done", text });
        })
        .catch((error) => {
          if (active) setDeepSeekAnalysis({ status: "error", text: error?.message || "DeepSeek 분석 실패" });
        });
      return () => { active = false; };
    }, [analysisStarted, activeType, dashboardData, dashboardParticipant, submittedName]);

    useEffect(() => {
      if (!analysisStarted || activeType !== "SVT" || !dashboardParticipant) {
        setTransitionAnalysis((current) => current.status === "idle" ? current : { status: "idle", text: "" });
        return undefined;
      }
      const transitions = correctnessTransitions(dashboardParticipant);
      if (!transitions.length) {
        setTransitionAnalysis({ status: "idle", text: "" });
        return undefined;
      }
      let active = true;
      setTransitionAnalysis({ status: "loading", text: "" });
      requestTransitionMovingAverageAnalysis(dashboardParticipant)
        .then((text) => {
          if (active) setTransitionAnalysis({ status: "done", text });
        })
        .catch((error) => {
          if (active) setTransitionAnalysis({ status: "error", text: error?.message || "이동평균 분석 실패" });
        });
      return () => { active = false; };
    }, [analysisStarted, activeType, dashboardParticipant]);

    useEffect(() => {
      if (!analysisStarted || activeType !== "SVT" || !dashboardParticipant) {
        setSummaryAnalysis((current) => current.status === "idle" ? current : { status: "idle", text: "" });
        return undefined;
      }
      const transitions = correctnessTransitions(dashboardParticipant);
      const waitingForGraph = deepSeekAnalysis.status === "idle" || deepSeekAnalysis.status === "loading";
      const waitingForTransition = transitions.length > 0 && (transitionAnalysis.status === "idle" || transitionAnalysis.status === "loading");
      if (waitingForGraph || waitingForTransition) {
        setSummaryAnalysis({ status: "loading", text: "" });
        return undefined;
      }
      let active = true;
      const graphText = deepSeekAnalysis.status === "done"
        ? deepSeekAnalysis.text
        : buildGraphExplanation(dashboardParticipant, "all", averageArrowSeries(dashboardData || { participants: [] }));
      const transitionText = transitionAnalysis.status === "done" ? transitionAnalysis.text : "";
      setSummaryAnalysis({ status: "loading", text: "" });
      requestOverallSummaryAnalysis(dashboardParticipant, graphText, transitionText)
        .then((text) => {
          if (active) setSummaryAnalysis({ status: "done", text });
        })
        .catch((error) => {
          if (active) setSummaryAnalysis({ status: "error", text: error?.message || "총평 분석 실패" });
        });
      return () => { active = false; };
    }, [analysisStarted, activeType, dashboardParticipant, dashboardData, deepSeekAnalysis, transitionAnalysis]);

    function handleSubmit(event) {
      event.preventDefault();
      const cleanName = nickname.trim();
      if (!cleanName || !isKnownNickname) {
        setIsFocused(true);
        setStatus(cleanName ? "먼저 닉네임 추가 + 를 눌러 등록하세요." : status);
        return;
      }
      const confirmName = () => {
        setSubmittedName(cleanName);
        setSubmittedParticipantKey(resolveParticipantKey(cleanName));
        setIsFocused(false);
      };
      if (document.startViewTransition) {
        document.startViewTransition(confirmName);
      } else {
        confirmName();
      }
    }

    function selectNickname(name) {
      setNickname(name);
      setIsFocused(false);
    }

    function addNickname() {
      const cleanName = nickname.trim();
      if (!cleanName) return;
      if (canAddNickname) setCustomNames((names) => [...names, cleanName]);
      setNickname(cleanName);
      setIsFocused(false);
      setStatus(`${cleanName} 닉네임이 추가되었습니다. 이제 확인할 수 있습니다.`);
    }

    function startGuidedAnalysis(event) {
      event.preventDefault();
      if (!analysisOverview.canAnalyze) return;
      setSelectedPreviewRound("all");
      setPreviewGraphMode("trajectory");
      setAnalysisCourse("rt-accuracy");
      setAnalysisCourseDirection("forward");
      setAnalysisStarted(true);
      window.setTimeout(() => {
        document.querySelector(".guided-analysis-course")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 280);
    }

    function goToMainPage() {
      setSubmittedName("");
      setSubmittedParticipantKey("");
      setPhase("idle");
      setExperimentFiles([]);
      setUploadReview(null);
      setAnalysisStarted(false);
      setAnalysisCourse("rt-accuracy");
      setSelectedPreviewRound("all");
      setPreviewGraphMode("trajectory");
      setIsFocused(true);
      setStatus("다시 사용할 닉네임을 선택하거나 추가하세요.");
    }

    function addLocalFile(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      const cleanName = submittedName.trim();
      const review = uploadStepsFor(file, cleanName);
      setUploadReview({
        fileName: file.name,
        status: "checking",
        activeStep: 0,
        steps: review.steps,
      });
      const timers = [
        setTimeout(() => {
          setUploadReview((current) => current && { ...current, activeStep: 1 });
        }, 520),
        setTimeout(() => {
          setUploadReview((current) => current && { ...current, activeStep: 2 });
        }, 1040),
        setTimeout(() => {
          if (!review.formatOk) {
            setUploadReview((current) => current && { ...current, status: "failed", activeStep: 0 });
            return;
          }
          const addedFile = {
            id: `local-${activeType}-${file.name}-${file.lastModified}`,
            type: activeType,
            round: 0,
            title: file.name,
            status: "pending",
            sortDate: review.parsedDate.timestamp,
            dateLabel: review.parsedDate.label,
            downloadUrl: URL.createObjectURL(file),
          };
          setExperimentFiles((current) => [...current, addedFile]);
          setUploadReview((current) => current && { ...current, status: "done", activeStep: 3 });
        }, 1620),
        setTimeout(() => {
          setUploadReview((current) => current?.status === "done" ? null : current);
        }, 2600),
      ];
      timers.forEach((timer) => void timer);
      event.target.value = "";
    }

    async function exportCsvFromSupabase(file) {
      if (!configuredSupabase() || !file?.manifestId) return;
      const exportConfig = EXPORT_CONFIG[file.type];
      if (!exportConfig) return;
      setCsvExport({ id: file.id, status: "working", message: "CSV 생성 중" });
      try {
        const config = window.SVT_SUPABASE_CONFIG;
        const client = window.supabase.createClient(config.url, config.anonKey);
        const rows = await fetchTrialRows(client, exportConfig.table, file);
        if (!rows.length) {
          setCsvExport({ id: file.id, status: "failed", message: "row 없음" });
          return;
        }
        const participantKey = file.participantKey || submittedParticipantKey || submittedName;
        const profile = await fetchExportProfile(client, participantKey);
        const csv = buildCsv(rows.map((row) => mergeExportProfile(row, profile)), exportConfig.headers);
        downloadCsv(experimentFileName(submittedName, file), csv);
        setCsvExport({ id: file.id, status: "done", message: `${rows.length}행 생성됨` });
        setTimeout(() => {
          setCsvExport((current) => current.id === file.id ? { id: "", status: "idle", message: "" } : current);
        }, 1800);
      } catch (error) {
        setCsvExport({
          id: file.id,
          status: "failed",
          message: error.message || "생성 실패",
        });
      }
    }

    function resolveParticipantKey(name) {
      const cleanName = name.trim().toLowerCase();
      const match = participants.find((participant) => participantTokenVariants(participant.displayName).includes(cleanName));
      return match?.participantKey || name.trim();
    }

    function goToExperimentGraphCourse() {
      setSelectedPreviewRound("all");
      goToAnalysisCourse("rt-accuracy");
    }

    function goToAnalysisCourse(nextCourse) {
      setAnalysisCourse((currentCourse) => {
        const currentIndex = ANALYSIS_COURSE_ORDER.indexOf(currentCourse);
        const nextIndex = ANALYSIS_COURSE_ORDER.indexOf(nextCourse);
        setAnalysisCourseDirection(nextIndex >= currentIndex ? "forward" : "backward");
        return nextCourse;
      });
    }

    function closeGuidedAnalysis() {
      setAnalysisStarted(false);
      setSelectedPreviewRound("all");
      setPreviewGraphMode("trajectory");
      setAnalysisCourse("rt-accuracy");
      setAnalysisCourseDirection("forward");
      setTransitionAnalysis({ status: "idle", text: "" });
      setSummaryAnalysis({ status: "idle", text: "" });
      setItemMapTooltip({ visible: false, text: "", x: 0, y: 0 });
    }

    function moveItemMapTooltip(event, text = itemMapTooltip.text) {
      if (!text) return;
      const offset = 14;
      const tooltipNode = itemMapTooltipRef.current;
      const width = tooltipNode?.offsetWidth || Math.min(360, window.innerWidth - 24);
      const height = tooltipNode?.offsetHeight || Math.min(170, 58 + String(text || "").split("\n").length * 18);
      const left = Math.min(window.innerWidth - width - 10, event.clientX + offset);
      const top = Math.min(window.innerHeight - height - 10, event.clientY + offset);
      const x = Math.max(10, left);
      const y = Math.max(10, top);
      if (tooltipNode) {
        tooltipNode.style.left = `${x}px`;
        tooltipNode.style.top = `${y}px`;
      }
      setItemMapTooltip({
        visible: true,
        text,
        x,
        y,
      });
    }

    function hideItemMapTooltip() {
      setItemMapTooltip((current) => ({ ...current, visible: false }));
    }

    const itemMapTooltipHandlers = {
      show: moveItemMapTooltip,
      move: (event, text) => moveItemMapTooltip(event, text),
      hide: hideItemMapTooltip,
    };

    function renderSvtAnalysisCourse() {
      if (analysisCourse === "forecast") {
        return renderForecastPreview(
          dashboardParticipant,
          goToExperimentGraphCourse,
          () => goToAnalysisCourse("ox")
        );
      }
      if (analysisCourse === "ox") {
        return renderOxResponsePreview(
          dashboardParticipant,
          () => goToAnalysisCourse("forecast"),
          () => goToAnalysisCourse("change")
        );
      }
      if (analysisCourse === "change") {
        return renderCorrectnessChangePreview(
          dashboardParticipant,
          () => goToAnalysisCourse("ox"),
          () => goToAnalysisCourse("item-map"),
          transitionAnalysis
        );
      }
      if (analysisCourse === "item-map") {
        return renderItemMapPreview(
          dashboardParticipant,
          () => goToAnalysisCourse("change"),
          () => goToAnalysisCourse("item-map-full")
        );
      }
      if (analysisCourse === "item-map-full") {
        return renderFullItemMapPreview(
          dashboardParticipant,
          () => {
            hideItemMapTooltip();
            goToAnalysisCourse("item-map");
          },
          () => {
            hideItemMapTooltip();
            goToAnalysisCourse("summary");
          },
          itemMapTooltipHandlers
        );
      }
      if (analysisCourse === "summary") {
        return renderFinalSummaryPreview(
          dashboardParticipant,
          () => goToAnalysisCourse("item-map-full"),
          goToMainPage,
          summaryAnalysis
        );
      }
      return renderRtAccuracyPreview(
        dashboardData,
        dashboardParticipant,
        selectedPreviewRound,
        setSelectedPreviewRound,
        previewGraphMode,
        setPreviewGraphMode,
        closeGuidedAnalysis,
        submittedName,
        deepSeekAnalysis,
        () => goToAnalysisCourse("forecast")
      );
    }

    function renderNicknameForm() {
      return h("form", { className: "nickname-form", onSubmit: handleSubmit },
        h("div", { className: "form-kicker" }, "Private lookup"),
        h("label", { className: "field-label", htmlFor: "nicknameInput" }, "당신의 닉네임을 입력하세요."),
        h("div", { className: "lookup-field" },
          h("div", { className: "input-row" },
            h("input", {
              id: "nicknameInput",
              className: "nickname-input",
              type: "text",
              value: nickname,
              onChange: (event) => {
                setNickname(event.target.value);
                setIsFocused(true);
              },
              onFocus: () => setIsFocused(true),
              placeholder: "예: applebanana",
              autoComplete: "off",
            }),
            h("button", { className: "button", type: "submit", disabled: !isKnownNickname }, "확인")
          ),
          isFocused && h("div", { className: "suggestion-panel", role: "listbox", "aria-label": "닉네임 후보" },
            suggestions.length
              ? suggestions.map((name) => h("button", {
                key: name,
                className: "suggestion-item",
                type: "button",
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => selectNickname(name),
              }, name))
              : h("div", { className: "suggestion-empty" }, "일치하는 닉네임이 없습니다."),
            h("button", {
              className: canAddNickname ? "add-nickname" : "add-nickname disabled",
              type: "button",
              disabled: !nickname.trim(),
              onMouseDown: (event) => event.preventDefault(),
              onClick: addNickname,
            }, "닉네임 추가 +")
          )
        ),
        h("p", { className: "form-note" },
          submittedName
            ? `${submittedName} 님으로 확인되었습니다.`
            : isKnownNickname ? "등록된 닉네임입니다. 확인을 눌러 계속하세요." : status
        )
      );
    }

    function renderFlow() {
      if (!submittedName) return null;
      return h("section", { className: `reveal-flow phase-${phase}${analysisStarted ? " analysis-active" : ""}`, "aria-live": "polite" },
        h("div", { className: "welcome-card" },
          h("div", null,
            h("p", { className: "eyebrow" }, "welcome"),
            h("h2", null, `${submittedName}님 환영합니다.`)
          ),
          h("button", { className: "change-name", type: "button", onClick: goToMainPage }, "메인페이지로")
        ),
        phase !== "welcome" && h("div", { className: "checking-card" },
          h("p", null, "당신의 실험 파일을 점검합니다."),
          h("span", null, phase === "checking" ? "데이터베이스 확인 중" : "확인 완료")
        ),
        phase === "files" && h("div", { className: "experiment-panel" },
          h("div", { className: "round-stack" },
            h("div", { className: analysisStarted ? "analysis-prelude is-exiting" : "analysis-prelude" },
              uploadReview && h("div", { className: `upload-review ${uploadReview.status}` },
                h("p", null, uploadReview.status === "failed" ? "파일을 추가할 수 없습니다." : "데이터를 확인합니다."),
                h("strong", null, uploadReview.fileName),
                h("div", { className: "review-steps" },
                  uploadReview.steps.map((step, index) => h("div", {
                    className: index < uploadReview.activeStep || uploadReview.status === "done"
                      ? "review-step done"
                      : index === uploadReview.activeStep
                        ? "review-step active"
                        : "review-step",
                    key: step.id,
                  },
                    h("span", null, step.label),
                    h("small", null, step.detail)
                  ))
                )
              ),
              !rounds.length && h("div", { className: "round-empty" }, `${activeType} 파일이 아직 없습니다.`),
              rounds.map((item) => h("div", { className: item.file ? "round-item ready" : "round-item", key: item.round },
                h("span", { className: "round-index" }, `${item.round}회`),
                h("span", { className: "round-title" }, item.label),
                item.file?.downloadUrl
                  ? h("a", { className: "round-download", href: item.file.downloadUrl, download: item.downloadName }, "다운로드")
                  : h("button", {
                    className: "round-download",
                    type: "button",
                    disabled: csvExport.id === item.file.id && csvExport.status === "working",
                    onClick: () => exportCsvFromSupabase(item.file),
                  }, csvExport.id === item.file.id ? csvExport.message : "CSV 다운로드")
              )),
              h("button", { className: "add-round", type: "button", onClick: () => fileInputRef.current?.click() }, "+ 더 추가하기"),
              h("div", { className: "analysis-readiness", "aria-label": "데이터 분석 준비 상태" },
                h("div", { className: "analysis-copy" },
                  h("span", null, "점검 요약"),
                  h("strong", null, `${activeType} ${analysisOverview.readyCount}/${analysisOverview.fileCount}개 준비됨`),
                  h("p", null, analysisOverview.fileCount
                    ? `${analysisOverview.rangeLabel}${analysisOverview.pendingCount ? ` · 임시 추가 ${analysisOverview.pendingCount}개` : ""}`
                    : "분석할 파일이 아직 없습니다.")
                ),
                analysisOverview.canAnalyze
                  ? h("button", { className: "analysis-action", type: "button", onClick: startGuidedAnalysis }, "데이터 분석")
                  : h("button", { className: "analysis-action disabled", type: "button", disabled: true },
                    "분석 대기"
                  )
            )
            ),
            analysisStarted && h("div", { className: "guided-analysis-course" },
              activeType === "SVT" && dashboardData
                ? h("div", {
                  className: `analysis-course-transition direction-${analysisCourseDirection}`,
                  key: analysisCourse,
                }, renderSvtAnalysisCourse())
                : [
                  h("div", { className: "course-intro", key: "intro" },
                    h("span", null, "첫 번째 코스"),
                    h("strong", null, `${submittedName}님의 실험 그래프부터 보겠습니다.`),
                    h("p", null, "전체 흐름을 먼저 보고, 회차별 점을 하나씩 짚으면서 반응속도와 정확도의 균형을 해석합니다.")
                  ),
                  h("section", { className: "analysis-guide-panel", key: "fallback" },
                    h("h3", null, `${activeType} 안내 분석`),
                    h("p", { className: "guide-empty" }, "이 실험 유형의 안내 분석은 준비 중입니다.")
                  ),
                ]
            )
          ),
          h("input", {
            ref: fileInputRef,
            className: "hidden-file-input",
            type: "file",
            accept: ".xlsx,.csv,.numbers",
            onChange: addLocalFile,
          })
        )
      );
    }

    return h(React.Fragment, null,
      h("main", { className: submittedName ? `landing-shell is-confirmed${analysisStarted ? " is-analysis-expanded" : ""}` : "landing-shell" },
        h("nav", { className: "top-bar", "aria-label": "SVT navigation" },
          h("div", { className: "brand" }, "SVT Studio"),
          h("a", {
            className: "global-analysis-link",
            href: "./total-results/",
            onMouseEnter: prefetchTotalResults,
            onFocus: prefetchTotalResults,
            onTouchStart: prefetchTotalResults,
          }, "전체 데이터 분석")
        ),
        h("section", { className: "landing-hero", "aria-label": "실험 파일 확인" },
          !submittedName && h("div", { className: "hero-copy" },
            h("p", { className: "eyebrow" }, "SVT · MAZE 실험"),
            h("h1", null, "당신의 ", h("br"), "실험 분석 결과를 ", h("br"), "확인하세요"),
            h("p", { className: "summary-text" }, "SVT와 MAZE 실험 분석 결과를 보여줍니다.")
          ),
          h("div", { className: "interaction-stack" },
            !submittedName && renderNicknameForm(),
            renderFlow()
          )
        )
      ),
      itemMapTooltip.visible && h("div", {
        ref: itemMapTooltipRef,
        className: "main-item-tooltip is-visible",
        style: {
          left: `${itemMapTooltip.x}px`,
          top: `${itemMapTooltip.y}px`,
        },
      }, itemMapTooltip.text)
    );
  }

export default App;
