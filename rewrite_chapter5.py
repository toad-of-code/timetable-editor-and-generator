import re

original_file = r"c:\Users\RAHUL ROY\OneDrive\Desktop\Time_Table_Project\timetable-editor-and-generator\original_chapter5_utf8.tex"
with open(original_file, "r", encoding="utf-8") as f:
    content = f.read()

def extract_block(label, env_type="figure"):
    label_match = re.search(r"\\label\{" + label + r"\}", content)
    if not label_match: return f"% ERROR: Missing {label}"
    pos = label_match.start()
    begin_str = r"\begin{" + env_type + "}"
    begin_pos = content.rfind(begin_str, 0, pos)
    end_str = r"\end{" + env_type + "}"
    end_pos = content.find(end_str, pos)
    if begin_pos != -1 and end_pos != -1:
        return content[begin_pos:end_pos + len(end_str)]
    return f"% ERROR: Boundaries missing for {label}"

tab_clash_types = extract_block("tab:clash_types", "table")
fig_free_room_flow = extract_block("fig:free_room_flow", "figure")
fig_component_tree = extract_block("fig:component_tree", "figure")
tab_view_mapping = extract_block("tab:view_mapping", "table")
tab_hard_constraints = extract_block("tab:hard_constraints", "table")
fig_solver_activity = extract_block("fig:solver_activity", "figure")
fig_lns_activity = extract_block("fig:lns_activity", "figure")
fig_generator_sequence = extract_block("fig:generator_sequence", "figure")

# Extract the non-solver original sections
arch_sections_pattern = r"(%-----------------------------------\n\\section\{Dynamic Time Grid Generation\}.*?)\\section\{The \(1\+1\)-ES Timetable Solver\}"
arch_match = re.search(arch_sections_pattern, content, re.DOTALL)
arch_content = arch_match.group(1) if arch_match else ""

# The old editor/generator sections
old_editor_generator_pattern = r"(%-----------------------------------\n\\section\{The Interactive Timetable Editor\}.*?)\\end\{figure\}\n"
old_eg_match = re.search(old_editor_generator_pattern, content, re.DOTALL)
old_eg_content = old_eg_match.group(1) + "\\end{figure}\n" if old_eg_match else ""

