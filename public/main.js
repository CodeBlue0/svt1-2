(function () {
  const { createElement: h, useEffect, useMemo, useRef, useState } = React;
  const FALLBACK_DATA_SCRIPT = "./total-results/data.js";
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
  const FIXED_DECIMAL_COLUMNS = new Set(["rt", "response_time", "rsvp_word_duration", "rsvp_blank_duration"]);
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

  function normalizeParticipant(row) {
    const config = window.SVT_SUPABASE_CONFIG || {};
    const displayColumn = config.participantDisplayColumn || "display_name";
    const keyColumn = config.participantKeyColumn || config.participantIdColumn || displayColumn;
    const displayName = row[displayColumn] || row.display_name || row.participant || row.nickname || row.student_id || row.id || "";
    const participantKey = row[keyColumn] || row.participant_key || row.participant || displayName;
    return {
      id: String(participantKey || displayName),
      displayName: String(displayName || participantKey),
      participantKey: String(participantKey || displayName),
    };
  }

  function normalizeExperimentFile(row, client, config) {
    const filePath = row[config.filePathColumn] || row.organized_path || row.path || "";
    const title = row.title || row.name || row.file_name || row.filename || basename(filePath) || "실험 파일";
    const typeSource = `${row[config.fileTaskColumn] || row.experiment_type || row.type || row.kind || row.task || title}`.toUpperCase();
    const roundFromTitle = String(title).match(/(\d+)\s*(회|round|차)/i)?.[1];
    const round = Number(row.round || row.attempt_index || row.attempt || row.session || roundFromTitle || 1);
    const dateValue = row[config.fileDateColumn] || row.file_date || row.test_date || row.date || "";
    const parsedDate = parseDateValue(dateValue, filePath || title, row[config.fileLoadedAtColumn] || row.loaded_at || row.created_at);
    return {
      id: String(row.id || row.file_id || row.path || title),
      type: typeSource.includes("MAZE") ? "MAZE" : "SVT",
      round: Number.isFinite(round) ? round : 1,
      title: String(title),
      status: row.status || "ready",
      sortDate: parsedDate.timestamp,
      dateLabel: parsedDate.label,
      downloadUrl: resolveDownloadUrl(row, filePath, client, config),
      sourcePath: filePath,
    };
  }

  function basename(path) {
    return String(path || "").split("/").filter(Boolean).pop() || "";
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

  function resolveDownloadUrl(row, filePath, client, config) {
    const directUrl = row.download_url || row.downloadUrl || row.public_url || row.url || "";
    if (directUrl) return directUrl;
    if (!filePath) return "";
    if (config.publicFileBaseUrl) {
      return `${config.publicFileBaseUrl.replace(/\/$/, "")}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
    }
    if (config.storageBucket && client?.storage?.from) {
      const { data } = client.storage.from(config.storageBucket).getPublicUrl(filePath);
      return data?.publicUrl ? `${data.publicUrl}?download=${encodeURIComponent(basename(filePath))}` : "";
    }
    return "";
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
    if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.append(script);
    });
  }

  async function loadFallbackParticipants() {
    await loadScriptOnce(FALLBACK_DATA_SCRIPT);
    const payload = window.SVT_DASHBOARD_DATA || { participants: [] };
    return (payload.participants || [])
      .map((participant) => normalizeParticipant({ ...participant, display_name: participant.nickname || participant.id }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
  }

  async function loadParticipants() {
    if (!configuredSupabase()) return loadFallbackParticipants();
    const config = window.SVT_SUPABASE_CONFIG;
    const client = window.supabase.createClient(config.url, config.anonKey);
    const displayColumn = config.participantDisplayColumn || "display_name";
    const keyColumn = config.participantKeyColumn || config.participantIdColumn || displayColumn;
    const selectColumns = Array.from(new Set([displayColumn, keyColumn])).join(",");
    const { data, error } = await client.from(config.participantsTable).select(selectColumns).limit(2000);
    if (error) throw error;
    const unique = new Map();
    (data || []).map(normalizeParticipant).forEach((participant) => {
      if (!participant.displayName) return;
      const key = participant.displayName.toLowerCase();
      if (!unique.has(key)) unique.set(key, participant);
    });
    return Array.from(unique.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
  }

  async function loadExperimentFiles(participantKey) {
    if (!configuredSupabase()) return FALLBACK_FILES;
    if (!participantKey) return [];
    const config = window.SVT_SUPABASE_CONFIG;
    const client = window.supabase.createClient(config.url, config.anonKey);
    const participantColumn = config.fileParticipantColumn || config.participantIdColumn || "participant_id";
    const { data, error } = await client
      .from(config.filesTable || "experiment_files")
      .select("*")
      .eq(participantColumn, participantKey)
      .limit(200);
    if (error) throw error;
    return (data || []).map((row) => normalizeExperimentFile(row, client, config));
  }

  async function fetchTrialRows(client, table, sourcePath) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await client
        .from(table)
        .select("*")
        .eq("file_path", sourcePath)
        .order("row_number", { ascending: true })
        .range(from, to);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
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
    const [uploadReview, setUploadReview] = useState(null);
    const [csvExport, setCsvExport] = useState({ id: "", status: "idle", message: "" });

    useEffect(() => {
      let active = true;
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
      if (!submittedName) return undefined;
      let active = true;
      setPhase("welcome");
      const checkingTimer = setTimeout(() => {
        if (active) setPhase("checking");
      }, 720);
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
      }, 1550);
      return () => {
        active = false;
        clearTimeout(checkingTimer);
        clearTimeout(fileTimer);
      };
    }, [submittedName, submittedParticipantKey]);

    const allNames = useMemo(() => {
      const merged = [...participants.map((participant) => participant.displayName), ...customNames];
      return Array.from(new Set(merged.filter(Boolean)));
    }, [participants, customNames]);

    const suggestions = useMemo(() => {
      const query = nickname.trim().toLowerCase();
      if (!query) return allNames.slice(0, 5);
      return allNames.filter((name) => name.toLowerCase().includes(query)).slice(0, 6);
    }, [allNames, nickname]);

    const isKnownNickname = Boolean(nickname.trim())
      && allNames.some((name) => name.toLowerCase() === nickname.trim().toLowerCase());

    const canAddNickname = Boolean(nickname.trim())
      && !isKnownNickname;

    const rounds = useMemo(() => {
      const activeFiles = experimentFiles
        .filter((file) => file.type === activeType)
        .slice()
        .sort((a, b) => (a.sortDate || 0) - (b.sortDate || 0) || a.title.localeCompare(b.title, "ko"));
      return activeFiles.map((file, index) => {
        const round = index + 1;
        return {
          round,
          file,
          label: file.dateLabel ? `${file.dateLabel} · ${file.title}` : file.title,
        };
      });
    }, [activeType, experimentFiles]);

    function handleSubmit(event) {
      event.preventDefault();
      const cleanName = nickname.trim();
      if (!cleanName || !isKnownNickname) {
        setIsFocused(true);
        setStatus(cleanName ? "먼저 닉네임 추가 + 를 눌러 등록하세요." : status);
        return;
      }
      setSubmittedName(cleanName);
      setSubmittedParticipantKey(resolveParticipantKey(cleanName));
      setIsFocused(false);
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

    function goToMainPage() {
      setSubmittedName("");
      setSubmittedParticipantKey("");
      setPhase("idle");
      setExperimentFiles([]);
      setUploadReview(null);
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
      if (!configuredSupabase() || !file?.sourcePath) return;
      const exportConfig = EXPORT_CONFIG[file.type];
      if (!exportConfig) return;
      setCsvExport({ id: file.id, status: "working", message: "CSV 생성 중" });
      try {
        const config = window.SVT_SUPABASE_CONFIG;
        const client = window.supabase.createClient(config.url, config.anonKey);
        const rows = await fetchTrialRows(client, exportConfig.table, file.sourcePath);
        if (!rows.length) {
          setCsvExport({ id: file.id, status: "failed", message: "row 없음" });
          return;
        }
        const csv = buildCsv(rows, exportConfig.headers);
        downloadCsv(file.title, csv);
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
      const match = participants.find((participant) => participant.displayName.toLowerCase() === cleanName);
      return match?.participantKey || name.trim();
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
      return h("section", { className: `reveal-flow phase-${phase}`, "aria-live": "polite" },
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
          h("div", { className: "experiment-tabs", role: "tablist", "aria-label": "실험 유형" },
            ["SVT", "MAZE"].map((type) => h("button", {
              key: type,
              className: activeType === type ? "experiment-tab active" : "experiment-tab",
              type: "button",
              onClick: () => setActiveType(type),
            }, type))
          ),
          h("div", { className: "round-stack" },
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
                ? h("a", { className: "round-download", href: item.file.downloadUrl, download: item.file.title }, "다운로드")
                : h("button", {
                  className: "round-download",
                  type: "button",
                  disabled: csvExport.id === item.file.id && csvExport.status === "working",
                  onClick: () => exportCsvFromSupabase(item.file),
                }, csvExport.id === item.file.id ? csvExport.message : "CSV 다운로드")
            )),
            h("button", { className: "add-round", type: "button", onClick: () => fileInputRef.current?.click() }, "+ 더 추가하기")
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

    return h("main", { className: submittedName ? "landing-shell is-confirmed" : "landing-shell" },
      h("nav", { className: "top-bar", "aria-label": "SVT navigation" },
        h("a", { className: "nav-tab", href: "./total-results/" }, "전체 결과보기"),
        h("div", { className: "brand" }, "SVT Studio")
      ),
      h("section", { className: "landing-hero", "aria-label": "실험 파일 확인" },
        h("div", { className: "hero-copy" },
          h("p", { className: "eyebrow" }, "SVT experiment archive"),
          h("h1", null, "실험 파일을 가장 조용한 방식으로 확인합니다."),
          h("p", { className: "summary-text" }, "닉네임을 확인하면 SVT와 MAZE 파일을 회차별로 점검합니다."),
          h("p", { className: "summary-text secondary" }, "선택은 확인 전까지 입력칸을 채우는 정도로만 작동합니다.")
        ),
        h("div", { className: "interaction-stack" },
          renderNicknameForm(),
          renderFlow()
        )
      )
    );
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();
