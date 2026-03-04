import type { ClassSession, Gene, Solution, FitnessResult, SolverInput } from './types';
import { SLOTS_PER_DAY, BREAK_AFTER_SLOTS } from './constants';

// ─── Hard Constraint Violation Counters ────────────────────────────────────────
// Each returns the number of violations found.

/**
 * Constraint: Time Frame Boundaries.
 * A session must not exceed slot 8 (end of day 18:30).
 */
function countTimeBoundaryViolations(sessions: ClassSession[], solution: Solution): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        const endSlot = solution[i].startBucket + sessions[i].duration - 1;
        if (endSlot > SLOTS_PER_DAY) violations++;
    }
    return violations;
}

/**
 * Constraint: Break & Lunch Boundary.
 * A multi-slot session must NOT span across a break boundary.
 * E.g., a 2-slot session starting at slot 2 would need slot 3,
 * but there's a 10-min break between them.
 * Similarly, slot 4→5 has a 90-min lunch break.
 */
function countBreakViolations(sessions: ClassSession[], solution: Solution): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        const start = solution[i].startBucket;
        const duration = sessions[i].duration;
        if (duration <= 1) continue; // single-slot sessions can't cross breaks

        // Check if the session spans across any break boundary
        for (let s = start; s < start + duration - 1; s++) {
            if (BREAK_AFTER_SLOTS.includes(s)) {
                violations++;
                break; // count at most 1 violation per session
            }
        }
    }
    return violations;
}

/**
 * Build an occupancy map: for each (entityKey, day, slot) → array of session indices.
 * Used for room, professor, and group overlap checks.
 */
function buildOccupancyMap(
    sessions: ClassSession[],
    solution: Solution,
    keyFn: (session: ClassSession, gene: Gene) => string,
): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        const gene = solution[i];
        const key = keyFn(sessions[i], gene);
        const start = gene.startBucket;
        const end = start + sessions[i].duration - 1;
        for (let s = start; s <= end; s++) {
            const slot = `${key}:${gene.day}:${s}`;
            const arr = map.get(slot);
            if (arr) arr.push(i);
            else map.set(slot, [i]);
        }
    }
    return map;
}

/**
 * Constraint: Room Non-Overlap.
 * A room can host at most one session at any given slot.
 */
function countRoomOverlaps(
    sessions: ClassSession[],
    solution: Solution,
    rooms: SolverInput['rooms'],
): number {
    const map = buildOccupancyMap(sessions, solution, (_s, g) => `R${rooms[g.roomIndex]?.id ?? g.roomIndex}`);
    let violations = 0;
    for (const arr of map.values()) {
        if (arr.length > 1) violations += arr.length - 1;
    }
    return violations;
}

/**
 * Constraint: Professor Non-Overlap.
 * A professor can teach at most one session at any given slot.
 */
function countProfessorOverlaps(sessions: ClassSession[], solution: Solution): number {
    const map = buildOccupancyMap(sessions, solution, (s) => `P${s.professorId}`);
    let violations = 0;
    for (const arr of map.values()) {
        if (arr.length > 1) violations += arr.length - 1;
    }
    return violations;
}

/**
 * Constraint: Student Group Non-Overlap.
 * A student group can attend at most one session at any given slot.
 *
 * EXCEPTION: Elective sessions sharing the same group+time are NOT violations,
 * because they are concurrent alternatives (students choose one).
 * However, an elective overlapping with a non-elective IS a violation.
 */
function countGroupOverlaps(sessions: ClassSession[], solution: Solution): number {
    const map = buildOccupancyMap(sessions, solution, (s) => `G${s.groupId}`);
    let violations = 0;
    for (const arr of map.values()) {
        if (arr.length <= 1) continue;

        // Count how many are elective vs non-elective
        let electiveCount = 0;
        let nonElectiveCount = 0;
        for (const idx of arr) {
            if (sessions[idx].isElective) electiveCount++;
            else nonElectiveCount++;
        }

        // Non-elective overlaps with anything = violation
        if (nonElectiveCount > 1) {
            violations += nonElectiveCount - 1;
        }
        // If any non-elective overlaps with electives, that's also a violation
        if (nonElectiveCount > 0 && electiveCount > 0) {
            violations += Math.min(nonElectiveCount, 1); // count the overlap once
        }
        // Elective-vs-elective: NOT a violation (they're concurrent options)
    }
    return violations;
}

// ─── Soft Constraint: Student Gap Penalty ──────────────────────────────────────

/**
 * For each student group on each day, count empty slots
 * between their first and last scheduled class.
 */
function computeGapPenalty(sessions: ClassSession[], solution: Solution, numDays: number): number {
    const groupDaySlots = new Map<string, Map<number, Set<number>>>();

    for (let i = 0; i < sessions.length; i++) {
        const gene = solution[i];
        const session = sessions[i];
        const groupId = session.groupId;
        if (!groupDaySlots.has(groupId)) groupDaySlots.set(groupId, new Map());
        const dayMap = groupDaySlots.get(groupId)!;
        if (!dayMap.has(gene.day)) dayMap.set(gene.day, new Set());
        const slotSet = dayMap.get(gene.day)!;
        const end = gene.startBucket + session.duration - 1;
        for (let s = gene.startBucket; s <= end; s++) {
            slotSet.add(s);
        }
    }

    let totalGaps = 0;
    for (const dayMap of groupDaySlots.values()) {
        for (let d = 1; d <= numDays; d++) {
            const slots = dayMap.get(d);
            if (!slots || slots.size === 0) continue;
            const sorted = Array.from(slots).sort((a, b) => a - b);
            const first = sorted[0];
            const last = sorted[sorted.length - 1];
            const span = last - first + 1;
            totalGaps += span - slots.size;
        }
    }
    return totalGaps;
}

