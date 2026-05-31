#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import re
import statistics
import unicodedata
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EXTRACTED_DIR = ROOT / "extracted"
METADATA_DIR = ROOT / "metadata"
WEB_DIR = ROOT / "web"
WEB_DATA_JS = WEB_DIR / "data.js"

METRICS_CSV = METADATA_DIR / "svt_experiment_metrics.csv"
TRIALS_CSV = METADATA_DIR / "svt_clean_trials.csv"
FILE_LOG_CSV = METADATA_DIR / "svt_file_log.csv"
DUPLICATE_LOG_CSV = METADATA_DIR / "svt_duplicate_log.csv"
QUALITY_JSON = METADATA_DIR / "svt_quality_summary.json"

ROUND_DIRS = {
    "svt_s1": 1,
    "svt_s2": 2,
    "svt3": 3,
    "svt4": 4,
    "svt5": 5,
    "svt6": 6,
    "svt7": 7,
    "SVT_5_520": 5,
    "SVT_6_525": 6,
    "SVT_7_527": 7,
}
ROUND_LABELS = {round_number: f"svt_{round_number}" for round_number in range(1, 8)}
ROUND_FALLBACK_DATES = {
    1: "2026-05-06",
    2: "2026-05-11",
    3: "2026-05-16",
    4: "2026-05-18",
    5: "2026-05-20",
    6: "2026-05-25",
    7: "2026-05-27",
}
ZIP_ROUNDS = {
    "SVT_5_520.zip": 5,
    "SVT_6_525.zip": 6,
    "SVT_7_527.zip": 7,
}
ZIP_EXTRACTED_DIRS = {
    "SVT_5_520.zip": "SVT_5_520",
    "SVT_6_525.zip": "SVT_6_525",
    "SVT_7_527.zip": "SVT_7_527",
}
LATE_DIR_MARKER = "늦은제출"
NAME_RE = re.compile(r"^(?P<name>.*?)(?P<short_id>\d{6})_(?P<upload_id>\d+)_(?P<record_id>\d+)_")
DATE_RE = re.compile(r"(?P<date>20\d{2}-\d{2}-\d{2})(?:[_T](?P<hour>\d{2})h?(?P<minute>\d{2})?[.:]?(?P<second>\d{2})?)?")
VALID_RESPONSE = {"O", "X"}


def nfc(value: object) -> str:
    return unicodedata.normalize("NFC", str(value or "")).strip()


def decode_bytes(data: bytes) -> tuple[str | None, str, str]:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr", "utf-16"):
        try:
            return data.decode(encoding), encoding, ""
        except UnicodeDecodeError as exc:
            last_error = str(exc)
    try:
        return data.decode("utf-8", errors="replace"), "utf-8-replace", "decode used replacement characters"
    except Exception as exc:  # pragma: no cover - defensive
        return None, "unreadable", str(exc)


def index_map(header: list[str]) -> dict[str, int]:
    indexes: dict[str, int] = {}
    for idx, name in enumerate(header):
        indexes.setdefault(nfc(name), idx)
    return indexes


def value(row: list[str], indexes: dict[str, int], key: str) -> str:
    idx = indexes.get(key)
    if idx is None or idx >= len(row):
        return ""
    return nfc(row[idx])


def parse_number(raw: str) -> float | None:
    if raw == "":
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    return value


def parse_intish(raw: str) -> int | None:
    number = parse_number(raw)
    if number is None:
        return None
    return int(number)


def parse_datetime_from_text(text: str) -> datetime | None:
    match = DATE_RE.search(text)
    if not match:
        return None
    date = match.group("date")
    hour = match.group("hour") or "00"
    minute = match.group("minute") or "00"
    second = match.group("second") or "00"
    try:
        return datetime.strptime(f"{date} {hour}:{minute}:{second}", "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            return datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            return None


def parse_datetime_from_row(row: list[str], indexes: dict[str, int]) -> datetime | None:
    for key in ("date", "timestamp", "session_id"):
        raw = value(row, indexes, key)
        if not raw:
            continue
        if key == "timestamp":
            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                pass
        parsed = parse_datetime_from_text(raw)
        if parsed:
            return parsed
    return None


def file_name_parts(path_or_name: Path | str) -> tuple[str, str, str, str]:
    filename = path_or_name.name if isinstance(path_or_name, Path) else str(path_or_name)
    match = NAME_RE.match(nfc(filename))
    if not match:
        return "", "", "", ""
    return (
        nfc(match.group("name")),
        nfc(match.group("short_id")),
        nfc(match.group("upload_id")),
        nfc(match.group("record_id")),
    )


def identity_key(student_id: str, participant_id: str, name_from_filename: str, short_id: str) -> str:
    student_id = nfc(student_id)
    participant_id = nfc(participant_id)
    name_from_filename = nfc(name_from_filename)
    short_id = nfc(short_id)
    if student_id and student_id.isdigit() and len(student_id) >= 6:
        return f"student_id:{student_id}"
    if participant_id and participant_id.lower() not in {"anonymous", "participant"}:
        return f"participant_id:{participant_id}"
    if short_id and name_from_filename:
        return f"filename:{name_from_filename}:{short_id}"
    if name_from_filename:
        return f"filename:{name_from_filename}"
    if short_id:
        return f"filename_short_id:{short_id}"
    return f"participant_id:{participant_id or 'unknown'}"


def usable_text_participant_id(value: object) -> str:
    cleaned = nfc(value)
    if not cleaned or cleaned.lower() in {"anonymous", "participant"}:
        return ""
    if cleaned.isdigit() and len(cleaned) >= 6:
        return ""
    return cleaned


def numeric_student_like_id(value: object) -> str:
    cleaned = nfc(value)
    return cleaned if cleaned.isdigit() and len(cleaned) >= 6 else ""


def identity_aliases(student_id: str, participant_id: str, name_from_filename: str, short_id: str, name_unique: bool = False) -> list[str]:
    aliases: list[str] = []
    student_numeric = numeric_student_like_id(student_id)
    participant_numeric = numeric_student_like_id(participant_id)
    participant_text = usable_text_participant_id(participant_id)
    if student_numeric:
        aliases.append(f"student_numeric:{student_numeric}")
    if participant_numeric:
        aliases.append(f"student_numeric:{participant_numeric}")
    if participant_text:
        aliases.append(f"participant_text:{participant_text.lower()}")
    name = nfc(name_from_filename)
    short = nfc(short_id)
    if name and short:
        aliases.append(f"filename_name_short:{name}:{short}")
    if name and name_unique:
        aliases.append(f"filename_name_unique:{name}")
    if not aliases:
        aliases.append(identity_key(student_id, participant_id, name_from_filename, short_id))
    return aliases


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, item: str) -> str:
        self.parent.setdefault(item, item)
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]

    def union(self, left: str, right: str) -> None:
        root_left = self.find(left)
        root_right = self.find(right)
        if root_left == root_right:
            return
        self.parent[max(root_left, root_right)] = min(root_left, root_right)


