#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

import compute_svt_metrics as m


def trial(identity="student_id:1", round_number=1, trial_index=1, correct=1.0, rt=1.0, response="O", answer="O", participant_id="P", student_id="1", name="Name", short_id="000001"):
    return m.Trial(
        source_file=f"file-{round_number}.csv",
        encoding="utf-8-sig",
        identity_key=identity,
        participant_id=participant_id,
        student_id=student_id,
        name_from_filename=name,
        short_id=short_id,
        round_number=round_number,
        round_label=m.attempt_label(round_number),
        task="cst",
        trial_index=trial_index,
        stimulus_id=f"s{trial_index}",
        item_category="Noun",
        statement=f"Statement {trial_index}",
        response=response,
        correct_answer=answer,
        correct=correct,
        rt=rt,
        timestamp="",
        file_datetime=None,
        row_datetime=None,
    )


def test_late_round_assignment():
    anchors = {
        1: datetime(2026, 5, 6),
        2: datetime(2026, 5, 11),
        3: datetime(2026, 5, 16),
        4: datetime(2026, 5, 18),
        5: datetime(2026, 5, 20),
        6: datetime(2026, 5, 25),
        7: datetime(2026, 5, 27),
    }
    path = Path("extracted/SVT_MAZE 늦은제출파일_0526/PARTICIPANT_cst_2026-05-19_13h29.16.554.csv")
    round_number, rule, parsed = m.assign_round(path, None, anchors)
    assert round_number == 4
    assert rule == "late_nearest_date"
    assert parsed and parsed.date().isoformat() == "2026-05-19"


def test_exact_copy_duplicates_are_collapsed_by_content_hash():
    early = m.FileRecord(Path("a.csv"), "a.csv", "candidate", identity_key="student_id:1", task="cst", round_number=1, file_datetime=datetime(2026, 5, 6, 10), valid_trials=2, content_hash="same")
    late = m.FileRecord(Path("b.csv"), "b.csv", "candidate", identity_key="student_id:1", task="cst", round_number=1, file_datetime=datetime(2026, 5, 6, 11), valid_trials=2, content_hash="same")
    selected, duplicates = m.choose_representative_files([early, late], {"a.csv": [trial(trial_index=1), trial(trial_index=2)], "b.csv": [trial(trial_index=1), trial(trial_index=2)]})
    assert len(selected) == 2
    assert late.status == "selected"
    assert early.status == "duplicate"
    assert duplicates[0]["selected_file"] == "b.csv"
    assert "content hash" in duplicates[0]["reason"]


def test_same_source_bucket_different_times_remain_separate_attempts():
    first_path = "extracted/svt_s1/강필중202135_64122_5063969_PARTICIPANT_cst_2026-05-06_11h00.58.059.csv"
    second_path = "extracted/svt_s1/강필중202135_64122_5063970_PARTICIPANT_cst_2026-05-06_11h05.09.297.csv"
    first = m.FileRecord(Path(first_path), first_path, "candidate", identity_key="participant_id:applebanana", task="cst", round_number=1, source_round_number=1, file_datetime=datetime(2026, 5, 6, 11, 0), valid_trials=32, content_hash="first")
    second = m.FileRecord(Path(second_path), second_path, "candidate", identity_key="participant_id:applebanana", task="cst", round_number=1, source_round_number=1, file_datetime=datetime(2026, 5, 6, 11, 5), valid_trials=32, content_hash="second")
    trials_by_file = {first_path: [trial(correct=0.0, round_number=1)], second_path: [trial(correct=1.0, round_number=1)]}
    selected, duplicates = m.choose_representative_files([first, second], trials_by_file)
    assert len(selected) == 2
    assert not duplicates
    assert first.status == "selected"
    assert second.status == "selected"
    m.assign_chronological_attempts([first, second], trials_by_file)
    assert first.round_number == 1
    assert second.round_number == 2
    assert trials_by_file[first_path][0].round_number == 1
    assert trials_by_file[second_path][0].round_number == 2


