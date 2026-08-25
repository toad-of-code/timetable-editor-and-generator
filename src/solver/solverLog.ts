import type { SolverInput, SolverResult, Gene, FitnessResult } from './types';

import type { EditorSlot } from './localSearch';
import {
    checkTimeBoundaryViolations,
    checkBreakViolations,
    checkRoomOverlaps,
    checkProfessorOverlaps,
    checkGroupOverlaps,
    checkElectiveSyncViolations,
    checkLabRoomViolations,
    checkWMCSectionOverlaps,
    checkHomeRoomViolations,
    checkTwoOneLectureViolations,
    dayName,
    slotTime,
    slotEndTime,
    sessionLabel,
    geneLabel
} from './conflictDetectors';

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
        
        let utilStr = '';
        if (g) {
            const room = rooms[g.roomIndex];
            if (room && room.capacity > 0) {
                const util = Math.round((s.studentCount / room.capacity) * 100);
                utilStr = ` | Util: ${util}%`;
            }
        }
        
        const flags = [
            s.isElective ? 'ELECTIVE' : '',
            s.isWMCGroup ? 'WMC' : '',
            s.isLocked ? 'LOCKED' : '',
        ].filter(Boolean).join(' | ');
        lines.push(`│  ${sessionLabel(s).padEnd(40)} → ${placement}${flags ? `  [${flags}]` : ''}${utilStr}`);
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
    lines.push(`│  Room util penalty  : ${fitness.roomUtilizationPenalty}`);
    lines.push(`│  Prof same-half     : ${fitness.professorSameHalfPenalty}`);
    lines.push(`│  FEASIBLE           : ${fitness.hardViolations === 0 ? 'YES' : 'NO'}`);
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
        lines.push(`│    Two/One Lecture    : ${vb.twoOneLecture}`);
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
            checkTimeBoundaryViolations(sessions, solution, lines);
            lines.push('');
        }

        if (vb.breakCrossing > 0) {
            lines.push('── Break/Lunch Crossing Violations ──────────────────────────');
            lines.push('   WHY: A multi-slot session spans across a break (10:50-11:00) or lunch (13:00-14:30).');
            checkBreakViolations(sessions, solution, lines);
            lines.push('');
        }

        if (vb.roomOverlap > 0) {
            lines.push('── Room Overlap Violations ──────────────────────────────────');
            lines.push('   WHY: Two or more sessions are assigned to the same room at the same time.');
            checkRoomOverlaps(sessions, solution, rooms, lines);
            lines.push('');
        }

        if (vb.professorOverlap > 0) {
            lines.push('── Professor Overlap Violations ─────────────────────────────');
            lines.push('   WHY: A professor is scheduled to teach two sessions at the same time.');
            checkProfessorOverlaps(sessions, solution, lines);
            lines.push('');
        }

        if (vb.groupOverlap > 0) {
            lines.push('── Group (Section) Overlap Violations ───────────────────────');
            lines.push('   WHY: A student group has two non-elective sessions at the same time.');
            checkGroupOverlaps(sessions, solution, lines);
            lines.push('');
        }

        if (vb.wmcSectionOverlap > 0) {
            lines.push('── WMC–Section Overlap Violations ───────────────────────────');
            lines.push('   WHY: A whole-batch (WMC/IT-BI) session collides with a section-level session.');
            lines.push('   All students must attend WMC, so no section class can run concurrently.');
            checkWMCSectionOverlaps(sessions, solution, lines);
            lines.push('');
        }

        if (vb.labRoom > 0) {
            lines.push('── Lab Room Violations ──────────────────────────────────────');
            lines.push('   WHY: A Practical session is placed in a non-Lab room.');
            checkLabRoomViolations(sessions, solution, rooms, lines);
            lines.push('');
        }

        if (vb.homeRoom > 0) {
            lines.push('── Home Room Violations ─────────────────────────────────────');
            lines.push('   WHY: A Lecture/Tutorial is not in its assigned home room.');
            checkHomeRoomViolations(sessions, solution, rooms, lines);
            lines.push('');
        }

        if (vb.electiveSync > 0) {
            lines.push('── Elective Sync / Cross-Basket Violations ──────────────────');
            lines.push('   WHY: Either a synced basket (HSMC/MDM) has members at different times,');
            lines.push('   or two DIFFERENT baskets have sessions at the same (day, slot).');
            checkElectiveSyncViolations(sessions, solution, lines);
            lines.push('');
        }
        
        if (vb.twoOneLecture > 0) {
            lines.push('── Two/One Lecture Format Violations ────────────────────────');
            lines.push('   WHY: A 2-hour and 1-hour core lecture for the same subject/group are on the same day.');
            checkTwoOneLectureViolations(sessions, solution, lines);
            lines.push('');
        }
    } else {
        lines.push('NO VIOLATIONS -- Timetable is fully feasible!');
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
                const room = gene.roomIndex >= 0 ? rooms[gene.roomIndex] : undefined;
                const endBucket = gene.startBucket + session.duration - 1;
                const time = `${slotTime(gene.startBucket)}-${slotEndTime(endBucket)}`;
                const flags = [session.isLocked ? 'LOCKED' : '', session.isElective ? 'ELEC' : ''].filter(Boolean).join(' ');
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

// ─── Editor Log Generator ───────────────────────────────────────────────────────

interface EditorLogInput {
    sessions: SolverInput['sessions'];
    rooms: SolverInput['rooms'];
    solution: Gene[];
    fitness: FitnessResult;
    timetableName: string;
    slots: EditorSlot[];
    /** Number of normal (non-locked) sessions. Sessions from index 0..normalSessionCount-1 are from this timetable. */
    normalSessionCount?: number;
    /** Names of the locked published timetables included in this evaluation. */
    lockedTimetableNames?: string[];
}

export function generateEditorLog(input: EditorLogInput): string {
    const { sessions, rooms, solution, fitness, timetableName, slots } = input;
    const normalCount = input.normalSessionCount ?? sessions.length;
    const lockedCount = sessions.length - normalCount;
    const lockedNames = input.lockedTimetableNames ?? [];
    const lines: string[] = [];
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    // ─── Header ──
    lines.push('═'.repeat(80));
    lines.push(`  TIMETABLE EDITOR LOG — ${timetableName}`);
    lines.push(`  Saved: ${new Date().toLocaleString()}`);
    lines.push('═'.repeat(80));
    lines.push('');

    // ─── 1. Edit Summary ──
    lines.push('┌─── EDIT SUMMARY ──────────────────────────────────────────────┐');
    lines.push(`│  Timetable           : ${timetableName}`);
    lines.push(`│  Total slots saved   : ${slots.length}`);
    lines.push(`│  Unique sections     : ${new Set(slots.map(s => s.group_name)).size}`);
    lines.push(`│  Unique subjects     : ${new Set(slots.map(s => s.subject_code)).size}`);
    lines.push(`│  Unique professors   : ${new Set(slots.filter(s => s.professor_name && s.professor_name !== 'TBD' && s.professor_name !== 'Unknown').map(s => s.professor_name)).size}`);
    lines.push(`│  Unique rooms used   : ${new Set(slots.filter(s => s.room_name).map(s => s.room_name)).size}`);
    lines.push(`│  Available rooms     : ${rooms.length}`);
    lines.push(`│  Days × Slots        : 5 × 8`);
    lines.push('│');

    // Slot type counts
    const lectureCount = slots.filter(s => s.slot_type === 'Lecture').length;
    const tutorialCount = slots.filter(s => s.slot_type === 'Tutorial').length;
    const practicalCount = slots.filter(s => s.slot_type === 'Practical').length;
    lines.push(`│  Lectures            : ${lectureCount}`);
    lines.push(`│  Tutorials           : ${tutorialCount}`);
    lines.push(`│  Practicals          : ${practicalCount}`);
    lines.push('│');

    // Locked session info
    if (lockedCount > 0) {
        lines.push(`│  Locked sessions     : ${lockedCount} (from ${lockedNames.length} published TT${lockedNames.length > 1 ? 's' : ''})`);
        for (const name of lockedNames) {
            lines.push(`│     • ${name}`);
        }
    } else {
        lines.push(`│  Locked sessions     : 0 (no other published timetables)`);
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 2. Session List (Normal) ──
    lines.push('┌─── EDITOR SESSIONS ───────────────────────────────────────────┐');
    for (let i = 0; i < normalCount; i++) {
        const s = sessions[i];
        const g = solution[i];
        const placement = g ? geneLabel(g, s, rooms) : 'NOT PLACED';
        
        let utilStr = '';
        if (g) {
            const room = rooms[g.roomIndex];
            if (room && room.capacity > 0) {
                const util = Math.round((s.studentCount / room.capacity) * 100);
                utilStr = ` | Util: ${util}%`;
            }
        }
        
        const flags = [
            s.isElective ? 'ELECTIVE' : '',
            s.isWMCGroup ? 'WMC' : '',
        ].filter(Boolean).join(' | ');
        lines.push(`│  ${sessionLabel(s).padEnd(40)} → ${placement}${flags ? `  [${flags}]` : ''}${utilStr}`);
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 2b. Session List (Locked) ──
    if (lockedCount > 0) {
        lines.push('┌─── LOCKED SESSIONS (from other published TTs) ──────────────┐');
        for (let i = normalCount; i < sessions.length; i++) {
            const s = sessions[i];
            const g = solution[i];
            const placement = g ? geneLabel(g, s, rooms) : 'NOT PLACED';
            
            let utilStr = '';
            if (g) {
                const room = rooms[g.roomIndex];
                if (room && room.capacity > 0) {
                    const util = Math.round((s.studentCount / room.capacity) * 100);
                    utilStr = ` | Util: ${util}%`;
                }
            }
            
            const flags = [
                s.isElective ? 'ELECTIVE' : '',
                s.isWMCGroup ? 'WMC' : '',
                'LOCKED',
            ].filter(Boolean).join(' | ');
            lines.push(`│  ${sessionLabel(s).padEnd(40)} → ${placement}  [${flags}]${utilStr}`);
        }
        lines.push('└──────────────────────────────────────────────────────────────┘');
        lines.push('');
    }

    // ─── 3. Fitness Summary ──
    lines.push('┌─── FITNESS RESULT ────────────────────────────────────────────┐');
    lines.push(`│  Total fitness      : ${fitness.total}`);
    lines.push(`│  Hard violations    : ${fitness.hardViolations}`);
    lines.push(`│  Gap penalty (soft) : ${fitness.gapPenalty}`);
    lines.push(`│  Room util penalty  : ${fitness.roomUtilizationPenalty}`);
    lines.push(`│  Prof same-half     : ${fitness.professorSameHalfPenalty}`);
    lines.push(`│  FEASIBLE           : ${fitness.hardViolations === 0 ? 'YES' : 'NO'}`);
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
        lines.push(`│    Two/One Lecture    : ${vb.twoOneLecture}`);
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 4. Detailed Violation Report ──
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
            checkTimeBoundaryViolations(sessions, solution, lines);
            lines.push('');
        }

        if (vb.breakCrossing > 0) {
            lines.push('── Break/Lunch Crossing Violations ──────────────────────────');
            lines.push('   WHY: A multi-slot session spans across a break (10:50-11:00) or lunch (13:00-14:30).');
            checkBreakViolations(sessions, solution, lines);
            lines.push('');
        }

        if (vb.roomOverlap > 0) {
            lines.push('── Room Overlap Violations ──────────────────────────────────');
            lines.push('   WHY: Two or more sessions are assigned to the same room at the same time.');
            checkRoomOverlaps(sessions, solution, rooms, lines);
            lines.push('');
        }

        if (vb.professorOverlap > 0) {
            lines.push('── Professor Overlap Violations ─────────────────────────────');
            lines.push('   WHY: A professor is scheduled to teach two sessions at the same time.');
            checkProfessorOverlaps(sessions, solution, lines);
            lines.push('');
        }

        if (vb.groupOverlap > 0) {
            lines.push('── Group (Section) Overlap Violations ───────────────────────');
            lines.push('   WHY: A student group has two non-elective sessions at the same time.');
            checkGroupOverlaps(sessions, solution, lines);
            lines.push('');
        }

        if (vb.wmcSectionOverlap > 0) {
            lines.push('── WMC–Section Overlap Violations ───────────────────────────');
            lines.push('   WHY: A whole-batch (WMC/IT-BI) session collides with a section-level session.');
            lines.push('   All students must attend WMC, so no section class can run concurrently.');
            checkWMCSectionOverlaps(sessions, solution, lines);
            lines.push('');
        }

        if (vb.labRoom > 0) {
            lines.push('── Lab Room Violations ──────────────────────────────────────');
            lines.push('   WHY: A Practical session is placed in a non-Lab room.');
            checkLabRoomViolations(sessions, solution, rooms, lines);
            lines.push('');
        }

        if (vb.homeRoom > 0) {
            lines.push('── Home Room Violations ─────────────────────────────────────');
            lines.push('   WHY: A Lecture/Tutorial is not in its assigned home room.');
            checkHomeRoomViolations(sessions, solution, rooms, lines);
            lines.push('');
        }

        if (vb.electiveSync > 0) {
            lines.push('── Elective Sync / Cross-Basket Violations ──────────────────');
            lines.push('   WHY: Either a synced basket (HSMC/MDM) has members at different times,');
            lines.push('   or two DIFFERENT baskets have sessions at the same (day, slot).');
            checkElectiveSyncViolations(sessions, solution, lines);
            lines.push('');
        }
        
        if (vb.twoOneLecture > 0) {
            lines.push('── Two/One Lecture Format Violations ────────────────────────');
            lines.push('   WHY: A 2-hour and 1-hour core lecture for the same subject/group are on the same day.');
            checkTwoOneLectureViolations(sessions, solution, lines);
            lines.push('');
        }
    } else {
        lines.push('NO VIOLATIONS -- Timetable is fully feasible!');
        lines.push('');
    }

    // ─── 5. Day-by-Day Schedule ──
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
                const room = gene.roomIndex >= 0 ? rooms[gene.roomIndex] : undefined;
                const endBucket = gene.startBucket + session.duration - 1;
                const time = `${slotTime(gene.startBucket)}-${slotEndTime(endBucket)}`;
                const flags = [session.isElective ? 'ELEC' : ''].filter(Boolean).join(' ');
                lines.push(`│     ${time.padEnd(12)} ${session.subjectCode.padEnd(12)} ${session.slotType.charAt(0)} ${(room?.name ?? '??').padEnd(10)} ${flags}`);
            }
        }
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ─── 6. Section-wise Summary ──
    lines.push('┌─── SECTION-WISE SLOT COUNTS ──────────────────────────────────┐');
    const sectionCounts = new Map<string, { L: number; T: number; P: number }>();
    for (const slot of slots) {
        let entry = sectionCounts.get(slot.group_name);
        if (!entry) { entry = { L: 0, T: 0, P: 0 }; sectionCounts.set(slot.group_name, entry); }
        if (slot.slot_type === 'Lecture') entry.L++;
        else if (slot.slot_type === 'Tutorial') entry.T++;
        else if (slot.slot_type === 'Practical') entry.P++;
    }
    for (const [section, counts] of Array.from(sectionCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        const total = counts.L + counts.T + counts.P;
        lines.push(`│  ${section.padEnd(15)} L:${String(counts.L).padStart(2)} T:${String(counts.T).padStart(2)} P:${String(counts.P).padStart(2)}  (total: ${total})`);
    }
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');

    lines.push('═'.repeat(80));
    lines.push(`  END OF EDITOR LOG — ${ts}`);
    lines.push('═'.repeat(80));

    return lines.join('\n');
}