def canonical_identity_key(aliases: set[str]) -> str:
    participant_texts = sorted(alias.split(":", 1)[1] for alias in aliases if alias.startswith("participant_text:"))
    if participant_texts:
        return f"participant_id:{participant_texts[0]}"
    student_ids = sorted(alias.split(":", 1)[1] for alias in aliases if alias.startswith("student_numeric:"))
    if student_ids:
        return f"student_id:{student_ids[0]}"
    name_short = sorted(alias.split(":", 1)[1] for alias in aliases if alias.startswith("filename_name_short:"))
    if name_short:
        return f"filename:{name_short[0]}"
    name_unique = sorted(alias.split(":", 1)[1] for alias in aliases if alias.startswith("filename_name_unique:"))
    if name_unique:
        return f"filename:{name_unique[0]}"
    return sorted(aliases)[0]


def resolve_identity_links(records: list[FileRecord], trials_by_file: dict[str, list[Trial]]) -> None:
    """Merge per-file identities across participant ID, student ID, and filename name.

    Some participants entered a privacy-preserving text ID in one round but a
    numeric student ID in another. Filename name+short-id is the bridge that lets
    those rounds stay under one internal identity before duplicate removal.
    Name-only aliases are used only when the filename name maps to a single
    short-id globally, avoiding accidental merges such as homonyms.
    """
    name_to_shorts: dict[str, set[str]] = defaultdict(set)
    for record in records:
        if record.status == "candidate" and record.name_from_filename and record.short_id:
            name_to_shorts[record.name_from_filename].add(record.short_id)

    uf = UnionFind()
    record_aliases: dict[str, list[str]] = {}
    for record in records:
        if record.status != "candidate":
            continue
        name_unique = bool(record.name_from_filename) and len(name_to_shorts.get(record.name_from_filename, set())) == 1
        aliases = identity_aliases(record.student_id, record.participant_id, record.name_from_filename, record.short_id, name_unique)
        record_aliases[record.rel_path] = aliases
        first = aliases[0]
        for alias in aliases[1:]:
            uf.union(first, alias)

    root_aliases: dict[str, set[str]] = defaultdict(set)
    for aliases in record_aliases.values():
        for alias in aliases:
            root_aliases[uf.find(alias)].add(alias)
    root_to_key = {root: canonical_identity_key(aliases) for root, aliases in root_aliases.items()}

    for record in records:
        aliases = record_aliases.get(record.rel_path)
        if not aliases:
            continue
        canonical = root_to_key[uf.find(aliases[0])]
        record.identity_key = canonical
        for trial in trials_by_file.get(record.rel_path, []):
            trial.identity_key = canonical


def display_name(student_ids: set[str], participant_ids: set[str], names: set[str], key: str) -> str:
    usable_names = sorted(x for x in names if x)
    if usable_names:
        return usable_names[0]
    usable_participants = sorted(x for x in participant_ids if x and x.lower() not in {"anonymous", "participant"})
    if usable_participants:
        return usable_participants[0]
    usable_students = sorted(x for x in student_ids if x)
    if usable_students:
        return usable_students[0]
    return key.split(":", 1)[-1]


@dataclass
class Trial:
    source_file: str
    encoding: str
    identity_key: str
    participant_id: str
    student_id: str
    name_from_filename: str
    short_id: str
    round_number: int
    round_label: str
    task: str
    trial_index: int
    stimulus_id: str
    item_category: str
    statement: str
    response: str
    correct_answer: str
    correct: float | None
    rt: float | None
    timestamp: str
    file_datetime: datetime | None
    row_datetime: datetime | None
    selected_file: bool = True
    rt_sd3_excluded: bool = False