def test_identity_resolution_merges_text_id_student_id_and_filename_name():
    numeric = m.FileRecord(
        Path("round1.csv"),
        "round1.csv",
        "candidate",
        identity_key="student_id:2021350035",
        participant_id="2021350035",
        student_id="2021350035",
        name_from_filename="강필중",
        short_id="202135",
        task="cst",
        round_number=1,
        file_datetime=datetime(2026, 5, 6, 10),
        valid_trials=1,
    )
    text_id = m.FileRecord(
        Path("round2.csv"),
        "round2.csv",
        "candidate",
        identity_key="participant_id:applebanana",
        participant_id="applebanana",
        student_id="applebanana",
        name_from_filename="강필중",
        short_id="202135",
        task="cst",
        round_number=2,
        file_datetime=datetime(2026, 5, 11, 10),
        valid_trials=1,
    )
    trials_by_file = {
        "round1.csv": [trial(identity=numeric.identity_key, round_number=1, participant_id="2021350035", student_id="2021350035", name="강필중", short_id="202135")],
        "round2.csv": [trial(identity=text_id.identity_key, round_number=2, participant_id="applebanana", student_id="applebanana", name="강필중", short_id="202135")],
    }
    m.resolve_identity_links([numeric, text_id], trials_by_file)
    assert numeric.identity_key == "participant_id:applebanana"
    assert text_id.identity_key == "participant_id:applebanana"
    assert {t.identity_key for trials in trials_by_file.values() for t in trials} == {"participant_id:applebanana"}


def test_identity_resolution_merges_text_student_id_with_unique_filename_name():
    named_file = m.FileRecord(
        Path("named.csv"),
        "named.csv",
        "candidate",
        identity_key="filename:강혜민:202231",
        participant_id="anonymous",
        student_id="",
        name_from_filename="강혜민",
        short_id="202231",
        task="cst",
        round_number=1,
        file_datetime=datetime(2026, 5, 13, 10),
        valid_trials=1,
    )
    anonymous_late = m.FileRecord(
        Path("late.csv"),
        "late.csv",
        "candidate",
        identity_key="participant_id:anonymous",
        participant_id="anonymous",
        student_id="강혜민",
        name_from_filename="",
        short_id="",
        task="cst",
        round_number=2,
        file_datetime=datetime(2026, 5, 26, 10),
        valid_trials=1,
    )
    other_anonymous = m.FileRecord(
        Path("other.csv"),
        "other.csv",
        "candidate",
        identity_key="participant_id:anonymous",
        participant_id="anonymous",
        student_id="크롱",
        name_from_filename="",
        short_id="",
        task="cst",
        round_number=3,
        file_datetime=datetime(2026, 5, 27, 10),
        valid_trials=1,
    )
    trials_by_file = {
        "named.csv": [trial(identity=named_file.identity_key, round_number=1, participant_id="anonymous", student_id="", name="강혜민", short_id="202231")],
        "late.csv": [trial(identity=anonymous_late.identity_key, round_number=2, participant_id="anonymous", student_id="강혜민", name="", short_id="")],
        "other.csv": [trial(identity=other_anonymous.identity_key, round_number=3, participant_id="anonymous", student_id="크롱", name="", short_id="")],
    }
    m.resolve_identity_links([named_file, anonymous_late, other_anonymous], trials_by_file)
    assert named_file.identity_key == "filename:강혜민:202231"
    assert anonymous_late.identity_key == "filename:강혜민:202231"
    assert other_anonymous.identity_key == "student_text:크롱"
    assert {t.identity_key for t in trials_by_file["named.csv"] + trials_by_file["late.csv"]} == {"filename:강혜민:202231"}
    assert {t.identity_key for t in trials_by_file["other.csv"]} == {"student_text:크롱"}


def test_confusion_stats():
    trials = [trial(trial_index=i, rt=1.0) for i in range(1, 21)] + [trial(trial_index=21, rt=100.0, correct=0.0, response="X", answer="O")]
    stats = m.confusion_stats(trials)
    assert stats is not None
    assert stats["included"] == 21
    assert stats["counts"]["tp"] == 20
    assert stats["counts"]["fn"] == 1


def test_comparable_stimulus_ids_identifies_round1_only_items():
    trials = []
    for round_number in m.ROUND_LABELS:
        trials.append(trial(round_number=round_number, trial_index=1))
        trials[-1].stimulus_id = "shared"
    one_only = trial(round_number=1, trial_index=2)
    one_only.stimulus_id = "round1_only"
    trials.append(one_only)
    common, round1_only = m.comparable_stimulus_ids(trials)
    assert common == {"shared"}
    assert round1_only == {"round1_only"}


def test_zip_archive_round_assignment_and_reading():
    source = m.CandidateSource(
        rel_path="extracted/SVT_5_520.zip::tester202500_12345_1_PARTICIPANT_cst_2026-05-20_11h14.49.332.csv",
        name="tester202500_12345_1_PARTICIPANT_cst_2026-05-20_11h14.49.332.csv",
        parent_name="SVT_5_520",
        suffix=".csv",
        archive_round=5,
        data=(
            "participant_id,student_id,task,trial_index,stimulus_id,item_category,response,correct_answer,correct,rt,timestamp\n"
            "zipnick,202500,cst,1,svt_shared,Noun,O,O,1,1.23,2026-05-20T11:14:49\n"
        ).encode("utf-8-sig"),
    )
    record, trials = m.read_trials(source, m.discover_round_anchors())
    assert record.status == "candidate"
    assert record.round_number == 5
    assert record.assignment_rule == "zip_archive"
    assert len(trials) == 1
    assert trials[0].round_label == "svt_5"


