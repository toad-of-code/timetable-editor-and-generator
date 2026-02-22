"""
main.py — FastAPI application entry point for the GG-CP Timetable Solver.

Single endpoint:
    POST /api/generate
        Receives the GeneratorView UI payload, runs the full GG-CP pipeline,
        persists the result, and returns the scheduled slots + timetable_id.

Run with:
    uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import GenerateRequest, GenerateResponse
from preprocessor import generate_chunked_sessions, fetch_ghost_blocks
from graph_stage import run_graph_stage
from solver import run_cp_sat_solver
from persistence import persist_solution

app = FastAPI(
    title="GG-CP Timetable Solver",
    description="Graph-Guided Constraint Programming hybrid pipeline for college timetable generation.",
    version="1.0.0",
)

# Allow requests from the Vite dev server (and any production origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok", "solver": "GG-CP v1"}


@app.post("/api/generate", response_model=GenerateResponse)
async def generate_timetable(request: GenerateRequest):
    """
    Full GG-CP pipeline:
        Phase 1 → Ingestion & session chunking (preprocessor.py)
        Stage 1 → Graph Coloring heuristic (graph_stage.py)
        Stage 2 → CP-SAT time & room mapping (solver.py)
        Phase 3 → Persist to Supabase (persistence.py)
    """
    try:
        # ── Phase 1: Ingestion & Pre-processing ──────────────────────────────
        print("[main] Phase 1: Ingestion & pre-processing...")
        sessions, context, semester_number = generate_chunked_sessions(request)

        if not sessions:
            return GenerateResponse(
                status="error",
                message="No sessions could be generated. Check cluster assignments.",
            )

        print(f"[main] {len(sessions)} sessions created.")

        # Fetch ghost blocks (occupied slots from other semesters)
        ghost_blocks = fetch_ghost_blocks(request.cluster_id)
        print(f"[main] {len(ghost_blocks)} ghost blocks loaded.")

        rooms: dict = context["rooms"]
        cluster: dict = context["cluster"]

        # ── Stage 1: Graph Grouping ───────────────────────────────────────────
        print("[main] Stage 1: Graph coloring...")
        color_groups = run_graph_stage(sessions)

        if not color_groups:
            return GenerateResponse(
                status="error",
                message="Graph coloring produced no groups. This is unexpected.",
            )

        # ── Stage 2: CP-SAT Solver ────────────────────────────────────────────
        print("[main] Stage 2: CP-SAT solving...")
        scheduled_sessions = run_cp_sat_solver(color_groups, ghost_blocks, rooms, context)

        if scheduled_sessions is None:
            return GenerateResponse(
                status="infeasible",
                message=(
                    "The solver could not find a valid timetable within the given constraints. "
                    "Try removing some fixed room assignments or check ghost block conflicts."
                ),
            )

        # ── Phase 3: Persist ──────────────────────────────────────────────────
        print("[main] Phase 3: Persisting to Supabase...")
        timetable_id, slot_results = persist_solution(scheduled_sessions, request, cluster)

        return GenerateResponse(
            status="success",
            message=f"Timetable generated successfully with {len(slot_results)} slots.",
            timetable_id=timetable_id,
            slots_generated=len(slot_results),
            slots=slot_results,
        )

    except Exception as exc:
        print(f"[main] ❌ Unhandled error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