@dataclass
class FileRecord:
    path: Path
    rel_path: str
    status: str
    reason: str = ""
    encoding: str = ""
    task: str = "unknown"
    identity_key: str = ""
    participant_id: str = ""
    student_id: str = ""
    name_from_filename: str = ""
    short_id: str = ""
    round_number: int | None = None
    round_label: str = ""
    assignment_rule: str = ""
    file_datetime: datetime | None = None
    valid_trials: int = 0
    selected: bool = False
    duplicate_of: str = ""


@dataclass(frozen=True)
class CandidateSource:
    rel_path: str
    name: str
    parent_name: str
    suffix: str
    data: bytes | None = None
    path: Path | None = None
    archive_round: int | None = None

    @classmethod
    def from_path(cls, path: Path) -> CandidateSource:
        return cls(
            rel_path=str(path.relative_to(ROOT)),
            name=path.name,
            parent_name=path.parent.name,
            suffix=path.suffix,
            path=path,
        )

    @classmethod
    def from_zip_member(cls, archive: Path, member_name: str, data: bytes, archive_round: int | None) -> CandidateSource:
        member_path = Path(member_name)
        return cls(
            rel_path=f"{archive.relative_to(ROOT)}::{member_name}",
            name=member_path.name,
            parent_name=archive.stem,
            suffix=member_path.suffix,
            data=data,
            path=archive,
            archive_round=archive_round,
        )

    def read_bytes(self) -> bytes:
        if self.data is not None:
            return self.data
        if self.path is None:
            raise FileNotFoundError(self.rel_path)
        return self.path.read_bytes()


