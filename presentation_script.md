# Presentation Script: Automated University Timetabling System


## Slide 1: Overview
* **Report Title:** Automated University Timetabling System
* **Context:** This report outlines the development and implementation of an automated university timetabling system.
* **Problem Type:** University timetabling is a resource-constrained optimization problem.
* **Constraints handled:** It allocates subjects, professors, and student batches to a limited number of rooms and time slots.
* **Complexity Classification:** The problem is classified as NP-Hard.
* **Reasoning for Complexity:** This is due to the exponential growth of potential configurations as the number of constraints increases.

---

## Slide 2: Problem Statement
* **Core Problem:** University timetabling is a complex matching problem classified as NP-Hard.
* This means finding a perfect solution is too slow for large schedules, so we use heuristic algorithms instead.
* **Mathematical Objective:** Minimize cost function $F(x)$ where $H(x) = 0$ (Hard Constraints) and $S(x) \geq \min$ (Soft Constraints).
* Hard constraints are strict rules that must never be broken.
* Soft constraints improve schedule quality but are not strictly required.

---

## Slide 3: Motivations
* **Primary Goal:** Build a conflict-free, automated timetable generator that produces high-quality schedules.
* **Reduce Manual Effort:** Eliminate the labor-intensive process of manually checking for professor and room overlaps.
* **Save Administrative Time:** Drastically reduce the weeks of time wasted by academic departments in preparing and revising timetables.
* **Human-in-the-Loop:** Provide a seamless web interface for administrators to make final manual adjustments directly on the generated grid.

---

## Slide 4: Formulation of Hard Constraints
* The solver evaluates fitness through a scalarized penalty function:
* $P(S) = \sum (W_{hard} \times C_{hard}) + \sum (W_{soft} \times C_{soft})$
* **Hard Constraints ($W_{hard} = 1000$):**
  * **Time boundaries:** Sessions cannot cross end-of-day or break boundaries.
  * **Room Overlaps:** A physical room can host at most one session.
  * **Professor Overlaps:** A professor can teach at most one session at a time.
  * **Student Overlaps:** A group attends at most one session (except synced baskets).
  * **Elective Sync:** Synced baskets must run concurrently.

---

## Slide 5: Formulation of Complex & Soft Constraints
* Additional Hard Constraints ($W_{hard} = 1000$) handled by the algorithm:
  * **WMC vs Section:** Whole-Batch classes strictly cannot overlap with section classes.
  * **$2+1$ Lecture Spread:** Multi-period subjects must spread across different days.
  * **Home Room \& Labs:** Non-practical core sessions use assigned home rooms.
* **Soft Constraints ($W_{soft} = 1.0$):**
  * Minimizing empty slots between classes for students and faculty.
* Treating Soft Constraints at 1.0 ensures they only optimize when hard clashes hit zero.

---

## Slide 6: Review of Literature
* **Genetic Algorithm (GA):** Represents timetables as chromosomes and evolves them using crossover and mutation operators to minimize constraint violations.
* **GA Advantages:** Explores a large search space and is capable of improving solutions over generations.
* **GA Limitations:** Crossover often breaks important schedule structures, requiring complex repair mechanisms to fix invalid schedules.
* **High Cost:** It has high computational cost due to large population evaluations.
* **Multi-Objective Simulated Annealing (MOSA):** Uses simulated annealing to optimize multiple objectives simultaneously such as timetable quality and robustness.
* **MOSA Advantages:** Can escape local optima, handles multiple objectives, and allows evaluation of timetable robustness.
* **MOSA Limitations:** Robustness evaluation requires expensive repair simulations, causing slow convergence for large datasets.
* **Evolution Strategy (1+1-ES):** Maintains a single timetable solution and iteratively improves it using mutation-based modifications.
* **ES Advantages:** Avoids destructive crossover and has a lower computational cost because it evaluates only one candidate per iteration.
* **Improved ES with Preprocessing:** Combines ES with preprocessing techniques and structured mutation strategies to improve convergence speed.
* **Improved ES Result:** Produces high-quality schedules with fewer conflicts, alongside better exploration of the search space.

---

## Slide 7: Limitations of Current Timetable Generation Approaches
* **Traditional Method:** Manual spreadsheet-based planning is the traditional method used by academic departments to prepare college timetables.
* **Key Limitations:**
  * **Human-Dependent:** Requires manual cross-verification of faculty and room availability.
  * **Difficult Tracking:** Difficult to enforce multiple constraints simultaneously (labs, electives, lecture distribution).
  * **Hidden Conflicts:** High probability of hidden conflicts in faculty, class, or room allocation.
  * **Restricted Optimization:** Limited ability to optimize schedules and reduce idle gaps.
  * **Slow Re-evaluation:** Timetable updates require manual re-evaluation of many schedules.
  * **Poor Scalability:** Process breaks down as the number of courses, faculty, and rooms increases.
* **Core Gap:** Manual scheduling $\neq$ Conflict-free, optimized timetable generation.

