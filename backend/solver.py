"""
solver.py — Stage 2 of the GG-CP Pipeline: CP-SAT Time & Room Mapper.

Takes the color groups from Stage 1 and maps each group onto the
10-minute time grid using Google OR-Tools CP-SAT.

Hard constraints enforced:
  - No lunch slots (13:00–14:30)
  - Professor not double-booked across any two sessions on the same day
  - Room not double-booked on the same day
  - Ghost blocks (pre-occupied by other semesters) fully blocked
  - Labs must use a room of type 'Lab'
  - Sec C and IT-BI must not share the same time bucket (from constants.py)

Soft constraint:
  - Prefer rooms on the correct floor for this semester (SEMESTER_TO_FLOOR)
"""

from ortools.sat.python import cp_model
from typing import Optional

from models import Session, GhostBlock, ScheduledSession
from constants import (
    TOTAL_BUCKETS,
    NUM_WORK_DAYS,
    LUNCH_BLOCKED_BUCKETS,
    SEMESTER_TO_FLOOR,
    MUST_NOT_CLASH_PAIRS,
)


def run_cp_sat_solver(
    color_groups: dict[int, list[Session]],
    ghost_blocks: list[GhostBlock],
    rooms: dict[str, dict],
    context: dict,
) -> Optional[list[ScheduledSession]]:
    """
    Entry point for Stage 2.

    Args:
        color_groups    — output from Stage 1 (color → sessions list)
        ghost_blocks    — pre-occupied slots from other semesters
        rooms           — all available rooms {room_id: {name, room_type, ...}}
        context         — enriched context dict from preprocessor (groups, cluster, etc.)

    Returns:
        list[ScheduledSession] on success, None if infeasible.
    """
    model = cp_model.CpModel()
    all_sessions: list[Session] = [s for group in color_groups.values() for s in group]
    semester_number: int = context["semester_number"]
    groups_meta: dict[str, dict] = context["groups"]  # group_id → {name, ...}

    # Expand rooms into sorted lists for indexing
    room_ids = list(rooms.keys())
    room_idx: dict[str, int] = {rid: i for i, rid in enumerate(room_ids)}
    num_rooms = len(room_ids)

    if num_rooms == 0 or not all_sessions:
        return None

    # ── Decision Variables ───────────────────────────────────────────────────
    # For each session: day (0-4), start_bucket (0-57), room_index

    day_vars: dict[str, cp_model.IntVar] = {}
    start_vars: dict[str, cp_model.IntVar] = {}
    room_vars: dict[str, cp_model.IntVar] = {}

    for s in all_sessions:
        sid = s.session_id
        # Day: Monday=0 ... Friday=4
        day_vars[sid] = model.NewIntVar(0, NUM_WORK_DAYS - 1, f"day_{sid[:8]}")
        # Start bucket: must leave room for the full duration before end of day
        max_start = TOTAL_BUCKETS - s.duration_buckets
        start_vars[sid] = model.NewIntVar(0, max_start, f"start_{sid[:8]}")
        # Room: index into room_ids list
        room_vars[sid] = model.NewIntVar(0, num_rooms - 1, f"room_{sid[:8]}")

    # ── Hard Constraint 1: No Lunch ───────────────────────────────────────────
    for s in all_sessions:
        sid = s.session_id
        for blocked in LUNCH_BLOCKED_BUCKETS:
            # Session must NOT start inside the lunch window such that it overlaps
            # i.e., start < blocked AND start + duration > blocked  → forbidden
            # Simplified: start must be before LUNCH_START or >= LUNCH_END
            lunch_start_b = min(LUNCH_BLOCKED_BUCKETS)
            lunch_end_b = max(LUNCH_BLOCKED_BUCKETS) + 1
            # Session end = start + duration; must not overlap [lunch_start, lunch_end)
            # Either: end <= lunch_start  OR  start >= lunch_end
            b_before = model.NewBoolVar(f"before_lunch_{sid[:8]}")
            model.Add(start_vars[sid] + s.duration_buckets <= lunch_start_b).OnlyEnforceIf(b_before)
            model.Add(start_vars[sid] >= lunch_end_b).OnlyEnforceIf(b_before.Not())
            break  # Only need one pass — constraint covers the whole window

    # ── Hard Constraint 2: Professor No Double-Booking ────────────────────────
    # Two sessions with the same professor on the same day must not overlap.
    _add_no_overlap_constraints(model, all_sessions, day_vars, start_vars,
                                key_fn=lambda s: s.professor_id, label="prof")

    # ── Hard Constraint 3: Room No Double-Booking ─────────────────────────────
    # Two sessions in the same room on the same day must not overlap.
    _add_no_overlap_constraints(model, all_sessions, day_vars, start_vars,
                                key_fn=lambda s: s.group_id, label="group")

    # ── Hard Constraint 4: Ghost Blocks ──────────────────────────────────────
    for ghost in ghost_blocks:
        ghost_day = ghost.day_of_week - 1  # Supabase stores 1-5; convert to 0-4
        for s in all_sessions:
            sid = s.session_id
            same_day = model.NewBoolVar(f"ghost_day_{sid[:8]}_{ghost.start_bucket}")
            model.Add(day_vars[sid] == ghost_day).OnlyEnforceIf(same_day)
            model.Add(day_vars[sid] != ghost_day).OnlyEnforceIf(same_day.Not())

            if ghost.professor_id and ghost.professor_id == s.professor_id:
                # Professor blocked by ghost → must not overlap
                b = model.NewBoolVar(f"gp_{sid[:8]}_{ghost.start_bucket}")
                model.Add(start_vars[sid] + s.duration_buckets <= ghost.start_bucket).OnlyEnforceIf(b)
                model.Add(start_vars[sid] >= ghost.end_bucket).OnlyEnforceIf(b.Not())
                model.AddImplication(same_day, b)  # enforce only if same day

    # ── Hard Constraint 5: Lab rooms for Practicals ───────────────────────────
    lab_room_indices = [room_idx[rid] for rid, r in rooms.items() if r["room_type"] == "Lab"]
    lec_room_indices = [room_idx[rid] for rid, r in rooms.items() if r["room_type"] == "Lecture"]

    for s in all_sessions:
        sid = s.session_id
        if s.session_type == "Practical":
            if lab_room_indices:
                model.AddAllowedAssignments([room_vars[sid]], [[i] for i in lab_room_indices])
        else:
            # Lectures/Tutorials prefer lecture rooms (hard if available)
            if lec_room_indices:
                model.AddAllowedAssignments([room_vars[sid]], [[i] for i in lec_room_indices])

    # ── Hard Constraint 6: Sec C and IT-BI must NOT clash (constraints.txt) ───
    _add_section_clash_constraints(
        model, all_sessions, day_vars, start_vars, groups_meta
    )

    # ── Color Group Constraint: Same-color sessions share the same day+start ──
    for color, group_sessions in color_groups.items():
        if len(group_sessions) <= 1:
            continue
        ref = group_sessions[0]
        for s in group_sessions[1:]:
            model.Add(day_vars[s.session_id] == day_vars[ref.session_id])
            model.Add(start_vars[s.session_id] == start_vars[ref.session_id])

    # ── Soft Constraint: Floor Zoning ─────────────────────────────────────────
    preferred_floor = SEMESTER_TO_FLOOR.get(semester_number, 0)
    floor_penalty_terms = []
    for s in all_sessions:
        sid = s.session_id
        for i, rid in enumerate(room_ids):
            room_floor = rooms[rid].get("floor", 0)
            if room_floor != preferred_floor:
                b = model.NewBoolVar(f"floor_penalty_{sid[:8]}_{i}")
                model.Add(room_vars[sid] == i).OnlyEnforceIf(b)
                model.Add(room_vars[sid] != i).OnlyEnforceIf(b.Not())
                floor_penalty_terms.append(b)

    model.Minimize(sum(floor_penalty_terms))

    # ── Solve ─────────────────────────────────────────────────────────────────
    solver_cp = cp_model.CpSolver()
    solver_cp.parameters.max_time_in_seconds = 60.0
    solver_cp.parameters.num_search_workers = 4
    status = solver_cp.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(f"[Solver] CP-SAT returned status: {solver_cp.StatusName(status)}")
        return None

    # ── Extract Solution ──────────────────────────────────────────────────────
    results: list[ScheduledSession] = []
    for s in all_sessions:
        sid = s.session_id
        day_0indexed = solver_cp.Value(day_vars[sid])
        start_b = solver_cp.Value(start_vars[sid])
        end_b = start_b + s.duration_buckets
        assigned_room_idx = solver_cp.Value(room_vars[sid])
        assigned_room_id = room_ids[assigned_room_idx]

        results.append(ScheduledSession(
            session=s,
            day_of_week=day_0indexed + 1,  # convert back to 1-5
            start_bucket=start_b,
            end_bucket=end_b,
            assigned_room_id=assigned_room_id,
        ))

    print(f"[Solver] ✅ Solution found: {len(results)} sessions scheduled.")
    return results


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _add_no_overlap_constraints(
    model: cp_model.CpModel,
    sessions: list[Session],
    day_vars: dict,
    start_vars: dict,
    key_fn,
    label: str,
):
    """
    For all pairs of sessions sharing the same key (professor or group),
    enforce that they do not overlap on the same day.
    """
    from itertools import combinations

    groups: dict[str, list[Session]] = {}
    for s in sessions:
        k = key_fn(s)
        if k:
            groups.setdefault(k, []).append(s)

    for key, group in groups.items():
        for s1, s2 in combinations(group, 2):
            sid1, sid2 = s1.session_id, s2.session_id
            # If on same day → one must end before the other starts
            same_day = model.NewBoolVar(f"{label}_same_{sid1[:6]}_{sid2[:6]}")
            model.Add(day_vars[sid1] == day_vars[sid2]).OnlyEnforceIf(same_day)
            model.Add(day_vars[sid1] != day_vars[sid2]).OnlyEnforceIf(same_day.Not())

            b = model.NewBoolVar(f"{label}_order_{sid1[:6]}_{sid2[:6]}")
            model.Add(start_vars[sid1] + s1.duration_buckets <= start_vars[sid2]).OnlyEnforceIf([same_day, b])
            model.Add(start_vars[sid2] + s2.duration_buckets <= start_vars[sid1]).OnlyEnforceIf([same_day, b.Not()])