def discover_round_anchors() -> dict[int, datetime]:
    dates: dict[int, list[datetime]] = defaultdict(list)
    for dir_name, round_number in ROUND_DIRS.items():
        phase_dir = EXTRACTED_DIR / dir_name
        for path in phase_dir.glob("*.csv"):
            parsed = parse_datetime_from_text(nfc(path.name))
            if parsed:
                dates[round_number].append(parsed)
    anchors: dict[int, datetime] = {}
    for round_number, values in dates.items():
        ordinal = sorted(dt.toordinal() for dt in values)[len(values) // 2]
        anchors[round_number] = datetime.fromordinal(ordinal)
    for round_number, date in ROUND_FALLBACK_DATES.items():
        anchors.setdefault(round_number, datetime.strptime(date, "%Y-%m-%d"))
    return anchors


def assign_round(path: Path | CandidateSource, first_row_datetime: datetime | None, anchors: dict[int, datetime]) -> tuple[int | None, str, datetime | None]:
    if isinstance(path, CandidateSource):
        parent = nfc(path.parent_name)
        filename = nfc(path.name)
        archive_round = path.archive_round
    else:
        parent = nfc(path.parent.name)
        filename = nfc(path.name)
        archive_round = ZIP_ROUNDS.get(path.name)
    file_dt = parse_datetime_from_text(filename) or first_row_datetime
    if archive_round is not None:
        return archive_round, "zip_archive", file_dt
    if parent in ROUND_DIRS:
        return ROUND_DIRS[parent], "folder", file_dt
    if LATE_DIR_MARKER in parent and file_dt:
        nearest_round = min(anchors, key=lambda round_number: (abs((file_dt.date() - anchors[round_number].date()).days), round_number))
        return nearest_round, "late_nearest_date", file_dt
    return None, "unassigned", file_dt


def iter_candidate_files() -> list[CandidateSource]:
    sources: list[CandidateSource] = []
    extracted_round_dirs = {name for name in ZIP_EXTRACTED_DIRS.values() if (EXTRACTED_DIR / name).is_dir()}
    for path in sorted(candidate for candidate in EXTRACTED_DIR.rglob("*") if candidate.is_file()):
        if path.suffix.lower() == ".zip" and path.name in ZIP_ROUNDS:
            if ZIP_EXTRACTED_DIRS[path.name] in extracted_round_dirs:
                continue
            try:
                with zipfile.ZipFile(path) as archive:
                    for info in archive.infolist():
                        if info.is_dir():
                            continue
                        sources.append(CandidateSource.from_zip_member(path, info.filename, archive.read(info), ZIP_ROUNDS[path.name]))
            except zipfile.BadZipFile:
                sources.append(CandidateSource.from_path(path))
            continue
        sources.append(CandidateSource.from_path(path))
    return sorted(sources, key=lambda source: source.rel_path)


def read_trials(path: Path | CandidateSource, anchors: dict[int, datetime]) -> tuple[FileRecord, list[Trial]]:
    source = path if isinstance(path, CandidateSource) else CandidateSource.from_path(path)
    record_path = source.path or Path(source.rel_path)
    record = FileRecord(path=record_path, rel_path=source.rel_path, status="excluded")
    if source.suffix.lower() != ".csv":
        record.reason = f"unsupported extension {source.suffix or '<none>'}"
        return record, []

    text, encoding, decode_warning = decode_bytes(source.read_bytes())
    record.encoding = encoding
    if text is None:
        record.reason = decode_warning or "unreadable"
        return record, []

    rows_iter = csv.reader(text.splitlines())
    header = next(rows_iter, None)
    if not header:
        record.reason = "empty csv"
        return record, []
    indexes = index_map(header)
    required = {"correct", "rt"}
    if not required.issubset(indexes):
        record.reason = "missing correct/rt columns"
        return record, []

    raw_rows = list(rows_iter)
    first_data_row = next((row for row in raw_rows if any(cell.strip() for cell in row)), [])
    first_row_datetime = parse_datetime_from_row(first_data_row, indexes) if first_data_row else None
    round_number, assignment_rule, file_dt = assign_round(path, first_row_datetime, anchors)
    record.round_number = round_number
    record.round_label = ROUND_LABELS.get(round_number or 0, "")
    record.assignment_rule = assignment_rule
    record.file_datetime = file_dt
    if round_number is None:
        record.reason = "not assigned to an SVT round"
        return record, []

    name_from_filename, short_id, _, _ = file_name_parts(source.name)
    trials: list[Trial] = []
    for row in raw_rows:
        if not any(cell.strip() for cell in row):
            continue
        task = value(row, indexes, "task") or "unknown"
        if task != "cst":
            continue
        participant_id = value(row, indexes, "participant_id") or short_id
        student_id = value(row, indexes, "student_id")
        match_key = identity_key(student_id, participant_id, name_from_filename, short_id)
        correct = parse_number(value(row, indexes, "correct"))
        rt = parse_number(value(row, indexes, "rt"))
        response = value(row, indexes, "response")
        correct_answer = value(row, indexes, "correct_answer")
        trial_index = parse_intish(value(row, indexes, "trial_index")) or (len(trials) + 1)
        if correct is None and response in VALID_RESPONSE and correct_answer in VALID_RESPONSE:
            correct = 1.0 if response == correct_answer else 0.0
        if correct is None and rt is None:
            continue
        trials.append(
            Trial(
                source_file=source.rel_path,
                encoding=encoding,
                identity_key=match_key,
                participant_id=participant_id,
                student_id=student_id,
                name_from_filename=name_from_filename,
                short_id=short_id,
                round_number=round_number,
                round_label=ROUND_LABELS[round_number],
                task=task,
                trial_index=trial_index,
                stimulus_id=value(row, indexes, "stimulus_id"),
                item_category=value(row, indexes, "item_category"),
                statement=value(row, indexes, "statement"),
                response=response,
                correct_answer=correct_answer,
                correct=correct,
                rt=rt,
                timestamp=value(row, indexes, "timestamp"),
                file_datetime=file_dt,
                row_datetime=parse_datetime_from_row(row, indexes),
            )
        )

    if not trials:
        record.reason = "no usable cst trials"
        return record, []

    first = trials[0]
    record.status = "candidate"
    record.reason = decode_warning
    record.task = "cst"
    record.identity_key = first.identity_key
    record.participant_id = first.participant_id
    record.student_id = first.student_id
    record.name_from_filename = first.name_from_filename
    record.short_id = first.short_id
    record.valid_trials = len(trials)
    return record, trials


def choose_representative_files(records: list[FileRecord], trials_by_file: dict[str, list[Trial]]) -> tuple[list[Trial], list[dict[str, str]]]:
    groups: dict[tuple[str, int, str], list[FileRecord]] = defaultdict(list)
    for record in records:
        if record.status == "candidate" and record.round_number is not None:
            groups[(record.identity_key, record.round_number, record.task)].append(record)

    selected_trials: list[Trial] = []
    duplicate_rows: list[dict[str, str]] = []
    for key, candidates in groups.items():
        def sort_key(record: FileRecord) -> tuple[int, datetime, str]:
            return (record.valid_trials, record.file_datetime or datetime.min, record.rel_path)

        winner = max(candidates, key=sort_key)
        winner.status = "selected"
        winner.selected = True
        for trial in trials_by_file[winner.rel_path]:
            trial.selected_file = True
            selected_trials.append(trial)
        for record in candidates:
            if record is winner:
                continue
            record.status = "duplicate"
            record.selected = False
            record.duplicate_of = winner.rel_path
            record.reason = "same identity/round/task; representative chosen by valid trial count then later file date"
            for trial in trials_by_file[record.rel_path]:
                trial.selected_file = False
            duplicate_rows.append(
                {
                    "identity_key": key[0],
                    "round_number": str(key[1]),
                    "task": key[2],
                    "duplicate_file": record.rel_path,
                    "selected_file": winner.rel_path,
                    "duplicate_valid_trials": str(record.valid_trials),
                    "selected_valid_trials": str(winner.valid_trials),
                    "reason": record.reason,
                }
            )
    return selected_trials, duplicate_rows


def apply_sd3(trials: list[Trial]) -> int:
    groups: dict[tuple[str, int], list[Trial]] = defaultdict(list)
    for trial in trials:
        if trial.rt is not None:
            groups[(trial.identity_key, trial.round_number)].append(trial)
    excluded = 0
    for group in groups.values():
        values = [trial.rt for trial in group if trial.rt is not None]
        if len(values) < 3:
            continue
        mean = statistics.fmean(values)
        stdev = statistics.pstdev(values)
        if stdev <= 0:
            continue
        low, high = mean - 3 * stdev, mean + 3 * stdev
        for trial in group:
            if trial.rt is not None and not (low <= trial.rt <= high):
                trial.rt_sd3_excluded = True
                excluded += 1
    return excluded


def safe_divide(a: float, b: float) -> float | None:
    if b == 0:
        return None
    return a / b


def round_float(value: float | None, digits: int = 6) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def confusion_stats(trials: list[Trial]) -> dict[str, Any] | None:
    counts = {"tp": 0, "fn": 0, "fp": 0, "tn": 0}
    included = 0
    skipped = 0
    for trial in trials:
        actual = trial.correct_answer
        pred = trial.response
        if actual not in VALID_RESPONSE or pred not in VALID_RESPONSE:
            skipped += 1
            continue
        included += 1
        if actual == "O" and pred == "O":
            counts["tp"] += 1
        elif actual == "O" and pred == "X":
            counts["fn"] += 1
        elif actual == "X" and pred == "O":
            counts["fp"] += 1
        elif actual == "X" and pred == "X":
            counts["tn"] += 1
    if included == 0:
        return None
    tp, fn, fp, tn = counts["tp"], counts["fn"], counts["fp"], counts["tn"]
    metrics = {
        "precision": safe_divide(tp, tp + fp),
        "sensitivity": safe_divide(tp, tp + fn),
        "specificity": safe_divide(tn, tn + fp),
        "negativePredictiveValue": safe_divide(tn, tn + fn),
        "accuracy": safe_divide(tp + tn, included),
    }
    return {
        "included": included,
        "skipped": skipped,
        "cells": {key: round_float(value / included) for key, value in counts.items()},
        "counts": counts,
        "metrics": {key: round_float(value) for key, value in metrics.items()},
    }


def solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float] | None:
    n = len(vector)
    aug = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda row: abs(aug[row][col]))
        if abs(aug[pivot][col]) < 1e-12:
            return None
        aug[col], aug[pivot] = aug[pivot], aug[col]
        divisor = aug[col][col]
        for j in range(col, n + 1):
            aug[col][j] /= divisor
        for row in range(n):
            if row == col:
                continue
            factor = aug[row][col]
            for j in range(col, n + 1):
                aug[row][j] -= factor * aug[col][j]
    return [aug[i][n] for i in range(n)]


