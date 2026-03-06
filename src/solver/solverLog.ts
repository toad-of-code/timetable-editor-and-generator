import type { SolverInput, SolverResult, ClassSession, Gene } from './types';
import { SLOT_START_TIMES, SLOT_END_TIMES } from './constants';

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function slotTime(bucket: number): string {
    return SLOT_START_TIMES[bucket - 1] ?? `slot${bucket}`;
}

function slotEndTime(bucket: number): string {
    return SLOT_END_TIMES[bucket - 1] ?? `slot${bucket}`;
}

function dayName(day: number): string {
    return DAY_NAMES[day - 1] ?? `Day${day}`;
}

function sessionLabel(s: ClassSession): string {
    return `[#${s.id}] ${s.subjectCode} (${s.slotType}${s.duration > 1 ? ` ×${s.duration}hr` : ''})${s.isLocked ? ' 🔒' : ''}`;
}

function geneLabel(g: Gene, s: ClassSession, rooms: SolverInput['rooms']): string {
    const room = rooms[g.roomIndex];
    const endBucket = g.startBucket + s.duration - 1;
    return `${dayName(g.day)} ${slotTime(g.startBucket)}-${slotEndTime(endBucket)} @ ${room?.name ?? `Room#${g.roomIndex}`}`;
}

// ─── Violation Detail Builders ──────────────────────────────────────────────────

function findTimeBoundaryViolations(sessions: ClassSession[], solution: Gene[]): string[] {
    const lines: string[] = [];
    for (let i = 0; i < sessions.length; i++) {
        const endSlot = solution[i].startBucket + sessions[i].duration - 1;
        if (endSlot > 8) {
            lines.push(`  ⛔ ${sessionLabel(sessions[i])} ends at slot ${endSlot} (> 8) — exceeds day boundary`);
        }
    }
    return lines;
}

function findBreakViolations(sessions: ClassSession[], solution: Gene[]): string[] {
    const BREAK_AFTER = [2, 4];
    const lines: string[] = [];
    for (let i = 0; i < sessions.length; i++) {
        const start = solution[i].startBucket;
        const dur = sessions[i].duration;
        if (dur <= 1) continue;
        for (let s = start; s < start + dur - 1; s++) {
            if (BREAK_AFTER.includes(s)) {
                const breakType = s === 2 ? 'morning break (10:50-11:00)' : 'lunch break (13:00-14:30)';
                lines.push(`  ⛔ ${sessionLabel(sessions[i])} spans slots ${start}→${start + dur - 1}, crosses ${breakType}`);
                break;
            }
        }
    }
    return lines;
}

function findRoomOverlaps(sessions: ClassSession[], solution: Gene[], rooms: SolverInput['rooms']): string[] {
    const lines: string[] = [];
    const map = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        const g = solution[i];
        const room = rooms[g.roomIndex];
        for (let s = g.startBucket; s < g.startBucket + sessions[i].duration; s++) {
            const key = `${room?.name ?? g.roomIndex}|${g.day}|${s}`;
            const arr = map.get(key) ?? [];
            arr.push(i);
            map.set(key, arr);
        }
    }
    for (const [key, indices] of map.entries()) {
        if (indices.length <= 1) continue;

        let lockedCount = 0;
        for (const idx of indices) {
            if (sessions[idx].isLocked) lockedCount++;
        }
        if (lockedCount === indices.length) continue; // ignore purely pre-existing

        const [roomName, dayStr, slotStr] = key.split('|');
        const labels = indices.map(i => sessionLabel(sessions[i])).join(' vs ');
        lines.push(`  ⛔ Room "${roomName}" on ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): ${labels}`);
    }
    return lines;
}

function findProfessorOverlaps(sessions: ClassSession[], solution: Gene[]): string[] {
    const lines: string[] = [];
    const map = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        if (!sessions[i].professorId) continue;
        const g = solution[i];
        for (let s = g.startBucket; s < g.startBucket + sessions[i].duration; s++) {
            const key = `${sessions[i].professorId}|${g.day}|${s}`;
            const arr = map.get(key) ?? [];
            arr.push(i);
            map.set(key, arr);
        }
    }
    for (const [key, indices] of map.entries()) {
        if (indices.length <= 1) continue;

        let lockedCount = 0;
        for (const idx of indices) {
            if (sessions[idx].isLocked) lockedCount++;
        }
        if (lockedCount === indices.length) continue; // ignore purely pre-existing

        const [profId, dayStr, slotStr] = key.split('|');
        const labels = indices.map(i => sessionLabel(sessions[i])).join(' vs ');
        lines.push(`  ⛔ Professor "${profId}" on ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): ${labels}`);
    }
    return lines;
}

