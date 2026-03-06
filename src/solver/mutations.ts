import type { ClassSession, Gene, Solution, SolverInput } from './types';
import { SLOTS_PER_DAY, NUM_DAYS, crossesBreak } from './constants';

// ─── Random Helpers ────────────────────────────────────────────────────────────

/** Random integer in [min, max] (inclusive) */
function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Gaussian random using Box-Muller transform */
function gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Clamp value to [min, max] */
function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

// ─── Valid start slot helpers ──────────────────────────────────────────────────

/**
 * Get all valid start slots for a session of a given duration.
 * A start is valid if:
 * 1. The session fits within the day (endSlot <= SLOTS_PER_DAY)
 * 2. The session doesn't cross a break boundary (slot 2→3 or slot 4→5)
 */
function getValidStarts(duration: number): number[] {
    const valid: number[] = [];
    for (let s = 1; s <= SLOTS_PER_DAY - duration + 1; s++) {
        if (!crossesBreak(s, duration)) {
            valid.push(s);
        }
    }
    return valid;
}

/** Cache valid starts per duration */
const validStartCache = new Map<number, number[]>();
function cachedValidStarts(duration: number): number[] {
    if (!validStartCache.has(duration)) {
        validStartCache.set(duration, getValidStarts(duration));
    }
    return validStartCache.get(duration)!;
}

/** Pick a random valid start slot for a given session duration */
function randomSafeStart(duration: number): number {
    const starts = cachedValidStarts(duration);
    if (starts.length === 0) return 1; // fallback
    return starts[randInt(0, starts.length - 1)];
}

// ─── Room-type helpers ─────────────────────────────────────────────────────────

/** Get indices of rooms with roomType === 'Lab' */
function getLabRoomIndices(rooms: SolverInput['rooms']): number[] {
    return rooms.map((r, i) => r.roomType === 'Lab' ? i : -1).filter(i => i >= 0);
}

/** Get indices of non-lab (lecture) rooms */
function getLectureRoomIndices(rooms: SolverInput['rooms']): number[] {
    return rooms.map((r, i) => r.roomType !== 'Lab' ? i : -1).filter(i => i >= 0);
}

/** Pick a room index appropriate for the session's slot type */
function pickRoomForSession(session: ClassSession, rooms: SolverInput['rooms']): number {
    if (session.slotType === 'Practical') {
        // Practicals → random Lab room
        const labIndices = getLabRoomIndices(rooms);
        if (labIndices.length > 0) return labIndices[randInt(0, labIndices.length - 1)];
    } else if (session.isElective) {
        // Electives → random Lecture room (they need different rooms for concurrent sessions)
        const lectureIndices = getLectureRoomIndices(rooms);
        if (lectureIndices.length > 0) return lectureIndices[randInt(0, lectureIndices.length - 1)];
    } else {
        // Core Lectures/Tutorials → ALWAYS use home room (hard constraint)
        return session.homeRoomIndex;
    }
    return randInt(0, rooms.length - 1); // fallback
}

// ─── Elective group helpers ────────────────────────────────────────────────────

/** Build a map of electiveSyncKey → session indices */
function buildElectiveGroups(sessions: ClassSession[]): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (!s.isElective || s.electiveSlotIndex < 0 || !s.basketName) continue;
        const key = `${s.basketName}|${s.slotType}|${s.electiveSlotIndex}`;
        const arr = groups.get(key);
        if (arr) arr.push(i);
        else groups.set(key, [i]);
    }
    return groups;
}

// ─── Initial Solution Generator ────────────────────────────────────────────────

/**
 * Generate a smarter initial solution:
 * - Spreads sessions evenly across days (round-robin)
 * - Avoids break/lunch crossings
 * - Uses lab rooms for practicals, lecture rooms for lectures/tutorials
 * - Elective sessions in the same sync group start at the same (day, slot)
 */
