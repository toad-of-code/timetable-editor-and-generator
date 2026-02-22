import type { Subject, Group, Professor } from '../../hooks/useGeneratorData';

interface Props {
    subjects: Subject[];
    groups: Group[];
    professors: Professor[];
    expertiseMap: Record<string, Professor[]>;
    assignments: Record<string, Record<string, string>>;
    onAssign: (subjectId: string, groupId: string, profId: string) => void;
    onApplyToAll: (subjectId: string, profId: string) => void;
}

export function AssignmentMatrix({
    subjects,
    groups,
    professors,
    expertiseMap,
    assignments,
    onAssign,
    onApplyToAll,
}: Props) {
    const totalCells = subjects.length * groups.length;
    const filledCells = Object.values(assignments).reduce(
        (sum, groupMap) => sum + Object.values(groupMap).filter(Boolean).length,
        0,
    );

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
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-gray-200">
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 min-w-[200px]">
                                    Subject
                                </th>
                                {groups.map(g => (
                                    <th
                                        key={g.id}
                                        className="px-3 py-3 text-center text-xs font-semibold text-gray-500 min-w-[150px]"
                                    >
                                        {g.name}
                                    </th>
                                ))}
                                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500">
                                    Apply All
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {subjects.map((subject, si) => {
                                const rowBg = si % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
                                // Only show professors with mapped expertise; fall back to all if none mapped
                                const qualifiedProfs = expertiseMap[subject.id] ?? professors;
                                const hasNoExpertise = !expertiseMap[subject.id];

                                return (
                                    <tr
                                        key={subject.id}
                                        className={`border-b border-gray-100 ${rowBg}`}
                                    >
                                        {/* Subject label */}
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-gray-800 leading-tight">
                                                {subject.name}
                                            </div>
                                            <div className="text-xs text-gray-400 font-mono mt-0.5">
                                                {subject.code}
                                            </div>
                                            <span
                                                className={`mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${subject.subject_type === 'Elective'
                                                        ? 'bg-purple-100 text-purple-700'
                                                        : 'bg-blue-100 text-blue-700'
                                                    }`}
                                            >
                                                {subject.subject_type}
                                            </span>
                                        </td>

                                        {/* Per-section professor dropdowns */}
                                        {groups.map(group => {
                                            const selectedProfId =
                                                assignments[subject.id]?.[group.id] ?? '';
                                            return (
                                                <td key={group.id} className="px-3 py-3 text-center">
                                                    <select
                                                        className={`w-full px-2 py-1.5 border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 ${selectedProfId
                                                                ? 'border-green-400 bg-green-50'
                                                                : 'border-gray-300'
                                                            }`}
                                                        value={selectedProfId}
                                                        onChange={e =>
                                                            onAssign(subject.id, group.id, e.target.value)
                                                        }
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
                                                </td>
                                            );
                                        })}

                                        {/* Apply-to-all shortcut */}
                                        <td className="px-3 py-3 text-center">
                                            <select
                                                className="w-full px-2 py-1.5 border border-dashed border-indigo-300 rounded-md text-xs text-indigo-600 bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
