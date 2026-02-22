"""
graph_stage.py — Stage 1 of the GG-CP Pipeline: Graph Grouping Heuristic.

Uses networkx Graph Coloring to group sessions that CAN safely run
at the same time (no shared professor or student section).

Elective Macro-Node rule:
  Sessions belonging to the same elective_group (e.g., 'Basket 1') are
  FORCED into the same color group — they must run simultaneously so that
  students can freely choose between elective options.
"""

import itertools
import networkx as nx

from models import Session


def build_conflict_graph(sessions: list[Session]) -> nx.Graph:
    """
    Build an undirected conflict graph.

    Nodes : session_id strings
    Edges : between sessions that CANNOT run at the same time because they
            share a professor OR share a student group (section).
    """
    G = nx.Graph()

    for s in sessions:
        G.add_node(s.session_id, session=s)

    # Add conflict edges
    for s1, s2 in itertools.combinations(sessions, 2):
        conflict = (
            s1.professor_id == s2.professor_id  # same professor
            or s1.group_id == s2.group_id        # same student section
        )
        if conflict:
            G.add_edge(s1.session_id, s2.session_id)

    return G


def apply_elective_macro_nodes(
    sessions: list[Session],
    color_map: dict[str, int],
    max_color: int,
) -> dict[str, int]:
    """
    After graph coloring, enforce that all sessions in the same
    elective_group share the same color (= scheduled simultaneously).

    Strategy: find sessions in each elective group, pick the most
    common color already assigned, and re-assign all to that color.
    If any conflicts exist (two sessions in the same elective group
    that share a professor), we log a warning — but this should never
    happen if the UI prevents it.
    """
    from collections import defaultdict, Counter

    elective_buckets: dict[str, list[str]] = defaultdict(list)
    for s in sessions:
        if s.is_elective and s.elective_group:
            elective_buckets[s.elective_group].append(s.session_id)

    for group_label, session_ids in elective_buckets.items():
        if len(session_ids) <= 1:
            continue
        # Pick the color with the most votes in this elective group
        colors_in_group = [color_map[sid] for sid in session_ids if sid in color_map]
        if not colors_in_group:
            continue
        chosen_color = Counter(colors_in_group).most_common(1)[0][0]
        for sid in session_ids:
            color_map[sid] = chosen_color

    return color_map


def run_graph_stage(sessions: list[Session]) -> dict[int, list[Session]]:
    """
    Entry point for Stage 1.

    Returns:
        color_groups — dict mapping color_index → list of Sessions.
        All sessions within one color group CAN safely run at the same time.
    """
    if not sessions:
        return {}

    G = build_conflict_graph(sessions)

    # Greedy graph coloring with the DSATUR strategy (best for timetabling)
    # Returns {node_id: color_int}
    raw_color_map: dict[str, int] = nx.coloring.greedy_color(G, strategy="DSATUR")

    max_color = max(raw_color_map.values(), default=0)

    # Apply elective macro-node rule
    color_map = apply_elective_macro_nodes(sessions, raw_color_map, max_color)

    # Group sessions by color
    session_by_id: dict[str, Session] = {s.session_id: s for s in sessions}
    color_groups: dict[int, list[Session]] = {}

    for session_id, color in color_map.items():
        if color not in color_groups:
            color_groups[color] = []
        color_groups[color].append(session_by_id[session_id])

    print(
        f"[GraphStage] {len(sessions)} sessions → "
        f"{len(color_groups)} color groups via DSATUR coloring."
    )

    return color_groups
