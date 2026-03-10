// ─── Solver-specific type definitions ─────────────────────────────────────────
// These mirror the mathematical formulation from RM_problem_formulation.pdf

/**
 * A single class session that MUST be scheduled.
 * E.g., a 3L-1T-1P subject for one group produces 5 ClassSession objects.
 */
export interface ClassSession {
  /** Unique within this solver run (index in the sessions array) */
  id: number;
  subjectId: string;
  subjectCode: string;
  groupId: string;
  professorId: string;
  /** Duration in 1-hour slots (Lecture/Tutorial = 1, Practical = practical_duration / 60) */
  duration: number;
  /** 'Lecture' | 'Tutorial' | 'Practical' */
  slotType: 'Lecture' | 'Tutorial' | 'Practical';
  /** Original room assigned as home room (used as preference / for labs) */
  homeRoomIndex: number;
  /** True if this session belongs to an elective subject */
  isElective: boolean;
  /**
   * Elective slot index — groups sessions that must be non-clashing within a basket.
   * Lecture#0 of all subjects in the same basket share index 0, etc.
   * Only meaningful when isElective = true. -1 otherwise.
   */
  electiveSlotIndex: number;
  /**
   * The elective basket this session belongs to (e.g., 'basket-1', 'HSMC', 'lang').
   * Null for core subjects. Used by the basket constraint system.
   */
  basketName: string | null;
  /** True if this session is for the WMC (whole batch) group */
  isWMCGroup: boolean;
  /** True if this session is locked (from a published timetable) and must not be mutated */
  isLocked?: boolean;
  /**
   * 2+1 format marker for lecture sessions.
   *  0   = this is the one double-lecture (2-hour) block.
   * -1   = this is a single-lecture (1-hour) remainder slot.
   * -2   = not applicable (elective, tutorial, practical, or lectures < 2).
   */
  lecturePairIndex: number;
}

/**
 * A single gene — the decision for one ClassSession.
 * Maps to X_{c,d,t,r} in the formulation.
 */
export interface Gene {
  /** Day of week: 1–5 (Mon–Fri) */
  day: number;
  /** Start slot: 1–8 (1-hour slots) */
  startBucket: number;
  /** Index into the rooms array */
  roomIndex: number;
}

/**
 * A complete solution: one Gene per ClassSession, in the same index order.
 */
export type Solution = Gene[];

/**
 * Configuration for the solver.
 */
export interface SolverConfig {
  /** Maximum generations before stopping */
  maxGenerations: number;
  /** How often to report progress to the UI */
  reportInterval: number;
  /** Initial mutation step size (σ) */
  initialSigma: number;
  /** Weight for the student-gap soft penalty (W_gap) */
  gapWeight: number;
  /** Hard-constraint penalty multiplier */
  hardPenalty: number;
  /** How many generations to average for the 1/5th rule */
  adaptationWindow: number;
  /** Factor to increase σ when success rate > 1/5 */
  sigmaIncrease: number;
  /** Factor to decrease σ when success rate < 1/5 */
  sigmaDecrease: number;
}

/**
 * Evaluation result for a single solution.
 */
export interface FitnessResult {
  /** Total fitness (lower is better) */
  total: number;
  /** Number of hard constraint violations */
  hardViolations: number;
  /** Soft penalty (student gap cost) */
  gapPenalty: number;
  /** Breakdown of violations by constraint type (only on best results) */
  violationBreakdown?: {
    timeBoundary: number;
    breakCrossing: number;
    roomOverlap: number;
    professorOverlap: number;
    groupOverlap: number;
    electiveSync: number;
    labRoom: number;
    wmcSectionOverlap: number;
    homeRoom: number;
    /** 2+1 format: penalty when the double-lecture and single-lecture for the same subject+group land on the same day */
    twoOneLecture: number;
  };
}

/**
 * Progress report sent to the UI during solving.
 */
export interface SolverProgress {
  generation: number;
  maxGenerations: number;
  fitness: FitnessResult;
  sigma: number;
  successRate: number;
  elapsedMs: number;
  /** Whether a feasible solution (0 hard violations) has been found */
  feasible: boolean;
}

/**
 * Final output of the solver.
 */
export interface SolverResult {
  /** The best solution found */
  solution: Solution;
  /** Its fitness evaluation */
  fitness: FitnessResult;
  /** Generation at which the best solution was found */
  bestGeneration: number;
  /** Total generations run */
  totalGenerations: number;
  /** Total wall-clock time in ms */
  elapsedMs: number;
  /** Whether the run was cancelled */
  cancelled: boolean;
}

/**
 * Full input bundle the solver needs — prepared by dataPrep.ts.
 */
export interface SolverInput {
  sessions: ClassSession[];
  /** Room info: id and type, indexed by roomIndex */
  rooms: { id: string; name: string; roomType: string }[];
  /** Number of working days (always 5) */
  numDays: number;
  /** Number of 1-hour slots per day (always 8) */
  numBuckets: number;
  config: SolverConfig;
}
