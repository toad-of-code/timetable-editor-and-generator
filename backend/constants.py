"""
constants.py — Hardcoded mathematical realities of the college.
These never belong in a UI. Changing them requires re-running the solver.
"""

# ─── Time Grid ─────────────────────────────────────────────────────────────────
# 58 buckets of 10-minutes each, from 08:50 to 18:30.
# Bucket 0 = 08:50, Bucket 57 = 18:20 (end of last possible slot)

BUCKET_DURATION_MINUTES = 10
TOTAL_BUCKETS = 58

# College day starts at 08:50 AM
DAY_START_HOUR = 8
DAY_START_MINUTE = 50


def bucket_to_time_str(bucket: int) -> str:
    """Convert a bucket index (0-57) to a HH:MM time string."""
    total_minutes = DAY_START_HOUR * 60 + DAY_START_MINUTE + bucket * BUCKET_DURATION_MINUTES
    h = total_minutes // 60
    m = total_minutes % 60
    return f"{h:02d}:{m:02d}:00"


def time_str_to_bucket(time_str: str) -> int:
    """Convert 'HH:MM:SS' or 'HH:MM' to a bucket index."""
    parts = time_str.split(":")
    h, m = int(parts[0]), int(parts[1])
    total_minutes = h * 60 + m
    day_start_minutes = DAY_START_HOUR * 60 + DAY_START_MINUTE
    return (total_minutes - day_start_minutes) // BUCKET_DURATION_MINUTES


# ─── Blocked Buckets (Lunch) ───────────────────────────────────────────────────
# 13:00 → bucket 25  |  14:30 → bucket 34
LUNCH_START_BUCKET = time_str_to_bucket("13:00")  # 25
LUNCH_END_BUCKET = time_str_to_bucket("14:30")    # 34

# All buckets that are completely inside the lunch window (solver cannot start here)
LUNCH_BLOCKED_BUCKETS: set[int] = set(range(LUNCH_START_BUCKET, LUNCH_END_BUCKET))


# ─── Session Duration in Buckets ──────────────────────────────────────────────
LECTURE_1HR_BUCKETS = 6   # 60 min / 10 min = 6 buckets
LECTURE_2HR_BUCKETS = 12  # 120 min / 10 min = 12 buckets
LAB_BUCKETS = 12          # Labs are always 2-hour contiguous blocks


# ─── Floor Zoning ─────────────────────────────────────────────────────────────
# Maps semester number → preferred building floor (0-indexed).
# The solver uses this as a soft constraint to prefer rooms on the correct floor.

SEMESTER_TO_FLOOR: dict[int, int] = {
    1: 0,  # 1st year → Ground Floor
    2: 0,
    3: 1,  # 2nd year → 1st Floor
    4: 1,
    5: 2,  # 3rd year → 2nd Floor
    6: 2,
    7: 3,  # 4th year → 3rd Floor
    8: 3,
}


# ─── Work Week ─────────────────────────────────────────────────────────────────
# day_of_week matches timetable_slots.day_of_week (1=Mon, 5=Fri)
WORK_DAYS = [1, 2, 3, 4, 5]  # Monday to Friday only
NUM_WORK_DAYS = len(WORK_DAYS)


# ─── Special Group Names ───────────────────────────────────────────────────────
# Groups named 'All' are used for elective baskets (all sections attend together).
ELECTIVE_ALL_GROUP_NAME = "All"


# ─── Section Clash Constraints (from constraints.txt) ─────────────────────────
# These pairs of student group NAMES must never share the same time bucket.
# Add new constraints here as strings — matched against student_group.name.

MUST_NOT_CLASH_PAIRS: list[tuple[str, str]] = [
    ("Sec C", "IT-BI"),
]
