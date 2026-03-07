import { Activity, XCircle, CheckCircle2 } from 'lucide-react';
import type { SolverProgress } from '../../solver/types';

interface Props {
    progress: SolverProgress | null;
    onCancel: () => void;
}

export function SolverProgressCard({ progress, onCancel }: Props) {
    if (!progress) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-6 mb-5 animate-pulse">
                <div className="flex items-center gap-3 text-indigo-600">
                    <Activity className="w-5 h-5 animate-bounce" />
                    <span className="font-semibold text-sm">Initializing solver…</span>
                </div>
            </div>
        );
    }

    const pct = Math.min(100, (progress.generation / progress.maxGenerations) * 100);
    const elapsed = (progress.elapsedMs / 1000).toFixed(1);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-6 mb-5">
            {/* Title */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-indigo-600 animate-pulse" />
                    <h3 className="font-bold text-gray-800 text-sm">(1+1)-ES Solver Running</h3>
                </div>
                <button
                    onClick={onCancel}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition"
                >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                </button>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-3 mb-4 overflow-hidden">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <StatBox label="Generation" value={`${progress.generation.toLocaleString()} / ${progress.maxGenerations.toLocaleString()}`} />
                <StatBox label="Hard Violations" value={progress.fitness.hardViolations.toString()} color={progress.fitness.hardViolations === 0 ? 'text-green-600' : 'text-red-600'} />
                <StatBox label="Gap Penalty" value={progress.fitness.gapPenalty.toString()} />
            </div>

            {/* Footer */}
            <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
                <span>Elapsed: {elapsed}s</span>
                {progress.feasible && (
                    <span className="flex items-center gap-1 text-green-600 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Feasible solution found!
                    </span>
                )}
            </div>
        </div>
    );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="bg-gray-50 rounded-lg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{label}</div>
            <div className={`text-sm font-bold mt-0.5 ${color ?? 'text-gray-800'}`}>{value}</div>
        </div>
    );
}
