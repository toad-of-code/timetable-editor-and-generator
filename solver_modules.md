# Solver Codebase Breakdown

The timetable generation engine is contained entirely within the `src/solver` directory. It is completely decoupled from the React UI components, acting as an independent module that takes in requirements and spits out optimized schedules.

Here is a breakdown of what every file in that directory does:

---

### `types.ts`
**The Blueprint**
Defines the TypeScript interfaces that all other solver files use. The most critical types here are:
- `ClassSession`: Represents a *requirement* (e.g., "We need to schedule a 2-hour lecture for Data Structures").
- `Gene`: Represents a *decision* (e.g., "That Data Structures lecture is happening on Tuesday at 11:00 AM in Room 402").
- `Solution`: An array of `Gene`s representing a full timetable.

---

### `constants.ts`
**The Rulebook**
Contains system-wide constants, configuration defaults, and timing definitions.
- Defines exactly when slots start and end (`SLOT_START_TIMES`, `SLOT_END_TIMES`).
- Determines when the lunch break occurs and defines "Break Boundaries" so 2-hour classes don't awkwardly span across lunch.
- Holds the `SolverConfig` defaults like mutation rates and penalty weights.

---

### `dataPrep.ts`
**The Interpreter**
The React UI passes in raw database rows (Subjects, Groups). `dataPrep.ts` translates this raw data into a format the solver understands: an array of `ClassSession` objects.
- **L-T-P Expansion**: If a subject requires 3 lectures and 1 tutorial, this file creates 4 distinct `ClassSession` objects.
- **2+1 Logic**: Groups lectures into double-blocks (2 hours) and single-blocks (1 hour) as required.
- **Locking**: Pulls in existing published timetables and creates `isLocked = true` sessions so the solver avoids those slots.

---

### `solver.ts`
**The Engine Room**
This is the main entry point for generating a new timetable. It houses the **(1+1) Evolutionary Strategy** loop.
- It starts by asking `mutations.ts` for a random initial guess.
- It enters a loop for `N` generations. In each loop, it creates a mutated "offspring" timetable.
- It asks `constraints.ts` to score both the parent and the offspring.
- It keeps whichever timetable has a better score (lower penalty) and throws away the other.

---

### `mutations.ts`
**The Shaker**
Responsible for introducing randomness and variation into the timetable, which drives the evolutionary algorithm.
- `generateInitialSolution`: Blindly throws every class into a random day, time, and room just to get started.
- `mutate`: Takes an existing timetable and tweaks it slightly (moves a class to a new day, or changes its room). It avoids touching `isLocked` sessions.
- It intelligently handles "Synced Baskets" (like Electives) by ensuring that when one elective moves, all other electives in that basket move with it.

---

### `constraints.ts`
**The Judge**
Calculates the "Fitness" score of a timetable. A perfect timetable has a score of 0. Every rule broken adds points.
- **Hard Constraints**: Unbreakable rules. (e.g., Two classes in the same room at the same time, or a professor teaching two things at once). Each violation adds massive penalty points (e.g., +1000).
- **Soft Constraints**: Preferences. (e.g., Trying to put a 20-student class in a 60-seat room, or having huge gaps between classes). These add minor penalty points.

---

### `localSearch.ts`
**The Surgeon**
While `solver.ts` uses blind evolution to build a timetable from scratch, `localSearch.ts` uses Large Neighborhood Search (LNS) to perform surgical fixes.
- This is what powers the **"Auto-Fix"** button in the Editor.
- Instead of mutating random classes, it runs `findClashingIndices` to identify *only* the specific classes causing a problem.
- It then temporarily deletes those specific classes and aggressively tries to insert them into empty gaps without breaking anything else.

---

### `solverLog.ts`
**The Reporter**
When a timetable fails to reach 0 Hard Violations, the algorithm spits out raw numbers. `solverLog.ts` turns those raw numbers into a readable diagnostic file.
- It looks at the final timetable, figures out exactly *why* a penalty fired (e.g., "Professor Smith is double-booked on Monday at 09:50"), and generates a text file that the user can download to manually fix the issue in the Editor.
