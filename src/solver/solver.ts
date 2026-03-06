import type { SolverInput, SolverProgress, SolverResult, Solution, Gene, FitnessResult } from './types';
import { generateInitialSolution, mutate } from './mutations';
import { evaluate } from './constraints';

// ─── Main (1+1)-ES Solver Loop ─────────────────────────────────────────────────

/**
 * Run the (1+1)-ES solver.
 *
 * Key improvements over naive implementation:
 * - Larger batch size (500) for fewer async yields
 * - Report interval configurable from SolverConfig
 * - Early termination when feasible solution found (0 hard violations)
 * - Stagnation restart: re-randomize if no improvement for 10k generations
 * - σ clamped to [0.5, 30] for problem-appropriate range
 * - Optional seedSolution for warm-starting from an existing timetable
 * - Optional lockedGenes for pinning published timetable slots
 */
export function runSolver(
    input: SolverInput,
    onProgress: (p: SolverProgress) => void,
    cancelToken: { cancelled: boolean },
    seedSolution?: Solution,
    lockedGenes?: Gene[],
): Promise<SolverResult> {
    return new Promise((resolve) => {
        const { config, sessions } = input;
        const startTime = performance.now();

        // Helper: overwrite locked session positions in a solution
        function pinLockedGenes(sol: Solution) {
            if (!lockedGenes || lockedGenes.length === 0) return;
            // Locked sessions are appended at the end of the sessions array.
            // Their positions start at index (sessions.length - lockedGenes.length).
            const lockedStart = sessions.length - lockedGenes.length;
            for (let i = 0; i < lockedGenes.length; i++) {
                sol[lockedStart + i] = { ...lockedGenes[i] };
            }
        }

        // ── State: use seed if provided, otherwise generate random ──
        let parent: Solution = seedSolution
            ? seedSolution.map(g => ({ ...g }))
            : generateInitialSolution(input);
        pinLockedGenes(parent);
        let parentFitness: FitnessResult = evaluate(input, parent);

        let bestSolution: Solution = parent.map(g => ({ ...g }));
        let bestFitness: FitnessResult = {
            ...parentFitness,
            violationBreakdown: parentFitness.violationBreakdown
                ? { ...parentFitness.violationBreakdown }
                : undefined,
        };
        let bestGeneration = 0;

        let sigma = config.initialSigma;
        let successes = 0;
        let generation = 0;
        let stagnationCounter = 0;

        const BATCH_SIZE = 500;
        const STAGNATION_LIMIT = 15_000; // restart if no improvement for 15k gens
        const SIGMA_MIN = 0.5;
        const SIGMA_MAX = 30;

        // ── Step function (runs one batch then yields to event loop) ──
        function step() {
            if (cancelToken.cancelled || generation >= config.maxGenerations) {
                const elapsed = performance.now() - startTime;
                resolve({
                    solution: bestSolution,
                    fitness: bestFitness,
                    bestGeneration,
                    totalGenerations: generation,
                    elapsedMs: elapsed,
                    cancelled: cancelToken.cancelled,
                });
                return;
            }

            // Early termination if feasible
            if (bestFitness.hardViolations === 0) {
                const elapsed = performance.now() - startTime;
                // Report final progress
                onProgress({
                    generation,
                    maxGenerations: config.maxGenerations,
                    fitness: bestFitness,
                    sigma,
                    successRate: successes / Math.max(generation, 1),
                    elapsedMs: elapsed,
                    feasible: true,
                });
                resolve({
                    solution: bestSolution,
                    fitness: bestFitness,
                    bestGeneration,
                    totalGenerations: generation,
                    elapsedMs: elapsed,
                    cancelled: false,
                });
                return;
            }

            const batchEnd = Math.min(generation + BATCH_SIZE, config.maxGenerations);

            while (generation < batchEnd) {
                // 1. Mutate
                const offspring = mutate(parent, input, sigma);
                const offspringFitness = evaluate(input, offspring);

                // 2. Select (elitist: offspring replaces parent if ≤)
                if (offspringFitness.total <= parentFitness.total) {
                    parent = offspring;
                    parentFitness = offspringFitness;
                    successes++;
                }

                // 3. Track global best
                if (parentFitness.total < bestFitness.total) {
                    bestSolution = parent.map(g => ({ ...g }));
                    bestFitness = {
                        ...parentFitness,
                        violationBreakdown: parentFitness.violationBreakdown
                            ? { ...parentFitness.violationBreakdown }
                            : undefined,
                    };
                    bestGeneration = generation;
                    stagnationCounter = 0;
                } else {
                    stagnationCounter++;
                }

                // 4. Adaptation (1/5th rule)
                if (generation > 0 && generation % config.adaptationWindow === 0) {
                    const rate = successes / config.adaptationWindow;
                    if (rate > 0.2) {
                        sigma = Math.min(sigma * config.sigmaIncrease, SIGMA_MAX);
                    } else if (rate < 0.2) {
                        sigma = Math.max(sigma * config.sigmaDecrease, SIGMA_MIN);
                    }
                    successes = 0;
                }

                // 5. Stagnation restart: if stuck, re-randomize parent (keep best)
                if (stagnationCounter >= STAGNATION_LIMIT) {
                    parent = generateInitialSolution(input);
                    pinLockedGenes(parent);
                    parentFitness = evaluate(input, parent);
                    sigma = config.initialSigma;
                    stagnationCounter = 0;
                }

                generation++;
            }

            // Report progress
            if (generation % config.reportInterval === 0 || generation >= config.maxGenerations) {
                const elapsed = performance.now() - startTime;
                onProgress({
                    generation,
                    maxGenerations: config.maxGenerations,
                    fitness: bestFitness,
                    sigma,
                    successRate: successes / Math.max(config.adaptationWindow, 1),
                    elapsedMs: elapsed,
                    feasible: bestFitness.hardViolations === 0,
                });
            }

            // Yield to event loop to keep UI responsive
            setTimeout(step, 0);
        }

        // Begin
        step();
    });
}
