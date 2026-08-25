import type { ClassSession, Gene, Solution, SolverInput } from './types';
import { SLOTS_PER_DAY, BREAK_AFTER_SLOTS, LUNCH_AFTER_SLOT, isSyncedBasket, SLOT_START_TIMES, SLOT_END_TIMES } from './constants';

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

// ─── Helpers ────────────────────────────────────────────────────────────────────
export function slotTime(bucket: number): string { return SLOT_START_TIMES[bucket - 1] ?? `slot${bucket}`; }
export function slotEndTime(bucket: number): string { return SLOT_END_TIMES[bucket - 1] ?? `slot${bucket}`; }
export function dayName(day: number): string { return DAY_NAMES[day - 1] ?? `Day${day}`; }
export function sessionLabel(s: ClassSession): string { return `[#${s.id}] ${s.subjectCode} (${s.slotType}${s.duration > 1 ? ` x${s.duration}hr` : ''})${s.isLocked ? ' [LOCKED]' : ''}`; }
export function geneLabel(g: Gene, s: ClassSession, rooms: SolverInput['rooms']): string {
    const room = g.roomIndex >= 0 ? rooms[g.roomIndex] : undefined;
    const endBucket = g.startBucket + s.duration - 1;
    return `${dayName(g.day)} ${slotTime(g.startBucket)}-${slotEndTime(endBucket)} @ ${room?.name ?? (g.roomIndex < 0 ? 'External' : `Room#${g.roomIndex}`)}`;
}

// ─── Occupancy Map Helper ────────────────────────────────────────────────────────
function buildOccupancyMap(
    sessions: ClassSession[],
    solution: Solution,
    keyFn: (session: ClassSession, gene: Gene) => string,
): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        const gene = solution[i];
        const key = keyFn(sessions[i], gene);
        if (!key) continue;
        const start = gene.startBucket;
        const end = start + sessions[i].duration - 1;
        for (let s = start; s <= end; s++) {
            const slot = `${key}|${gene.day}|${s}`;
            const arr = map.get(slot);
            if (arr) arr.push(i);
            else map.set(slot, [i]);
        }
    }
    return map;
}

// ─── Detectors ────────────────────────────────────────────────────────
export function checkTimeBoundaryViolations(sessions: ClassSession[], solution: Solution, log?: string[]): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked) continue;
        const endSlot = solution[i].startBucket + sessions[i].duration - 1;
        if (endSlot > SLOTS_PER_DAY) {
            violations++;
            if (log) log.push(`  [X] ${sessionLabel(sessions[i])} ends at slot ${endSlot} (> ${SLOTS_PER_DAY}) -- exceeds day boundary`);
        }
    }
    return violations;
}

export function checkBreakViolations(sessions: ClassSession[], solution: Solution, log?: string[]): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        if (session.isLocked || session.duration <= 1) continue;

        const start = solution[i].startBucket;
        for (let s = start; s < start + session.duration - 1; s++) {
            if (BREAK_AFTER_SLOTS.includes(s)) {
                violations++;
                if (log) {
                    const breakType = s === 2 ? 'morning break (10:50-11:00)' : 'lunch break (13:00-14:30)';
                    log.push(`  [X] ${sessionLabel(session)} spans slots ${start}->${start + session.duration - 1}, crosses ${breakType}`);
                }
                break;
            }
        }
    }
    return violations;
}

export function checkRoomOverlaps(sessions: ClassSession[], solution: Solution, rooms: SolverInput['rooms'], log?: string[]): number {
    const map = buildOccupancyMap(sessions, solution, (_s, g) => g.roomIndex < 0 ? '' : (rooms[g.roomIndex]?.name ?? String(g.roomIndex)));
    let violations = 0;
    for (const [key, arr] of map.entries()) {
        if (arr.length > 1) {
            let lockedCount = 0;
            for (const idx of arr) if (sessions[idx].isLocked) lockedCount++;
            const baseline = lockedCount > 1 ? lockedCount - 1 : 0;
            const count = (arr.length - 1) - baseline;
            if (count > 0) {
                violations += count;
                if (log) {
                    const [roomName, dayStr, slotStr] = key.split('|');
                    const labels = arr.map(i => sessionLabel(sessions[i])).join(' vs ');
                    log.push(`  [X] Room "${roomName}" on ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): ${labels}`);
                }
            }
        }
    }
    return violations;
}