function findGroupOverlaps(sessions: ClassSession[], solution: Gene[]): string[] {
    const lines: string[] = [];
    const map = new Map<string, number[]>();
    for (let i = 0; i < sessions.length; i++) {
        const g = solution[i];
        for (let s = g.startBucket; s < g.startBucket + sessions[i].duration; s++) {
            const key = `${sessions[i].groupId}|${g.day}|${s}`;
            const arr = map.get(key) ?? [];
            arr.push(i);
            map.set(key, arr);
        }
    }
    for (const [key, indices] of map.entries()) {
        if (indices.length <= 1) continue;
        // Check if all are elective (concurrent OK) or all are locked (pre-existing OK)
        let nonElectiveCount = 0;
        let lockedCount = 0;
        for (const idx of indices) {
            if (!sessions[idx].isElective) nonElectiveCount++;
            if (sessions[idx].isLocked) lockedCount++;
        }
        if (nonElectiveCount === 0) continue; // all elective = concurrent, OK
        if (lockedCount === indices.length) continue; // all locked = pre-existing, ignore

        const [groupId, dayStr, slotStr] = key.split('|');
        const labels = indices.map(i => sessionLabel(sessions[i])).join(' vs ');
        lines.push(`  Group "${groupId}" on ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): ${labels}`);
    }
    return lines;
}

function findWMCSectionOverlaps(sessions: ClassSession[], solution: Gene[]): string[] {
    const lines: string[] = [];
    const slotMap = new Map<string, { wmcSessions: number[]; sectionSessions: number[] }>();
    for (let i = 0; i < sessions.length; i++) {
        const g = solution[i];
        for (let s = g.startBucket; s < g.startBucket + sessions[i].duration; s++) {
            const key = `${g.day}|${s}`;
            let entry = slotMap.get(key);
            if (!entry) { entry = { wmcSessions: [], sectionSessions: [] }; slotMap.set(key, entry); }
            if (sessions[i].isWMCGroup) entry.wmcSessions.push(i);
            else entry.sectionSessions.push(i);
        }
    }
    for (const [key, { wmcSessions, sectionSessions }] of slotMap.entries()) {
        if (wmcSessions.length > 0 && sectionSessions.length > 0) {
            const allSessions = [...wmcSessions, ...sectionSessions];
            let lockedCount = 0;
            for (const idx of allSessions) {
                if (sessions[idx].isLocked) lockedCount++;
            }
            if (lockedCount === allSessions.length) continue; // ignore purely pre-existing

            const [dayStr, slotStr] = key.split('|');
            const wLabels = wmcSessions.map(i => sessionLabel(sessions[i])).join(', ');
            const sLabels = sectionSessions.map(i => sessionLabel(sessions[i])).join(', ');
            lines.push(`  ⛔ ${dayName(+dayStr)} slot ${slotStr} (${slotTime(+slotStr)}): WMC {${wLabels}} vs Section {${sLabels}}`);
        }
    }
    return lines;
}

function findHomeRoomViolations(sessions: ClassSession[], solution: Gene[], rooms: SolverInput['rooms']): string[] {
    const lines: string[] = [];
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].slotType === 'Practical') continue;
        if (sessions[i].isElective) continue;
        if (solution[i].roomIndex !== sessions[i].homeRoomIndex) {
            const assigned = rooms[solution[i].roomIndex]?.name ?? `Room#${solution[i].roomIndex}`;
            const home = rooms[sessions[i].homeRoomIndex]?.name ?? `Room#${sessions[i].homeRoomIndex}`;
            lines.push(`  ⛔ ${sessionLabel(sessions[i])}: placed in "${assigned}" but home room is "${home}"`);
        }
    }
    return lines;
}

function findLabRoomViolations(sessions: ClassSession[], solution: Gene[], rooms: SolverInput['rooms']): string[] {
    const lines: string[] = [];
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].slotType !== 'Practical') continue;
        const room = rooms[solution[i].roomIndex];
        if (!room || room.roomType !== 'Lab') {
            lines.push(`  ⛔ ${sessionLabel(sessions[i])}: practical in "${room?.name ?? '??'}" (type: ${room?.roomType ?? 'unknown'}) — needs Lab`);
        }
    }
    return lines;
}

// ─── Main Log Generator ────────────────────────────────────────────────────────