def linear_fit(features: list[list[float]], y_values: list[float]) -> tuple[list[float], float] | None:
    if not features or len(features) != len(y_values):
        return None
    p = len(features[0])
    xtx = [[0.0 for _ in range(p)] for _ in range(p)]
    xty = [0.0 for _ in range(p)]
    for row, y in zip(features, y_values):
        for i in range(p):
            xty[i] += row[i] * y
            for j in range(p):
                xtx[i][j] += row[i] * row[j]
    coeffs = solve_linear_system(xtx, xty)
    if coeffs is None:
        return None
    predictions = [sum(c * x for c, x in zip(coeffs, row)) for row in features]
    mean_y = statistics.fmean(y_values)
    ss_tot = sum((y - mean_y) ** 2 for y in y_values)
    ss_res = sum((y - pred) ** 2 for y, pred in zip(y_values, predictions))
    r2 = 1.0 if ss_tot == 0 else max(-1.0, 1 - ss_res / ss_tot)
    return coeffs, r2


def fit_models(points: list[dict[str, float]]) -> dict[str, Any]:
    clean = [(float(p["x"]), float(p["y"])) for p in points if p.get("x") is not None and p.get("y") is not None and math.isfinite(p["y"])]
    if len(clean) < 3:
        return {"status": "insufficient_points", "models": {}}
    xs = [p[0] for p in clean]
    min_x, max_x = min(xs), max(xs)
    if min_x == max_x:
        return {"status": "insufficient_x_variation", "models": {}}
    sample_xs = [min_x + (max_x - min_x) * i / 24 for i in range(25)]
    models: dict[str, Any] = {}

    def add_model(name: str, coeffs: list[float], r2: float, predict) -> None:
        models[name] = {
            "coefficients": [round_float(c, 6) for c in coeffs],
            "r2": round_float(r2, 4),
            "points": [{"x": round_float(x, 3), "y": round_float(predict(x), 6)} for x in sample_xs],
        }

    degree = 2 if len(clean) >= 3 else 1
    poly_features = [[x ** power for power in range(degree + 1)] for x, _ in clean]
    poly = linear_fit(poly_features, [y for _, y in clean])
    if poly:
        coeffs, r2 = poly
        add_model("polynomial", coeffs, r2, lambda x, c=coeffs: sum(value * (x ** i) for i, value in enumerate(c)))

    if min(xs) > 0:
        log_features = [[1.0, math.log(x)] for x, _ in clean]
        log_fit = linear_fit(log_features, [y for _, y in clean])
        if log_fit:
            coeffs, r2 = log_fit
            add_model("logarithmic", coeffs, r2, lambda x, c=coeffs: c[0] + c[1] * math.log(max(x, 1e-9)))

    exp_fit: tuple[float, list[float], float] | None = None
    y_values = [y for _, y in clean]
    for step in range(1, 121):
        decay = step / 50
        exp_features = [[1.0, math.exp(-decay * x)] for x, _ in clean]
        fit = linear_fit(exp_features, y_values)
        if not fit:
            continue
        coeffs, r2 = fit
        if exp_fit is None or r2 > exp_fit[0]:
            exp_fit = (r2, coeffs, decay)
    if exp_fit:
        r2, coeffs, decay = exp_fit
        offset, amplitude = coeffs
        add_model("exponential", [offset, amplitude, decay], r2, lambda x, c=offset, a=amplitude, b=decay: c + a * math.exp(-b * x))

    return {"status": "ok" if models else "fit_failed", "models": models}



