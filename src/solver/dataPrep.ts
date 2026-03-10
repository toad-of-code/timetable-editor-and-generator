import type { ClassSession, SolverInput, Gene, Solution } from './types';
import { LECTURE_DURATION, DOUBLE_LECTURE_DURATION, TUTORIAL_DURATION, NUM_DAYS, SLOTS_PER_DAY, DEFAULT_SOLVER_CONFIG, timeToSlot } from './constants';
import { generateInitialSolution } from './mutations';
import type { Subject, Group, Room } from '../hooks/useGeneratorData';

// ─── Extended Subject type (with L-T-P fields from DB) ─────────────────────────
// The hook's Subject type is updated to include these fields.

export interface SubjectFull extends Subject {
    lectures: number;
    tutorials: number;
    practicals: number;
    practical_duration: number;
    /** Elective basket name this subject belongs to (e.g. 'basket-1', 'HSMC', 'lang'). Null for core subjects. */
    elective_basket: string | null;
}

/**
 * Prepare solver input from the UI configuration.
 *
 * @param subjects       - Subjects with L-T-P fields
 * @param groups         - Student groups (sections)
 * @param rooms          - Available rooms
 * @param assignments    - Professor assignment map: subjectId → groupId → professorId
 * @param homeRooms      - Home room map: groupId → roomId
 */
