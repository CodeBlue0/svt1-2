(function () {
  const params = new URLSearchParams(window.location.search);
  const requestedDatasetKey = (params.get("dataset") || "svt").toLowerCase();
  const TASK_DATASETS = {
    rsvp: { key: "rsvp", label: "RSVP", taskQuery: "rsvp", itemFallback: "RSVP 문항" },
    maze: { key: "maze", label: "MAZE", taskQuery: "maze", itemFallback: "MAZE 문항" },
  };
  const datasetConfig = TASK_DATASETS[requestedDatasetKey] || null;
  const datasetKey = datasetConfig?.key || "svt";
  const PAGE_SIZE = 1000;
  activateDatasetSwitcher(datasetKey);

  if (!datasetConfig) {
    window.SVT_DASHBOARD_DATA_READY = loadScriptOnce("data.js").then(() => window.SVT_DASHBOARD_DATA);
    return;
  }

  preserveDatasetLinks(datasetKey);

  window.SVT_DASHBOARD_DATA_READY = loadTaskDashboardData(datasetConfig)
    .then((payload) => {
      window.SVT_DASHBOARD_DATA = payload;
      return payload;
    })
    .catch((error) => {
      console.error(error);
      return {
        schemaVersion: 1,
        datasetKey: datasetConfig.key,
        datasetLabel: datasetConfig.label,
        generatedAt: new Date().toISOString(),
        rounds: [],
        itemCatalog: { commonItems: [], round1OnlyItems: [], counts: { common: 0, round1Only: 0, byRound: {} } },
        demographics: {},
        quality: { sourceFileCount: 0, selectedFileCount: 0, excludedFileCount: 0, duplicateFileCount: 0, selectedTrialCount: 0, ignoredNonComparableTrialCount: 0, sd3ExcludedCount: 0 },
        participants: [],
        loadError: error.message || `${datasetConfig.label} 데이터를 불러오지 못했습니다.`,
      };
    });

  async function loadTaskDashboardData(taskConfig) {
    const config = window.SVT_SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey || !window.supabase?.createClient) {
      throw new Error(`Supabase 설정이 없어 ${taskConfig.label} 데이터를 불러올 수 없습니다.`);
    }

    const client = window.supabase.createClient(config.url, config.anonKey);
    const participantColumn = config.fileParticipantColumn || config.participantIdColumn || "participant";
    const dateColumn = config.fileDateColumn || "experiment_date";
    const manifestTable = config.filesTable || "organized_manifest";
    const { data: manifests, error } = await client
      .from(manifestTable)
      .select(`id, ${participantColumn}, task, ${dateColumn}, loaded_at`)
      .ilike("task", `%${taskConfig.taskQuery}%`)
      .order(dateColumn, { ascending: true })
      .limit(5000);

    if (error) throw error;
    const usableManifests = (manifests || []).filter((row) => row.id && row[participantColumn]);
    const trialsByManifest = await fetchTaskRowsByManifest(client, usableManifests.map((manifest) => manifest.id), taskConfig);

    return buildPayload(usableManifests, trialsByManifest, { participantColumn, dateColumn, taskConfig });
  }

  async function fetchTaskRowsByManifest(client, manifestIds, taskConfig) {
    const rowsByManifest = new Map();
    for (let batchStart = 0; batchStart < manifestIds.length; batchStart += 80) {
      const batchIds = manifestIds.slice(batchStart, batchStart + 80);
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await client
          .from("maze_trials")
          .select("manifest_id,row_number,task,trial_index,stimulus_id,phrase_type,correct,rt,response_time,korean_phrase,english_phrase,prefix,correct_word,distractor_word,selected_word,selected_phrase,response,experiment_datetime,event_timestamp")
          .in("manifest_id", batchIds)
          .ilike("task", `%${taskConfig.taskQuery}%`)
          .order("manifest_id", { ascending: true })
          .order("row_number", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        (data || []).forEach((row) => {
          const key = String(row.manifest_id);
          if (!rowsByManifest.has(key)) rowsByManifest.set(key, []);
          rowsByManifest.get(key).push(row);
        });
        if (!data || data.length < PAGE_SIZE) break;
      }
    }
    return rowsByManifest;
  }

  function buildPayload(manifests, trialsByManifest, config) {
    const byParticipant = new Map();
    const itemCatalog = new Map();
    const roundItems = new Map();
    const datedManifests = manifests
      .map((manifest) => ({
        ...manifest,
        participant: String(manifest[config.participantColumn] || "").trim(),
        date: String(manifest[config.dateColumn] || ""),
        sortDate: parseDate(manifest[config.dateColumn], manifest.loaded_at),
      }))
      .filter((manifest) => manifest.participant && trialsByManifest.has(String(manifest.id)))
      .sort((a, b) => a.participant.localeCompare(b.participant, "ko") || a.sortDate - b.sortDate || String(a.id).localeCompare(String(b.id)));

    const participantCounters = new Map();
    datedManifests.forEach((manifest) => {
      const participant = byParticipant.get(manifest.participant) || {
        id: manifest.participant,
        nickname: manifest.participant,
        idSource: "participant_id",
        rounds: {},
        sequence: [],
        itemResults: {},
      };
      byParticipant.set(manifest.participant, participant);
      const attemptIndex = (participantCounters.get(manifest.participant) || 0) + 1;
      participantCounters.set(manifest.participant, attemptIndex);
      const rows = trialsByManifest.get(String(manifest.id)) || [];
      const correctValues = rows.map((row) => asNumber(row.correct)).filter(Number.isFinite);
      const rtValues = rows.map((row) => asNumber(row.rt ?? row.response_time)).filter(Number.isFinite);
      const roundNumber = attemptIndex;
      const dateLabel = formatIsoDate(manifest.date || rows[0]?.experiment_datetime || rows[0]?.event_timestamp);
      participant.rounds[String(roundNumber)] = {
        round: roundNumber,
        actualRound: roundNumber,
        label: `${config.taskConfig.key}_${roundNumber}`,
        attemptIndex,
        displayLabel: `R${attemptIndex}`,
        date: dateLabel,
        accuracy: roundFloat(mean(correctValues)),
        rtMean: roundFloat(mean(rtValues)),
        rtMeanRaw: roundFloat(mean(rtValues)),
        trialCount: rows.length,
        rtCount: rtValues.length,
        sd3Excluded: 0,
        confusion: confusionStats(correctValues),
      };
      participant.itemResults[String(roundNumber)] = {};

      rows.forEach((row, rowIndex) => {
        const itemId = itemIdFor(row, rowIndex, config.taskConfig);
        const statement = statementFor(row, config.taskConfig);
        const category = String(row.phrase_type || config.taskConfig.label);
        itemCatalog.set(itemId, { id: itemId, itemCategory: category, statement });
        if (!roundItems.has(roundNumber)) roundItems.set(roundNumber, new Set());
        roundItems.get(roundNumber).add(itemId);
        const correct = asNumber(row.correct);
        const rt = asNumber(row.rt ?? row.response_time);
        const answer = Number.isFinite(correct) && correct >= 0.5 ? "O" : "X";
        participant.itemResults[String(roundNumber)][itemId] = {
          correct: roundFloat(correct),
          rt: roundFloat(rt),
          sd3Excluded: false,
          itemCategory: category,
          statement,
          response: answer,
          correctAnswer: answer,
          trialIndex: asNumber(row.trial_index) || rowIndex + 1,
          attemptIndex,
          displayLabel: `R${attemptIndex}`,
          date: dateLabel,
        };
      });
    });

    const participants = Array.from(byParticipant.values())
      .filter((participant) => Object.keys(participant.rounds).length > 0)
      .map((participant) => {
        const rounds = Object.values(participant.rounds).sort((a, b) => a.attemptIndex - b.attemptIndex);
        participant.models = {
          rtByRound: fitModels(rounds.map((round) => ({ x: round.attemptIndex, y: round.rtMean }))),
          accuracyByRound: fitModels(rounds.map((round) => ({ x: round.attemptIndex, y: round.accuracy }))),
        };
        return participant;
      })
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"));

    const commonIds = commonItemIds(roundItems);
    const commonItems = commonIds.map((id) => itemCatalog.get(id)).filter(Boolean);
    const maxRound = Math.max(0, ...Array.from(roundItems.keys()));
    const selectedTrialCount = participants.flatMap((participant) => Object.values(participant.rounds)).reduce((sum, round) => sum + (round.trialCount || 0), 0);

    return {
      schemaVersion: 1,
      datasetKey: config.taskConfig.key,
      datasetLabel: config.taskConfig.label,
      generatedAt: new Date().toISOString(),
      rounds: Array.from({ length: maxRound }, (_, index) => ({ round: index + 1, label: `${config.taskConfig.key}_${index + 1}` })),
      itemCatalog: {
        commonItems,
        round1OnlyItems: [],
        counts: {
          common: commonItems.length,
          round1Only: 0,
          byRound: Object.fromEntries(Array.from(roundItems.entries()).map(([round, ids]) => [String(round), ids.size])),
        },
      },
      demographics: {},
      quality: {
        sourceFileCount: manifests.length,
        selectedFileCount: trialsByManifest.size,
        excludedFileCount: Math.max(0, manifests.length - trialsByManifest.size),
        duplicateFileCount: 0,
        selectedTrialCount,
        ignoredNonComparableTrialCount: 0,
        sd3ExcludedCount: 0,
      },
      participants,
    };
  }

  function itemIdFor(row, index, taskConfig) {
    return String(row.stimulus_id || row.english_phrase || row.korean_phrase || `${row.phrase_type || taskConfig.key}_${row.trial_index || index + 1}`)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^0-9a-z가-힣_-]+/g, "")
      || `${taskConfig.key}_item_${index + 1}`;
  }

  function statementFor(row, taskConfig) {
    const prefix = String(row.prefix || "").trim();
    const correct = String(row.correct_word || "").trim();
    const distractor = String(row.distractor_word || "").trim();
    const selected = String(row.selected_word || row.selected_phrase || row.response || "").trim();
    const phrase = String(row.korean_phrase || row.english_phrase || "").trim();
    return [phrase, prefix && `${prefix} ...`, correct && distractor && `${correct} / ${distractor}`, selected && `응답: ${selected}`]
      .filter(Boolean)
      .join(" · ") || taskConfig.itemFallback;
  }

  function commonItemIds(roundItems) {
    const sets = Array.from(roundItems.values());
    if (!sets.length) return [];
    return Array.from(sets.reduce((common, ids) => new Set(Array.from(common).filter((id) => ids.has(id)))))
      .sort((a, b) => a.localeCompare(b, "ko"));
  }

  function confusionStats(values) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return null;
    const correct = clean.filter((value) => value >= 0.5).length;
    const wrong = clean.length - correct;
    return {
      included: clean.length,
      counts: { tp: correct, fn: 0, fp: 0, tn: wrong },
      metrics: {
        precision: safeDivide(correct, clean.length),
        sensitivity: safeDivide(correct, clean.length),
        specificity: safeDivide(wrong, clean.length),
        negativePredictiveValue: safeDivide(wrong, clean.length),
        accuracy: safeDivide(correct, clean.length),
      },
    };
  }

  function fitModels(points) {
    const clean = points
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (clean.length < 3) return { status: "insufficient_points", models: {} };
    const xs = clean.map((point) => point.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (minX === maxX) return { status: "insufficient_x_variation", models: {} };
    const sampleXs = Array.from({ length: 25 }, (_, index) => minX + (maxX - minX) * index / 24);
    const yValues = clean.map((point) => point.y);
    const models = {};

    addModel(models, "polynomial", linearFit(clean.map((point) => [1, point.x, point.x * point.x]), yValues), sampleXs, (x, c) => c[0] + c[1] * x + c[2] * x * x);
    addModel(models, "logarithmic", linearFit(clean.map((point) => [1, Math.log(Math.max(point.x, 1e-9))]), yValues), sampleXs, (x, c) => c[0] + c[1] * Math.log(Math.max(x, 1e-9)));
    const decay = 0.58;
    addModel(models, "exponential", linearFit(clean.map((point) => [1, Math.exp(-decay * point.x)]), yValues), sampleXs, (x, c) => c[0] + c[1] * Math.exp(-decay * x), decay);
    return { status: Object.keys(models).length ? "ok" : "fit_failed", models };
  }

  function addModel(models, name, fit, sampleXs, predict, decay) {
    if (!fit) return;
    const coefficients = decay === undefined ? fit.coefficients : [fit.coefficients[0], fit.coefficients[1], decay];
    models[name] = {
      coefficients: coefficients.map((value) => roundFloat(value, 6)),
      r2: roundFloat(fit.r2, 4),
      points: sampleXs.map((x) => ({ x: roundFloat(x, 3), y: roundFloat(predict(x, fit.coefficients), 6) })),
    };
  }

  function linearFit(features, yValues) {
    const n = features[0]?.length || 0;
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
    const ssTot = yValues.reduce((sum, value) => sum + ((value - avgY) ** 2), 0);
    const ssRes = yValues.reduce((sum, value, index) => sum + ((value - predictions[index]) ** 2), 0);
    return { coefficients, r2: ssTot === 0 ? 1 : Math.max(-1, 1 - ssRes / ssTot) };
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
      for (let j = col; j <= n; j += 1) augmented[col][j] /= divisor;
      for (let row = 0; row < n; row += 1) {
        if (row === col) continue;
        const factor = augmented[row][col];
        for (let j = col; j <= n; j += 1) augmented[row][j] -= factor * augmented[col][j];
      }
    }
    return augmented.map((row) => row[n]);
  }

  function parseDate(value, fallback) {
    const parsed = Date.parse(value || fallback || "");
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  function formatIsoDate(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
  }

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function mean(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : NaN;
  }

  function safeDivide(numerator, denominator) {
    return denominator ? numerator / denominator : null;
  }

  function roundFloat(value, digits = 6) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function preserveDatasetLinks(key) {
    document.querySelectorAll('a[href$=".html"], a[href="./"], a[href="index.html"], a[href="insights.html"], a[href="items.html"]').forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (link.hasAttribute("data-dataset-option")) return;
      if (href.startsWith("../") || href.startsWith("http") || href.includes("dataset=")) return;
      const [path, query = ""] = href.split("?");
      const nextParams = new URLSearchParams(query);
      nextParams.set("dataset", key);
      link.setAttribute("href", `${path}?${nextParams.toString()}`);
    });
  }

  function activateDatasetSwitcher(key) {
    document.querySelectorAll("[data-dataset-option]").forEach((link) => {
      const isActive = link.getAttribute("data-dataset-option") === key;
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function loadScriptOnce(src) {
    if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.append(script);
    });
  }
})();