---

## Slide 8: Inability of GA and MOSA
* **Genetic Algorithm (GA) Flaws:**
  * **Requires Many Valid States:** GA requires a large initial population of valid timetables to function. For highly dense, constrained environments like IIITA, randomly generating even many completely valid initial timetable is nearly impossible.
  * **Destructive Crossover:** Crossover operations inherently break highly inter-dependent structures like synced elective baskets and lab sessions.
* **Multi-Objective Simulated Annealing (MOSA) Flaws:**
  * **The "Empty Slot" Trap:** In dense timetables ($> 85\%$ utilization), simple neighborhood moves fail because empty slots do not exist.
  * **Constraint Destruction:** Random perturbations dismantle hard-won synchronized blocks, and balancing objectives with coin tosses prevents learning.
  * **Cooling Schedule Mismatch:** Massive penalty weights for hard clashes freeze the algorithm in local optima due to misaligned cooling temperatures.

---

## Slide 9: The Shift to (1+1)-Evolution Strategies
* **The Pivot:** To overcome these limitations, we engineered a practical pivot to a (1+1)-Evolution Strategy.
* **Data Simplification:** This shift allowed us to drastically simplify our target representation by pre-chunking sessions upfront.
* **Memory Footprint:** Unlike population-based GAs, $(1+1)$-ES holds only one parent and one offspring, making it memory-light for browser execution.
* **1/5th Success Rule:** We implemented strict Rechenberg's 1/5th rule to manage the local minima problem natively.
* **Adaptive Variance:** It scales search intensity without relying on brittle cooling schedules, allowing the solver to maintain constraint integrity through strict elitism.

---


---

## Slide 10: System Design & Session Chunking
* **System Design (Three-Tier Architecture):**
* **Database (Supabase):** Stores Professors, Rooms, Groups, and Subject L-T-P counts.
* **Frontend (React/TypeScript):** An interface for HODs to map professors to subjects and sections.
* **Solver (Client-Side):** An asynchronous engine running the optimization loop in the background of the browser.
* **Data Pre-processing (Session Chunking):**
* The system processes raw lecture hours ($L$) into chunks to reduce variable complexity:
* **$L = 3$**: One 2-hour contiguous block and one 1-hour block.
* **$L = 2$**: One 2-hour contiguous block.
* **Practicals ($P$):** One 2-hour contiguous block assigned to a Lab room domain.

---

## Slide 11: The (1+1)-ES Algorithm (Part 1)
* The engine follows an iterative loop to minimize a total penalty score $P(S)$.
* **Step 1: Initialization.** Initializes using a seed timetable ($S_{parent}$) and calculates its penalty.
* **Step 2: Mutation ($\sigma$).** A Child is created by selecting mutable sessions and applying five distinct operators governed by the variance $\sigma$:
* **Mutators Used:**
  * **Mutate Day:** Shifts the session to a random new day.
  * **Mutate Time:** Applies Gaussian noise scaled by $\sigma$.
  * **Mutate Room:** Reassigns strictly respecting Lab vs. Lecture limits.
  * **Relocate (Global Jump):** Moves session to a totally new, random valid configuration.
  * **Swap:** Trades places between two non-elective sessions of equal duration.
* **Sync Preservation:** Any time-mutation applied to an elective forces the entire synced basket to move with it.

---

## Slide 12: The (1+1)-ES Algorithm (Part 2)
* **Step 3: Selection.** The Child replaces the Parent only if $P(S_{child}) \leq P(S_{parent})$. This elitism protects hard constraints.
* **Step 4: 1/5th Success Rule.** Checked every 50 iterations:
* If $> 20\%$ success: $\sigma = \sigma \times 1.22$ (Search wider).
* If $< 20\%$ success: $\sigma = \sigma \times 0.82$ (Search finer).
* **Step 5: Stagnation Recovery.** Checks for failure over $15,000$ consecutive generations (a deep local optimum).
* It triggers a hard reset by generating a completely new initial timetable (preserving user-pinned UI classes). 
* The tracking variance ($\sigma$) is reset, but the global best timetable found so far is kept safe in memory against regression.

---

## Slide 13: Final Implementation Status
* **Final Result:** The implementation successfully manages the L-T-P chunking and the $(1+1)$-ES loop.
* **Overcoming Obstacles:** The system resolves hard conflicts in high-density scenarios where previous implementations failed.
* **Preserving Structure:** It specifically maintains the integrity of synchronized elective blocks through elitist selection.
* **Ready Structure:** The architecture serves as a functional, optimized solution for modern university timetabling needs.

---

## Slide 14: Future Work
* **Human-in-the-Loop:** Implementing and Improving the React-based Editor functionality.
* **Quality Optimization:** Addition of more complex Soft Constraints into the solver engine.
* The current system reliably satisfies Hard Constraints, so future work will focus heavily on Soft Constraints (like minimizing professor campus-time) to improve the human quality-of-life of the timetables.