def test_extracted_round_directory_assignment():
    source = m.CandidateSource(
        rel_path="extracted/SVT_5_520/tester202500_12345_1_PARTICIPANT_cst_2026-05-20_11h14.49.332.csv",
        name="tester202500_12345_1_PARTICIPANT_cst_2026-05-20_11h14.49.332.csv",
        parent_name="SVT_5_520",
        suffix=".csv",
        data=(
            "participant_id,student_id,task,trial_index,stimulus_id,item_category,response,correct_answer,correct,rt,timestamp\n"
            "zipnick,202500,cst,1,svt_shared,Noun,O,O,1,1.23,2026-05-20T11:14:49\n"
        ).encode("utf-8-sig"),
    )
    record, trials = m.read_trials(source, m.discover_round_anchors())
    assert record.status == "candidate"
    assert record.round_number == 5
    assert record.assignment_rule == "folder"
    assert len(trials) == 1


def test_iter_candidate_files_reads_real_zip_archive():
    original_root = m.ROOT
    original_extracted = m.EXTRACTED_DIR
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        extracted = root / "extracted"
        extracted.mkdir()
        archive_path = extracted / "SVT_5_520.zip"
        csv_name = "tester202500_12345_1_PARTICIPANT_cst_2026-05-20_11h14.49.332.csv"
        csv_data = (
            "participant_id,student_id,task,trial_index,stimulus_id,item_category,response,correct_answer,correct,rt,timestamp\n"
            "zipnick,202500,cst,1,svt_shared,Noun,O,O,1,1.23,2026-05-20T11:14:49\n"
        )
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr(csv_name, csv_data)
        try:
            m.ROOT = root
            m.EXTRACTED_DIR = extracted
            sources = m.iter_candidate_files()
            assert len(sources) == 1
            assert sources[0].rel_path == f"extracted/SVT_5_520.zip::{csv_name}"
            record, trials = m.read_trials(sources[0], m.discover_round_anchors())
            assert record.status == "candidate"
            assert record.round_number == 5
            assert record.assignment_rule == "zip_archive"
            assert len(trials) == 1
        finally:
            m.ROOT = original_root
            m.EXTRACTED_DIR = original_extracted


def test_iter_candidate_files_reads_generic_zip_archive_by_date():
    original_root = m.ROOT
    original_extracted = m.EXTRACTED_DIR
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        extracted = root / "extracted"
        extracted.mkdir()
        archive_path = extracted / "0609 svt.zip"
        csv_name = "PARTICIPANT_cst_2026-06-09_17h46.36.887.csv"
        csv_data = (
            "participant_id,student_id,task,trial_index,stimulus_id,item_category,response,correct_answer,correct,rt,timestamp\n"
            "zipnick,202500,cst,1,svt_shared,Noun,O,O,1,1.23,2026-06-09T17:46:36\n"
        )
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr(csv_name, csv_data)
        try:
            m.ROOT = root
            m.EXTRACTED_DIR = extracted
            sources = m.iter_candidate_files()
            assert len(sources) == 1
            assert sources[0].rel_path == f"extracted/0609 svt.zip::{csv_name}"
            record, trials = m.read_trials(sources[0], m.discover_round_anchors())
            assert record.status == "candidate"
            assert record.assignment_rule == "nearest_date"
            assert len(trials) == 1
        finally:
            m.ROOT = original_root
            m.EXTRACTED_DIR = original_extracted


def test_dated_unknown_folder_csv_is_included_by_nearest_date():
    source = m.CandidateSource(
        rel_path="extracted/0609/PARTICIPANT_cst_2026-06-09_17h46.36.887.csv",
        name="PARTICIPANT_cst_2026-06-09_17h46.36.887.csv",
        parent_name="0609",
        suffix=".csv",
        data=(
            "participant_id,student_id,task,trial_index,stimulus_id,item_category,response,correct_answer,correct,rt,timestamp\n"
            "dated,202500,cst,1,svt_shared,Noun,O,O,1,1.23,2026-06-09T17:46:36\n"
        ).encode("utf-8-sig"),
    )
    record, trials = m.read_trials(source, m.discover_round_anchors())
    assert record.status == "candidate"
    assert record.assignment_rule == "nearest_date"
    assert len(trials) == 1


