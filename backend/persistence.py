"""
persistence.py — Phase 3 of the GG-CP Pipeline.

Takes the CP-SAT solution (list of ScheduledSession) and:
  1. Creates a new timetable record in the `timetables` table.
  2. Inserts all scheduled slots into `timetable_slots` (the Global Ledger).
"""

import os
from datetime import datetime

from models import ScheduledSession, SlotResult, GenerateRequest
from constants import bucket_to_time_str
from preprocessor import get_supabase


def persist_solution(
    scheduled_sessions: list[ScheduledSession],
    request: GenerateRequest,
    cluster: dict,
) -> tuple[str, list[SlotResult]]:
    """
    Saves the generated timetable to Supabase.

    Returns:
        timetable_id — UUID of the newly created timetable record
        slot_results — list of SlotResult for the API response
    """
    sb = get_supabase()
    semester = cluster["semester_number"]
    batch_year = cluster["batch_year"]
    dept = cluster.get("department", "IT")

    # ── Step 1: Create a new timetable record ─────────────────────────────────
    timetable_name = f"{dept} Sem-{semester} Batch-{batch_year} (GG-CP)"
    academic_year = f"{batch_year}-{batch_year + 1}"

    tt_res = sb.from_("timetables").insert({
        "name": timetable_name,
        "academic_year": academic_year,
        "semester": semester,
        "status": "draft",
        "lunch_start": "13:00:00",
        "lunch_end": "14:30:00",
    }).select("id").single().execute()

    timetable_id: str = tt_res.data["id"]
    print(f"[Persistence] Created timetable '{timetable_name}' → {timetable_id}")

    # ── Step 2: Prepare slot rows ─────────────────────────────────────────────
    slot_rows = []
    slot_results: list[SlotResult] = []

    for sched in scheduled_sessions:
        s = sched.session
        start_time_str = bucket_to_time_str(sched.start_bucket)
        end_time_str = bucket_to_time_str(sched.end_bucket)

        slot_row = {
            "timetable_id": timetable_id,
            "subject_id": s.subject_id,
            "professor_id": s.professor_id,
            "room_id": sched.assigned_room_id,
            "student_group_id": s.group_id,
            "day_of_week": sched.day_of_week,
            "start_time": start_time_str,
            "end_time": end_time_str,
            "slot_type": s.session_type,
        }
        slot_rows.append(slot_row)

        slot_results.append(SlotResult(
            subject_id=s.subject_id,
            subject_name=s.subject_name,
            professor_id=s.professor_id,
            room_id=sched.assigned_room_id,
            student_group_id=s.group_id,
            day_of_week=sched.day_of_week,
            start_time=start_time_str,
            end_time=end_time_str,
            slot_type=s.session_type,
        ))

    # ── Step 3: Bulk insert slots ──────────────────────────────────────────────
    if slot_rows:
        insert_res = sb.from_("timetable_slots").insert(slot_rows).execute()
        print(f"[Persistence] ✅ Inserted {len(slot_rows)} slots into timetable_slots.")

    return timetable_id, slot_results
