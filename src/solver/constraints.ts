import type { Solution, FitnessResult, SolverInput } from './types';
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
    computeGapPenalty,
    computeRoomUtilizationPenalty,
    computeProfessorSameHalfPenalty,
} from './conflictDetectors';

/**
 * Evaluate a complete solution against all constraints.
 * fitness.total = hardViolations * hardPenalty
 *               + gapPenalty * gapWeight
 *               + roomUtilizationPenalty * roomUtilizationWeight
 *               + professorSameHalfPenalty * professorSameHalfWeight
 */
export function evaluate(input: SolverInput, solution: Solution): FitnessResult {
    const { sessions, rooms, numDays, config } = input;

    const timeBoundary = checkTimeBoundaryViolations(sessions, solution);
    const breakCrossing = checkBreakViolations(sessions, solution);
    const roomOverlap = checkRoomOverlaps(sessions, solution, rooms);
    const professorOverlap = checkProfessorOverlaps(sessions, solution);
    const groupOverlap = checkGroupOverlaps(sessions, solution);
    const electiveSync = checkElectiveSyncViolations(sessions, solution);
    const labRoom = checkLabRoomViolations(sessions, solution, rooms);
    const wmcSectionOverlap = checkWMCSectionOverlaps(sessions, solution);
    const homeRoom = checkHomeRoomViolations(sessions, solution, rooms);
    const twoOneLecture = checkTwoOneLectureViolations(sessions, solution);

    const hardViolations = timeBoundary + breakCrossing + roomOverlap +
        professorOverlap + groupOverlap + electiveSync + labRoom +
        wmcSectionOverlap + homeRoom + twoOneLecture;

    const gapPenalty = computeGapPenalty(sessions, solution, numDays);
    const roomUtilizationPenalty = computeRoomUtilizationPenalty(
        sessions, solution, rooms, config.roomUtilizationThreshold, config.roomOverutilizationThreshold,
    );
    const professorSameHalfPenalty = computeProfessorSameHalfPenalty(sessions, solution, numDays);

    const total = hardViolations * config.hardPenalty
        + gapPenalty * config.gapWeight
        + roomUtilizationPenalty * config.roomUtilizationWeight
        + professorSameHalfPenalty * config.professorSameHalfWeight;

    return {
        total,
        hardViolations,
        gapPenalty,
        roomUtilizationPenalty,
        professorSameHalfPenalty,
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
            twoOneLecture,
        },
    };
}