def test_iter_candidate_files_prefers_extracted_round_dir_over_matching_zip():
    original_root = m.ROOT
    original_extracted = m.EXTRACTED_DIR
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        extracted = root / "extracted"
        round_dir = extracted / "SVT_5_520"
        round_dir.mkdir(parents=True)
        csv_name = "tester202500_12345_1_PARTICIPANT_cst_2026-05-20_11h14.49.332.csv"
        csv_data = (
            "participant_id,student_id,task,trial_index,stimulus_id,item_category,response,correct_answer,correct,rt,timestamp\n"
            "zipnick,202500,cst,1,svt_shared,Noun,O,O,1,1.23,2026-05-20T11:14:49\n"
        )
        (round_dir / csv_name).write_text(csv_data, encoding="utf-8")
        with zipfile.ZipFile(extracted / "SVT_5_520.zip", "w") as archive:
            archive.writestr(csv_name, csv_data)
        try:
            m.ROOT = root
            m.EXTRACTED_DIR = extracted
            sources = m.iter_candidate_files()
            assert [source.rel_path for source in sources] == [f"extracted/SVT_5_520/{csv_name}"]
        finally:
            m.ROOT = original_root
            m.EXTRACTED_DIR = original_extracted


def test_iter_candidate_files_excludes_svt_s1_directory():
    original_root = m.ROOT
    original_extracted = m.EXTRACTED_DIR
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        extracted = root / "extracted"
        excluded_dir = extracted / "svt_s1"
        included_dir = extracted / "svt_s2"
        excluded_dir.mkdir(parents=True)
        included_dir.mkdir(parents=True)
        csv_name = "tester202500_12345_1_PARTICIPANT_cst_2026-05-20_11h14.49.332.csv"
        csv_data = (
            "participant_id,student_id,task,trial_index,stimulus_id,item_category,response,correct_answer,correct,rt,timestamp\n"
            "zipnick,202500,cst,1,svt_shared,Noun,O,O,1,1.23,2026-05-20T11:14:49\n"
        )
        (excluded_dir / csv_name).write_text(csv_data, encoding="utf-8")
        (included_dir / csv_name).write_text(csv_data, encoding="utf-8")
        try:
            m.ROOT = root
            m.EXTRACTED_DIR = extracted
            sources = m.iter_candidate_files()
            assert [source.rel_path for source in sources] == [f"extracted/svt_s2/{csv_name}"]
        finally:
            m.ROOT = original_root
            m.EXTRACTED_DIR = original_extracted


def test_model_fallback_and_privacy_payload():
    assert m.fit_models([{"x": 1.0, "y": 1.0}, {"x": 2.0, "y": 2.0}])["status"] == "insufficient_points"
    summary = {
        "generatedAt": "now",
        "rounds": [{"round": 1, "label": "svt_1"}, {"round": 2, "label": "svt_2"}],
        "quality": {"sourceFileCount": 1, "selectedFileCount": 1, "excludedFileCount": 0, "duplicateFileCount": 0, "selectedTrialCount": 1, "sd3ExcludedCount": 0, "fileRows": [], "duplicates": [{"identity_key": "secret"}]},
        "participants": [{"id": "student_id:2024000000", "nickname": "Real Name", "studentIds": ["2024000000"], "participantIds": ["nick"], "namesFromFilename": ["Real Name"], "rounds": {"1": {"round": 1, "sourceFiles": ["secret.csv"], "accuracy": 1.0}, "2": {"round": 2, "sourceFiles": ["secret2.csv"], "accuracy": 1.0}}, "sequence": [], "models": {}}],
    }
    public = m.compact_for_web(summary)
    assert public["schemaVersion"] == 1
    assert public["participants"][0]["id"] == "nick"
    assert public["participants"][0]["idSource"] == "participant_id"
    assert "studentIds" not in public["participants"][0]
    assert "sourceFiles" not in public["participants"][0]["rounds"]["1"]
    assert "duplicates" not in public["quality"]


