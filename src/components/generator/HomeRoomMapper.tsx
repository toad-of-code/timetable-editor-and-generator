import { useState, useEffect } from 'react';
import type { Group, Room } from '../../hooks/useGeneratorData';

interface Props {
    roomableGroups: Group[];
    rooms: Room[];
    homeRooms: Record<string, string>;
    onChange: (groupId: string, roomId: string) => void;
}

function CascadingRoomSelect({ rooms, value, onChange }: { group: Group, rooms: Room[], value: string, onChange: (val: string) => void }) {
    const selectedRoom = rooms.find(r => r.id === value);
    const [type, setType] = useState<string>(selectedRoom ? selectedRoom.room_type : 'Lecture');
    
    useEffect(() => {
        if (selectedRoom && selectedRoom.room_type !== type) {
            setType(selectedRoom.room_type);
        }
    }, [selectedRoom, type]);

    const filteredRooms = rooms.filter(r => r.room_type === type);

    return (
        <div className="flex flex-1 gap-1">
            <select
                className="w-[40%] px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                value={type}
                onChange={e => {
                    setType(e.target.value);
                    onChange('');
                }}
            >
                <option value="Lecture">Lecture</option>
                <option value="Lab">Lab</option>
            </select>
            <select
                className={`w-[60%] px-2 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${value ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white'}`}
                value={value}
                onChange={e => onChange(e.target.value)}
            >
                <option value="">— Room —</option>
                {filteredRooms.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                ))}
            </select>
        </div>
    );
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
                    No assignable sections found (only 'WMC' group exists).
                </p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {roomableGroups.map(group => (
                        <div
                            key={group.id}
                            className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg"
                        >
                            <span className="text-sm font-semibold text-gray-700 min-w-[50px]">
                                {group.name}
                            </span>
                            <CascadingRoomSelect
                                group={group}
                                rooms={rooms}
                                value={homeRooms[group.id] ?? ''}
                                onChange={(val) => onChange(group.id, val)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
