import type { SolverInput, Solution, Gene, FitnessResult } from './types';
import { evaluate } from './constraints';
import { timeToSlot } from './constants';
import { mutateRelocate, mutateTime, mutateRoom } from './mutations';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** A slot as stored in the editor (enriched DB row). */
export interface EditorSlot {
    id: string;                 // timetable_slots.id
    timetable_id: string;
    subject_id: string;
    professor_id: string | null;
    room_id: string | null;
    student_group_id: string;
    day_of_week: number;        // 1-5
    start_time: string;         // "08:50"
    end_time: string;           // "09:50"
    slot_type: 'Lecture' | 'Tutorial' | 'Practical';
    subject_type: string;        // 'Core' | 'Elective' | 'Minor'
    // Joined display names
    subject_code: string;
    subject_name: string;
    professor_name: string;
    room_name: string;
    group_name: string;
}

export interface FeasibilityResult {
    feasible: boolean;
    fitness: FitnessResult;
}

// ─── Convert editor slots back into a Solution for evaluation ──────────────────

/**
 * Build a Solution (Gene[]) from the editor's slot list, aligned to a SolverInput.
 *
 * Each ClassSession in `input.sessions` is matched to an EditorSlot by
 * (subjectId, groupId, slotType). Slots are consumed in order so that
 * duplicates (e.g. 3 lectures for the same subject+group) map 1-to-1.
 */
export function solutionFromSlots(
    input: SolverInput,
    slots: EditorSlot[],
): Solution {
    const roomIdToIndex = new Map<string, number>();
    input.rooms.forEach((r, i) => roomIdToIndex.set(r.id, i));

    // Build queues keyed by (subjectId|groupId|slotType)
    const queues = new Map<string, EditorSlot[]>();
    for (const slot of slots) {
        const key = `${slot.subject_id}|${slot.student_group_id}|${slot.slot_type}`;
        if (!queues.has(key)) queues.set(key, []);
        queues.get(key)!.push(slot);
    }

    return input.sessions.map((session) => {
        const key = `${session.subjectId}|${session.groupId}|${session.slotType}`;
        const queue = queues.get(key);

        if (queue && queue.length > 0) {
            const slot = queue.shift()!;
            return {
                day: slot.day_of_week,
                startBucket: timeToSlot(slot.start_time),
                roomIndex: slot.room_id ? (roomIdToIndex.get(slot.room_id) ?? 0) : 0,
            } as Gene;
        }

        // Fallback for unmatched sessions — place at day 1 slot 1 room 0
        return { day: 1, startBucket: 1, roomIndex: 0 } as Gene;
    });
}

// ─── Feasibility Check ────────────────────────────────────────────────────────

/**
 * Check if the current editor state is feasible.
 * Returns the full FitnessResult so the UI can show violation details.
 */
export function checkFeasibility(
    input: SolverInput,
    solution: Solution,
): FeasibilityResult {
    const fitness = evaluate(input, solution);
    return {
        feasible: fitness.hardViolations === 0,
        fitness,
    };
}

// ─── Local Neighbourhood Search ────────────────────────────────────────────────

/**
 * After a user drag, run a quick local search around the changed session
 * to see if nearby adjustments can eliminate violations.
 *
 * Strategy: try relocating the changed session + its neighbours to find
 * a zero-violation arrangement. This is a lightweight LNS that only
 * perturbs a small neighbourhood.
 *
 * @returns The improved solution if one is found, or null if no improvement.
 */
export function runLNS(
    input: SolverInput,
    solution: Solution,
    changedIndex: number,
    maxAttempts: number = 200,
): { solution: Solution; fitness: FitnessResult } | null {
    const baseFitness = evaluate(input, solution);

    // If already feasible, nothing to do
    if (baseFitness.hardViolations === 0) {
        return { solution, fitness: baseFitness };
    }

    let bestSolution = solution.map(g => ({ ...g }));
    let bestFitness = baseFitness;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Clone current best
        const candidate = bestSolution.map(g => ({ ...g }));

        // Pick a random strategy
        const strategy = Math.random();
        const session = input.sessions[changedIndex];

        if (strategy < 0.4) {
            // Relocate the changed session
            candidate[changedIndex] = mutateRelocate(session, input.rooms);
        } else if (strategy < 0.7) {
            // Mutate time of the changed session
            candidate[changedIndex] = {
                ...candidate[changedIndex],
                ...mutateTime(candidate[changedIndex], session, 2.0),
            };
        } else {
            // Mutate room of the changed session
            candidate[changedIndex] = {
                ...candidate[changedIndex],
                ...mutateRoom(session, input.rooms),
            };
        }

        const candidateFitness = evaluate(input, candidate);

        if (candidateFitness.total < bestFitness.total) {
            bestSolution = candidate;
            bestFitness = candidateFitness;

            if (bestFitness.hardViolations === 0) {
                return { solution: bestSolution, fitness: bestFitness };
            }
        }
    }

    // Return improvement if any, even if not fully feasible
    if (bestFitness.total < baseFitness.total) {
        return { solution: bestSolution, fitness: bestFitness };
    }

    return null;
}

