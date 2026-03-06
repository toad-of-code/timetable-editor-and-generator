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