export function checkProfessorOverlaps(sessions: ClassSession[], solution: Solution, log?: string[]): number {
    const map = buildOccupancyMap(sessions, solution, (s) => s.professorId ? `P_${s.professorId}` : `P__EMPTY_${s.id}`);
    let violations = 0;
    for (const [key, arr] of map.entries()) {
        if (key.startsWith('P__EMPTY_')) continue;
        if (arr.length > 1) {
            let pairViolations = 0;
            for (let i = 0; i < arr.length - 1; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const sA = sessions[arr[i]];
                    const sB = sessions[arr[j]];
                    if (sA.isLocked && sB.isLocked) continue;
                    pairViolations++;
                }
            }
            if (pairViolations > 0) {
                violations += pairViolations;
                if (log) {
                    const [profIdStr, dayStr, slotStr] = key.split('|');
                    const profId = profIdStr.substring(2);
                    const labels = arr.map(i => sessionLabel(sessions[i])).join(' vs ');
                    log.push(`  [X] Professor "${profId}" on ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): ${labels}`);
                }
            }
        }
    }
    return violations;
}

export function checkGroupOverlaps(sessions: ClassSession[], solution: Solution, log?: string[]): number {
    const map = buildOccupancyMap(sessions, solution, (s) => `G_${s.groupId}`);
    let violations = 0;
    for (const [key, arr] of map.entries()) {
        if (arr.length <= 1) continue;
        let pairViolations = 0;
        for (let i = 0; i < arr.length - 1; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const sA = sessions[arr[i]];
                const sB = sessions[arr[j]];
                if (sA.isLocked || sB.isLocked) continue;
                if (sA.basketName && sA.basketName === sB.basketName) continue;
                if (sA.isElective && sB.isElective) continue;
                pairViolations++;
            }
        }
        if (pairViolations > 0) {
            violations += pairViolations;
            if (log) {
                const [groupIdStr, dayStr, slotStr] = key.split('|');
                const groupId = groupIdStr.substring(2);
                const labels = arr.map(i => sessionLabel(sessions[i])).join(' vs ');
                log.push(`  [X] Group "${groupId}" on ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): ${labels}`);
            }
        }
    }
    return violations;
}

export function checkElectiveSyncViolations(sessions: ClassSession[], solution: Solution, log?: string[]): number {
    const basketGroups = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s.isLocked || !s.isElective || !s.basketName || s.electiveSlotIndex < 0) continue;
        const groupKey = `${s.basketName}|${s.slotType}|${s.electiveSlotIndex}`;
        const arr = basketGroups.get(groupKey) ?? [];
        arr.push(i);
        basketGroups.set(groupKey, arr);
    }
    let violations = 0;
    for (const [groupKey, indices] of basketGroups.entries()) {
        const basketName = groupKey.split('|')[0];
        if (!isSyncedBasket(basketName)) continue;
        if (indices.length <= 1) continue;
        const refDay = solution[indices[0]].day;
        const refStart = solution[indices[0]].startBucket;
        for (let k = 1; k < indices.length; k++) {
            const g = solution[indices[k]];
            if (g.day !== refDay || g.startBucket !== refStart) {
                violations++;
                if (log) {
                    log.push(`  [X] Synced basket "${basketName}": ${sessionLabel(sessions[indices[k]])} at ${dayName(g.day)} ${slotTime(g.startBucket)} != reference ${dayName(refDay)} ${slotTime(refStart)}`);
                }
            }
        }
    }
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
    for (const [slotKey, baskets] of slotToBaskets.entries()) {
        if (baskets.size > 1) {
            violations += baskets.size - 1;
            if (log) {
                const [dayStr, bucketStr] = slotKey.split(':');
                const basketNames = [...baskets];
                log.push(`  [X] Cross-basket clash on ${dayName(+dayStr)} ${slotTime(+bucketStr)}: baskets [${basketNames.join(', ')}] overlap`);
            }
        }
    }
    return violations;
}

export function checkLabRoomViolations(sessions: ClassSession[], solution: Solution, rooms: SolverInput['rooms'], log?: string[]): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked || sessions[i].slotType !== 'Practical') continue;
        const room = rooms[solution[i].roomIndex];
        if (!room || room.roomType !== 'Lab') {
            violations++;
            if (log) log.push(`  [X] ${sessionLabel(sessions[i])}: practical in "${room?.name ?? '??'}" (type: ${room?.roomType ?? 'unknown'}) -- needs Lab`);
        }
    }
    return violations;
}

export function checkWMCSectionOverlaps(sessions: ClassSession[], solution: Solution, log?: string[]): number {
    const slotMap = new Map<string, { wmc: number[]; section: number[] }>();
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked) continue;
        const gene = solution[i];
        const end = gene.startBucket + sessions[i].duration - 1;
        for (let s = gene.startBucket; s <= end; s++) {
            const key = `${gene.day}|${s}`;
            let entry = slotMap.get(key);
            if (!entry) { entry = { wmc: [], section: [] }; slotMap.set(key, entry); }
            if (sessions[i].isWMCGroup) entry.wmc.push(i);
            else entry.section.push(i);
        }
    }
    let violations = 0;
    for (const [key, { wmc, section }] of slotMap.entries()) {
        if (wmc.length > 0 && section.length > 0) {
            let clashCount = 0;
            for (const sIdx of section) {
                const sSession = sessions[sIdx];
                for (const wIdx of wmc) {
                    const wSession = sessions[wIdx];
                    if (sSession.isElective && wSession.isElective) continue;
                    clashCount++;
                }
            }
            if (clashCount > 0) {
                violations += clashCount;
                if (log) {
                    const [dayStr, slotStr] = key.split('|');
                    const wLabels = wmc.map(i => sessionLabel(sessions[i])).join(', ');
                    const sLabels = section.map(i => sessionLabel(sessions[i])).join(', ');
                    log.push(`  [X] ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): WMC {${wLabels}} vs Section {${sLabels}}`);
                }
            }
        }
    }
    return violations;
}

