"""
models.py — Pydantic data models for the API request/response
and internal solver data structures.
"""

from pydantic import BaseModel, Field
from typing import Optional


# ─── API Request (from GeneratorView UI) ──────────────────────────────────────

class GenerateRequest(BaseModel):
    """Payload sent by the React frontend when the user clicks 'Generate Timetable'."""

    cluster_id: str = Field(..., description="UUID of the semester_cluster to generate for.")

    # { group_id: room_id } — Home room for each non-'All' student section.
    home_rooms: dict[str, str] = Field(default_factory=dict)

    # { subject_id: { group_id: professor_id } } — Professor assignments from the matrix.
    assignments: dict[str, dict[str, str]] = Field(default_factory=dict)


# ─── Internal Solver Structures ───────────────────────────────────────────────

class Session:
    """
    A single schedulable unit produced by the pre-processor.
    Represents one contiguous block (e.g., a 2-hr lecture, a 1-hr tutorial, a 2-hr lab).
    """

    def __init__(
        self,
        session_id: str,
        subject_id: str,
        subject_code: str,
        subject_name: str,
        group_id: str,
        group_name: str,
        professor_id: str,
        room_id: Optional[str],      # None = solver picks from pool
        session_type: str,           # 'Lecture' | 'Tutorial' | 'Practical'
        duration_buckets: int,       # e.g., 6 = 1hr, 12 = 2hr
        semester_number: int,
        is_elective: bool = False,
        elective_group: Optional[str] = None,
        elective_instance_idx: Optional[int] = None,
    ):
        self.session_id = session_id
        self.subject_id = subject_id
        self.subject_code = subject_code
        self.subject_name = subject_name
        self.group_id = group_id
        self.group_name = group_name
        self.professor_id = professor_id
        self.room_id = room_id
        self.session_type = session_type
        self.duration_buckets = duration_buckets
        self.semester_number = semester_number
        self.is_elective = is_elective
        self.elective_group = elective_group
        self.elective_instance_idx = elective_instance_idx

    def __repr__(self) -> str:
        return (
            f"Session({self.subject_code} | {self.group_name} | "
            f"{self.session_type} | {self.duration_buckets * 10}min)"
        )


class GhostBlock:
    """
    A time slot already occupied by a previously generated semester.
    The solver treats these as immovable obstacles.
    """

    def __init__(
        self,
        day_of_week: int,
        start_bucket: int,
        end_bucket: int,
        professor_id: Optional[str] = None,
        room_id: Optional[str] = None,
    ):
        self.day_of_week = day_of_week
        self.start_bucket = start_bucket
        self.end_bucket = end_bucket
        self.professor_id = professor_id
        self.room_id = room_id


class ScheduledSession:
    """The solved output for a single session."""

    def __init__(
        self,
        session: Session,
        day_of_week: int,
        start_bucket: int,
        end_bucket: int,
        assigned_room_id: str,
    ):
        self.session = session
        self.day_of_week = day_of_week
        self.start_bucket = start_bucket
        self.end_bucket = end_bucket
        self.assigned_room_id = assigned_room_id


# ─── API Response ─────────────────────────────────────────────────────────────

class SlotResult(BaseModel):
    """A single scheduled slot returned to the frontend."""
    subject_id: str
    subject_name: str
    professor_id: str
    room_id: str
    student_group_id: str
    day_of_week: int
    start_time: str    # 'HH:MM:SS'
    end_time: str      # 'HH:MM:SS'
    slot_type: str     # 'Lecture' | 'Tutorial' | 'Practical'


class GenerateResponse(BaseModel):
    status: str        # 'success' | 'infeasible' | 'error'
    message: str
    timetable_id: Optional[str] = None
    slots_generated: int = 0
    slots: list[SlotResult] = []
