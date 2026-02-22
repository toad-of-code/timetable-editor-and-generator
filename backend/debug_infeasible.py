"""
debug_infeasible.py — Incrementally adds constraints to find the EXACT one that breaks the CP-SAT model.
"""
import sys
from ortools.sat.python import cp_model
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

from preprocessor import get_supabase, generate_chunked_sessions
from models import GenerateRequest
from constants import TOTAL_BUCKETS, NUM_WORK_DAYS, LUNCH_START_BUCKET, LUNCH_END_BUCKET, MUST_NOT_CLASH_PAIRS

sb = get_supabase()

# --- Load Data ---
clusters = sb.from_("semester_clusters").select("*").eq("is_active", True).execute().data
cluster = clusters[0]
cluster_id = cluster["id"]

subjects_res = sb.from_("cluster_requirements").select("subject:subject_id (id, code, name, lectures, tutorials, practicals, subject_type, elective_group)").eq("cluster_id", cluster_id).execute()
subjects = [row["subject"] for row in subjects_res.data if row["subject"]]

groups_res = sb.from_("student_groups").select("id, name").eq("semester", cluster["semester_number"]).execute()
groups = groups_res.data or []

profs_res = sb.from_("professors").select("id, name").execute()
profs = profs_res.data or []

rooms_res = sb.from_("rooms").select("id, name, room_type").execute()
rooms_data = {r["id"]: r for r in rooms_res.data or []}

assignments = {}
home_rooms = {}
for si, sub in enumerate(subjects):
    assignments[sub["id"]] = {}
    for gi, grp in enumerate(groups):
        assignments[sub["id"]][grp["id"]] = profs[(si + gi) % len(profs)]["id"]

for gi, grp in enumerate([g for g in groups if g["name"] != "All"]):
    home_rooms[grp["id"]] = [r for r in rooms_data.values() if r["room_type"] != "Lab"][gi % 10]["id"]

req = GenerateRequest(cluster_id=cluster_id, home_rooms=home_rooms, assignments=assignments)
sessions, context, _ = generate_chunked_sessions(req)

print(f"Loaded {len(sessions)} sessions.")