export function generateSolverLog(
    input: SolverInput,
    result: SolverResult,
    clusterName: string,
): string {
    const { sessions, rooms } = input;
    const { solution, fitness } = result;
    const lines: string[] = [];
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    // ─── Header ──
    lines.push('═'.repeat(80));
    lines.push(`  TIMETABLE SOLVER LOG — ${clusterName}`);
    lines.push(`  Generated: ${new Date().toLocaleString()}`);
    lines.push('═'.repeat(80));
    lines.push('');

    // ─── 1. Input Summary ──
    lines.push('┌─── INPUT SUMMARY ─────────────────────────────────────────────┐');
    const normalSessions = sessions.filter(s => !s.isLocked);
    const lockedSessions = sessions.filter(s => s.isLocked);
    lines.push(`│  Total sessions to schedule : ${normalSessions.length}`);
    lines.push(`│  Locked (published) sessions: ${lockedSessions.length}`);
    lines.push(`│  Available rooms            : ${rooms.length}`);
    lines.push(`│  Days × Slots              : ${input.numDays} × ${input.numBuckets}`);
    lines.push('│');

    // Group counts
    const groupIds = new Set(normalSessions.map(s => s.groupId));
    const subjectCodes = new Set(normalSessions.map(s => s.subjectCode));
    const electiveCount = normalSessions.filter(s => s.isElective).length;
    lines.push(`│  Unique groups             : ${groupIds.size}`);
    lines.push(`│  Unique subjects           : ${subjectCodes.size}`);
    lines.push(`│  Elective/Minor sessions   : ${electiveCount}`);
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 2. Session List ──
    lines.push('┌─── ALL SESSIONS ──────────────────────────────────────────────┐');
    for (const s of sessions) {
        const g = solution[s.id];
        const placement = g ? geneLabel(g, s, rooms) : 'NOT PLACED';
        const flags = [
            s.isElective ? 'ELECTIVE' : '',
            s.isWMCGroup ? 'WMC' : '',
            s.isLocked ? 'LOCKED' : '',
        ].filter(Boolean).join(' | ');
        lines.push(`│  ${sessionLabel(s).padEnd(40)} → ${placement}${flags ? `  [${flags}]` : ''}`);
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 3. Solver Performance ──
    lines.push('┌─── SOLVER PERFORMANCE ────────────────────────────────────────┐');
    lines.push(`│  Algorithm          : (1+1) Evolution Strategy`);
    lines.push(`│  Max generations    : ${input.config.maxGenerations.toLocaleString()}`);
    lines.push(`│  Generations run    : ${result.totalGenerations.toLocaleString()}`);
    lines.push(`│  Best at generation : ${result.bestGeneration.toLocaleString()}`);
    lines.push(`│  Elapsed time       : ${(result.elapsedMs / 1000).toFixed(2)}s`);
    lines.push(`│  Cancelled          : ${result.cancelled ? 'Yes' : 'No'}`);
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 4. Fitness Summary ──
    lines.push('┌─── FITNESS RESULT ────────────────────────────────────────────┐');
    lines.push(`│  Total fitness      : ${fitness.total}`);
    lines.push(`│  Hard violations    : ${fitness.hardViolations}`);
    lines.push(`│  Gap penalty (soft) : ${fitness.gapPenalty}`);
    lines.push(`│  FEASIBLE           : ${fitness.hardViolations === 0 ? '✅ YES' : '❌ NO'}`);
    lines.push('│');
    if (fitness.violationBreakdown) {
        const vb = fitness.violationBreakdown;
        lines.push('│  Violation Breakdown:');
        lines.push(`│    Time Boundary      : ${vb.timeBoundary}`);
        lines.push(`│    Break/Lunch Cross  : ${vb.breakCrossing}`);
        lines.push(`│    Room Overlap       : ${vb.roomOverlap}`);
        lines.push(`│    Professor Overlap  : ${vb.professorOverlap}`);
        lines.push(`│    Group Overlap      : ${vb.groupOverlap}`);
        lines.push(`│    Elective Sync      : ${vb.electiveSync}`);
        lines.push(`│    Lab Room           : ${vb.labRoom}`);
        lines.push(`│    WMC-Section Overlap: ${vb.wmcSectionOverlap}`);
        lines.push(`│    Home Room          : ${vb.homeRoom}`);
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 5. Detailed Violation Report ──
    if (fitness.hardViolations > 0) {
        lines.push('╔══════════════════════════════════════════════════════════════╗');
        lines.push('║  DETAILED VIOLATION REPORT                                  ║');
        lines.push('║  Each violation below explains WHY and WHERE it occurs.     ║');
        lines.push('╚══════════════════════════════════════════════════════════════╝');
        lines.push('');

        const vb = fitness.violationBreakdown!;

        if (vb.timeBoundary > 0) {
            lines.push('── Time Boundary Violations ──────────────────────────────────');
            lines.push('   WHY: A session extends beyond slot 8 (18:30). The day only has 8 slots.');
            findTimeBoundaryViolations(sessions, solution).forEach(l => lines.push(l));
            lines.push('');
        }

        if (vb.breakCrossing > 0) {
            lines.push('── Break/Lunch Crossing Violations ──────────────────────────');
            lines.push('   WHY: A multi-slot session spans across a break (10:50-11:00) or lunch (13:00-14:30).');
            findBreakViolations(sessions, solution).forEach(l => lines.push(l));
            lines.push('');
        }

        if (vb.roomOverlap > 0) {
            lines.push('── Room Overlap Violations ──────────────────────────────────');
            lines.push('   WHY: Two or more sessions are assigned to the same room at the same time.');
            findRoomOverlaps(sessions, solution, rooms).forEach(l => lines.push(l));
            lines.push('');
        }

        if (vb.professorOverlap > 0) {
            lines.push('── Professor Overlap Violations ─────────────────────────────');
            lines.push('   WHY: A professor is scheduled to teach two sessions at the same time.');
            findProfessorOverlaps(sessions, solution).forEach(l => lines.push(l));
            lines.push('');
        }

        if (vb.groupOverlap > 0) {
            lines.push('── Group (Section) Overlap Violations ───────────────────────');
            lines.push('   WHY: A student group has two non-elective sessions at the same time.');
            findGroupOverlaps(sessions, solution).forEach(l => lines.push(l));
            lines.push('');
        }

        if (vb.wmcSectionOverlap > 0) {
            lines.push('── WMC–Section Overlap Violations ───────────────────────────');
            lines.push('   WHY: A whole-batch (WMC/IT-BI) session collides with a section-level session.');
            lines.push('   All students must attend WMC, so no section class can run concurrently.');
            findWMCSectionOverlaps(sessions, solution).forEach(l => lines.push(l));
            lines.push('');
        }

        if (vb.labRoom > 0) {
            lines.push('── Lab Room Violations ──────────────────────────────────────');
            lines.push('   WHY: A Practical session is placed in a non-Lab room.');
            findLabRoomViolations(sessions, solution, rooms).forEach(l => lines.push(l));
            lines.push('');
        }

        if (vb.homeRoom > 0) {
            lines.push('── Home Room Violations ─────────────────────────────────────');
            lines.push('   WHY: A Lecture/Tutorial is not in its assigned home room.');
            findHomeRoomViolations(sessions, solution, rooms).forEach(l => lines.push(l));
            lines.push('');
        }
    } else {
        lines.push('✅ NO VIOLATIONS — Timetable is fully feasible!');
        lines.push('');
    }

    // ─── 6. Day-by-Day Schedule ──
    lines.push('┌─── DAY-BY-DAY SCHEDULE ───────────────────────────────────────┐');
    for (let d = 1; d <= 5; d++) {
        lines.push(`│`);
        lines.push(`│  ── ${dayName(d)} ${'─'.repeat(50)}`);
        const daySessions = sessions
            .map((s, i) => ({ session: s, gene: solution[i] }))
            .filter(({ gene }) => gene.day === d)
            .sort((a, b) => a.gene.startBucket - b.gene.startBucket);

        if (daySessions.length === 0) {
            lines.push(`│     (no sessions)`);
        } else {
            for (const { session, gene } of daySessions) {
                const room = rooms[gene.roomIndex];
                const endBucket = gene.startBucket + session.duration - 1;
                const time = `${slotTime(gene.startBucket)}-${slotEndTime(endBucket)}`;
                const flags = [session.isLocked ? '🔒' : '', session.isElective ? '📚' : ''].filter(Boolean).join(' ');
                lines.push(`│     ${time.padEnd(12)} ${session.subjectCode.padEnd(12)} ${session.slotType.charAt(0)} ${(room?.name ?? '??').padEnd(10)} ${flags}`);
            }
        }
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    lines.push('═'.repeat(80));
    lines.push(`  END OF LOG — ${ts}`);
    lines.push('═'.repeat(80));

    return lines.join('\n');
}

// ─── File Download Trigger ──────────────────────────────────────────────────────

export function downloadLogFile(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