// ─── Full LNS: Destroy & Repair ALL clashing sessions ──────────────────────────

/**
 * Identify session indices involved in clashes (room, professor, group overlaps).
 */
function findClashingIndices(input: SolverInput, solution: Solution): Set<number> {
    const clashing = new Set<number>();
    const { sessions, rooms } = input;

    // Helper: check occupancy for a given key function
    const checkOccupancy = (keyFn: (s: typeof sessions[0], g: Gene) => string) => {
        const map = new Map<string, number[]>();
        for (let i = 0; i < sessions.length; i++) {
            const gene = solution[i];
            const key = keyFn(sessions[i], gene);
            const start = gene.startBucket;
            const end = start + sessions[i].duration - 1;
            for (let s = start; s <= end; s++) {
                const slot = `${key}:${gene.day}:${s}`;
                const arr = map.get(slot);
                if (arr) { arr.push(i); }
                else map.set(slot, [i]);
            }
        }
        for (const arr of map.values()) {
            if (arr.length > 1) {
                for (const idx of arr) clashing.add(idx);
            }
        }
    };

    // Room overlaps
    checkOccupancy((_s, g) => `R${rooms[g.roomIndex]?.id ?? g.roomIndex}`);

    // Professor overlaps (skip empty/unknown)
    checkOccupancy((s) => s.professorId ? `P${s.professorId}` : `P__EMPTY_${s.id}`);
    // Remove false positives from empty-prof keys
    // (they use unique keys so they never clash — no cleanup needed)

    // Group overlaps
    checkOccupancy((s) => `G${s.groupId}`);

    // Remove locked sessions — we cannot move those
    for (const idx of clashing) {
        if (sessions[idx].isLocked) clashing.delete(idx);
    }

    return clashing;
}

/**
 * Full LNS: Identify ALL sessions in conflict, destroy their placements,
 * and repair via randomised hill-climbing.
 *
 * @returns Improved solution + fitness, or null if no improvement found.
 */
export function runFullLNS(
    input: SolverInput,
    solution: Solution,
    maxAttempts: number = 1000,
): { solution: Solution; fitness: FitnessResult } | null {
    const baseFitness = evaluate(input, solution);

    if (baseFitness.hardViolations === 0) {
        return { solution, fitness: baseFitness };
    }

    // Find all clashing session indices
    const clashingIndices = findClashingIndices(input, solution);
    if (clashingIndices.size === 0) {
        return { solution, fitness: baseFitness };
    }

    const targets = Array.from(clashingIndices);

    let bestSolution = solution.map(g => ({ ...g }));
    let bestFitness = baseFitness;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = bestSolution.map(g => ({ ...g }));

        // Pick a random target from the clashing set
        const idx = targets[Math.floor(Math.random() * targets.length)];
        const session = input.sessions[idx];

        // Apply a random mutation strategy
        const strategy = Math.random();
        if (strategy < 0.5) {
            // Full relocate (new day + time + room)
            candidate[idx] = mutateRelocate(session, input.rooms);
        } else if (strategy < 0.8) {
            // Just shift time
            candidate[idx] = {
                ...candidate[idx],
                ...mutateTime(candidate[idx], session, 3.0),
            };
        } else {
            // Just change room
            const newRoom = mutateRoom(session, input.rooms);
            candidate[idx] = { ...candidate[idx], roomIndex: newRoom.roomIndex };
        }

        const candidateFitness = evaluate(input, candidate);

        if (candidateFitness.total < bestFitness.total) {
            bestSolution = candidate;
            bestFitness = candidateFitness;

            // Update targets — re-identify what's still clashing
            if (bestFitness.hardViolations === 0) {
                return { solution: bestSolution, fitness: bestFitness };
            }
        }
    }

    // Return improvement if any
    if (bestFitness.total < baseFitness.total) {
        return { solution: bestSolution, fitness: bestFitness };
    }

    return null;
}
