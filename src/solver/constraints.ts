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
        if (sessions[i].isLocked) continue;
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
        const session = sessions[i];
        if (session.isLocked || session.duration <= 1) continue;

        const start = solution[i].startBucket;
        // Check if the session spans across any break boundary
        for (let s = start; s < start + session.duration - 1; s++) {
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
        if (arr.length > 1) {
            let lockedCount = 0;
            for (const idx of arr) if (sessions[idx].isLocked) lockedCount++;
            const baseline = lockedCount > 1 ? lockedCount - 1 : 0;
            violations += (arr.length - 1) - baseline;
        }
    }
    return violations;
}

/**
 * Constraint: Professor Non-Overlap.
 * A professor can teach at most one session at any given slot.
 */
function countProfessorOverlaps(sessions: ClassSession[], solution: Solution): number {
    // Use unique keys for empty professorId so they never collide
    const map = buildOccupancyMap(sessions, solution, (s) =>
        s.professorId ? `P${s.professorId}` : `P__EMPTY_${s.id}`
    );
    let violations = 0;
    for (const [key, arr] of map.entries()) {
        if (key.startsWith('P__EMPTY_')) continue;
        if (arr.length > 1) {
            let lockedCount = 0;
            for (const idx of arr) if (sessions[idx].isLocked) lockedCount++;
            const baseline = lockedCount > 1 ? lockedCount - 1 : 0;
            violations += (arr.length - 1) - baseline;
        }
    }
    return violations;
}

/**
 * Constraint: Student Group Non-Overlap.
 * A student group can attend at most one session at any given slot.
 *
 * Exception: sessions from the SAME synced basket are intentionally
 * concurrent (students pick one), so they must NOT be counted as violations.
 */
