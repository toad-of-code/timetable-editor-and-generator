import { Users, User2 } from 'lucide-react';
import type { Subject, Group, Professor } from '../../hooks/useGeneratorData';

interface Props {
    subjects: Subject[];
    groups: Group[];
    professors: Professor[];
    expertiseMap: Record<string, Professor[]>;
    assignments: Record<string, Record<string, string>>;
    sectionModes: Record<string, 'all' | 'sections' | 'itbi'>;
    onAssign: (subjectId: string, groupId: string, profId: string) => void;
    onApplyToAll: (subjectId: string, profId: string) => void;
    onSectionModeChange: (subjectId: string, mode: 'all' | 'sections' | 'itbi') => void;
}

export function AssignmentMatrix({
    subjects,
    groups,
    professors,
    expertiseMap,
    assignments,
    sectionModes,
    onAssign,
    onApplyToAll,
    onSectionModeChange,
}: Props) {
    // Helper: detect IT-BI group (robust matching for variations)
    const isITBIGroup = (name: string) => /IT[\s-]*BI/i.test(name);

    // Split groups
    const allGroup = groups.find(g => g.name === 'WMC');
    const itbiGroup = groups.find(g => isITBIGroup(g.name));
    const sectionGroups = groups.filter(g => g.name !== 'WMC' && !isITBIGroup(g.name));

    // Count filled cells (respecting modes)
    let totalCells = 0;
    let filledCells = 0;
    // Smart default: electives → 'all', everything else → 'sections'
    const getDefaultMode = (sub: { subject_type: string }): 'all' | 'sections' =>
        (sub.subject_type === 'Elective' || sub.subject_type === 'Minor') ? 'all' : 'sections';

    subjects.forEach(sub => {
        const mode = sectionModes[sub.id] ?? getDefaultMode(sub);
        const relevantGroups = mode === 'all' && allGroup ? [allGroup]
            : mode === 'itbi' && itbiGroup ? [itbiGroup]
                : sectionGroups;
        totalCells += relevantGroups.length;
        relevantGroups.forEach(g => {
            if (assignments[sub.id]?.[g.id]) filledCells++;
        });
    });

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-5">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-xs uppercase tracking-wider text-gray-400 font-bold flex items-center gap-2">
                    <span className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px]">
                        3
                    </span>
                    Subject × Section Professor Assignment
                </h2>
                {totalCells > 0 && (
                    <span
                        className={`text-xs px-3 py-1 rounded-full font-semibold ${filledCells === totalCells
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                            }`}
                    >
                        {filledCells}/{totalCells} assigned
                    </span>
                )}
            </div>

            {/* Body */}
            {subjects.length === 0 ? (
                <p className="text-sm text-gray-400 italic p-5">
                    No subjects found for this cluster.
                </p>
            ) : (
                <div className="divide-y divide-gray-100">
                    {subjects.map((subject, si) => {
                        const mode = sectionModes[subject.id] ?? getDefaultMode(subject);
                        const qualifiedProfs = expertiseMap[subject.id] ?? professors;
                        const hasNoExpertise = !expertiseMap[subject.id];
                        const rowBg = si % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';

                        // Which groups to show based on mode
                        const activeGroups = mode === 'all' && allGroup ? [allGroup]
                            : mode === 'itbi' && itbiGroup ? [itbiGroup]
                                : sectionGroups;

                        return (
                            <div key={subject.id} className={`p-4 ${rowBg}`}>
                                {/* Row: Subject info + Mode toggle */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex-1">
                                        <div className="font-medium text-gray-800 leading-tight">
                                            {subject.name}
                                        </div>
                                        <div className="text-xs text-gray-400 font-mono mt-0.5">
                                            {subject.code}
                                            <span
                                                className={`ml-2 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${subject.subject_type === 'Elective'
                                                    ? 'bg-purple-100 text-purple-700'
                                                    : 'bg-blue-100 text-blue-700'
                                                    }`}
                                            >
                                                {subject.subject_type}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Mode toggle */}
                                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                                        <button
                                            onClick={() => onSectionModeChange(subject.id, 'all')}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${mode === 'all'
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            <Users className="w-3.5 h-3.5" />
                                            All Together
                                        </button>
                                        <button
                                            onClick={() => onSectionModeChange(subject.id, 'sections')}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${mode === 'sections'
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            <User2 className="w-3.5 h-3.5" />
                                            Per Section
                                        </button>
                                        {itbiGroup && (
                                            <button
                                                onClick={() => onSectionModeChange(subject.id, 'itbi')}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${mode === 'itbi'
                                                    ? 'bg-teal-600 text-white shadow-sm'
                                                    : 'text-gray-500 hover:text-gray-700'
                                                    }`}
                                            >
                                                <Users className="w-3.5 h-3.5" />
                                                IT-BI Only
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Professor assignment dropdowns */}
                                <div className="flex flex-wrap gap-3">
                                    {activeGroups.map(group => {
                                        const selectedProfId = assignments[subject.id]?.[group.id] ?? '';
                                        return (
                                            <div key={group.id} className="flex flex-col items-center gap-1">
                                                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                                                    {group.name}
                                                </span>
                                                <select
                                                    className={`px-2 py-1.5 border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[160px] ${selectedProfId
                                                        ? 'border-green-400 bg-green-50'
                                                        : 'border-gray-300'
                                                        }`}
                                                    value={selectedProfId}
                                                    onChange={e => onAssign(subject.id, group.id, e.target.value)}
                                                >
                                                    <option value="">— Assign —</option>
                                                    {qualifiedProfs.map(p => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.name}
                                                        </option>
                                                    ))}
                                                    {hasNoExpertise && (
                                                        <optgroup label="⚠ No expertise mapped — showing all">
                                                            {professors.map(p => (
                                                                <option key={p.id} value={p.id}>
                                                                    {p.name}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                </select>
                                            </div>
                                        );
                                    })}

                                    {/* Apply-to-all shortcut (only for per-section mode) */}
                                    {mode === 'sections' && sectionGroups.length > 1 && (
                                        <div className="flex flex-col items-center gap-1">
                                            <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">
                                                Apply All
                                            </span>
                                            <select
                                                className="px-2 py-1.5 border border-dashed border-indigo-300 rounded-md text-xs text-indigo-600 bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[160px]"
                                                value=""
                                                onChange={e => {
                                                    if (e.target.value)
                                                        onApplyToAll(subject.id, e.target.value);
                                                }}
                                            >
                                                <option value="">→ All Sections</option>
                                                {qualifiedProfs.map(p => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
