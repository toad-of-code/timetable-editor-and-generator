"""
preprocessor.py — Phase 1 of the GG-CP Pipeline.

Responsibilities:
  1. Fetch subject L/T/P counts and room/group data from Supabase for the cluster.
  2. Fetch Ghost Blocks (slots already committed by other semesters).
  3. Chunk each subject × group × assignment into solver-ready Session objects.
"""

import os
import uuid
from typing import Optional
from supabase import create_client, Client
from dotenv import load_dotenv

from constants import (
    LECTURE_1HR_BUCKETS,
    LECTURE_2HR_BUCKETS,
    LAB_BUCKETS,
    time_str_to_bucket,
    ELECTIVE_ALL_GROUP_NAME,
)
from models import GenerateRequest, Session, GhostBlock

load_dotenv()

# ─── Supabase client (shared across modules) ─────────────────────────────────
_supabase: Optional[Client] = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_KEY"]
        _supabase = create_client(url, key)
    return _supabase


# ─── Ghost Block Fetcher ──────────────────────────────────────────────────────

def fetch_ghost_blocks(cluster_id: str, timetable_id_to_exclude: Optional[str] = None) -> list[GhostBlock]:
    """
    Query timetable_slots for ALL existing schedules EXCEPT the current one
    being generated. These become hard 'occupied' constraints in the solver.
    """
    sb = get_supabase()
    query = sb.from_("timetable_slots").select(
        "day_of_week, start_time, end_time, professor_id, room_id"
    )
    if timetable_id_to_exclude:
        query = query.neq("timetable_id", timetable_id_to_exclude)

    res = query.execute()
    if res.data is None:
        return []

    ghosts: list[GhostBlock] = []
    for row in res.data:
        start_b = time_str_to_bucket(row["start_time"])
        end_b = time_str_to_bucket(row["end_time"])
        ghosts.append(
            GhostBlock(
                day_of_week=row["day_of_week"],
                start_bucket=start_b,
                end_bucket=end_b,
                professor_id=row.get("professor_id"),
                room_id=row.get("room_id"),
            )
        )
    return ghosts


# ─── Session Chunker ──────────────────────────────────────────────────────────

def generate_chunked_sessions(request: GenerateRequest) -> tuple[list[Session], dict, int]:
    """
    Main pre-processor entry point.

    Returns:
        sessions       — list of solver-ready Session objects
        context        — enriched metadata dict (groups, rooms, cluster info)
        semester_number — the semester being solved (for floor zoning)
    """
    sb = get_supabase()

    # 1. Load cluster metadata
    cluster_res = sb.from_("semester_clusters").select("*").eq("id", request.cluster_id).single().execute()
    cluster = cluster_res.data
    semester_number: int = cluster["semester_number"]

    # 2. Load subjects for this cluster (with L/T/P data)
    req_res = sb.from_("cluster_requirements").select(
        "subject:subject_id (id, code, name, lectures, tutorials, practicals, subject_type, elective_group)"
    ).eq("cluster_id", request.cluster_id).execute()

    subjects: dict[str, dict] = {}
    for row in req_res.data:
        s = row["subject"]
        if s:
            subjects[s["id"]] = s

    # 3. Load student groups (need names for constraint matching)
    groups_res = sb.from_("student_groups").select("id, name, student_count").eq(
        "semester", semester_number
    ).execute()
    groups: dict[str, dict] = {g["id"]: g for g in (groups_res.data or [])}

    # 4. Load available rooms
    rooms_res = sb.from_("rooms").select("id, name, room_type, capacity").execute()
    rooms: dict[str, dict] = {r["id"]: r for r in (rooms_res.data or [])}

    # 5. Build sessions
    sessions: list[Session] = []

    for subject_id, group_assignments in request.assignments.items():
        subject = subjects.get(subject_id)
        if not subject:
            continue

        lectures: int = subject.get("lectures") or 0
        tutorials: int = subject.get("tutorials") or 0
        practicals: int = subject.get("practicals") or 0
        is_elective: bool = subject.get("subject_type") == "Elective"
        elective_group: Optional[str] = subject.get("elective_group")

        for group_id, professor_id in group_assignments.items():
            group = groups.get(group_id)
            if not group:
                continue

            group_name: str = group["name"]
            # Home room from UI (may be None for electives; solver will pick)
            home_room_id: Optional[str] = request.home_rooms.get(group_id)

            # ── Chunk Lectures ───────────────────────────────────────────
            # Rule: If L >= 2, create one 2-hr block + remaining 1-hr blocks.
            # Example: L=3 → [2hr, 1hr]; L=2 → [2hr]; L=1 → [1hr]
            remaining_lectures = lectures
            instance_idx = 0
            if remaining_lectures >= 2:
                sessions.append(_make_session(
                    subject, group_id, group_name, professor_id,
                    home_room_id, "Lecture", LECTURE_2HR_BUCKETS,
                    semester_number, is_elective, elective_group, instance_idx
                ))
                remaining_lectures -= 2
                instance_idx += 1
            for _ in range(remaining_lectures):
                sessions.append(_make_session(
                    subject, group_id, group_name, professor_id,
                    home_room_id, "Lecture", LECTURE_1HR_BUCKETS,
                    semester_number, is_elective, elective_group, instance_idx
                ))
                instance_idx += 1

            # ── Chunk Tutorials ──────────────────────────────────────────
            instance_idx = 0
            for _ in range(tutorials):
                sessions.append(_make_session(
                    subject, group_id, group_name, professor_id,
                    home_room_id, "Tutorial", LECTURE_1HR_BUCKETS,
                    semester_number, is_elective, elective_group, instance_idx
                ))
                instance_idx += 1

            # ── Chunk Practicals ─────────────────────────────────────────
            # Labs are always 2hr contiguous. practical count = number of lab sessions.
            instance_idx = 0
            for _ in range(practicals):
                sessions.append(_make_session(
                    subject, group_id, group_name, professor_id,
                    None,          # Labs never use home room — solver picks Lab room
                    "Practical", LAB_BUCKETS,
                    semester_number, is_elective, elective_group, instance_idx
                ))
                instance_idx += 1

    context = {
        "cluster": cluster,
        "groups": groups,
        "rooms": rooms,
        "semester_number": semester_number,
    }

    return sessions, context, semester_number


# ─── Helper ───────────────────────────────────────────────────────────────────

def _make_session(
    subject: dict,
    group_id: str,
    group_name: str,
    professor_id: str,
    room_id: Optional[str],
    session_type: str,
    duration_buckets: int,
    semester_number: int,
    is_elective: bool,
    elective_group: Optional[str],
    instance_idx: Optional[int],
) -> Session:
    return Session(
        session_id=str(uuid.uuid4()),
        subject_id=subject["id"],
        subject_code=subject["code"],
        subject_name=subject["name"],
        group_id=group_id,
        group_name=group_name,
        professor_id=professor_id,
        room_id=room_id,
        session_type=session_type,
        duration_buckets=duration_buckets,
        semester_number=semester_number,
        is_elective=is_elective,
        elective_group=elective_group,
        elective_instance_idx=instance_idx,
    )