export function generateInitialSolution(input: SolverInput): Solution {
    const { sessions, rooms } = input;

    // Round-robin day assignment to spread load
    const dayLoad = new Array(NUM_DAYS).fill(0);

    // For synced baskets: groupKey → { day, startBucket } (shared slot)
    const syncedBasketSlots = new Map<string, { day: number; startBucket: number }>();
    // Global set of used day:slot combos across ALL elective baskets (for anti-clash)
    const usedElectiveSlots = new Set<string>();

    const solution: Gene[] = new Array(sessions.length);

    for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];

        // Locked sessions are pre-filled by the caller — skip them
        if (session.isLocked) {
            if (!solution[i]) {
                solution[i] = { day: 1, startBucket: 1, roomIndex: 0 }; // placeholder, overwritten by caller
            }
            continue;
        }

        // Elective basket placement
        if (session.isElective && session.electiveSlotIndex >= 0 && session.basketName) {
            const groupKey = `${session.basketName}|${session.slotType}|${session.electiveSlotIndex}`;

            // Both SYNCED and FREE baskets now handle slots exactly the same way:
            // All members of the same basket+index share one slot.
            // Differences:
            // - Synced baskets must remain together (enforced by countElectiveSyncViolations A).
            // - Free baskets can drift apart later during mutation (since countElectiveSyncViolations B was removed),
            //   but placing them together initially saves space and is perfectly valid.

            const existing = syncedBasketSlots.get(groupKey);
            if (existing) {
                solution[i] = { day: existing.day, startBucket: existing.startBucket, roomIndex: pickRoomForSession(session, rooms) };
                continue;
            }

            // First in group — pick a slot not already used by any basket
            const day = 1 + dayLoad.indexOf(Math.min(...dayLoad));
            let start = randomSafeStart(session.duration);
            let key = `${day}:${start}`;
            let attempts = 0;
            while (usedElectiveSlots.has(key) && attempts < 30) {
                start = randomSafeStart(session.duration);
                const d = 1 + Math.floor(Math.random() * NUM_DAYS);
                key = `${d}:${start}`;
                attempts++;
            }
            usedElectiveSlots.add(key);
            const [chosenDay, chosenStart] = key.split(':').map(Number);
            dayLoad[chosenDay - 1] += session.duration;
            syncedBasketSlots.set(groupKey, { day: chosenDay, startBucket: chosenStart });
            solution[i] = { day: chosenDay, startBucket: chosenStart, roomIndex: pickRoomForSession(session, rooms) };
            continue;
        }

        // Non-elective: normal round-robin placement
        let bestDay = 1;
        let minLoad = Infinity;
        for (let d = 1; d <= NUM_DAYS; d++) {
            if (dayLoad[d - 1] < minLoad) {
                minLoad = dayLoad[d - 1];
                bestDay = d;
            }
        }
        dayLoad[bestDay - 1] += session.duration;

        const startBucket = randomSafeStart(session.duration);
        const roomIndex = pickRoomForSession(session, rooms);

        solution[i] = { day: bestDay, startBucket, roomIndex };
    }

    return solution;
}

// ─── Mutation Operators ────────────────────────────────────────────────────────

/** Mutate: assign a random new day */
function mutateDay(gene: Gene): Gene {
    return { ...gene, day: randInt(1, NUM_DAYS) };
}

/** Mutate: shift start slot by Gaussian noise, snapping to valid positions */
export function mutateTime(gene: Gene, session: ClassSession, sigma: number): Gene {
    const noise = Math.round(gaussianRandom() * sigma);
    const maxStart = SLOTS_PER_DAY - session.duration + 1;
    let newStart = clamp(gene.startBucket + noise, 1, Math.max(1, maxStart));

    // If new position crosses a break, snap to nearest valid start
    if (crossesBreak(newStart, session.duration)) {
        const validStarts = cachedValidStarts(session.duration);
        if (validStarts.length > 0) {
            let bestStart = validStarts[0];
            let bestDist = Math.abs(newStart - bestStart);
            for (const vs of validStarts) {
                const dist = Math.abs(newStart - vs);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestStart = vs;
                }
            }
            newStart = bestStart;
        }
    }

    return { ...gene, startBucket: newStart };
}

/** Mutate: reassign room (respecting Lab/Lecture type) */
export function mutateRoom(session: ClassSession, rooms: SolverInput['rooms']): Gene & { roomIndex: number } {
    return { day: 0, startBucket: 0, roomIndex: pickRoomForSession(session, rooms) };
}