// ─── Combined Fitness Evaluation ───────────────────────────────────────────────

/**
 * Constraint: Elective Synchronization.
 * All elective sessions with the same (slotType, electiveSlotIndex) must be
 * scheduled at the same (day, startBucket). This allows students to choose
 * one elective from a set of concurrent options.
 */
function countElectiveSyncViolations(sessions: ClassSession[], solution: Solution): number {
    // Group elective sessions by their sync key: "slotType-electiveSlotIndex"
    const groups = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        if (!sessions[i].isElective || sessions[i].electiveSlotIndex < 0) continue;
        const key = `${sessions[i].slotType}-${sessions[i].electiveSlotIndex}`;
        const arr = groups.get(key);
        if (arr) arr.push(i);
        else groups.set(key, [i]);
    }

    let violations = 0;
    for (const indices of groups.values()) {
        if (indices.length <= 1) continue;
        // All sessions in this group must have the same (day, startBucket)
        const refDay = solution[indices[0]].day;
        const refStart = solution[indices[0]].startBucket;
        for (let k = 1; k < indices.length; k++) {
            const gene = solution[indices[k]];
            if (gene.day !== refDay || gene.startBucket !== refStart) {
                violations++;
            }
        }
    }
    return violations;
}

/**
 * Constraint: Lab Room for Practicals.
 * Practical sessions must be assigned to rooms with roomType === 'Lab'.
 */
function countLabRoomViolations(
    sessions: ClassSession[],
    solution: Solution,
    rooms: SolverInput['rooms'],
): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].slotType !== 'Practical') continue;
        const room = rooms[solution[i].roomIndex];
        if (!room || room.roomType !== 'Lab') violations++;
    }
    return violations;
}

/**
 * Constraint: WMC-Section Non-Overlap.
 * A WMC (whole batch) session cannot occupy the same (day, slot) as any
 * section-level session, because WMC means ALL students are in that class.
 */
function countWMCSectionOverlaps(sessions: ClassSession[], solution: Solution): number {
    // Build occupancy: (day, slot) → { wmcCount, sectionCount }
    const slotMap = new Map<string, { wmc: number; section: number }>();
    for (let i = 0; i < sessions.length; i++) {
        const gene = solution[i];
        const end = gene.startBucket + sessions[i].duration - 1;
        for (let s = gene.startBucket; s <= end; s++) {
            const key = `${gene.day}:${s}`;
            let entry = slotMap.get(key);
            if (!entry) {
                entry = { wmc: 0, section: 0 };
                slotMap.set(key, entry);
            }
            if (sessions[i].isWMCGroup) entry.wmc++;
            else entry.section++;
        }
    }

    let violations = 0;
    for (const { wmc, section } of slotMap.values()) {
        if (wmc > 0 && section > 0) {
            violations += section; // each section session colliding with WMC is a violation
        }
    }
    return violations;
}

/**
 * Constraint: Home Room for Lectures/Tutorials.
 * Non-practical sessions must be in their assigned home room.
 * Practicals are exempt (they use Lab rooms).
 * Electives are exempt (they need different rooms for concurrent sessions).
 */
function countHomeRoomViolations(sessions: ClassSession[], solution: Solution): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].slotType === 'Practical') continue;
        if (sessions[i].isElective) continue; // Electives need separate rooms
        if (solution[i].roomIndex !== sessions[i].homeRoomIndex) violations++;
    }
    return violations;
}

/**
 * Evaluate a complete solution against all constraints.
 * fitness.total = hardViolations * hardPenalty + gapPenalty * gapWeight
 */
export function evaluate(input: SolverInput, solution: Solution): FitnessResult {
    const { sessions, rooms, numDays, config } = input;

    const timeBoundary = countTimeBoundaryViolations(sessions, solution);
    const breakCrossing = countBreakViolations(sessions, solution);
    const roomOverlap = countRoomOverlaps(sessions, solution, rooms);
    const professorOverlap = countProfessorOverlaps(sessions, solution);
    const groupOverlap = countGroupOverlaps(sessions, solution);
    const electiveSync = countElectiveSyncViolations(sessions, solution);
    const labRoom = countLabRoomViolations(sessions, solution, rooms);
    const wmcSectionOverlap = countWMCSectionOverlaps(sessions, solution);
    const homeRoom = countHomeRoomViolations(sessions, solution);

    const hardViolations = timeBoundary + breakCrossing + roomOverlap +
        professorOverlap + groupOverlap + electiveSync + labRoom +
        wmcSectionOverlap + homeRoom;

    const gapPenalty = computeGapPenalty(sessions, solution, numDays);

    const total = hardViolations * config.hardPenalty + gapPenalty * config.gapWeight;

    return {
        total,
        hardViolations,
        gapPenalty,
        violationBreakdown: {
            timeBoundary,
            breakCrossing,
            roomOverlap,
            professorOverlap,
            groupOverlap,
            electiveSync,
            labRoom,
            wmcSectionOverlap,
            homeRoom,
        },
    };
}
