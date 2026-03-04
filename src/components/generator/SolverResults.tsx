import { CheckCircle2, AlertTriangle, Clock, Zap, Save, Loader2 } from 'lucide-react';
import type { SolverResult } from '../../solver/types';

interface Props {
    result: SolverResult;
    sessionCount: number;
    timetableName: string;
    onNameChange: (name: string) => void;
    onSave: () => void;
    saving: boolean;
    saved: boolean;
}

export function SolverResults({ result, sessionCount, timetableName, onNameChange, onSave, saving, saved }: Props) {
    const feasible = result.fitness.hardViolations === 0;
    const elapsed = (result.elapsedMs / 1000).toFixed(1);

    return (
        <div className={`rounded-xl shadow-sm border p-6 mb-5 ${feasible ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            {/* Title */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    {feasible
                        ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                        : <AlertTriangle className="w-5 h-5 text-amber-600" />
                    }
                    <h3 className={`font-bold text-sm ${feasible ? 'text-green-800' : 'text-amber-800'}`}>
                        {result.cancelled
                            ? 'Solver Cancelled'
                            : feasible
                                ? '✅ Feasible Timetable Found!'
                                : '⚠️ Best-Effort Solution (has conflicts)'}
                    </h3>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center mb-4">
                <ResultStat icon={<Zap className="w-4 h-4" />} label="Total Fitness" value={result.fitness.total.toFixed(0)} />
                <ResultStat icon={<AlertTriangle className="w-4 h-4" />} label="Hard Violations" value={String(result.fitness.hardViolations)} color={feasible ? 'text-green-700' : 'text-red-600'} />
                <ResultStat icon={<Clock className="w-4 h-4" />} label="Gap Penalty" value={String(result.fitness.gapPenalty)} />
                <ResultStat icon={<Zap className="w-4 h-4" />} label="Best @ Gen" value={result.bestGeneration.toLocaleString()} />
                <ResultStat icon={<Clock className="w-4 h-4" />} label="Time" value={`${elapsed}s`} />
            </div>

            {/* Violation Breakdown (when there are violations) */}
            {!feasible && result.fitness.violationBreakdown && (
                <div className="bg-white/60 rounded-lg p-3 mb-4 border border-amber-200">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-amber-600 mb-2">Violation Breakdown</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {Object.entries(result.fitness.violationBreakdown)
                            .filter(([, v]) => (v as number) > 0)
                            .map(([key, v]) => (
                                <div key={key} className="flex justify-between bg-red-50 px-2 py-1 rounded border border-red-100">
                                    <span className="text-gray-600">{key}</span>
                                    <span className="font-bold text-red-600">{String(v)}</span>
                                </div>
                            ))
                        }
                    </div>
                </div>
            )}

            <div className="text-xs text-gray-500 mb-4">
                Scheduled <b>{sessionCount}</b> class sessions across {result.totalGenerations.toLocaleString()} generations.
            </div>

            {/* Timetable Name Input */}
            <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Name:</label>
                <input
                    type="text"
                    value={timetableName}
                    onChange={(e) => onNameChange(e.target.value)}
                    disabled={saved}
                    placeholder="Enter timetable name..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                />
            </div>

            {/* Save button */}
            <button
                onClick={onSave}
                disabled={saving || saved || !timetableName.trim()}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm ${saved
                    ? 'bg-green-600 text-white cursor-default'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                    }`}
            >
                {saving
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                    : saved
                        ? <><CheckCircle2 className="w-4 h-4" /> Saved to Supabase</>
                        : <><Save className="w-4 h-4" /> Save Timetable to Supabase</>
                }
            </button>
        </div>
    );
}

function ResultStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
    return (
        <div className="bg-white/70 rounded-lg px-3 py-2.5 border border-white/50">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">{icon}<span className="text-[10px] uppercase tracking-wider font-bold">{label}</span></div>
            <div className={`text-sm font-bold ${color ?? 'text-gray-800'}`}>{value}</div>
        </div>
    );
}