export function prepareSolverInput(
    subjects: SubjectFull[],
    groups: Group[],
    professors: { id: string; name: string }[],
    rooms: Room[],
    assignments: Record<string, Record<string, string>>,
    homeRooms: Record<string, string>,
): SolverInput {
    const sessions: ClassSession[] = [];
    let sessionId = 0;

    // Build roomId → index map
    const roomIndexMap = new Map<string, number>();
    rooms.forEach((r, i) => roomIndexMap.set(r.id, i));

    // Track elective occurrence indices per slotType for synchronization
    // All elective subjects' Lecture#0 get electiveSlotIndex=0, Lecture#1 get =1, etc.

    // Map professor IDs to names for overlap skipping
    const profNameMap = new Map<string, string>();
    professors.forEach(p => profNameMap.set(p.id, p.name));

    for (const subject of subjects) {
        const isElective = subject.subject_type === 'Elective' || subject.subject_type === 'Minor';

        for (const group of groups) {
            let professorId = assignments[subject.id]?.[group.id];
            if (!professorId) continue; // Skip unassigned

            // If professor is Unknown/TBD, wipe the ID so the solver doesn't try to sync them as one person
            const profName = profNameMap.get(professorId) || '';
            if (profName === 'Unknown' || profName === 'TBD') {
                professorId = '';
            }

            const homeRoomId = homeRooms[group.id] ?? '';
            const homeRoomIndex = roomIndexMap.get(homeRoomId) ?? 0;
            const isWMCGroup = group.name === 'WMC' || /IT[\s-]*BI/i.test(group.name);

            // ── 2+1 Lecture Expansion ────────────────────────────────────────────
            // For non-elective core lectures ONLY:
            //   lectures=1 → one 1-hour session
            //   lectures=2 → one 2-hour double-lecture
            //   lectures=3 → one 2-hour double-lecture + one 1-hour session
            //   lectures=4 → one 2-hour double-lecture + two 1-hour sessions
            //   (i.e., always exactly ONE 2-hr block, rest are 1-hr singles)
            // For electives, each lecture is a separate 1-hour session (unchanged).
            const numLectures = subject.lectures ?? 0;

            if (!isElective && numLectures >= 2) {
                // The one double-lecture block (2-hour)
                sessions.push({
                    id: sessionId++,
                    subjectId: subject.id,
                    subjectCode: subject.code,
                    groupId: group.id,
                    professorId,
                    duration: DOUBLE_LECTURE_DURATION,
                    slotType: 'Lecture',
                    homeRoomIndex,
                    isElective: false,
                    electiveSlotIndex: -1,
                    basketName: null,
                    isWMCGroup,
                    lecturePairIndex: 0, // the double-lecture block
                });

                // Remaining single-lecture slots (lectures - 2)
                for (let l = 0; l < numLectures - 2; l++) {
                    sessions.push({
                        id: sessionId++,
                        subjectId: subject.id,
                        subjectCode: subject.code,
                        groupId: group.id,
                        professorId,
                        duration: LECTURE_DURATION,
                        slotType: 'Lecture',
                        homeRoomIndex,
                        isElective: false,
                        electiveSlotIndex: -1,
                        basketName: null,
                        isWMCGroup,
                        lecturePairIndex: -1, // remainder single-lecture slot
                    });
                }
            } else {
                // lectures=1 or elective: create individual 1-hour sessions (unchanged)
                for (let l = 0; l < numLectures; l++) {
                    sessions.push({
                        id: sessionId++,
                        subjectId: subject.id,
                        subjectCode: subject.code,
                        groupId: group.id,
                        professorId,
                        duration: LECTURE_DURATION,
                        slotType: 'Lecture',
                        homeRoomIndex,
                        isElective,
                        electiveSlotIndex: isElective ? l : -1,
                        basketName: isElective ? (subject.elective_basket ?? null) : null,
                        isWMCGroup,
                        lecturePairIndex: -2, // not applicable
                    });
                }
            }

            // Expand Tutorials: each tutorial = 1 slot (1 hour)
            for (let t = 0; t < (subject.tutorials ?? 0); t++) {
                sessions.push({
                    id: sessionId++,
                    subjectId: subject.id,
                    subjectCode: subject.code,
                    groupId: group.id,
                    professorId,
                    duration: TUTORIAL_DURATION,
                    slotType: 'Tutorial',
                    homeRoomIndex,
                    isElective,
                    electiveSlotIndex: isElective ? t : -1,
                    basketName: isElective ? (subject.elective_basket ?? null) : null,
                    isWMCGroup,
                    lecturePairIndex: -2, // not applicable
                });
            }

            // Expand Practicals: each practical = practical_duration / 60 slots
            // If P >= 2, halve the count (e.g., P=2 → 1 session of 2 hours)
            const practicalCount = (subject.practicals ?? 0) >= 2
                ? Math.floor((subject.practicals ?? 0) / 2)
                : (subject.practicals ?? 0);
            for (let p = 0; p < practicalCount; p++) {
                const dur = Math.ceil((subject.practical_duration ?? 120) / 60);
                sessions.push({
                    id: sessionId++,
                    subjectId: subject.id,
                    subjectCode: subject.code,
                    groupId: group.id,
                    professorId,
                    duration: dur,
                    slotType: 'Practical',
                    homeRoomIndex,
                    isElective,
                    electiveSlotIndex: isElective ? p : -1,
                    basketName: isElective ? (subject.elective_basket ?? null) : null,
                    isWMCGroup,
                    lecturePairIndex: -2, // not applicable
                });
            }
        }
    }

    return {
        sessions,
        rooms: rooms.map(r => ({ id: r.id, name: r.name, roomType: r.room_type })),
        numDays: NUM_DAYS,
        numBuckets: SLOTS_PER_DAY,
        config: { ...DEFAULT_SOLVER_CONFIG },
    };
}


// ─── Extended Subject type (with L-T-P fields from DB) ─────────────────────────
// The hook's Subject type is updated to include these fields.

// ─── Seed Solution from Existing Timetable ─────────────────────────────────────

/**
 * A raw timetable slot row fetched from the DB.
 */
export interface TimetableSlotRow {
    subject_id: string;
    student_group_id: string;
    room_id: string | null;
    day_of_week: number;
    start_time: string;       // e.g. "09:00"
    end_time: string;
    slot_type: string;        // "Lecture" | "Tutorial" | "Practical"
}

/**
 * Build a seed solution from existing timetable slots.
 *
 * Matches each solver ClassSession to a DB slot by (subjectId, groupId, slotType).
 * When multiple slots match (e.g., 3 lectures for the same subject+group),
 * they are consumed in order so each session gets a unique slot.
 *
 * Unmatched sessions fall back to the smart random initial placement.
 */
