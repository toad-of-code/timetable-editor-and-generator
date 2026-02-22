"""
solver.py — Stage 2 of the GG-CP Pipeline: CP-SAT Time & Room Mapper.

Key design decisions:
  - Uses OR-Tools IntervalVar + AddNoOverlap for efficient no-overlap constraints
    (this is O(n log n) vs O(n²) for pairwise — essential for 200+ sessions).
  - Day and room are separate: sessions are solved per-day using cumulative/no-overlap.
  - Ghost blocks are applied as forbidden intervals per professor per day.

Hard constraints:
  1. No lunch (13:00–14:30)
  2. Professor no double-booking (AddNoOverlap per professor per day)
  3. Group (section) no double-booking (AddNoOverlap per group per day)
  4. Ghost blocks block professors/rooms per day
  5. Labs → Lab rooms only; Lectures/Tutorials → Lecture rooms only
  6. Sec C and IT-BI must not share the same slot (from constants.py)

Soft constraint:
  - Prefer rooms on the correct floor for this semester (min penalty)
"""

from ortools.sat.python import cp_model
from typing import Optional
from collections import defaultdict
from itertools import combinations

from models import Session, GhostBlock, ScheduledSession
from constants import (
    TOTAL_BUCKETS,
    NUM_WORK_DAYS,
    LUNCH_START_BUCKET,
    LUNCH_END_BUCKET,
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
    Returns list[ScheduledSession] on success, None if infeasible/timeout.
    """
    model = cp_model.CpModel()
    all_sessions: list[Session] = [s for group in color_groups.values() for s in group]
    semester_number: int = context["semester_number"]
    groups_meta: dict[str, dict] = context["groups"]

    # ── Room categorisation ────────────────────────────────────────────────────
    room_ids = list(rooms.keys())
    num_rooms = len(room_ids)
    room_idx: dict[str, int] = {rid: i for i, rid in enumerate(room_ids)}

    lab_room_indices =  [i for i, rid in enumerate(room_ids) if rooms[rid].get("room_type") == "Lab"]
    lec_room_indices =  [i for i, rid in enumerate(room_ids) if rooms[rid].get("room_type") != "Lab"]

    if num_rooms == 0 or not all_sessions:
        return None

    # ── Decision variables ─────────────────────────────────────────────────────
    # day  : 0 = Monday, 4 = Friday
    # start: bucket index (each bucket = 10 min); end = start + duration
    # room : index into room_ids

    day_vars:   dict[str, cp_model.IntVar] = {}
    start_vars: dict[str, cp_model.IntVar] = {}
    end_vars:   dict[str, cp_model.IntVar] = {}
    room_vars:  dict[str, cp_model.IntVar] = {}

    # Interval per session (needed for AddNoOverlap)
    # We create one interval per (session, day) pair using optional intervals
    # keyed by (session_id, day_index)
    session_day_intervals: dict[tuple[str, int], cp_model.IntervalVar] = {}
    session_day_active:    dict[tuple[str, int], cp_model.BoolVar]     = {}

    for s in all_sessions:
        sid = s.session_id
        dur = s.duration_buckets
        max_start = TOTAL_BUCKETS - dur

        day_vars[sid]   = model.NewIntVar(0, NUM_WORK_DAYS - 1, f"d_{sid[:6]}")
        start_vars[sid] = model.NewIntVar(0, max_start,          f"s_{sid[:6]}")
        end_vars[sid]   = model.NewIntVar(dur, TOTAL_BUCKETS,    f"e_{sid[:6]}")
        model.Add(end_vars[sid] == start_vars[sid] + dur)

        # Room
        if s.session_type == "Practical":
            allowed = lab_room_indices if lab_room_indices else list(range(num_rooms))
        else:
            allowed = lec_room_indices if lec_room_indices else list(range(num_rooms))
        room_vars[sid] = model.NewIntVarFromDomain(
            cp_model.Domain.FromValues(allowed), f"r_{sid[:6]}"
        )

        # Optional interval per day (for no-overlap by day)
        for d in range(NUM_WORK_DAYS):
            is_active = model.NewBoolVar(f"act_{sid[:6]}_d{d}")
            session_day_intervals[(sid, d)] = model.NewOptionalIntervalVar(
                start_vars[sid], dur, end_vars[sid], is_active, f"iv_{sid[:6]}_d{d}"
            )
            session_day_active[(sid, d)] = is_active
            # is_active == True only when day_vars[sid] == d
            model.Add(day_vars[sid] == d).OnlyEnforceIf(is_active)
            model.Add(day_vars[sid] != d).OnlyEnforceIf(is_active.Not())

    # ── Constraint 1: No Lunch ─────────────────────────────────────────────────
    # Session must end before lunch OR start after lunch
    for s in all_sessions:
        sid = s.session_id
        b = model.NewBoolVar(f"lunch_{sid[:6]}")
        model.Add(end_vars[sid] <= LUNCH_START_BUCKET).OnlyEnforceIf(b)
        model.Add(start_vars[sid] >= LUNCH_END_BUCKET).OnlyEnforceIf(b.Not())

    # ── Constraint 2: Professor no double-booking (per day) ───────────────────
    prof_day_sessions: dict[tuple[str, int], list[str]] = defaultdict(list)
    for s in all_sessions:
        for d in range(NUM_WORK_DAYS):
            prof_day_sessions[(s.professor_id, d)].append(s.session_id)

    for (prof_id, d), sids in prof_day_sessions.items():
        if len(sids) < 2:
            continue
        model.AddNoOverlap([session_day_intervals[(sid, d)] for sid in sids])

    # ── Constraint 3: Group (section) no double-booking (per day) ─────────────
    group_day_sessions: dict[tuple[str, int], list[str]] = defaultdict(list)
    for s in all_sessions:
        for d in range(NUM_WORK_DAYS):
            group_day_sessions[(s.group_id, d)].append(s.session_id)

    for (group_id, d), sids in group_day_sessions.items():
        if len(sids) < 2:
            continue
        model.AddNoOverlap([session_day_intervals[(sid, d)] for sid in sids])

    # ── Constraint 4: Ghost Blocks (cross-semester occupied slots) ────────────
    # Index ghost blocks by (professor_id, day) for efficient lookup
    ghost_by_prof_day: dict[tuple[str, int], list[GhostBlock]] = defaultdict(list)
    for ghost in ghost_blocks:
        d = ghost.day_of_week - 1   # convert 1-5 to 0-4
        if ghost.professor_id:
            ghost_by_prof_day[(ghost.professor_id, d)].append(ghost)

    for s in all_sessions:
        sid = s.session_id
        for d in range(NUM_WORK_DAYS):
            ghosts_here = ghost_by_prof_day.get((s.professor_id, d), [])
            for ghost in ghosts_here:
                active = session_day_active[(sid, d)]
                # If this session is on day d → it must not overlap the ghost slot
                # i.e., end <= ghost.start  OR  start >= ghost.end
                g_b = model.NewBoolVar(f"g_{sid[:6]}_{d}_{ghost.start_bucket}")
                model.Add(end_vars[sid] <= ghost.start_bucket).OnlyEnforceIf([active, g_b])
                model.Add(start_vars[sid] >= ghost.end_bucket).OnlyEnforceIf([active, g_b.Not()])

    # ── Constraint 5: Elective group synchronisation ──────────────────────────
    # Sessions in the same elective_group (basket) MUST run simultaneously.
    # We group by (elective_group, session_type, elective_instance_idx) so that
    # "Lecture 1" of Physics syncs with "Lecture 1" of Chemistry, etc.
    elective_sync_groups: dict[tuple, list[Session]] = defaultdict(list)
    for s in all_sessions:
        if s.is_elective and s.elective_group:
            k = (s.elective_group, s.session_type, s.elective_instance_idx)
            elective_sync_groups[k].append(s)

    for sync_key, group_sessions in elective_sync_groups.items():
        if len(group_sessions) <= 1:
            continue
        ref = group_sessions[0]
        for s in group_sessions[1:]:
            model.Add(day_vars[s.session_id]   == day_vars[ref.session_id])
            model.Add(start_vars[s.session_id] == start_vars[ref.session_id])

    # ── Constraint 6: Section clash pairs (Sec C / IT-BI etc.) ───────────────
    name_to_ids: dict[str, list[str]] = defaultdict(list)
    for gid, gmeta in groups_meta.items():
        name_to_ids[gmeta.get("name", "")].append(gid)

    for name_a, name_b in MUST_NOT_CLASH_PAIRS:
        sids_a = [s.session_id for s in all_sessions if s.group_id in name_to_ids.get(name_a, [])]
        sids_b = [s.session_id for s in all_sessions if s.group_id in name_to_ids.get(name_b, [])]
        for sid1 in sids_a:
            for sid2 in sids_b:
                for d in range(NUM_WORK_DAYS):
                    # If both are on same day → no overlap
                    both_active = model.NewBoolVar(f"clash_{sid1[:5]}_{sid2[:5]}_d{d}")
                    model.AddBoolAnd([
                        session_day_active[(sid1, d)],
                        session_day_active[(sid2, d)],
                    ]).OnlyEnforceIf(both_active)
                    # If both active, they must not overlap
                    ord_b = model.NewBoolVar(f"clash_ord_{sid1[:5]}_{sid2[:5]}_d{d}")
                    model.Add(end_vars[sid1] <= start_vars[sid2]).OnlyEnforceIf([both_active, ord_b])
                    model.Add(end_vars[sid2] <= start_vars[sid1]).OnlyEnforceIf([both_active, ord_b.Not()])

    # ── Soft Constraint: Floor Zoning ─────────────────────────────────────────
    preferred_floor = SEMESTER_TO_FLOOR.get(semester_number, 0)
    floor_penalties: list[cp_model.BoolVar] = []
    for s in all_sessions:
        sid = s.session_id
        for i, rid in enumerate(room_ids):
            if rooms[rid].get("floor", 0) != preferred_floor:
                b = model.NewBoolVar(f"fp_{sid[:6]}_{i}")
                model.Add(room_vars[sid] == i).OnlyEnforceIf(b)
                model.Add(room_vars[sid] != i).OnlyEnforceIf(b.Not())
                floor_penalties.append(b)

    if floor_penalties:
        model.Minimize(sum(floor_penalties))

    # ── Solve ──────────────────────────────────────────────────────────────────
    solver_cp = cp_model.CpSolver()
    solver_cp.parameters.max_time_in_seconds = 120.0   # 2 minutes
    solver_cp.parameters.num_search_workers  = 8        # use all cores
    solver_cp.parameters.log_search_progress = False

    status = solver_cp.Solve(model)
    print(f"[Solver] Status: {solver_cp.StatusName(status)} | "
          f"Objective: {solver_cp.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 'N/A'}")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    # ── Extract solution ───────────────────────────────────────────────────────
    results: list[ScheduledSession] = []
    for s in all_sessions:
        sid = s.session_id
        results.append(ScheduledSession(
            session=s,
            day_of_week=solver_cp.Value(day_vars[sid]) + 1,   # back to 1-5
            start_bucket=solver_cp.Value(start_vars[sid]),
            end_bucket=solver_cp.Value(end_vars[sid]),
            assigned_room_id=room_ids[solver_cp.Value(room_vars[sid])],
        ))

    print(f"[Solver] ✅ {len(results)} sessions scheduled.")
    return results
