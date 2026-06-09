#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import os
import re
import statistics
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MAZE_DATA_DIR = ROOT / "maze rsvp analyzer" / "data" / "maze"
WEB_DIR = ROOT / "web"
WEB_MAZE_ANALYZER_DATA_JS = WEB_DIR / "maze-analyzer-data.js"
ROUND_RE = re.compile(r"(?:s|_|round|mazersvp_)(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})(?:[_T](\d{2})h?(\d{2})?[.:]?(\d{2})?)?")


def nfc(value: object) -> str:
    return unicodedata.normalize("NFC", str(value or "")).strip()


def parse_number(raw: object) -> float | None:
    try:
        value = float(nfc(raw))
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def parse_datetime(text: str) -> datetime | None:
    match = DATE_RE.search(text)
    if not match:
        return None
    date, hour, minute, second = match.groups()
    try:
        return datetime.strptime(f"{date} {hour or '00'}:{minute or '00'}:{second or '00'}", "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def decode_csv(path: Path) -> tuple[list[dict[str, str]], str]:
    raw = path.read_bytes()
    last_error = ""
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            text = raw.decode(encoding)
            return list(csv.DictReader(text.splitlines())), encoding
        except UnicodeDecodeError as exc:
            last_error = str(exc)
    text = raw.decode("utf-8", errors="replace")
    return list(csv.DictReader(text.splitlines())), f"utf-8-replace: {last_error}"


def round_from_path(path: Path) -> int:
    for part in reversed(path.parent.parts):
        match = ROUND_RE.search(part)
        if match:
            return int(match.group(1))
    return 1


def identity_id(row: dict[str, str], path: Path) -> str:
    for key in ("participant_id", "student_id"):
        value = nfc(row.get(key, ""))
        if value and value.lower() not in {"anonymous", "participant"}:
            base = re.sub(r"\s+", "_", value)
            base = re.sub(r"[^0-9A-Za-z가-힣_.@-]+", "", base)[:48]
            if base:
                return base
    else:
        base = path.name.split("_", 1)[0] or "maze_participant"
        base = re.sub(r"\s+", "_", nfc(base))
        base = re.sub(r"[^0-9A-Za-z가-힣_.@-]+", "", base)[:48] or "maze_participant"
        return base


def unique_public_id(base: str, used: set[str]) -> str:
    base = base or "maze_participant"

    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def round_float(value: float | None, digits: int = 6) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def safe_divide(left: float, right: float) -> float | None:
    return left / right if right else None


@dataclass
class MazeItem:
    source_file: str
    participant_id: str
    round_number: int
    file_datetime: datetime | None
    stimulus_id: str
    category: str
    statement: str
    trial_index: int
    correct: float | None
    rt: float | None


def load_items() -> tuple[list[MazeItem], dict[str, int]]:
    items: list[MazeItem] = []
    file_counts = {"source": 0, "usable": 0, "excluded": 0}
    for path in sorted(MAZE_DATA_DIR.rglob("*.csv")):
        file_counts["source"] += 1
        try:
            rows, _encoding = decode_csv(path)
        except OSError:
            file_counts["excluded"] += 1
            continue
        maze_rows = [row for row in rows if nfc(row.get("task", "")).casefold() == "maze"]
        if not maze_rows:
            file_counts["excluded"] += 1
            continue
        file_counts["usable"] += 1
        round_number = round_from_path(path)
        file_datetime = parse_datetime(path.name) or parse_datetime(nfc(maze_rows[0].get("date", "")))
        pid = identity_id(maze_rows[0], path)
        grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in maze_rows:
            stimulus_id = nfc(row.get("stimulus_id", ""))
            if stimulus_id:
                grouped[stimulus_id].append(row)

        for stimulus_id, stimulus_rows in grouped.items():
            correct_values = [value for value in (parse_number(row.get("correct")) for row in stimulus_rows) if value is not None]
            rt_values = [value for value in (parse_number(row.get("rt")) for row in stimulus_rows) if value is not None]
            first = stimulus_rows[0]
            items.append(
                MazeItem(
                    source_file=str(path.relative_to(ROOT)),
                    participant_id=pid,
                    round_number=round_number,
                    file_datetime=file_datetime,
                    stimulus_id=stimulus_id,
                    category=nfc(first.get("phrase_type", "")) or nfc(first.get("itemCategory", "")) or "MAZE",
                    statement=nfc(first.get("english_phrase", "")) or nfc(first.get("korean_phrase", "")) or stimulus_id,
                    trial_index=int(parse_number(first.get("trial_index")) or len(items) + 1),
                    correct=mean(correct_values),
                    rt=sum(rt_values) if rt_values else None,
                )
            )
    return items, file_counts


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
    width = len(features[0])
    xtx = [[0.0] * width for _ in range(width)]
    xty = [0.0] * width
    for row, y in zip(features, y_values):
        for i in range(width):
            xty[i] += row[i] * y
            for j in range(width):
                xtx[i][j] += row[i] * row[j]
    coeffs = solve_linear_system(xtx, xty)
    if coeffs is None:
        return None
    predictions = [sum(c * x for c, x in zip(coeffs, row)) for row in features]
    mean_y = statistics.fmean(y_values)
    ss_tot = sum((y - mean_y) ** 2 for y in y_values)
    ss_res = sum((y - pred) ** 2 for y, pred in zip(y_values, predictions))
    return coeffs, (1.0 if ss_tot == 0 else max(-1.0, 1 - ss_res / ss_tot))


def fit_models(points: list[dict[str, float]]) -> dict[str, Any]:
    clean = [(float(point["x"]), float(point["y"])) for point in points if point.get("y") is not None]
    if len(clean) < 3:
        return {"status": "insufficient_points", "models": {}}
    min_x, max_x = min(x for x, _ in clean), max(x for x, _ in clean)
    if min_x == max_x:
        return {"status": "insufficient_x_variation", "models": {}}
    sample_xs = [min_x + (max_x - min_x) * i / 24 for i in range(25)]
    y_values = [y for _, y in clean]
    models: dict[str, Any] = {}

    def add_model(name: str, coeffs: list[float], r2: float, predict) -> None:
        models[name] = {
            "coefficients": [round_float(c, 6) for c in coeffs],
            "r2": round_float(r2, 4),
            "points": [{"x": round_float(x, 3), "y": round_float(predict(x), 6)} for x in sample_xs],
        }

    decay = 0.58
    features = [[1.0, math.exp(-decay * x)] for x, _ in clean]
    fit = linear_fit(features, y_values)
    if fit:
        coeffs, r2 = fit
        offset, amplitude = coeffs
        add_model("exponential", [offset, amplitude, decay], r2, lambda x: offset + amplitude * math.exp(-decay * x))
    return {"status": "ok" if models else "fit_failed", "models": models}


def confusion_stats(items: list[MazeItem]) -> dict[str, Any] | None:
    included = len([item for item in items if item.correct is not None])
    if not included:
        return None
    correct_count = sum(1 for item in items if item.correct is not None and item.correct >= 0.5)
    wrong_count = included - correct_count
    counts = {"tp": correct_count, "fn": 0, "fp": 0, "tn": wrong_count}
    return {
        "included": included,
        "skipped": len(items) - included,
        "cells": {key: round_float(value / included) for key, value in counts.items()},
        "counts": counts,
        "metrics": {
            "precision": safe_divide(counts["tp"], counts["tp"] + counts["fp"]),
            "sensitivity": safe_divide(counts["tp"], counts["tp"] + counts["fn"]),
            "specificity": safe_divide(counts["tn"], counts["tn"] + counts["fp"]),
            "negativePredictiveValue": safe_divide(counts["tn"], counts["tn"] + counts["fn"]),
            "accuracy": safe_divide(counts["tp"] + counts["tn"], included),
        },
    }


def build_payload(items: list[MazeItem], file_counts: dict[str, int]) -> dict[str, Any]:
    by_participant: dict[str, list[MazeItem]] = defaultdict(list)
    by_round: dict[int, set[str]] = defaultdict(set)
    item_meta: dict[str, dict[str, str]] = {}
    for item in items:
        by_participant[item.participant_id].append(item)
        by_round[item.round_number].add(item.stimulus_id)
        item_meta.setdefault(item.stimulus_id, {"id": item.stimulus_id, "itemCategory": item.category, "statement": item.statement})

    common_ids = set.intersection(*(ids for ids in by_round.values())) if by_round else set()
    common_items = [item_meta[item_id] for item_id in sorted(common_ids, key=lambda item_id: (item_meta[item_id]["itemCategory"], item_id))]
    participants: list[dict[str, Any]] = []
    used_public_ids: set[str] = set()

    for participant_id, person_items in sorted(by_participant.items()):
        public_participant_id = unique_public_id(participant_id, used_public_ids)
        rounds_payload: dict[str, Any] = {}
        item_results: dict[str, dict[str, Any]] = {}
        rt_points: list[dict[str, float]] = []
        accuracy_points: list[dict[str, float]] = []
        for attempt_index, round_number in enumerate(sorted({item.round_number for item in person_items}), start=1):
            round_items = [item for item in person_items if item.round_number == round_number]
            correct_values = [item.correct for item in round_items if item.correct is not None]
            rt_values = [item.rt for item in round_items if item.rt is not None]
            accuracy = mean(correct_values)
            rt_mean = mean(rt_values)
            round_date_values = [item.file_datetime for item in round_items if item.file_datetime]
            round_date = min(round_date_values).date().isoformat() if round_date_values else ""
            display_label = f"R{attempt_index}"
            rounds_payload[str(round_number)] = {
                "round": round_number,
                "actualRound": round_number,
                "label": f"maze_{round_number}",
                "attemptIndex": attempt_index,
                "displayLabel": display_label,
                "date": round_date,
                "accuracy": round_float(accuracy),
                "rtMean": round_float(rt_mean),
                "rtMeanRaw": round_float(rt_mean),
                "trialCount": len(round_items),
                "rtCount": len(rt_values),
                "sd3Excluded": 0,
                "confusion": confusion_stats(round_items),
            }
            if rt_mean is not None:
                rt_points.append({"x": float(attempt_index), "y": rt_mean})
            if accuracy is not None:
                accuracy_points.append({"x": float(attempt_index), "y": accuracy})

            item_results[str(round_number)] = {}
            for item in round_items:
                correct_answer = "O" if (item.correct or 0) >= 0.5 else "X"
                item_results[str(round_number)][item.stimulus_id] = {
                    "correct": round_float(item.correct),
                    "rt": round_float(item.rt),
                    "sd3Excluded": False,
                    "itemCategory": item.category,
                    "statement": item.statement,
                    "response": correct_answer,
                    "correctAnswer": correct_answer,
                    "trialIndex": item.trial_index,
                    "attemptIndex": attempt_index,
                    "displayLabel": display_label,
                    "date": round_date,
                }

        if len(rounds_payload) < 2:
            continue
        participants.append(
            {
                "id": public_participant_id,
                "nickname": public_participant_id,
                "idSource": "participant_id",
                "rounds": rounds_payload,
                "sequence": [],
                "itemResults": item_results,
                "models": {
                    "rtByRound": fit_models(rt_points),
                    "accuracyByRound": fit_models(accuracy_points),
                },
            }
        )

    max_round = max(by_round, default=0)
    return {
        "schemaVersion": 1,
        "datasetKey": "maze",
        "datasetLabel": "MAZE",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "rounds": [{"round": number, "label": f"maze_{number}"} for number in range(1, max_round + 1)],
        "itemCatalog": {
            "commonItems": common_items,
            "round1OnlyItems": [],
            "counts": {
                "common": len(common_items),
                "round1Only": 0,
                "byRound": {str(number): len(ids) for number, ids in sorted(by_round.items())},
            },
        },
        "demographics": {},
        "quality": {
            "sourceFileCount": file_counts["source"],
            "selectedFileCount": file_counts["usable"],
            "excludedFileCount": file_counts["excluded"],
            "duplicateFileCount": 0,
            "selectedTrialCount": len(items),
            "ignoredNonComparableTrialCount": 0,
            "sd3ExcludedCount": 0,
        },
        "participants": participants,
    }


def task_summary(rows: list[dict[str, str]]) -> dict[str, Any] | None:
    if not rows:
        return None
    correct_values = [value for value in (parse_number(row.get("correct")) for row in rows) if value is not None]
    rt_values = [value for value in (parse_number(row.get("rt")) for row in rows) if value is not None]
    if not correct_values and not rt_values:
        return None
    return {
        "accuracy": (mean(correct_values) or 0) * 100,
        "rt": mean(rt_values) or 0,
        "count": len(rows),
    }


def trend_curve(rounds: list[int], values: list[float], clamp_max: float | None = None) -> dict[str, Any]:
    points = [(float(r), float(v)) for r, v in zip(rounds, values) if math.isfinite(v)]
    if len(points) < 3:
        return {"curve": [], "formula": "데이터 부족", "r2": 0.0}
    xs = [x for x, _ in points]
    ys = [y for _, y in points]

    try:
        is_decaying = ys[0] > ys[-1]
        if is_decaying:
            a = min(ys) * 0.9
            shifted = [max(1e-5, y - a) for y in ys]
            slope, intercept = linear_coefficients(xs, [math.log(value) for value in shifted])
            b, c = math.exp(intercept), slope
        else:
            a = max(100.0, max(ys) * 1.05)
            shifted = [max(1e-5, a - y) for y in ys]
            slope, intercept = linear_coefficients(xs, [math.log(value) for value in shifted])
            b, c = -math.exp(intercept), slope

        fitted = [a + b * math.exp(c * x) for x in xs]
        mean_y = statistics.fmean(ys)
        ss_tot = sum((y - mean_y) ** 2 for y in ys)
        ss_res = sum((y - pred) ** 2 for y, pred in zip(ys, fitted))
        r2 = 1 - (ss_res / ss_tot) if ss_tot else 0.0
        curve = []
        max_x = max(xs)
        for i in range(50):
            x = 1 + (max_x - 1) * i / 49
            limit = 100.0 if not is_decaying else float("inf")
            y = max(0.0, min(limit, a + b * math.exp(c * x)))
            curve.append({"round": round_float(x, 6), "value": round_float(y, 6)})
        return {
            "curve": curve,
            "formula": f"y = {a:.3f} {'+' if b >= 0 else '-'} {abs(b):.3f}e^({c:.3f}x)",
            "r2": round_float(max(0.0, min(1.0, r2)), 4),
        }
    except Exception:
        slope, intercept = linear_coefficients(xs, ys)
        curve = []
        max_x = max(xs)
        for i in range(50):
            x = 1 + (max_x - 1) * i / 49
            curve.append({"round": round_float(x, 6), "value": round_float(max(0.0, slope * x + intercept), 6)})
        return {"curve": curve, "formula": f"y = {slope:.3f}x + {intercept:.3f}", "r2": 0.0}


def linear_coefficients(xs: list[float], ys: list[float]) -> tuple[float, float]:
    mean_x = statistics.fmean(xs)
    mean_y = statistics.fmean(ys)
    denom = sum((x - mean_x) ** 2 for x in xs)
    if not denom:
        return 0.0, mean_y
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom
    return slope, mean_y - slope * mean_x


def synthetic_matrix(accuracy_percent: float, total: int = 176) -> dict[str, int]:
    correct = max(0, min(total, round(total * accuracy_percent / 100)))
    wrong = total - correct
    return {
        "true_O": correct // 2,
        "true_X": correct - (correct // 2),
        "false_O": wrong // 2,
        "false_X": wrong - (wrong // 2),
        "total_items": total,
    }


def simulate_transitions(acc_list: list[float], total: int = 176) -> list[dict[str, int]]:
    transitions = []
    for index in range(len(acc_list) - 1):
        prev = int((acc_list[index] / 100.0) * total)
        curr = int((acc_list[index + 1] / 100.0) * total)
        kept_correct = max(0, min(prev, curr) - int(abs(prev - curr) * 0.15))
        correct_to_wrong = max(0, prev - kept_correct)
        wrong_to_correct = max(0, curr - kept_correct)
        wrong_to_wrong = max(0, total - kept_correct - correct_to_wrong - wrong_to_correct)
        transitions.append({
            "from_round": index + 1,
            "to_round": index + 2,
            "cc": kept_correct,
            "cx": correct_to_wrong,
            "xx": wrong_to_wrong,
            "xc": wrong_to_correct,
        })
    return transitions


def analyzer_identity(row: dict[str, str], path: Path) -> str:
    for key, value in row.items():
        if nfc(key).lower() in {"student_id", "id", "학번", "name", "participant"}:
            return nfc(value)
    return nfc(path.name.split("_", 1)[0]) or "unknown"


def build_analyzer_payload() -> dict[str, Any]:
    profiles: dict[str, dict[str, Any]] = {}
    source_count = 0
    excluded_count = 0
    for path in sorted(MAZE_DATA_DIR.rglob("*.csv")):
        source_count += 1
        try:
            rows, _encoding = decode_csv(path)
        except OSError:
            excluded_count += 1
            continue
        usable_rows = [row for row in rows if nfc(row.get("task", "")).casefold() in {"maze", "rsvp"}]
        if not usable_rows:
            excluded_count += 1
            continue
        identity = analyzer_identity(usable_rows[0], path)
        profile = profiles.setdefault(
            identity,
            {
                "student_id": identity,
                "maze": {"rounds": [], "rt": [], "accuracy": [], "dates": [], "matrices": []},
                "rsvp": {"rounds": [], "rt": [], "accuracy": [], "dates": [], "matrices": []},
            },
        )
        round_number = round_from_path(path)
        file_date = (parse_datetime(path.name) or parse_datetime(nfc(usable_rows[0].get("date", ""))))
        date_label = file_date.date().isoformat() if file_date else ""
        for task_name in ("maze", "rsvp"):
            summary = task_summary([row for row in usable_rows if nfc(row.get("task", "")).casefold() == task_name])
            if not summary:
                continue
            profile[task_name]["rounds"].append(round_number)
            profile[task_name]["rt"].append(summary["rt"])
            profile[task_name]["accuracy"].append(summary["accuracy"])
            profile[task_name]["dates"].append(date_label)
            profile[task_name]["matrices"].append(synthetic_matrix(summary["accuracy"]))

    cohort_profiles: dict[str, Any] = {}
    for identity, raw in sorted(profiles.items()):
        if not raw["maze"]["rounds"]:
            continue
        tasks: dict[str, Any] = {}
        total_rounds = 0
        for task_name in ("maze", "rsvp"):
            order = sorted(range(len(raw[task_name]["rounds"])), key=lambda index: raw[task_name]["rounds"][index])
            rounds = [raw[task_name]["rounds"][index] for index in order]
            rts = [raw[task_name]["rt"][index] for index in order]
            accuracies = [raw[task_name]["accuracy"][index] for index in order]
            tasks[task_name] = {
                "raw_points": [
                    {
                        "round": rounds[index],
                        "rt": round_float(rts[index]),
                        "accuracy": round_float(accuracies[index]),
                        "date": raw[task_name]["dates"][order[index]],
                        "matrix": raw[task_name]["matrices"][order[index]],
                    }
                    for index in range(len(order))
                ],
                "transitions": simulate_transitions(accuracies),
                "rt_trend": trend_curve(rounds, rts),
                "accuracy_trend": trend_curve(rounds, accuracies, 100.0),
            }
            total_rounds = max(total_rounds, len(rounds))
        cohort_profiles[identity] = {
            "student_id": identity,
            "total_rounds": total_rounds,
            "tasks": tasks,
        }

    maze_rts = [point["rt"] for profile in cohort_profiles.values() for point in profile["tasks"]["maze"]["raw_points"] if point["rt"] is not None]
    maze_accs = [point["accuracy"] for profile in cohort_profiles.values() for point in profile["tasks"]["maze"]["raw_points"] if point["accuracy"] is not None]
    cluster_payload = build_analyzer_clusters(cohort_profiles)
    return {
        "data": {
            "cohort_profiles": cohort_profiles,
            "global_summary": {
                "polynomial_degree_label": "지수 회귀 (Exponential Fit)",
                "average_response_time": round_float(mean(maze_rts) or 0),
                "average_correction_rate": round_float(mean(maze_accs) or 0),
            },
            "quality": {
                "sourceFileCount": source_count,
                "excludedFileCount": excluded_count,
            },
        },
        "clusters": cluster_payload,
    }


def build_analyzer_clusters(cohort_profiles: dict[str, Any]) -> dict[str, Any]:
    original_clusters = load_original_analyzer_clusters()
    if original_clusters is not None:
        return original_clusters

    colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#14b8a6"]
    valid_users = [identity for identity, profile in cohort_profiles.items() if profile["total_rounds"] >= 3]
    if not valid_users:
        return {}

    features = []
    for identity in valid_users:
        accuracies = [point["accuracy"] for point in cohort_profiles[identity]["tasks"]["maze"]["raw_points"]]
        features.append((accuracies[:5] if len(accuracies) >= 5 else accuracies + [accuracies[-1]] * (5 - len(accuracies))))

    distance_matrix = [[0.0] * len(valid_users) for _ in valid_users]
    for i, left in enumerate(features):
        for j, right in enumerate(features):
            distance_matrix[i][j] = simple_dtw(left, right)

    num_clusters = min(6, len(valid_users))
    sklearn_result = sklearn_cluster_result(distance_matrix, num_clusters)
    if sklearn_result:
        cluster_labels, coords = sklearn_result
    else:
        cluster_labels = average_linkage_labels(distance_matrix, num_clusters)
        coords = classical_mds(distance_matrix)

    output: dict[str, Any] = {}
    for group_index in range(num_clusters):
        member_indices = [index for index, label in enumerate(cluster_labels) if label == group_index]
        members = [valid_users[index] for index in member_indices]
        if not members:
            continue
        trait_name, trait_desc = assign_cluster_traits(members, cohort_profiles)
        member_coords = [
            {
                "id": valid_users[index],
                "x": round_float(coords[index][0]),
                "y": round_float(coords[index][1]),
            }
            for index in member_indices
        ]
        output[f"g{group_index}"] = {
            "name": f"그룹 {group_index + 1} - {trait_name}",
            "desc": trait_desc,
            "color": colors[group_index % len(colors)],
            "members": members,
            "coords": member_coords,
        }
    return output


def load_original_analyzer_clusters() -> dict[str, Any] | None:
    analyzer_dir = ROOT / "maze rsvp analyzer"
    app_path = analyzer_dir / "app.py"
    if not app_path.exists():
        return None
    previous_cwd = Path.cwd()
    inserted = False
    try:
        sys.path.insert(0, str(analyzer_dir))
        inserted = True
        os.chdir(analyzer_dir)
        import app as maze_app

        with maze_app.app.app_context():
            clusters = maze_app.get_clusters().get_json()
        return clusters if isinstance(clusters, dict) else None
    except Exception:
        return None
    finally:
        os.chdir(previous_cwd)
        if inserted:
            try:
                sys.path.remove(str(analyzer_dir))
            except ValueError:
                pass


def sklearn_cluster_result(distance_matrix: list[list[float]], num_clusters: int) -> tuple[list[int], list[list[float]]] | None:
    try:
        import numpy as np
        from sklearn.cluster import AgglomerativeClustering
        from sklearn.manifold import MDS
    except Exception:
        return None

    matrix = np.array(distance_matrix)
    try:
        clusterer = AgglomerativeClustering(n_clusters=num_clusters, metric="precomputed", linkage="average")
    except TypeError:
        clusterer = AgglomerativeClustering(n_clusters=num_clusters, affinity="precomputed", linkage="average")
    labels = [int(label) for label in clusterer.fit_predict(matrix)]
    coords = MDS(n_components=2, dissimilarity="precomputed", random_state=42).fit_transform(matrix).tolist()
    return labels, [[float(x), float(y)] for x, y in coords]


def simple_dtw(left: list[float], right: list[float]) -> float:
    n, m = len(left), len(right)
    matrix = [[float("inf")] * (m + 1) for _ in range(n + 1)]
    matrix[0][0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = abs(left[i - 1] - right[j - 1])
            matrix[i][j] = cost + min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1])
    return matrix[n][m]


def average_linkage_labels(distance_matrix: list[list[float]], target_count: int) -> list[int]:
    clusters: list[list[int]] = [[index] for index in range(len(distance_matrix))]

    def cluster_distance(left: list[int], right: list[int]) -> float:
        values = [distance_matrix[i][j] for i in left for j in right]
        return statistics.fmean(values)

    while len(clusters) > target_count:
        best_pair = (0, 1)
        best_distance = float("inf")
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                distance = cluster_distance(clusters[i], clusters[j])
                if distance < best_distance:
                    best_distance = distance
                    best_pair = (i, j)
        i, j = best_pair
        clusters[i] = sorted(clusters[i] + clusters[j])
        del clusters[j]

    labels = [0] * len(distance_matrix)
    for label, members in enumerate(clusters):
        for member in members:
            labels[member] = label
    return labels


def assign_cluster_traits(members: list[str], data: dict[str, Any]) -> tuple[str, str]:
    if not members:
        return "기타 패턴형", "데이터 부족"

    start_acc: list[float] = []
    end_acc: list[float] = []
    start_rt: list[float] = []
    end_rt: list[float] = []
    for identity in members:
        points = data[identity]["tasks"]["maze"]["raw_points"]
        if len(points) < 2:
            continue
        start_acc.append(mean([point["accuracy"] for point in points[:2]]) or 0.0)
        end_acc.append(mean([point["accuracy"] for point in points[-2:]]) or 0.0)
        start_rt.append(mean([point["rt"] for point in points[:2]]) or 0.0)
        end_rt.append(mean([point["rt"] for point in points[-2:]]) or 0.0)

    if not start_acc:
        return "기타 패턴형", "데이터 부족"

    accuracy_delta = (mean(end_acc) or 0.0) - (mean(start_acc) or 0.0)
    rt_delta = (mean(end_rt) or 0.0) - (mean(start_rt) or 0.0)

    if accuracy_delta >= 2.0 and rt_delta <= -0.3:
        return "동반 개선 곡선형", "정확도와 반응속도가 모두 향상됨"
    if rt_delta <= -0.5 and abs(accuracy_delta) < 2.0:
        return "속도 개선 곡선형", "정확도는 유지하면서 반응속도가 빨라짐"
    if accuracy_delta <= -2.0 and rt_delta <= -0.3:
        return "속도-정확도 교환 곡선형", "더 빨리 응답하려다 정확도가 하락함"
    if accuracy_delta >= 2.0 and rt_delta >= 0.0:
        return "정확도 개선 곡선형", "반응속도 향상 없이 정확도에 집중하여 개선됨"
    if accuracy_delta <= -2.0 and rt_delta >= 0.3:
        return "피로 누적(동반 하락)형", "정확도와 반응속도가 모두 저하됨"
    if (mean(start_acc) or 0.0) > 85:
        return "고득점 유지형", "처음부터 끝까지 높은 정확도를 안정적으로 유지함"
    return "불규칙 혼합형", "특정 방향성 없이 점수가 혼재됨"


def classical_mds(distance_matrix: list[list[float]]) -> list[list[float]]:
    n = len(distance_matrix)
    if n == 0:
        return []
    if n == 1:
        return [[0.0, 0.0]]

    squared = [[distance_matrix[i][j] ** 2 for j in range(n)] for i in range(n)]
    row_means = [statistics.fmean(row) for row in squared]
    col_means = [statistics.fmean(squared[i][j] for i in range(n)) for j in range(n)]
    total_mean = statistics.fmean(value for row in squared for value in row)
    centered = [
        [-0.5 * (squared[i][j] - row_means[i] - col_means[j] + total_mean) for j in range(n)]
        for i in range(n)
    ]
    eigenvalues, eigenvectors = jacobi_eigen(centered)
    order = sorted(range(n), key=lambda index: eigenvalues[index], reverse=True)[:2]
    coords = [[0.0, 0.0] for _ in range(n)]
    for axis, eigen_index in enumerate(order):
        eigenvalue = max(0.0, eigenvalues[eigen_index])
        scale = math.sqrt(eigenvalue)
        for row in range(n):
            coords[row][axis] = eigenvectors[row][eigen_index] * scale
    return coords


def jacobi_eigen(matrix: list[list[float]], max_iterations: int = 120) -> tuple[list[float], list[list[float]]]:
    n = len(matrix)
    a = [row[:] for row in matrix]
    vectors = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    if n == 1:
        return [a[0][0]], vectors

    for _ in range(max_iterations):
        p, q = 0, 1
        max_value = abs(a[p][q])
        for i in range(n):
            for j in range(i + 1, n):
                value = abs(a[i][j])
                if value > max_value:
                    max_value = value
                    p, q = i, j
        if max_value < 1e-10:
            break

        if abs(a[p][p] - a[q][q]) < 1e-12:
            angle = math.pi / 4
        else:
            angle = 0.5 * math.atan2(2 * a[p][q], a[q][q] - a[p][p])
        cosine = math.cos(angle)
        sine = math.sin(angle)

        app = (cosine * cosine * a[p][p]) - (2 * sine * cosine * a[p][q]) + (sine * sine * a[q][q])
        aqq = (sine * sine * a[p][p]) + (2 * sine * cosine * a[p][q]) + (cosine * cosine * a[q][q])
        a[p][p], a[q][q], a[p][q], a[q][p] = app, aqq, 0.0, 0.0

        for k in range(n):
            if k in {p, q}:
                continue
            akp, akq = a[k][p], a[k][q]
            a[k][p] = a[p][k] = cosine * akp - sine * akq
            a[k][q] = a[q][k] = sine * akp + cosine * akq

        for k in range(n):
            vkp, vkq = vectors[k][p], vectors[k][q]
            vectors[k][p] = cosine * vkp - sine * vkq
            vectors[k][q] = sine * vkp + cosine * vkq

    return [a[i][i] for i in range(n)], vectors


def main() -> None:
    analyzer_payload = build_analyzer_payload()
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    WEB_MAZE_ANALYZER_DATA_JS.write_text(
        "window.MAZE_ANALYZER_DATA = "
        + json.dumps(analyzer_payload["data"], ensure_ascii=False, separators=(",", ":"))
        + ";\nwindow.MAZE_ANALYZER_CLUSTERS = "
        + json.dumps(analyzer_payload["clusters"], ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {WEB_MAZE_ANALYZER_DATA_JS.relative_to(ROOT)} ({len(analyzer_payload['data']['cohort_profiles'])} analyzer participants)")


if __name__ == "__main__":
    main()