export function checkHomeRoomViolations(sessions: ClassSession[], solution: Solution, rooms: SolverInput['rooms'], log?: string[]): number {
    let violations = 0;
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked || sessions[i].slotType === 'Practical' || sessions[i].isElective) continue;
        if (solution[i].roomIndex !== sessions[i].homeRoomIndex) {
            violations++;
            if (log) {
                const assigned = rooms[solution[i].roomIndex]?.name ?? `Room#${solution[i].roomIndex}`;
                const home = rooms[sessions[i].homeRoomIndex]?.name ?? `Room#${sessions[i].homeRoomIndex}`;
                log.push(`  [X] ${sessionLabel(sessions[i])}: placed in "${assigned}" but home room is "${home}"`);
            }
        }
    }
    return violations;
}

export function checkTwoOneLectureViolations(sessions: ClassSession[], solution: Solution, log?: string[]): number {
    const groupMap = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s.isLocked || s.slotType !== 'Lecture' || s.lecturePairIndex === -2) continue;
        const key = `${s.subjectId}|${s.groupId}`;
        const arr = groupMap.get(key) ?? [];
        arr.push(i);
        groupMap.set(key, arr);
    }
    let violations = 0;
    for (const indices of groupMap.values()) {
        if (indices.length <= 1) continue;
        const dayCount = new Map<number, number[]>();
        for (const idx of indices) {
            const d = solution[idx].day;
            const arr = dayCount.get(d) ?? [];
            arr.push(idx);
            dayCount.set(d, arr);
        }
        for (const [day, arr] of dayCount.entries()) {
            if (arr.length > 1) {
                violations += arr.length - 1;
                if (log) {
                    const labels = arr.map(i => sessionLabel(sessions[i])).join(' vs ');
                    log.push(`  [X] Two/One Lecture Clash: ${dayName(day)} has multiple lectures for same subject/group: ${labels}`);
                }
            }
        }
    }
    return violations;
}

// ─── Soft Constraints ────────────────────────────────────────────────────────

export function computeGapPenalty(sessions: ClassSession[], solution: Solution, numDays: number): number {
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
        for (let s = gene.startBucket; s <= end; s++) slotSet.add(s);
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

export function computeRoomUtilizationPenalty(sessions: ClassSession[], solution: Solution, rooms: SolverInput['rooms'], minThreshold: number, maxThreshold: number): number {
    let totalPenalty = 0;
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].isLocked) continue;
        if (sessions[i].slotType !== 'Practical' && !sessions[i].isElective) continue;
        const room = rooms[solution[i].roomIndex];
        if (!room || room.capacity <= 0) continue;
        const utilization = sessions[i].studentCount / room.capacity;
        if (utilization < minThreshold) {
            totalPenalty += (minThreshold - utilization);
        } else if (utilization > maxThreshold) {
            totalPenalty += (utilization - maxThreshold);
        }
    }
    return Math.round(totalPenalty * 100);
}

export function computeProfessorSameHalfPenalty(sessions: ClassSession[], solution: Solution, numDays: number): number {
    const profDayHalf = new Map<string, Map<number, { morning: boolean; afternoon: boolean; hasMovable: boolean }>>();
    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (!s.professorId) continue;
        const gene = solution[i];
        const endSlot = gene.startBucket + s.duration - 1;
        let dayMap = profDayHalf.get(s.professorId);
        if (!dayMap) { dayMap = new Map(); profDayHalf.set(s.professorId, dayMap); }
        let entry = dayMap.get(gene.day);
        if (!entry) { entry = { morning: false, afternoon: false, hasMovable: false }; dayMap.set(gene.day, entry); }
        if (gene.startBucket <= LUNCH_AFTER_SLOT) entry.morning = true;
        if (endSlot > LUNCH_AFTER_SLOT) entry.afternoon = true;
        if (!s.isLocked) entry.hasMovable = true;
    }
    let penalty = 0;
    for (const dayMap of profDayHalf.values()) {
        for (let d = 1; d <= numDays; d++) {
            const entry = dayMap.get(d);
            if (entry && entry.morning && entry.afternoon && entry.hasMovable) penalty++;
        }
    }
    return penalty;
}
