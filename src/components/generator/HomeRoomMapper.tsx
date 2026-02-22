import type { Group, Room } from '../../hooks/useGeneratorData';

interface Props {
    roomableGroups: Group[];
    rooms: Room[];
    homeRooms: Record<string, string>;
    onChange: (groupId: string, roomId: string) => void;
}

export function HomeRoomMapper({ roomableGroups, rooms, homeRooms, onChange }: Props) {
    return (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 mb-5">
            <h2 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px]">
                    2
                </span>
                Section → Home Room
            </h2>

            {roomableGroups.length === 0 ? (
                <p className="text-sm text-gray-400 italic">
                    No assignable sections found (only 'All' group exists).
                </p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {roomableGroups.map(group => (
                        <div
                            key={group.id}
                            className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg"
                        >
                            <span className="text-sm font-semibold text-gray-700 min-w-[60px]">
                                {group.name}
                            </span>
                            <select
                                className={`flex-1 px-2 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${homeRooms[group.id]
                                        ? 'border-green-400 bg-green-50'
                                        : 'border-gray-300'
                                    }`}
                                value={homeRooms[group.id] ?? ''}
                                onChange={e => onChange(group.id, e.target.value)}
                            >
                                <option value="">— Room —</option>
                                {rooms.map(r => (
                                    <option key={r.id} value={r.id}>
                                        {r.name} ({r.room_type})
                                    </option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