def comparable_stimulus_ids(trials: list[Trial]) -> tuple[set[str], set[str]]:
    by_round: dict[int, set[str]] = defaultdict(set)
    for trial in trials:
        if trial.task == "cst" and trial.stimulus_id:
            by_round[trial.round_number].add(trial.stimulus_id)
    round_sets = [by_round.get(round_number, set()) for round_number in sorted(ROUND_LABELS)]
    common_ids = set.intersection(*round_sets) if all(round_sets) else set()
    comparison_rounds = [round_number for round_number in sorted(ROUND_LABELS) if round_number != 1]
    round1_only_ids = by_round.get(1, set()) - set().union(*(by_round.get(round_number, set()) for round_number in comparison_rounds))
    return common_ids, round1_only_ids


def build_item_catalog(trials: list[Trial]) -> dict[str, Any]:
    by_round: dict[int, dict[str, str]] = defaultdict(dict)
    statements: dict[str, str] = {}
    for trial in trials:
        if trial.task != "cst" or not trial.stimulus_id:
            continue
        by_round[trial.round_number][trial.stimulus_id] = trial.item_category
        if trial.statement and trial.stimulus_id not in statements:
            statements[trial.stimulus_id] = trial.statement
    round_sets = [set(by_round.get(round_number, {})) for round_number in sorted(ROUND_LABELS)]
    common_ids = set.intersection(*round_sets) if all(round_sets) else set()
    def item_payload(stimulus_id: str) -> dict[str, str]:
        category = next((by_round[round_number][stimulus_id] for round_number in sorted(by_round) if stimulus_id in by_round[round_number]), "")
        return {"id": stimulus_id, "itemCategory": category, "statement": statements.get(stimulus_id, "")}

    return {
        "commonItems": [item_payload(stimulus_id) for stimulus_id in sorted(common_ids, key=lambda sid: (item_payload(sid)["itemCategory"], sid))],
        # The item page intentionally compares only the 176 items shared by all SVT rounds.
        # Round-1-only / non-common items remain in attempt-level RT/accuracy summaries so
        # real submissions still appear as R1, but they are not exposed as a separate grid.
        "round1OnlyItems": [],
        "counts": {
            "common": len(common_ids),
            "round1Only": 0,
            "byRound": {str(round_number): len(by_round.get(round_number, {})) for round_number in sorted(ROUND_LABELS)},
        },
    }

