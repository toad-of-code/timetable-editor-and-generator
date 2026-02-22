import type { Cluster } from '../../hooks/useGeneratorData';

interface Props {
    clusters: Cluster[];
    selectedClusterId: string;
    onChange: (id: string) => void;
    subjectCount: number;
    groupCount: number;
}

export function ClusterSelector({ clusters, selectedClusterId, onChange, subjectCount, groupCount }: Props) {
    const selected = clusters.find(c => c.id === selectedClusterId);

    return (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 mb-5">
            <h2 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px]">
                    1
                </span>
                Select Semester Cluster
            </h2>

            <select
                className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                value={selectedClusterId}
                onChange={e => onChange(e.target.value)}
            >
                <option value="">— Choose a Cluster —</option>
                {clusters.map(c => (
                    <option key={c.id} value={c.id}>
                        Batch {c.batch_year} · Sem {c.semester_number} · {c.department}
                    </option>
                ))}
            </select>

            {selected && (
                <p className="text-xs text-gray-400 mt-2">
                    {subjectCount} subjects · {groupCount} sections loaded
                </p>
            )}
        </div>
    );
}
