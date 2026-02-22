"""
diagnose.py — Run in backend/ to find WHY the solver is INFEASIBLE.
Usage: python diagnose.py
"""
import sys
from dotenv import load_dotenv
load_dotenv()

from preprocessor import get_supabase, generate_chunked_sessions
from graph_stage import run_graph_stage
from models import GenerateRequest
from constants import TOTAL_BUCKETS, NUM_WORK_DAYS, LUNCH_START_BUCKET, LUNCH_END_BUCKET
from collections import defaultdict

sb = get_supabase()

print("Fetching clusters...")
clusters = sb.from_("semester_clusters").select("*").eq("is_active", True).execute().data
print(f"  Found {len(clusters)} active clusters")

if not clusters:
    print("ERROR: No active clusters. Exiting.")
    sys.exit(1)

cluster = clusters[0]
cluster_id = cluster["id"]
print(f"  Using: Batch {cluster['batch_year']} Sem {cluster['semester_number']} {cluster['department']}")

subjects_res = sb.from_("cluster_requirements").select(
    "subject:subject_id (id, code, lectures, tutorials, practicals, subject_type)"
).eq("cluster_id", cluster_id).execute()
subjects = [row["subject"] for row in subjects_res.data if row["subject"]]
print(f"  {len(subjects)} subjects")

groups_res = sb.from_("student_groups").select("id, name").eq("semester", cluster["semester_number"]).execute()
groups = groups_res.data or []
print(f"  {len(groups)} student groups")

profs_res = sb.from_("professors").select("id, name").execute()
profs = profs_res.data or []
print(f"  {len(profs)} professors")

rooms_res = sb.from_("rooms").select("id, name, room_type").execute()
rooms_data = rooms_res.data or []
lab_rooms   = [r for r in rooms_data if r["room_type"] == "Lab"]
lec_rooms   = [r for r in rooms_data if r["room_type"] != "Lab"]
print(f"  {len(rooms_data)} rooms  ({len(lab_rooms)} Lab  |  {len(lec_rooms)} Lecture)")

# Build fake round-robin assignments
assignments = {}
home_rooms = {}
for si, sub in enumerate(subjects):
    assignments[sub["id"]] = {}
    for gi, grp in enumerate(groups):
        assignments[sub["id"]][grp["id"]] = profs[(si + gi) % len(profs)]["id"]

non_all = [g for g in groups if g["name"] != "All"]
for gi, grp in enumerate(non_all):
    home_rooms[grp["id"]] = lec_rooms[gi % len(lec_rooms)]["id"] if lec_rooms else ""

request = GenerateRequest(cluster_id=cluster_id, home_rooms=home_rooms, assignments=assignments)

print("\n--- Generating sessions ---")
sessions, context, sem = generate_chunked_sessions(request)
print(f"  {len(sessions)} sessions total")

# ── Feasibility maths ──────────────────────────────────────────────────────
usable = (LUNCH_START_BUCKET + (TOTAL_BUCKETS - LUNCH_END_BUCKET)) * NUM_WORK_DAYS
print(f"\n--- Capacity check ---")
print(f"  Max buckets/week per entity: {usable}  ({usable * 10 // 60} hrs)")

prof_load: dict[str, int] = defaultdict(int)
group_load: dict[str, int] = defaultdict(int)
for s in sessions:
    prof_load[s.professor_id] += s.duration_buckets
    group_load[s.group_id]    += s.duration_buckets

bad_profs = [(pid, load) for pid, load in prof_load.items() if load > usable]
bad_groups = [(gid, load) for gid, load in group_load.items() if load > usable]

print(f"\n  Professor overload ({len(bad_profs)} overloaded out of {len(prof_load)}):")
for pid, load in sorted(bad_profs, key=lambda x: -x[1])[:10]:
    name = next((p["name"] for p in profs if p["id"] == pid), pid[:8])
    print(f"    OVERLOAD  {name}: {load * 10} min  > capacity {usable * 10} min")
if not bad_profs:
    print("    OK - all within capacity")

print(f"\n  Group overload ({len(bad_groups)} overloaded out of {len(group_load)}):")
for gid, load in sorted(bad_groups, key=lambda x: -x[1])[:10]:
    name = next((g["name"] for g in groups if g["id"] == gid), gid[:8])
    print(f"    OVERLOAD  {name}: {load * 10} min  > capacity {usable * 10} min")
if not bad_groups:
    print("    OK - all within capacity")

# ── Room type check ─────────────────────────────────────────────────────────
print("\n--- Room type check ---")
lab_sessions = [s for s in sessions if s.session_type == "Practical"]
lec_sessions = [s for s in sessions if s.session_type != "Practical"]
print(f"  Practical sessions: {len(lab_sessions)}  |  Lab rooms: {len(lab_rooms)}")
print(f"  Lec/Tut sessions : {len(lec_sessions)}  |  Lec rooms: {len(lec_rooms)}")
if len(lab_rooms) == 0 and lab_sessions:
    print("  CRITICAL: No Lab rooms but practical sessions exist!")
    print("  --> Mark rooms as room_type='Lab' in Supabase.")

# ── Color group sync check ──────────────────────────────────────────────────
print("\n--- Graph stage ---")
color_groups = run_graph_stage(sessions)
print(f"  {len(color_groups)} color groups from {len(sessions)} sessions")
mixed = [(c, set(s.duration_buckets for s in gs)) for c, gs in color_groups.items() if len(set(s.duration_buckets for s in gs)) > 1]
if mixed:
    print(f"  WARNING: {len(mixed)} color groups have mixed durations (sync constraint will conflict)")
    for c, durs in mixed[:5]:
        print(f"    Group {c}: durations {durs}")
else:
    print("  OK - no mixed durations in color groups")

print("\n--- Done ---")