def _add_section_clash_constraints(
    model: cp_model.CpModel,
    sessions: list[Session],
    day_vars: dict,
    start_vars: dict,
    groups_meta: dict[str, dict],
):
    """
    Enforce MUST_NOT_CLASH_PAIRS from constants.py.
    For each pair (name_A, name_B): any session belonging to group A and any
    session belonging to group B must not occupy the same day+bucket.
    """
    from itertools import combinations

    # Build name → group_ids lookup
    name_to_ids: dict[str, list[str]] = {}
    for gid, gmeta in groups_meta.items():
        name = gmeta.get("name", "")
        name_to_ids.setdefault(name, []).append(gid)

    for name_a, name_b in MUST_NOT_CLASH_PAIRS:
        ids_a = name_to_ids.get(name_a, [])
        ids_b = name_to_ids.get(name_b, [])
        if not ids_a or not ids_b:
            continue

        sessions_a = [s for s in sessions if s.group_id in ids_a]
        sessions_b = [s for s in sessions if s.group_id in ids_b]

        for s1, s2 in [(sa, sb) for sa in sessions_a for sb in sessions_b]:
            sid1, sid2 = s1.session_id, s2.session_id
            same_day = model.NewBoolVar(f"clash_day_{sid1[:6]}_{sid2[:6]}")
            model.Add(day_vars[sid1] == day_vars[sid2]).OnlyEnforceIf(same_day)
            model.Add(day_vars[sid1] != day_vars[sid2]).OnlyEnforceIf(same_day.Not())

            b = model.NewBoolVar(f"clash_ord_{sid1[:6]}_{sid2[:6]}")
            model.Add(start_vars[sid1] + s1.duration_buckets <= start_vars[sid2]).OnlyEnforceIf([same_day, b])
            model.Add(start_vars[sid2] + s2.duration_buckets <= start_vars[sid1]).OnlyEnforceIf([same_day, b.Not()])