def summarize(trials: list[Trial], records: list[FileRecord], duplicate_rows: list[dict[str, str]], ignored_non_comparable_trials: int = 0) -> dict[str, Any]:
    by_person: dict[str, list[Trial]] = defaultdict(list)
    for trial in trials:
        by_person[trial.identity_key].append(trial)

    participants = []
    metrics_rows = []
    clean_trial_rows = []
    for key, person_trials in sorted(by_person.items()):
        student_ids = {t.student_id for t in person_trials if t.student_id}
        short_ids = {t.short_id for t in person_trials if numeric_student_like_id(t.short_id)}
        participant_ids = {t.participant_id for t in person_trials if t.participant_id}
        names = {t.name_from_filename for t in person_trials if t.name_from_filename}
        rounds_payload: dict[str, Any] = {}
        sequence_points = []
        round_metric_points_rt = []
        round_metric_points_acc = []
        sequence = 0
        attempt_index = 0
        round_attempt_meta: dict[int, dict[str, Any]] = {}
        for round_number in sorted(ROUND_LABELS):
            round_trials = [t for t in person_trials if t.round_number == round_number]
            if not round_trials:
                continue
            attempt_index += 1
            round_dates = [t.file_datetime or t.row_datetime for t in round_trials if t.file_datetime or t.row_datetime]
            round_date = min(round_dates).date().isoformat() if round_dates else ""
            attempt_label = f"R{attempt_index}"
            round_attempt_meta[round_number] = {"attemptIndex": attempt_index, "displayLabel": attempt_label, "date": round_date}
            correct_values = [t.correct for t in round_trials if t.correct is not None]
            rt_values_raw = [t.rt for t in round_trials if t.rt is not None]
            rt_values = [t.rt for t in round_trials if t.rt is not None]
            accuracy = statistics.fmean(correct_values) if correct_values else None
            rt_mean = statistics.fmean(rt_values) if rt_values else None
            rt_raw_mean = statistics.fmean(rt_values_raw) if rt_values_raw else None
            conf = confusion_stats(round_trials)
            rounds_payload[str(round_number)] = {
                "round": round_number,
                "actualRound": round_number,
                "label": ROUND_LABELS[round_number],
                "attemptIndex": attempt_index,
                "displayLabel": attempt_label,
                "date": round_date,
                "accuracy": round_float(accuracy),
                "rtMean": round_float(rt_mean),
                "rtMeanRaw": round_float(rt_raw_mean),
                "trialCount": len(round_trials),
                "rtCount": len(rt_values),
                "sd3Excluded": 0,
                "sourceFiles": sorted({t.source_file for t in round_trials}),
                "confusion": conf,
            }
            if rt_mean is not None:
                round_metric_points_rt.append({"x": float(attempt_index), "y": float(rt_mean)})
            if accuracy is not None:
                round_metric_points_acc.append({"x": float(attempt_index), "y": float(accuracy)})
            metrics_rows.append(
                {
                    "identity_key": key,
                    "display_name": display_name(student_ids, participant_ids, names, key),
                    "round_number": round_number,
                    "round_label": ROUND_LABELS[round_number],
                    "attempt_index": attempt_index,
                    "attempt_label": attempt_label,
                    "date": round_date,
                    "trial_count": len(round_trials),
                    "accuracy": round_float(accuracy),
                    "rt_mean": round_float(rt_mean),
                    "rt_mean_raw": round_float(rt_raw_mean),
                    "rt_count": len(rt_values),
                    "sd3_excluded": 0,
                    "source_files": " | ".join(sorted({t.source_file for t in round_trials})),
                }
            )

        for trial in sorted(person_trials, key=lambda t: (t.round_number, t.trial_index, t.timestamp, t.source_file)):
            sequence += 1
            sequence_points.append(
                {
                    "x": sequence,
                    "round": trial.round_number,
                    "attemptIndex": round_attempt_meta.get(trial.round_number, {}).get("attemptIndex"),
                    "displayLabel": round_attempt_meta.get(trial.round_number, {}).get("displayLabel", f"R{trial.round_number}"),
                    "date": round_attempt_meta.get(trial.round_number, {}).get("date", ""),
                    "trialIndex": trial.trial_index,
                    "stimulusId": trial.stimulus_id,
                    "rt": round_float(trial.rt),
                    "correct": round_float(trial.correct),
                    "sd3Excluded": trial.rt_sd3_excluded,
                    "itemCategory": trial.item_category,
                }
            )
            clean_trial_rows.append(
                {
                    "identity_key": key,
                    "display_name": display_name(student_ids, participant_ids, names, key),
                    "round_number": trial.round_number,
                    "round_label": trial.round_label,
                    "attempt_index": round_attempt_meta.get(trial.round_number, {}).get("attemptIndex"),
                    "attempt_label": round_attempt_meta.get(trial.round_number, {}).get("displayLabel", f"R{trial.round_number}"),
                    "date": round_attempt_meta.get(trial.round_number, {}).get("date", ""),
                    "trial_sequence": sequence,
                    "trial_index": trial.trial_index,
                    "stimulus_id": trial.stimulus_id,
                    "item_category": trial.item_category,
                    "statement": trial.statement,
                    "response": trial.response,
                    "correct_answer": trial.correct_answer,
                    "correct": trial.correct,
                    "rt": trial.rt,
                    "rt_sd3_excluded": trial.rt_sd3_excluded,
                    "source_file": trial.source_file,
                }
            )

        item_results: dict[str, dict[str, Any]] = {}
        for trial in sorted(person_trials, key=lambda t: (t.round_number, t.trial_index, t.timestamp, t.source_file)):
            if not trial.stimulus_id:
                continue
            item_results.setdefault(str(trial.round_number), {})[trial.stimulus_id] = {
                "correct": round_float(trial.correct),
                "rt": round_float(trial.rt),
                "sd3Excluded": False,
                "itemCategory": trial.item_category,
                "statement": trial.statement,
                "response": trial.response,
                "correctAnswer": trial.correct_answer,
                "trialIndex": trial.trial_index,
                "attemptIndex": round_attempt_meta.get(trial.round_number, {}).get("attemptIndex"),
                "displayLabel": round_attempt_meta.get(trial.round_number, {}).get("displayLabel", f"R{trial.round_number}"),
                "date": round_attempt_meta.get(trial.round_number, {}).get("date", ""),
            }

        participants.append(
            {
                "id": key,
                "nickname": display_name(student_ids, participant_ids, names, key),
                "studentIds": sorted(student_ids),
                "shortIds": sorted(short_ids),
                "participantIds": sorted(participant_ids),
                "namesFromFilename": sorted(names),
                "rounds": rounds_payload,
                "sequence": sequence_points,
                "itemResults": item_results,
                "models": {
                    "rtByRound": fit_models(round_metric_points_rt),
                    "accuracyByRound": fit_models(round_metric_points_acc),
                },
            }
        )

    file_rows = []
    for record in records:
        file_rows.append(
            {
                "file": record.rel_path,
                "status": record.status,
                "reason": record.reason,
                "encoding": record.encoding,
                "identity_key": record.identity_key,
                "round_number": record.round_number or "",
                "round_label": record.round_label,
                "assignment_rule": record.assignment_rule,
                "file_datetime": record.file_datetime.isoformat() if record.file_datetime else "",
                "valid_trials": record.valid_trials,
                "selected": record.selected,
                "duplicate_of": record.duplicate_of,
            }
        )

    summary = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "rounds": [{"round": number, "label": label} for number, label in ROUND_LABELS.items()],
        "itemCatalog": build_item_catalog(trials),
        "participants": participants,
        "metricsRows": metrics_rows,
        "cleanTrialRows": clean_trial_rows,
        "quality": {
            "sourceFileCount": len(records),
            "selectedFileCount": sum(1 for r in records if r.status == "selected"),
            "excludedFileCount": sum(1 for r in records if r.status == "excluded"),
            "duplicateFileCount": sum(1 for r in records if r.status == "duplicate"),
            "selectedTrialCount": len(trials),
            "ignoredNonComparableTrialCount": ignored_non_comparable_trials,
            "sd3ExcludedCount": 0,
            "fileRows": file_rows,
            "duplicates": duplicate_rows,
        },
    }
    return summary


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        fieldnames = sorted({key for row in rows for key in row})
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)



def safe_public_identifier(value: object) -> str:
    cleaned = nfc(value)
    cleaned = re.sub(r"\s+", "_", cleaned)
    cleaned = re.sub(r"[^0-9A-Za-z가-힣_.@-]+", "", cleaned)
    return cleaned[:48]