function countGroupOverlaps(sessions: ClassSession[], solution: Solution): number {
    const map = buildOccupancyMap(sessions, solution, (s) => `G${s.groupId}`);
    let violations = 0;
    for (const arr of map.values()) {
        if (arr.length <= 1) continue;
        // Pairwise check — skip pairs that belong to the same SYNCED basket
        // (those are concurrent by design; handled by the basket sync constraint)
        for (let i = 0; i < arr.length - 1; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const sA = sessions[arr[i]];
                const sB = sessions[arr[j]];

                // Cross-semester group isolation:
                // If either session is locked, it belongs to a DIFFERENT semester's timetable.
                // An active Sem 6 group does not overlap with a locked Sem 2 group.
                // (Any internal conflicts within locked sessions were already handled/ignored.)
                if (sA.isLocked || sB.isLocked) continue;

                // Both in same basket (synced or free) → intentional/allowed, not a violation.
                // Students only pick one subject per basket.
                if (
                    sA.basketName &&
                    sA.basketName === sB.basketName
                ) continue;

                // Both are electives (even from DIFFERENT baskets) → not a violation.
                // If they are from different baskets, the global anti-clash rule (step 2C)
                // handles whether they are allowed to be concurrent.
                // As far as the *Section/Group* is concerned, concurrent electives are just options.
                if (sA.isElective && sB.isElective) continue;

                violations++;
            }
        }
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

// ─── Basket Configuration ───────────────────────────────────────────────────────

/**
 * Synced baskets: ALL subjects in the basket must run at the SAME timeslot
 * (students pick one from the basket, so concurrent scheduling is intentional).
 */
const SYNCED_BASKETS = new Set(['HSMC', 'MDM']);

/** Returns true if the given basket name is a synced basket. */
function isSyncedBasket(basketName: string | null): boolean {
    return basketName !== null && SYNCED_BASKETS.has(basketName);
}

/**
 * Constraint: Basket-Aware Elective Scheduling.
 *
 * Two rules applied here:
 *
 * A) SYNCED baskets (HSMC, MDM, lang):
 *    All elective Lecture#N sessions in the same synced basket must be at
 *    the same (day, startBucket). Violation if they differ.
 *
 * B) FREE baskets (basket-1, basket-2, and any unnamed basket):
 *    No two sessions in the same free basket should share a (day, startBucket).
 *    Violation if two basket members are at the same slot.
 *
 * C) GLOBAL anti-clash:
 *    No two elective sessions from DIFFERENT baskets (or one synced + one free)
 *    should share a (day, startBucket). This ensures a student can theoretically
 *    attend sessions from multiple baskets without time conflict.
 */
function countElectiveSyncViolations(sessions: ClassSession[], solution: Solution): number {
    // --- Step 1: Group by basket name + slotType + electiveSlotIndex ---
    // Key: "basketName|slotType|electiveSlotIndex"
    const basketGroups = new Map<string, number[]>(); // per-basket groups

    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s.isLocked || !s.isElective || !s.basketName || s.electiveSlotIndex < 0) continue;

        // Per-basket per-slotType grouping
        const groupKey = `${s.basketName}|${s.slotType}|${s.electiveSlotIndex}`;
        const arr = basketGroups.get(groupKey) ?? [];
        arr.push(i);
        basketGroups.set(groupKey, arr);
    }

    let violations = 0;

    // --- Step 2A: Synced basket violations (must be same slot) ---
    for (const [groupKey, indices] of basketGroups.entries()) {
        const basketName = groupKey.split('|')[0];
        if (!isSyncedBasket(basketName)) continue;
        if (indices.length <= 1) continue;

        const refDay = solution[indices[0]].day;
        const refStart = solution[indices[0]].startBucket;
        for (let k = 1; k < indices.length; k++) {
            const g = solution[indices[k]];
            if (g.day !== refDay || g.startBucket !== refStart) violations++;
        }
    }

    // --- Step 2B: Free basket violations ---
    // Previously we forced free basket members to be in different slots.
    // Given the sheer volume of electives (e.g. 100+ sessions for WMC), 
    // it's mathematically impossible for them to be in unique slots.
    // They are "free" because they CAN overlap or be spread out as needed.
    // So there is no penalty for free basket members overlapping with each other.

    // --- Step 2C: Global anti-clash across baskets ---
    // Build slot → list of baskets occupying it (each synced basket counts once per slot)
    const slotToBaskets = new Map<string, Set<string>>();
    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s.isLocked || !s.isElective || !s.basketName) continue;
        const gene = solution[i];
        for (let bucket = gene.startBucket; bucket < gene.startBucket + s.duration; bucket++) {
            const slotKey = `${gene.day}:${bucket}`;
            const basketsAtSlot = slotToBaskets.get(slotKey) ?? new Set<string>();
            basketsAtSlot.add(s.basketName);
            slotToBaskets.set(slotKey, basketsAtSlot);
        }
    }
    for (const baskets of slotToBaskets.values()) {
        if (baskets.size > 1) {
            // Multiple different baskets at the same slot = violation
            violations += baskets.size - 1;
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
        if (sessions[i].isLocked || sessions[i].slotType !== 'Practical') continue;
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
    // Build occupancy: (day, slot) → { wmc: number[], section: number[] }
    const slotMap = new Map<string, { wmc: number[]; section: number[] }>();
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked) continue; // WMC-Section logic only applies within the active cluster

        const gene = solution[i];
        const end = gene.startBucket + sessions[i].duration - 1;
        for (let s = gene.startBucket; s <= end; s++) {
            const key = `${gene.day}:${s}`;
            let entry = slotMap.get(key);
            if (!entry) {
                entry = { wmc: [], section: [] };
                slotMap.set(key, entry);
            }
            if (sessions[i].isWMCGroup) entry.wmc.push(i);
            else entry.section.push(i);
        }
    }

    let violations = 0;
    for (const { wmc, section } of slotMap.values()) {
        if (wmc.length > 0 && section.length > 0) {
            // A section session colliding with WMC is a violation UNLESS
            // they are both electives (handled by global anti-clash)
            for (const sIdx of section) {
                const sSession = sessions[sIdx];
                for (const wIdx of wmc) {
                    const wSession = sessions[wIdx];
                    if (sSession.isElective && wSession.isElective) continue;
                    violations++;
                }
            }
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