/** Swap two same-duration, non-elective sessions (electives are synced so swapping would break them) */
function trySwap(offspring: Solution, sessions: ClassSession[], idx: number): void {
    // Never swap elective sessions — it breaks sync groups
    if (sessions[idx].isElective) return;

    const duration = sessions[idx].duration;
    const candidates: number[] = [];
    for (let j = 0; j < sessions.length; j++) {
        if (j !== idx && sessions[j].duration === duration && !sessions[j].isElective) {
            candidates.push(j);
        }
    }
    if (candidates.length === 0) return;

    const other = candidates[randInt(0, candidates.length - 1)];
    const temp = { ...offspring[idx] };
    offspring[idx] = { ...offspring[other] };
    offspring[other] = temp;
}

/** Relocate to a random valid position */
export function mutateRelocate(session: ClassSession, rooms: SolverInput['rooms']): Gene {
    return {
        day: randInt(1, NUM_DAYS),
        startBucket: randomSafeStart(session.duration),
        roomIndex: pickRoomForSession(session, rooms),
    };
}

// ─── Main Mutation Function ────────────────────────────────────────────────────

/**
 * Create an offspring by applying mutations to the parent solution.
 * Mutation count scales with problem size (3-8% of sessions).
 * Special handling:
 * - Elective sync groups move together (same day+time)
 * - Room mutations respect Lab/Lecture type
 */
export function mutate(parent: Solution, input: SolverInput, sigma: number): Solution {
    const offspring: Solution = parent.map(g => ({ ...g }));
    const { sessions, rooms } = input;
    const n = sessions.length;
    if (n === 0) return offspring;

    // Build elective groups for this mutation pass
    const electiveGroups = buildElectiveGroups(sessions);
    // Reverse map: session index → sync key
    const sessionToKey = new Map<number, string>();
    for (const [key, indices] of electiveGroups) {
        for (const idx of indices) sessionToKey.set(idx, key);
    }

    // Build list of mutable (non-locked) session indices
    const mutableIndices: number[] = [];
    for (let i = 0; i < n; i++) {
        if (!sessions[i].isLocked) mutableIndices.push(i);
    }
    if (mutableIndices.length === 0) return offspring;

    const mutationFraction = 0.03 + Math.random() * 0.05;
    const numMutations = Math.max(2, Math.min(20, Math.round(mutableIndices.length * mutationFraction)));

    for (let m = 0; m < numMutations; m++) {
        const idx = mutableIndices[randInt(0, mutableIndices.length - 1)];
        const op = randInt(0, 4);

        switch (op) {
            case 0: { // Mutate day
                const newGene = mutateDay(offspring[idx]);
                offspring[idx] = newGene;
                // If elective, move all in sync group to same day
                const dayKey = sessionToKey.get(idx);
                if (dayKey) {
                    for (const j of electiveGroups.get(dayKey) ?? []) {
                        if (j !== idx) offspring[j] = { ...offspring[j], day: newGene.day };
                    }
                }
                break;
            }
            case 1: { // Mutate time
                const newGene = mutateTime(offspring[idx], sessions[idx], sigma);
                offspring[idx] = newGene;
                // If elective, move all in sync group to same start
                const timeKey = sessionToKey.get(idx);
                if (timeKey) {
                    for (const j of electiveGroups.get(timeKey) ?? []) {
                        if (j !== idx) offspring[j] = { ...offspring[j], startBucket: newGene.startBucket };
                    }
                }
                break;
            }
            case 2: // Mutate room (type-aware, only this session)
                offspring[idx] = { ...offspring[idx], roomIndex: mutateRoom(sessions[idx], rooms).roomIndex };
                break;
            case 3: // Swap
                trySwap(offspring, sessions, idx);
                break;
            case 4: { // Relocate
                const newGene = mutateRelocate(sessions[idx], rooms);
                offspring[idx] = newGene;
                // If elective, sync group follows the new day+time (but keeps own room)
                const relocKey = sessionToKey.get(idx);
                if (relocKey) {
                    for (const j of electiveGroups.get(relocKey) ?? []) {
                        if (j !== idx) {
                            offspring[j] = {
                                ...offspring[j],
                                day: newGene.day,
                                startBucket: newGene.startBucket,
                            };
                        }
                    }
                }
                break;
            }
        }
    }

    return offspring;
}