export function buildSeedSolution(
    input: SolverInput,
    existingSlots: TimetableSlotRow[],
): Solution {
    const { sessions, rooms } = input;

    // Build roomId → roomIndex map
    const roomIdToIndex = new Map<string, number>();
    rooms.forEach((r, i) => roomIdToIndex.set(r.id, i));

    // Group existing slots by (subjectId, groupId, slotType) → queue of slots
    const slotQueues = new Map<string, TimetableSlotRow[]>();
    for (const slot of existingSlots) {
        const key = `${slot.subject_id}|${slot.student_group_id}|${slot.slot_type}`;
        if (!slotQueues.has(key)) slotQueues.set(key, []);
        slotQueues.get(key)!.push(slot);
    }

    // First, generate a full random initial solution as fallback
    const fallback = generateInitialSolution(input);

    // Then, overwrite matched sessions with DB data
    const solution: Solution = fallback.map((gene, i) => {
        const session = sessions[i];
        const key = `${session.subjectId}|${session.groupId}|${session.slotType}`;
        const queue = slotQueues.get(key);

        if (queue && queue.length > 0) {
            const slot = queue.shift()!; // consume one slot from the queue
            const startBucket = timeToSlot(slot.start_time);
            const roomIndex = slot.room_id ? (roomIdToIndex.get(slot.room_id) ?? gene.roomIndex) : gene.roomIndex;

            return {
                day: slot.day_of_week,
                startBucket,
                roomIndex,
            } as Gene;
        }

        // No matching slot found — use random fallback
        return gene;
    });

    return solution;
}

// ─── Locked Sessions from Published Timetables ─────────────────────────────────

/**
 * A published timetable slot row with extra subject info for building sessions.
 */
export interface PublishedSlotRow {
    subject_id: string;
    student_group_id: string;
    professor_id: string | null;
    room_id: string | null;
    day_of_week: number;
    start_time: string;       // "09:50"
    end_time: string;         // "10:50"
    slot_type: string;        // "Lecture" | "Tutorial" | "Practical"
    subject_code: string;
    subject_type: string;     // "Core" | "Elective" | "Minor"
    group_name: string;
}

export interface LockedSessionResult {
    /** Locked ClassSession entries (isLocked=true) to append to SolverInput.sessions */
    sessions: ClassSession[];
    /** Corresponding fixed Gene positions (same index as sessions) */
    genes: Gene[];
}

/**
 * Build locked sessions + fixed genes from published timetable slots.
 *
 * These represent the "background" constraints from already-published
 * timetables. The solver will include them in constraint evaluation
 * (room/professor overlaps) but will never mutate them.
 *
 * @param publishedSlots  All slots from published timetables (other semesters)
 * @param rooms           Room list (same as solver's rooms array)
 * @param startId         Starting session id (should be after the normal sessions)
 */
export function buildLockedSessions(
    publishedSlots: PublishedSlotRow[],
    rooms: { id: string; name: string; roomType: string }[],
    startId: number,
): LockedSessionResult {
    const roomIdToIndex = new Map<string, number>();
    rooms.forEach((r, i) => roomIdToIndex.set(r.id, i));

    const sessions: ClassSession[] = [];
    const genes: Gene[] = [];

    for (const slot of publishedSlots) {
        const startBucket = timeToSlot(slot.start_time);
        const endBucket = timeToSlot(slot.end_time);
        // Duration: difference in bucket numbers (at least 1)
        const duration = Math.max(1, endBucket - startBucket + 1);
        const roomIndex = slot.room_id ? (roomIdToIndex.get(slot.room_id) ?? 0) : 0;
        const isElective = slot.subject_type === 'Elective' || slot.subject_type === 'Minor';

        sessions.push({
            id: startId + sessions.length,
            subjectId: slot.subject_id,
            subjectCode: slot.subject_code,
            groupId: slot.student_group_id,
            professorId: slot.professor_id ?? '',
            duration,
            slotType: slot.slot_type as 'Lecture' | 'Tutorial' | 'Practical',
            homeRoomIndex: roomIndex,
            isElective,
            electiveSlotIndex: -1,
            basketName: null, // locked sessions don't participate in basket constraints
            isWMCGroup: slot.group_name === 'WMC' || /IT[\s-]*BI/i.test(slot.group_name ?? ''),
            isLocked: true,
            lecturePairIndex: -2, // locked sessions are not subject to 2+1 format
        });

        genes.push({
            day: slot.day_of_week,
            startBucket,
            roomIndex,
        });
    }

    return { sessions, genes };
}