# --- Iterative Solver ---
def test_constraints(active_constraints: list[str]) -> str:
    model = cp_model.CpModel()
    
    day_vars, start_vars, end_vars, room_vars = {}, {}, {}, {}
    session_day_intervals, session_day_active = {}, {}
    
    room_ids = list(rooms_data.keys())
    lab_room_indices =  [i for i, rid in enumerate(room_ids) if rooms_data[rid].get("room_type") == "Lab"]
    lec_room_indices =  [i for i, rid in enumerate(room_ids) if rooms_data[rid].get("room_type") != "Lab"]
    
    for s in sessions:
        sid = s.session_id
        dur = s.duration_buckets
        max_start = TOTAL_BUCKETS - dur
        
        day_vars[sid] = model.NewIntVar(0, NUM_WORK_DAYS - 1, f"d_{sid[:6]}")
        start_vars[sid] = model.NewIntVar(0, max_start, f"s_{sid[:6]}")
        end_vars[sid] = model.NewIntVar(dur, TOTAL_BUCKETS, f"e_{sid[:6]}")
        model.Add(end_vars[sid] == start_vars[sid] + dur)
        
        allowed = lab_room_indices if s.session_type == "Practical" else lec_room_indices
        if not allowed:
            allowed = list(range(len(room_ids)))  # fallback if no rooms of type
            
        room_vars[sid] = model.NewIntVarFromDomain(cp_model.Domain.FromValues(allowed), f"r_{sid[:6]}")
        
        for d in range(NUM_WORK_DAYS):
            is_active = model.NewBoolVar(f"act_{sid[:6]}_d{d}")
            session_day_intervals[(sid, d)] = model.NewOptionalIntervalVar(start_vars[sid], dur, end_vars[sid], is_active, f"iv_{sid}_{d}")
            session_day_active[(sid, d)] = is_active
            model.Add(day_vars[sid] == d).OnlyEnforceIf(is_active)
            model.Add(day_vars[sid] != d).OnlyEnforceIf(is_active.Not())

    if "lunch" in active_constraints:
        for s in sessions:
            b = model.NewBoolVar(f"lunch_{s.session_id[:6]}")
            model.Add(end_vars[s.session_id] <= LUNCH_START_BUCKET).OnlyEnforceIf(b)
            model.Add(start_vars[s.session_id] >= LUNCH_END_BUCKET).OnlyEnforceIf(b.Not())

    if "prof_overlap" in active_constraints:
        prof_day_sessions = defaultdict(list)
        for s in sessions:
            for d in range(NUM_WORK_DAYS):
                prof_day_sessions[(s.professor_id, d)].append(s.session_id)
        for (pid, d), sids in prof_day_sessions.items():
            if len(sids) > 1:
                model.AddNoOverlap([session_day_intervals[(sid, d)] for sid in sids])

    if "group_overlap" in active_constraints:
        group_day_sessions = defaultdict(list)
        for s in sessions:
            for d in range(NUM_WORK_DAYS):
                group_day_sessions[(s.group_id, d)].append(s.session_id)
        for (gid, d), sids in group_day_sessions.items():
            if len(sids) > 1:
                model.AddNoOverlap([session_day_intervals[(sid, d)] for sid in sids])

    if "room_overlap" in active_constraints:
        # We need 2D intervals for room overlap! (This might be the bug in solver.py)
        # In solver.py we DID NOT constrain room overlap! Wait...
        pass
        
    if "elective_sync" in active_constraints:
        elective_sync_groups = defaultdict(list)
        for s in sessions:
            if s.is_elective and s.elective_group:
                k = (s.elective_group, s.session_type, s.elective_instance_idx)
                elective_sync_groups[k].append(s)
        for k, group_sessions in elective_sync_groups.items():
            if len(group_sessions) > 1:
                ref = group_sessions[0]
                for s in group_sessions[1:]:
                    model.Add(day_vars[s.session_id] == day_vars[ref.session_id])
                    model.Add(start_vars[s.session_id] == start_vars[ref.session_id])

    if "section_clash" in active_constraints:
        name_to_ids = defaultdict(list)
        for gid, gmeta in context["groups"].items():
            name_to_ids[gmeta.get("name", "")].append(gid)
        for name_a, name_b in MUST_NOT_CLASH_PAIRS:
            sids_a = [s.session_id for s in sessions if s.group_id in name_to_ids.get(name_a, [])]
            sids_b = [s.session_id for s in sessions if s.group_id in name_to_ids.get(name_b, [])]
            for sid1 in sids_a:
                for sid2 in sids_b:
                    for d in range(NUM_WORK_DAYS):
                        both_active = model.NewBoolVar(f"cl_{sid1}_{sid2}_d{d}")
                        model.AddBoolAnd([session_day_active[(sid1, d)], session_day_active[(sid2, d)]]).OnlyEnforceIf(both_active)
                        ord_b = model.NewBoolVar(f"clo_{sid1}_{sid2}_d{d}")
                        model.Add(end_vars[sid1] <= start_vars[sid2]).OnlyEnforceIf([both_active, ord_b])
                        model.Add(end_vars[sid2] <= start_vars[sid1]).OnlyEnforceIf([both_active, ord_b.Not()])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)
    return solver.StatusName(status)

constraints_to_test = [
    "lunch",
    "prof_overlap",
    "group_overlap",
    "elective_sync",
    "section_clash"
]

print("\n--- Iterative Debugging ---")
active = []
for c in constraints_to_test:
    active.append(c)
    print(f"Testing with: {active} ...", end=" ", flush=True)
    res = test_constraints(active)
    print(res)
    if res == "INFEASIBLE":
        print(f"\n[x] BREAKING CONSTRAINT FOUND: {c}")
        sys.exit(0)

print("\nAll constraints feasible individually! The issue is interaction.")