def public_participant_id(participant: dict[str, Any], index: int, used: set[str]) -> tuple[str, str]:
    participant_ids = [
        safe_public_identifier(value)
        for value in participant.get("participantIds", [])
        if usable_text_participant_id(value)
    ]
    student_ids = [
        safe_public_identifier(value)
        for value in [*participant.get("studentIds", []), *participant.get("shortIds", [])]
        if numeric_student_like_id(value)
    ]
    if participant_ids:
        base = participant_ids[0]
        source = "participant_id"
    elif student_ids:
        base = student_ids[0]
        source = "student_id"
    else:
        base = f"P{index:03d}"
        source = "generated_fallback"
    if not base:
        base = f"P{index:03d}"
        source = "generated_fallback"

    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate, source

def compact_for_web(summary: dict[str, Any]) -> dict[str, Any]:
    """Return the public static dashboard payload.

    The dashboard is selectable by participant-entered IDs (for example
    applebanana). When no usable participant_id exists for that internal
    identity group, the public payload falls back to the numeric student ID so
    nicknameless participants remain recognizable. Names, source paths, and
    duplicate details stay in ignored metadata outputs.
    """
    participants = []
    used_public_ids: set[str] = set()
    for index, participant in enumerate(summary["participants"], start=1):
        if len(participant.get("rounds", {})) < 2:
            continue
        public_id, id_source = public_participant_id(participant, index, used_public_ids)
        public_rounds: dict[str, Any] = {}
        for round_key, round_value in participant.get("rounds", {}).items():
            public_rounds[round_key] = {
                key: value
                for key, value in round_value.items()
                if key not in {"sourceFiles"}
            }
        participants.append(
            {
                "id": public_id,
                "nickname": public_id,
                "idSource": id_source,
                "rounds": public_rounds,
                "sequence": participant.get("sequence", []),
                "itemResults": participant.get("itemResults", {}),
                "models": participant.get("models", {}),
            }
        )

    quality = summary["quality"]
    return {
        "schemaVersion": 1,
        "generatedAt": summary["generatedAt"],
        "rounds": summary["rounds"],
        "itemCatalog": summary.get("itemCatalog", {}),
        "quality": {
            "sourceFileCount": quality.get("sourceFileCount", 0),
            "selectedFileCount": quality.get("selectedFileCount", 0),
            "excludedFileCount": quality.get("excludedFileCount", 0),
            "duplicateFileCount": quality.get("duplicateFileCount", 0),
            "selectedTrialCount": quality.get("selectedTrialCount", 0),
            "ignoredNonComparableTrialCount": quality.get("ignoredNonComparableTrialCount", 0),
            "sd3ExcludedCount": quality.get("sd3ExcludedCount", 0),
        },
        "participants": participants,
    }


def write_outputs(summary: dict[str, Any]) -> dict[str, Any]:
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(
        METRICS_CSV,
        summary["metricsRows"],
        [
            "identity_key",
            "display_name",
            "round_number",
            "round_label",
            "attempt_index",
            "attempt_label",
            "date",
            "trial_count",
            "accuracy",
            "rt_mean",
            "rt_mean_raw",
            "rt_count",
            "sd3_excluded",
            "source_files",
        ],
    )
    write_csv(TRIALS_CSV, summary["cleanTrialRows"])
    write_csv(FILE_LOG_CSV, summary["quality"]["fileRows"])
    write_csv(DUPLICATE_LOG_CSV, summary["quality"]["duplicates"])
    QUALITY_JSON.write_text(json.dumps(summary["quality"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public_payload = compact_for_web(summary)
    WEB_DATA_JS.write_text(
        "window.SVT_DASHBOARD_DATA = "
        + json.dumps(public_payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    return public_payload


def main() -> None:
    anchors = discover_round_anchors()
    records: list[FileRecord] = []
    trials_by_file: dict[str, list[Trial]] = {}
    for path in iter_candidate_files():
        record, trials = read_trials(path, anchors)
        records.append(record)
        if trials:
            trials_by_file[record.rel_path] = trials
    resolve_identity_links(records, trials_by_file)
    selected_trials, duplicate_rows = choose_representative_files(records, trials_by_file)
    common_ids, _round1_only_ids = comparable_stimulus_ids(selected_trials)
    ignored_non_comparable_trials = sum(1 for trial in selected_trials if trial.stimulus_id not in common_ids)
    summary = summarize(selected_trials, records, duplicate_rows, ignored_non_comparable_trials)
    public_payload = write_outputs(summary)
    print(f"Wrote {METRICS_CSV.relative_to(ROOT)} ({len(summary['metricsRows'])} person-round rows)")
    print(f"Wrote {TRIALS_CSV.relative_to(ROOT)} ({len(summary['cleanTrialRows'])} selected trials)")
    print(f"Wrote {FILE_LOG_CSV.relative_to(ROOT)} ({len(summary['quality']['fileRows'])} source file records)")
    print(f"Wrote {DUPLICATE_LOG_CSV.relative_to(ROOT)} ({len(summary['quality']['duplicates'])} duplicates)")
    print(f"Wrote {WEB_DATA_JS.relative_to(ROOT)} ({len(public_payload['participants'])} public participants)")
    print(f"Ignored non-comparable trials: {summary['quality']['ignoredNonComparableTrialCount']}")
    print("SD3 excluded RT values: 0 (disabled)")


if __name__ == "__main__":
    main()