new_content = f"""% Chapter 5

\\chapter{{Implementation and Results}} % Main chapter title

\\label{{Chapter5}}

%----------------------------------------------------------------------------------------

\\section{{Introduction to the Optimization Engine}}

The transition from data ingestion to the core solver introduces a highly constrained NP-hard optimization problem. The IIITA Timetabling System models this challenge mathematically, solving it via client-side heuristics. Rather than relying on traditional deterministic approaches which fail to scale, the system employs an evolutionary search mechanism. The engine processes high-dimensional inputs---comprising student cohorts, faculty assignments, and spatial capacities---and systematically navigates a vast, discontinuous search space to identify a globally optimal, conflict-free schedule.

{fig_generator_sequence}

\\section{{Mathematical Representation of the Schedule}}

To facilitate computational optimization, the schedule is encoded into a specific data structure known as a \\textit{{Chromosome}}. The solver models a complete timetable $S$ as an ordered array of \\textit{{genes}}. Each gene $g_i \\in S$ encodes the precise scheduling decision for the $i$-th class session, mapping it to a spatial and temporal coordinate. 

Formally, a gene is defined as a tuple:
\\begin{{equation}}
    g_i = (d_i, t_i, r_i)
\\end{{equation}}
where:
\\begin{{itemize}}
    \\item $d_i \\in \\{{1, 2, 3, 4, 5\\}}$ represents the day of the week (Monday through Friday).
    \\item $t_i \\in \\{{1, 2, \\dots, 8\\}}$ represents the discrete start time slot (each slot corresponding to one hour, from 08:50 to 18:30).
    \\item $r_i \\in \\mathcal{{R}}$ is the index into the array of available physical rooms.
\\end{{itemize}}

Each gene is invariably linked to an immutable \\texttt{{ClassSession}} object that contains the session's metadata: the specific subject identifier, the student group $G_i$, the assigned professor $p_i$, the duration $D_i$, and the specific slot type (Lecture, Tutorial, or Practical).

\\section{{Mathematical Formulation of Constraints}}

The optimization objective is governed by a composite fitness function that evaluates both the feasibility and the quality of the candidate solution $S$.

\\subsection{{Hard Constraints (The Feasibility Space)}}

Hard constraints define the boundary of feasible solutions. A schedule is strictly invalid if any hard constraint is violated. For two distinct sessions $i$ and $j$, we define the temporal overlap condition as:
\\begin{{equation}}
    \\text{{overlap}}(t_i, t_j) = \\begin{{cases}} 
      1 & \\text{{if }} \\max(t_i, t_j) \\le \\min(t_i + D_i - 1, t_j + D_j - 1) \\\\
      0 & \\text{{otherwise}}
   \\end{{cases}}
\\end{{equation}}

The engine enforces the following critical hard penalties:
\\begin{{itemize}}
    \\item \\textbf{{Professor Overlap Penalty:}} A professor $p$ cannot be physically present in two different locations at time $t$. 
    \\begin{{equation}}
        \\sum_{{i \\neq j}} \\mathbb{{I}}(p_i = p_j \\land d_i = d_j \\land \\text{{overlap}}(t_i, t_j)) = 0
    \\end{{equation}}

    \\item \\textbf{{Student Group Overlap Penalty:}} A specific student cohort $G$ cannot attend two distinct subjects simultaneously. (Concurrent sessions from the same synchronized elective basket are mathematically exempted).
    \\begin{{equation}}
        \\sum_{{i \\neq j}} \\mathbb{{I}}(G_i = G_j \\land d_i = d_j \\land \\text{{overlap}}(t_i, t_j) \\land \\neg \\text{{SameBasket}}(i, j)) = 0
    \\end{{equation}}

    \\item \\textbf{{Room Clash Penalty:}} A physical room $r$ can host at most one session at any given time.
    \\begin{{equation}}
        \\sum_{{i \\neq j}} \\mathbb{{I}}(r_i = r_j \\land d_i = d_j \\land \\text{{overlap}}(t_i, t_j)) = 0
    \\end{{equation}}

    \\item \\textbf{{Lunch Boundary Enforcement:}} Sessions cannot cross the designated lunch break ($B_{{lunch}}$ from 13:00 to 14:30, bounded between slot 4 and 5). 
    \\begin{{equation}}
        \\forall i \\in S, \\quad [t_i, t_i + D_i - 1] \\cap B_{{lunch}} = \\emptyset
    \\end{{equation}}

    \\item \\textbf{{L-T-P ``Chunking'' (The 2+1 Rule):}} For core courses with $L \\ge 2$ credits, the algorithm mathematically forces the contact hours into a contiguous 2-hour block and subsequent 1-hour blocks, distributed across distinct days. Let $\\mathcal{{L}}_c$ be the set of lecture sessions for subject $c$:
    \\begin{{equation}}
        \\exists! k \\in \\mathcal{{L}}_c : D_k = 2 \\quad \\text{{and}} \\quad \\forall j \\in \\mathcal{{L}}_c \\setminus \\{{k\\}}, D_j = 1
    \\end{{equation}}
    \\begin{{equation}}
        \\forall i, j \\in \\mathcal{{L}}_c, \\ i \\neq j \\implies d_i \\neq d_j
    \\end{{equation}}
\\end{{itemize}}

{tab_hard_constraints}

\\subsection{{Soft Constraints (The Quality Space)}}

Once the solution space is feasible, the engine optimizes for schedule quality by minimizing soft penalties.

\\begin{{itemize}}
    \\item \\textbf{{Minimizing Student Gaps:}} The engine minimizes idle slots between a cohort's first and last class on any given day. Let $\\mathcal{{T}}_{{g,d}}$ be the set of all active time slots for student group $g$ on day $d$. The gap penalty $G(S)$ is:
    \\begin{{equation}}
        G(S) = \\sum_{{g}} \\sum_{{d}} \\left( (\\max(\\mathcal{{T}}_{{g,d}}) - \\min(\\mathcal{{T}}_{{g,d}}) + 1) - |\\mathcal{{T}}_{{g,d}}| \\right)
    \\end{{equation}}

    \\item \\textbf{{Room Capacity Optimization:}} The system matches class enrollment $c_i$ to room capacity $K_{{r_i}}$. Let the utilization ratio be $u_i = c_i / K_{{r_i}}$. Given optimal thresholds $\\alpha = 0.6$ and $\\beta = 1.2$, the room utilization penalty $R(S)$ is formulated as:
    \\begin{{equation}}
        R(S) = \\sum_{{i}} \\left( \\max(0, \\alpha - u_i) + \\max(0, u_i - \\beta) \\right)
    \\end{{equation}}
\\end{{itemize}}

\\section{{The (1+1) Evolution Strategy Solver}}

The optimization engine is powered by a (1+1) Evolution Strategy (ES) algorithm. It relies on iterative stochastic perturbations and adaptive mutation rates to navigate the constrained schedule space.

\\subsection{{Strict Elitism}}

The algorithm employs a strictly elitist selection mechanism. In each generation, a parent solution $S_{{parent}}$ undergoes mutation to produce a single offspring $S_{{child}}$. The offspring replaces the parent if and only if its total fitness score is less than or equal to the parent's score:
\\begin{{equation}}
    S_{{parent}}^{{(t+1)}} = \\begin{{cases}} 
      S_{{child}} & \\text{{if }} f(S_{{child}}) \\le f(S_{{parent}}^{{(t)}}) \\\\
      S_{{parent}}^{{(t)}} & \\text{{otherwise}}
   \\end{{cases}}
\\end{{equation}}
This greediness guarantees that the solver never loses ground on hard constraint feasibility.

\\subsection{{Mutation Operators}}

To generate $S_{{child}}$, the engine selects a subset of mutable sessions and applies highly stochastic operators:
\\begin{{itemize}}
    \\item \\textbf{{Gaussian Time Shifts:}} The start time $t_i$ is perturbed using Gaussian noise scaled by variance $\\sigma$:
    \\begin{{equation}}
        t_i^{{(new)}} = t_i + \\lfloor \\mathcal{{N}}(0, \\sigma^2) \\rceil
    \\end{{equation}}
    \\item \\textbf{{Type-Aware Room Reassignments:}} A session is moved to a randomly selected room $r_k \\in \\mathcal{{R}}$ that strictly matches its required architectural type (e.g., Lab vs. Lecture Hall).
    \\item \\textbf{{Targeted Swaps:}} Two sessions $i$ and $j$ of identical duration exchange their spatial-temporal coordinates, effectively jumping out of local minima without increasing the overall density.
\\end{{itemize}}

\\subsection{{Adaptive Variance (The Brain)}}

To dynamically balance global exploration and local exploitation, the solver implements Rechenberg's 1/5th Success Rule. The mutation strength $\\sigma$ is adapted every $W = 50$ generations based on the success rate $p_s$ (the ratio of offspring that successfully improved or matched fitness).
\\begin{{equation}}
    \\sigma \\leftarrow
    \\begin{{cases}}
        \\sigma \\times 1.22 & \\text{{if }} p_s > 0.20 \\quad \\text{{(Search wider)}} \\\\
        \\sigma \\times 0.82 & \\text{{if }} p_s < 0.20 \\quad \\text{{(Search finer)}} \\\\
        \\sigma & \\text{{otherwise}}
    \\end{{cases}}
\\end{{equation}}

\\subsection{{Stagnation Recovery}}

In highly dense optimization landscapes, the algorithm may converge to a deep local optimum (a plateau). The engine mathematically tracks this stagnation. If $S_{{parent}}$ fails to improve for 15,000 consecutive generations, a stagnation recovery protocol is triggered. The current candidate is discarded, and maximum entropy is injected by generating a completely new randomized initial timetable.

{fig_solver_activity}

\\section{{Interactive Editor \\& Large Neighbourhood Search (LNS)}}

The user interface functions primarily as an engineering tool designed for granular control over the algorithmic output. When manual drag-and-drop actions introduce systemic conflicts, an integrated Large Neighbourhood Search (LNS) is deployed to repair the grid.

The ``Auto-Fix'' feature applies a destroy-and-repair heuristic. Instead of recalculating the entire grid, it isolates the localized clashing subset $C \\subseteq S$. The LNS algorithm iterates up to 1,500 times, randomly selecting a session $i \\in C$, applying stochastic mutations (relocation, time shifts, or swaps), and evaluating the local differential fitness. If a localized mutation resolves the clash without violating surrounding sessions, the repair is committed.

{fig_lns_activity}

\\section{{Results and Application Features}}

The implementation of the optimization engine drastically reduces the administrative overhead. By executing entirely client-side, the system achieves feasibility rapidly, circumventing backend server latencies.

\\subsection{{Algorithmic Convergence}}

The solver demonstrates rapid convergence. The heavily weighted hard penalties force the evolution strategy to prioritize feasibility before aggressively optimizing the soft quality metrics.

`[Insert Image: Fitness Score vs. Generations Graph]`

\\subsection{{The Interactive Drag-and-Drop Grid}}

The primary workspace visualizes the temporal matrix. It calculates multi-dimensional clashes in real-time, surfacing spatial and temporal overlaps through distinct programmatic warnings.

`[Insert Image: Main UI Grid showing Clashes]`

\\subsection{{LNS Auto-Fix Execution}}

When administrators execute the LNS repair routine, the interface explicitly highlights the target neighbourhood and dynamically resolves overlapping nodes without destabilizing the optimized framework.

`[Insert Image: UI highlighting Auto-Fix suggestions]`

\\subsection{{Export and PDF Generation}}

The final scheduling matrix is programmatically serialized into a high-fidelity PDF, leveraging DOM capture logic to bypass CSS layout constraints, ensuring the complete multidimensional array is rendered cleanly.

`[Insert Image: Final PDF Timetable Output]`

{arch_content}

{old_eg_content}
"""

with open(r"c:\Users\RAHUL ROY\OneDrive\Desktop\Time_Table_Project\timetable-editor-and-generator\Campus_Timetable_Report\Chapters\5_implementation.tex", "w", encoding="utf-8") as f:
    f.write(new_content)

print("Chapter 5 merged successfully!")
