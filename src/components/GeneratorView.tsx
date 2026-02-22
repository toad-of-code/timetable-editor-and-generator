import { useState, useCallback } from 'react';
import { Settings, Calendar, Sparkles, AlertCircle, Loader2, Wand2 } from 'lucide-react';
import { useGeneratorData } from '../hooks/useGeneratorData';
import { ClusterSelector } from './generator/ClusterSelector';
import { HomeRoomMapper } from './generator/HomeRoomMapper';
import { AssignmentMatrix } from './generator/AssignmentMatrix';

export function GeneratorView() {
    // ─── UI / Config State ────────────────────────────────────────────────────
    const [selectedClusterId, setSelectedClusterId] = useState('');
    const [homeRooms, setHomeRooms] = useState<Record<string, string>>({});
    const [assignments, setAssignments] = useState<Record<string, Record<string, string>>>({});

    // ─── Data (hook) ─────────────────────────────────────────────────────────
    const {
        clusters, rooms, professors,
        clusterSubjects, clusterGroups, expertiseMap,
        loading, fetchingDetails, error,
    } = useGeneratorData(selectedClusterId);

    // ─── Cluster change — also resets config ─────────────────────────────────
    const handleClusterChange = (id: string) => {
        setSelectedClusterId(id);
        setHomeRooms({});
        setAssignments({});
    };

    // ─── Handlers ─────────────────────────────────────────────────────────────
    const handleAssignment = (subjectId: string, groupId: string, profId: string) => {
        setAssignments(prev => ({
            ...prev,
            [subjectId]: { ...(prev[subjectId] ?? {}), [groupId]: profId },
        }));
    };

    const handleApplyToAll = (subjectId: string, profId: string) => {
        const all: Record<string, string> = {};
        clusterGroups.forEach(g => { all[g.id] = profId; });
        setAssignments(prev => ({ ...prev, [subjectId]: all }));
    };

    const handleHomeRoom = (groupId: string, roomId: string) => {
        setHomeRooms(prev => ({ ...prev, [groupId]: roomId }));
    };

    // ─── DX: Auto-fill ────────────────────────────────────────────────────────
    const handleAutoFill = useCallback(() => {
        if (professors.length === 0) return;

        const newHomeRooms: Record<string, string> = {};
        clusterGroups
            .filter(g => g.name !== 'All')
            .forEach((g, i) => { newHomeRooms[g.id] = rooms[i % rooms.length]?.id ?? ''; });

        const newAssignments: Record<string, Record<string, string>> = {};
        clusterSubjects.forEach((sub, si) => {
            const pool = (expertiseMap[sub.id] ?? professors);
            const resolved = pool.length > 0 ? pool : professors;
            newAssignments[sub.id] = {};
            clusterGroups.forEach((g, gi) => {
                newAssignments[sub.id][g.id] = resolved[(si + gi) % resolved.length].id;
            });
        });

        setHomeRooms(newHomeRooms);
        setAssignments(newAssignments);
    }, [professors, expertiseMap, clusterGroups, rooms, clusterSubjects]);

    // ─── Derived ──────────────────────────────────────────────────────────────
    const roomableGroups = clusterGroups.filter(g => g.name !== 'All');
    const totalCells = clusterSubjects.length * clusterGroups.length;
    const filledCells = Object.values(assignments).reduce(
        (sum, gMap) => sum + Object.values(gMap).filter(Boolean).length,
        0,
    );
    const isConfigComplete =
        totalCells > 0 &&
        filledCells === totalCells &&
        roomableGroups.every(g => homeRooms[g.id]);

    // ─── Render ───────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen gap-3 text-indigo-500">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-sm font-medium">Loading generator data…</span>
            </div>
        );
    }

    return (
        <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">

            {/* ── Header ── */}
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-indigo-600" />
                        Timetable Generator
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Configure constraints, then generate a conflict-free timetable.
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    {selectedClusterId && !fetchingDetails && (
                        <button
                            onClick={handleAutoFill}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100 transition text-sm font-medium"
                            title="Developer tool: instantly fills all fields with valid data"
                        >
                            <Wand2 className="w-4 h-4" />
                            Dev: Auto-Fill
                        </button>
                    )}
                    <button
                        disabled={!isConfigComplete}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                        <Sparkles className="w-4 h-4" />
                        Generate Timetable
                    </button>
                </div>
            </div>

            {/* ── Error Banner ── */}
            {error && (
                <div className="flex items-center gap-3 p-4 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* ── Step 1: Cluster Selection ── */}
            <ClusterSelector
                clusters={clusters}
                selectedClusterId={selectedClusterId}
                onChange={handleClusterChange}
                subjectCount={clusterSubjects.length}
                groupCount={clusterGroups.length}
            />

            {/* ── Loading spinner for cluster details ── */}
            {fetchingDetails && (
                <div className="flex items-center gap-2 text-indigo-500 text-sm py-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading cluster details…
                </div>
            )}

            {!fetchingDetails && selectedClusterId && (
                <>
                    {/* ── Step 2: Home Room Mapping ── */}
                    <HomeRoomMapper
                        roomableGroups={roomableGroups}
                        rooms={rooms}
                        homeRooms={homeRooms}
                        onChange={handleHomeRoom}
                    />

                    {/* ── Step 3: Assignment Matrix ── */}
                    <AssignmentMatrix
                        subjects={clusterSubjects}
                        groups={clusterGroups}
                        professors={professors}
                        expertiseMap={expertiseMap}
                        assignments={assignments}
                        onAssign={handleAssignment}
                        onApplyToAll={handleApplyToAll}
                    />

                    {/* ── Config Summary Footer ── */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                            <Settings className="w-4 h-4 text-gray-400" />
                            <span>
                                Home Rooms:{' '}
                                <b>{Object.values(homeRooms).filter(Boolean).length}/{roomableGroups.length}</b> set
                            </span>
                            <span>
                                Assignments: <b>{filledCells}/{totalCells}</b> filled
                            </span>
                        </div>
                        <button
                            disabled={!isConfigComplete}
                            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Sparkles className="w-4 h-4" />
                            Generate Timetable
                        </button>
                    </div>
                </>
            )}

            {/* ── Empty State ── */}
            {!selectedClusterId && (
                <div className="flex flex-col items-center justify-center py-24 text-center text-gray-400">
                    <Calendar className="w-12 h-12 mb-4 text-gray-200" />
                    <h3 className="text-base font-semibold text-gray-500 mb-1">Select a Cluster to Begin</h3>
                    <p className="text-sm max-w-sm">
                        Choose a semester cluster above. The subjects, sections, and professor assignment matrix will load automatically.
                    </p>
                </div>
            )}
        </div>
    );
}
