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
    basket_name: string | null;  // Elective basket (e.g., 'HSMC', 'MDM', 'lang'). Null for core subjects.
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
                roomIndex: slot.room_id ? (roomIdToIndex.get(slot.room_id) ?? -1) : -1,
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
 * Identify session indices involved in ANY hard constraint violation.
 * Covers all 10 hard constraints checked in constraints.ts evaluate():
 *   1. timeBoundary   — session ends past slot 8
 *   2. breakCrossing  — multi-slot session spans a break/lunch boundary
 *   3. roomOverlap    — two sessions share a room at the same slot
 *   4. profOverlap    — professor teaches two sessions at once (non-elective pairs only)
 *   5. groupOverlap   — student group attends two sessions at once (non-elective pairs only)
 *   6. electiveSync   — synced-basket members disagree; or two different baskets share a slot
 *   7. labRoom        — a practical is not in a Lab room
 *   8. wmcSection     — a WMC session clashes with a section-level session
 *   9. homeRoom       — a core lecture/tutorial is not in its assigned home room
 *  10. twoOneLecture  — double-lecture and single-lecture for same subject+group share a day
 */
function findClashingIndices(input: SolverInput, solution: Solution): Set<number> {
    const clashing = new Set<number>();
    const { sessions, rooms } = input;

    // ── 1 & 2: Time boundary + break crossing ─────────────────────────────────
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked) continue;
        const start = solution[i].startBucket;
        const dur = sessions[i].duration;
        const end = start + dur - 1;
        if (end > 8) { clashing.add(i); continue; }
        if (dur > 1) {
            for (let s = start; s < start + dur - 1; s++) {
                if (s === 2 || s === 4) { clashing.add(i); break; }
            }
        }
    }

    // ── 3: Room overlap ────────────────────────────────────────────────────────
    {
        const map = new Map<string, number[]>();
        for (let i = 0; i < sessions.length; i++) {
            const gene = solution[i];
            if (gene.roomIndex < 0) continue;
            const roomKey = `R${rooms[gene.roomIndex]?.id ?? gene.roomIndex}`;
            const start = gene.startBucket;
            const end = start + sessions[i].duration - 1;
            for (let s = start; s <= end; s++) {
                const slot = `${roomKey}:${gene.day}:${s}`;
                const arr = map.get(slot);
                if (arr) arr.push(i);
                else map.set(slot, [i]);
            }
        }
        for (const arr of map.values()) {
            if (arr.length > 1) for (const idx of arr) clashing.add(idx);
        }
    }

    // ── 4: Professor overlap (elective-elective pairs exempt) ──────────────────
    {
        const profMap = new Map<string, number[]>();
        for (let i = 0; i < sessions.length; i++) {
            const gene = solution[i];
            const key = sessions[i].professorId
                ? `P${sessions[i].professorId}`
                : `P__EMPTY_${sessions[i].id}`;
            const start = gene.startBucket;
            const end = start + sessions[i].duration - 1;
            for (let s = start; s <= end; s++) {
                const slot = `${key}:${gene.day}:${s}`;
                const arr = profMap.get(slot);
                if (arr) arr.push(i);
                else profMap.set(slot, [i]);
            }
        }
        for (const [key, arr] of profMap.entries()) {
            if (key.startsWith('P__EMPTY_') || arr.length <= 1) continue;
            for (let i = 0; i < arr.length - 1; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const sA = sessions[arr[i]];
                    const sB = sessions[arr[j]];
                    if (sA.isElective && sB.isElective) continue;
                    clashing.add(arr[i]);
                    clashing.add(arr[j]);
                }
            }
        }
    }

    // ── 5: Group overlap (elective-elective pairs exempt, mirrors countGroupOverlaps) ──
    {
        const groupMap = new Map<string, number[]>();
        for (let i = 0; i < sessions.length; i++) {
            if (sessions[i].isLocked) continue;
            const gene = solution[i];
            const start = gene.startBucket;
            const end = start + sessions[i].duration - 1;
            for (let s = start; s <= end; s++) {
                const slot = `G${sessions[i].groupId}:${gene.day}:${s}`;
                const arr = groupMap.get(slot);
                if (arr) arr.push(i);
                else groupMap.set(slot, [i]);
            }
        }
        for (const arr of groupMap.values()) {
            if (arr.length <= 1) continue;
            for (let i = 0; i < arr.length - 1; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const sA = sessions[arr[i]];
                    const sB = sessions[arr[j]];
                    if (sA.isLocked || sB.isLocked) continue;
                    if (sA.basketName && sA.basketName === sB.basketName) continue;
                    if (sA.isElective && sB.isElective) continue;
                    clashing.add(arr[i]);
                    clashing.add(arr[j]);
                }
            }
        }
    }

    // ── 6: Elective sync (synced basket disagreement + cross-basket slot clash) ─
    {
        const SYNCED = new Set(['HSMC', 'MDM']);
        const basketGroups = new Map<string, number[]>();
        for (let i = 0; i < sessions.length; i++) {
            const s = sessions[i];
            if (s.isLocked || !s.isElective || !s.basketName || s.electiveSlotIndex < 0) continue;
            const key = `${s.basketName}|${s.slotType}|${s.electiveSlotIndex}`;
            const arr = basketGroups.get(key) ?? [];
            arr.push(i);
            basketGroups.set(key, arr);
        }
        // Rule A: synced basket members must share (day, startBucket)
        for (const [groupKey, indices] of basketGroups.entries()) {
            const basketName = groupKey.split('|')[0];
            if (!SYNCED.has(basketName) || indices.length <= 1) continue;
            const refDay = solution[indices[0]].day;
            const refStart = solution[indices[0]].startBucket;
            for (let k = 1; k < indices.length; k++) {
                const g = solution[indices[k]];
                if (g.day !== refDay || g.startBucket !== refStart) {
                    clashing.add(indices[0]);
                    clashing.add(indices[k]);
                }
            }
        }
        // Rule C: no two different baskets at the same slot
        const slotToBaskets = new Map<string, Map<string, number[]>>();
        for (let i = 0; i < sessions.length; i++) {
            const s = sessions[i];
            if (s.isLocked || !s.isElective || !s.basketName) continue;
            const gene = solution[i];
            for (let bucket = gene.startBucket; bucket < gene.startBucket + s.duration; bucket++) {
                const slotKey = `${gene.day}:${bucket}`;
                let bMap = slotToBaskets.get(slotKey);
                if (!bMap) { bMap = new Map(); slotToBaskets.set(slotKey, bMap); }
                const arr = bMap.get(s.basketName) ?? [];
                arr.push(i);
                bMap.set(s.basketName, arr);
            }
        }
        for (const bMap of slotToBaskets.values()) {
            if (bMap.size > 1) {
                for (const indices of bMap.values()) {
                    for (const idx of indices) clashing.add(idx);
                }
            }
        }
    }

    // ── 7: Lab room violations (practical not in a Lab) ────────────────────────
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked || sessions[i].slotType !== 'Practical') continue;
        const room = rooms[solution[i].roomIndex];
        if (!room || room.roomType !== 'Lab') clashing.add(i);
    }

    // ── 8: WMC-Section overlap ─────────────────────────────────────────────────
    {
        const slotMap = new Map<string, { wmc: number[]; section: number[] }>();
        for (let i = 0; i < sessions.length; i++) {
            if (sessions[i].isLocked) continue;
            const gene = solution[i];
            const end = gene.startBucket + sessions[i].duration - 1;
            for (let s = gene.startBucket; s <= end; s++) {
                const key = `${gene.day}:${s}`;
                let entry = slotMap.get(key);
                if (!entry) { entry = { wmc: [], section: [] }; slotMap.set(key, entry); }
                if (sessions[i].isWMCGroup) entry.wmc.push(i);
                else entry.section.push(i);
            }
        }
        for (const { wmc, section } of slotMap.values()) {
            if (wmc.length > 0 && section.length > 0) {
                for (const sIdx of section) {
                    for (const wIdx of wmc) {
                        if (sessions[sIdx].isElective && sessions[wIdx].isElective) continue;
                        clashing.add(sIdx);
                        clashing.add(wIdx);
                    }
                }
            }
        }
    }

    // ── 9: Home room violations (core lecture/tutorial not in its home room) ────
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked) continue;
        if (sessions[i].slotType === 'Practical') continue;
        if (sessions[i].isElective) continue;
        if (solution[i].roomIndex !== sessions[i].homeRoomIndex) clashing.add(i);
    }

    // ── 10: 2+1 Lecture format (double + single for same subject+group on same day) ─
    {
        const groupMap = new Map<string, number[]>();
        for (let i = 0; i < sessions.length; i++) {
            const s = sessions[i];
            if (s.isLocked || s.slotType !== 'Lecture' || s.lecturePairIndex === -2) continue;
            const key = `${s.subjectId}|${s.groupId}`;
            const arr = groupMap.get(key) ?? [];
            arr.push(i);
            groupMap.set(key, arr);
        }
        for (const indices of groupMap.values()) {
            if (indices.length <= 1) continue;
            const dayBuckets = new Map<number, number[]>();
            for (const idx of indices) {
                const d = solution[idx].day;
                const arr = dayBuckets.get(d) ?? [];
                arr.push(idx);
                dayBuckets.set(d, arr);
            }
            for (const arr of dayBuckets.values()) {
                if (arr.length > 1) for (const idx of arr) clashing.add(idx);
            }
        }
    }

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
    let clashingIndices = findClashingIndices(input, solution);
    if (clashingIndices.size === 0) {
        return { solution, fitness: baseFitness };
    }

    let targets = Array.from(clashingIndices);

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

            if (bestFitness.hardViolations === 0) {
                return { solution: bestSolution, fitness: bestFitness };
            }

            // Refresh targets after every improvement so we attack the CURRENT
            // bottleneck, not sessions that may have already been resolved.
            clashingIndices = findClashingIndices(input, bestSolution);
            targets = Array.from(clashingIndices);
            if (targets.length === 0) break;
        }
    }

    // Return improvement if any
    if (bestFitness.total < baseFitness.total) {
        return { solution: bestSolution, fitness: bestFitness };
    }

    return null;
}