def test_public_payload_prefers_latest_selected_participant_id():
    summary = {
        "generatedAt": "now",
        "rounds": [],
        "quality": {"sourceFileCount": 0, "selectedFileCount": 0, "excludedFileCount": 0, "duplicateFileCount": 0, "selectedTrialCount": 0, "sd3ExcludedCount": 0},
        "participants": [
            {
                "id": "participant_id:ddochi",
                "nickname": "노휘래",
                "studentIds": ["2022130344"],
                "shortIds": ["202244"],
                "participantIds": ["2022130344", "Sochi", "ddochi"],
                "latestParticipantId": "ddochi",
                "namesFromFilename": ["노휘래"],
                "rounds": {"1": {"round": 1}, "7": {"round": 7}},
                "sequence": [],
                "models": {},
            }
        ],
    }
    public = m.compact_for_web(summary)
    assert public["participants"][0]["id"] == "ddochi"
    assert public["participants"][0]["nickname"] == "ddochi"
    assert public["participants"][0]["idSource"] == "participant_id"
    assert "latestParticipantId" not in public["participants"][0]


def test_student_id_public_fallback_when_participant_id_missing():
    summary = {
        "generatedAt": "now",
        "rounds": [],
        "quality": {"sourceFileCount": 0, "selectedFileCount": 0, "excludedFileCount": 0, "duplicateFileCount": 0, "selectedTrialCount": 0, "sd3ExcludedCount": 0},
        "participants": [{"id": "student_id:2024000000", "nickname": "2024000000", "studentIds": ["2024000000"], "participantIds": ["anonymous", "2024000000"], "namesFromFilename": [], "rounds": {"1": {"round": 1}, "2": {"round": 2}}, "sequence": [], "models": {}}],
    }
    public = m.compact_for_web(summary)
    assert public["participants"][0]["id"] == "2024000000"
    assert public["participants"][0]["nickname"] == "2024000000"
    assert public["participants"][0]["idSource"] == "student_id"
    assert "studentIds" not in public["participants"][0]


def test_filename_short_id_public_fallback_when_student_id_missing():
    summary = {
        "generatedAt": "now",
        "rounds": [],
        "quality": {"sourceFileCount": 0, "selectedFileCount": 0, "excludedFileCount": 0, "duplicateFileCount": 0, "selectedTrialCount": 0, "sd3ExcludedCount": 0},
        "participants": [{"id": "filename:Name:202231", "nickname": "Name", "studentIds": ["Name"], "shortIds": ["202231"], "participantIds": ["anonymous"], "namesFromFilename": ["Name"], "rounds": {"1": {"round": 1}, "2": {"round": 2}}, "sequence": [], "models": {}}],
    }
    public = m.compact_for_web(summary)
    assert public["participants"][0]["id"] == "202231"
    assert public["participants"][0]["nickname"] == "202231"
    assert public["participants"][0]["idSource"] == "student_id"
    assert "shortIds" not in public["participants"][0]


def test_public_payload_excludes_single_round_participants():
    summary = {
        "generatedAt": "now",
        "rounds": [],
        "quality": {"sourceFileCount": 0, "selectedFileCount": 0, "excludedFileCount": 0, "duplicateFileCount": 0, "selectedTrialCount": 0, "sd3ExcludedCount": 0},
        "participants": [
            {"id": "participant_id:one", "nickname": "one", "studentIds": [], "participantIds": ["one"], "namesFromFilename": [], "rounds": {"1": {"round": 1}}, "sequence": [], "models": {}},
            {"id": "participant_id:two", "nickname": "two", "studentIds": [], "participantIds": ["two"], "namesFromFilename": [], "rounds": {"1": {"round": 1}, "2": {"round": 2}}, "sequence": [], "models": {}},
        ],
    }
    public = m.compact_for_web(summary)
    assert [participant["id"] for participant in public["participants"]] == ["two"]


def run_all():
    for test in [test_late_round_assignment, test_exact_copy_duplicates_are_collapsed_by_content_hash, test_same_source_bucket_different_times_remain_separate_attempts, test_identity_resolution_merges_text_id_student_id_and_filename_name, test_identity_resolution_merges_text_student_id_with_unique_filename_name, test_confusion_stats, test_comparable_stimulus_ids_identifies_round1_only_items, test_zip_archive_round_assignment_and_reading, test_extracted_round_directory_assignment, test_iter_candidate_files_reads_real_zip_archive, test_iter_candidate_files_reads_generic_zip_archive_by_date, test_dated_unknown_folder_csv_is_included_by_nearest_date, test_iter_candidate_files_prefers_extracted_round_dir_over_matching_zip, test_iter_candidate_files_excludes_svt_s1_directory, test_model_fallback_and_privacy_payload, test_public_payload_prefers_latest_selected_participant_id, test_student_id_public_fallback_when_participant_id_missing, test_filename_short_id_public_fallback_when_student_id_missing, test_public_payload_excludes_single_round_participants]:
        test()
    print("fixture tests passed")


if __name__ == "__main__":
    run_all()
