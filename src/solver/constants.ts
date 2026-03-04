import type { SolverConfig } from './types';

// ─── Time Model ────────────────────────────────────────────────────────────────
// Day: 08:50 AM → 06:30 PM, divided into 8 one-hour slots.
// Break: 10:50 → 11:00 (between slot 2 and 3)
// Lunch: 13:00 → 14:30 (between slot 4 and 5)

/** Total one-hour slots in one day */
export const SLOTS_PER_DAY = 8;

/** Number of working days */
export const NUM_DAYS = 5;

/**
 * Slot start times (1-indexed, so slot 1 = index 0).
 * Slot 1:  08:50 - 09:50
 * Slot 2:  09:50 - 10:50
 *   [BREAK: 10:50 - 11:00]
 * Slot 3:  11:00 - 12:00
 * Slot 4:  12:00 - 13:00
 *   [LUNCH: 13:00 - 14:30]
 * Slot 5:  14:30 - 15:30
 * Slot 6:  15:30 - 16:30
 * Slot 7:  16:30 - 17:30
 * Slot 8:  17:30 - 18:30
 */
export const SLOT_START_TIMES = [
    '08:50', '09:50',             // slots 1-2 (morning block)
    '11:00', '12:00',             // slots 3-4 (mid-morning block)
    '14:30', '15:30', '16:30', '17:30', // slots 5-8 (afternoon block)
];

export const SLOT_END_TIMES = [
    '09:50', '10:50',             // slots 1-2
    '12:00', '13:00',             // slots 3-4
    '15:30', '16:30', '17:30', '18:30', // slots 5-8
];

/**
 * Break boundaries: a multi-slot session CANNOT span across these.
 * E.g., a 2-hour session starting at slot 2 would need slot 3, but there's
 * a break between them, so that's invalid.
 * Similarly, starting at slot 4 needs slot 5 but lunch is between them.
 */
export const BREAK_AFTER_SLOTS = [2, 4]; // break after slot 2, lunch after slot 4

// ─── Session Durations (in 1-hour slots) ───────────────────────────────────────

/** 1-hour lecture = 1 slot */
export const LECTURE_DURATION = 1;

/** 1-hour tutorial = 1 slot */
export const TUTORIAL_DURATION = 1;

/**
 * Default practical duration: 2 hours = 2 slots.
 * Use Math.ceil(subject.practical_duration / 60) for the actual value.
 */
export const DEFAULT_PRACTICAL_DURATION = 2;

// ─── Default Solver Config ─────────────────────────────────────────────────────

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
    maxGenerations: 200_000,
    reportInterval: 1000,
    initialSigma: 2.0,
    gapWeight: 1.0,
    hardPenalty: 1000,
    adaptationWindow: 50,
    sigmaIncrease: 1.22,
    sigmaDecrease: 0.82,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a slot number (1-indexed) to its start time string like "08:50".
 */
export function slotToStartTime(slot: number): string {
    if (slot < 1 || slot > SLOTS_PER_DAY) return '00:00';
    return SLOT_START_TIMES[slot - 1];
}

/**
 * Convert a slot number (1-indexed) to its end time string.
 * For multi-slot sessions, pass the last occupied slot.
 */
export function slotToEndTime(slot: number): string {
    if (slot < 1 || slot > SLOTS_PER_DAY) return '00:00';
    return SLOT_END_TIMES[slot - 1];
}

/**
 * Convert a time string like "09:50" to the nearest slot number (1-indexed).
 */
export function timeToSlot(time: string): number {
    // Find the slot whose start time matches
    const idx = SLOT_START_TIMES.indexOf(time);
    if (idx !== -1) return idx + 1;

    // Fallback: find the closest slot by comparing minutes
    const [h, m] = time.split(':').map(Number);
    const targetMins = h * 60 + m;

    let bestSlot = 1;
    let bestDiff = Infinity;
    for (let i = 0; i < SLOT_START_TIMES.length; i++) {
        const [sh, sm] = SLOT_START_TIMES[i].split(':').map(Number);
        const diff = Math.abs(targetMins - (sh * 60 + sm));
        if (diff < bestDiff) {
            bestDiff = diff;
            bestSlot = i + 1;
        }
    }
    return bestSlot;
}

/**
 * Check if a session of `duration` slots starting at `startSlot`
 * crosses any break boundary.
 */
export function crossesBreak(startSlot: number, duration: number): boolean {
    for (let s = startSlot; s < startSlot + duration - 1; s++) {
        if (BREAK_AFTER_SLOTS.includes(s)) return true;
    }
    return false;
}

// ─── Legacy aliases (for backward compat during migration) ─────────────────────
/** @deprecated Use SLOTS_PER_DAY */
export const BUCKETS_PER_DAY = SLOTS_PER_DAY;
/** @deprecated Use timeToSlot */
export const timeToBucket = timeToSlot;
/** @deprecated Use slotToStartTime */
export const bucketToTime = slotToStartTime;
