# Timetable Generator & Editor Architecture

This document explains the complete working of your project from the database layer all the way up to the evolutionary solver and the interactive user interface. 

---

## 1. High-Level System Architecture

At its core, the project is a modern, client-heavy React web application. It offloads all data persistence to Supabase while running the computationally heavy timetable generation directly in the browser using TypeScript.

```mermaid
flowchart TD
    subgraph Client Application [React Application Vite]
        UI[User Interface Components]
        Hook[React Hooks Data Layer]
        
        subgraph Core Solver Engine
            Prep[Data Preparation L-T-P Expansion]
            ES[Evolutionary Strategy ES Loop]
            Const[Constraint Evaluator]
            LNS[Local Search Auto-Fix]
        end
    end

    subgraph Backend Services [Supabase]
        DB[(PostgreSQL Database)]
        Auth[Supabase Auth]
    end

    UI <-->|Configures & Triggers| Prep
    Prep -->|Initializes| ES
    ES <-->|Checks Fitness| Const
    ES -->|Returns Best Solution| UI
    
    UI <-->|Drags & Drops| LNS
    
    Hook <-->|CRUD Operations| DB
    UI -->|Reads/Writes| Hook
```

---

## 2. The Core Data Model

The system's data is heavily relational. A "Semester Cluster" is the root entity that groups together everything needed to generate a timetable for a specific batch.

```mermaid
erDiagram
    SEMESTER_CLUSTER ||--o{ CLUSTER_REQUIREMENTS : defines
    SEMESTER_CLUSTER ||--o{ STUDENT_GROUPS : contains
    SEMESTER_CLUSTER ||--o{ TIMETABLES : generates

    CLUSTER_REQUIREMENTS }|--|| SUBJECTS : links_to
    
    SUBJECTS ||--o{ PROFESSOR_EXPERTISE : taught_by
    PROFESSORS ||--o{ PROFESSOR_EXPERTISE : has

    TIMETABLES ||--o{ TIMETABLE_SLOTS : contains
    
    TIMETABLE_SLOTS }o--|| ROOMS : held_in
    TIMETABLE_SLOTS }o--|| SUBJECTS : teaches
    TIMETABLE_SLOTS }o--|| STUDENT_GROUPS : attended_by
    TIMETABLE_SLOTS }o--|| PROFESSORS : taught_by
```

- **Semester Cluster**: E.g., "IT Dept, Sem 5, 2026 Batch".
- **Cluster Requirements**: The bridge table detailing which subjects are taught in this cluster, including estimated enrollments and elective baskets.
- **Subjects**: Contains the vital `L-T-P` (Lectures-Tutorials-Practicals) split and duration metadata.

---

## 3. The Generator Flow (How Timetables are Born)

When you click **"Generate Timetable"**, a complex pipeline converts database rows into an optimized schedule.

```mermaid
sequenceDiagram
    participant UI as GeneratorView.tsx
    participant DP as dataPrep.ts
    participant Mut as mutations.ts
    participant Sol as solver.ts
    participant Con as constraints.ts

    UI->>DP: Send Subjects, Groups, Rooms, Prof Assignments
    
    rect rgb(240, 248, 255)
        note right of DP: Phase 1: Expansion
        DP->>DP: Expand L-T-P into separate 1-hour ClassSession objects
        DP->>DP: Apply 2+1 format for core lectures
        DP->>DP: Inject Locked Sessions from published timetables
    end
    
    DP-->>UI: Return SolverInput (Array of Sessions)
    
    UI->>Sol: runSolver(SolverInput)
    
    rect rgb(240, 255, 240)
        note right of Sol: Phase 2: (1+1) Evolutionary Strategy
        Sol->>Mut: generateInitialSolution() (Smart Random Placement)
        
        loop For N Generations
            Sol->>Mut: mutate(currentSolution)
            Mut-->>Sol: offspringSolution
            
            Sol->>Con: evaluate(offspringSolution)
            Con-->>Sol: offspringFitness (Hard/Soft scores)
            
            alt offspringFitness < currentFitness
                Sol->>Sol: Accept offspring
            else
                Sol->>Sol: Reject offspring
            end
            
            Sol->>Sol: Adjust Mutation Rate (1/5th Success Rule)
        end
    end
    
    Sol-->>UI: Return Best SolverResult
    UI->>UI: Map Genes to Timetable Slots
    UI->>DB: Save to Database
```

### Expanding L-T-P
The magic starts in `dataPrep.ts`. If a subject has 3 Lectures, 1 Tutorial, and 1 Practical (2 hours), the system expands this single subject into **5 distinct `ClassSession` objects** that the algorithm must place on the grid independently.

---

## 4. Constraint Evaluation Logic

The solver's intelligence lives entirely in how it scores a timetable. A perfect timetable has **0 Hard Violations**.

```mermaid
graph LR
    A[Proposed Solution] --> B{Evaluate Constraints}
    
    B --> C[Hard Constraints Penalty: 1000]
    B --> D[Soft Constraints Penalty: Variable]
    
    C --> C1[Room/Prof/Group Overlaps]
    C --> C2[Elective Basket Sync]
    C --> C3[Break Boundaries]
    C --> C4[Home Room / Lab Mismatches]
    C --> C5[WMC vs Section Overlaps]
    C --> C6[2+1 Lecture Same-Day Clash]
    
    D --> D1[Student Gaps Time between classes]
    D --> D2[Room Under/Over Utilization]
    
    C1 & C2 & C3 & C4 & C5 & C6 & D1 & D2 --> F((Total Fitness Score))
```
*The solver blindly moves classes around, but it is heavily penalized by `constraints.ts` anytime it breaks a rule, forcing the evolution toward a 0-conflict state.*

---

## 5. The Editor Flow (Manual Adjustments & Auto-Fix)

Once a timetable is saved, you enter the Editor. The editor allows manual drag-and-drop, but it also has its own localized solver for quick fixes.

```mermaid
stateDiagram-v2
    [*] --> ViewingTimetable
    
    ViewingTimetable --> DragAndDrop: User moves class
    ViewingTimetable --> InlineEdit: User changes Prof/Room
    
    DragAndDrop --> DirtyState
    InlineEdit --> DirtyState
    
    DirtyState --> CheckFeasibility: User clicks 'Check'
    CheckFeasibility --> Feasible: 0 Conflicts
    CheckFeasibility --> Conflicts: > 0 Conflicts
    
    Conflicts --> AutoFix: User clicks 'Auto-Fix'
    
    state AutoFix {
        direction LR
        LNS[Local Search LNS] --> Find[Find Clashing Classes]
        Find --> Mutate[Mutate ONLY clashing classes]
        Mutate --> LNS
    }
    
    AutoFix --> Feasible: Solved
    AutoFix --> Conflicts: Partial Fix
    
    Feasible --> Publishing: User clicks 'Publish'
    Publishing --> [*]
```

### The Auto-Fix Magic (LNS)
When you use "Auto-Fix", the system runs a **Large Neighborhood Search (LNS)**. Unlike the main generator which mutates *any* class randomly, the LNS in `localSearch.ts` specifically targets **only** the classes causing conflicts, leaving your perfectly placed classes completely untouched.
