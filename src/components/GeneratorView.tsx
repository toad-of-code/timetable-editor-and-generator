import { useState, useCallback, useRef, useEffect } from 'react';
import { Settings, Calendar, Sparkles, AlertCircle, Loader2, Wand2, Database } from 'lucide-react';
import { useGeneratorData } from '../hooks/useGeneratorData';
import { ClusterSelector } from './generator/ClusterSelector';
import { HomeRoomMapper } from './generator/HomeRoomMapper';
import { AssignmentMatrix } from './generator/AssignmentMatrix';
import { SolverProgressCard } from './generator/SolverProgress';
import { SolverResults } from './generator/SolverResults';
import { prepareSolverInput, buildSeedSolution } from '../solver/dataPrep';
import type { TimetableSlotRow } from '../solver/dataPrep';
import { runSolver } from '../solver/solver';
import { slotToStartTime, slotToEndTime } from '../solver/constants';
import { supabase } from '../lib/supabase';
import type { SolverProgress, SolverResult } from '../solver/types';
import type { SubjectFull } from '../solver/dataPrep';
import toast from 'react-hot-toast';

export function GeneratorView() {
    // ─── UI / Config State ────────────────────────────────────────────────────
    const [selectedClusterId, setSelectedClusterId] = useState('');
    const [homeRooms, setHomeRooms] = useState<Record<string, string>>({});
    const [assignments, setAssignments] = useState<Record<string, Record<string, string>>>({});
    const [sectionModes, setSectionModes] = useState<Record<string, 'all' | 'sections'>>({});

    // ─── Solver State ─────────────────────────────────────────────────────────
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<SolverProgress | null>(null);
    const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [timetableName, setTimetableName] = useState('');
    const cancelTokenRef = useRef({ cancelled: false });

    // ─── Seed Timetable State ─────────────────────────────────────────────────
    const [seedTimetables, setSeedTimetables] = useState<{ id: string; name: string; semester: number }[]>([]);
    const [seedTimetableId, setSeedTimetableId] = useState<string>('');

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
        setSectionModes({});
        setSolverResult(null);
        setProgress(null);
        setSaved(false);
        setSeedTimetableId('');
    };

    // ─── Fetch existing timetables for seed picker ────────────────────────────
    useEffect(() => {
        const fetchTimetables = async () => {
            const { data } = await supabase
                .from('timetables')
                .select('id, name, semester')
                .order('created_at', { ascending: false });
            if (data) setSeedTimetables(data);
        };
        fetchTimetables();
    }, []);

    // ─── Assignment Handlers ──────────────────────────────────────────────────
    const handleAssignment = (subjectId: string, groupId: string, profId: string) => {
        setAssignments(prev => ({
            ...prev,
            [subjectId]: { ...(prev[subjectId] ?? {}), [groupId]: profId },
        }));
    };

    const handleApplyToAll = (subjectId: string, profId: string) => {
        const sectionGroups = clusterGroups.filter(g => g.name !== 'WMC');
        const all: Record<string, string> = {};
        sectionGroups.forEach(g => { all[g.id] = profId; });
        setAssignments(prev => ({ ...prev, [subjectId]: all }));
    };

    const handleSectionModeChange = (subjectId: string, mode: 'all' | 'sections') => {
        setSectionModes(prev => ({ ...prev, [subjectId]: mode }));
        // Clear assignments for this subject when switching modes
        setAssignments(prev => ({ ...prev, [subjectId]: {} }));
    };

    const handleHomeRoom = (groupId: string, roomId: string) => {
        setHomeRooms(prev => ({ ...prev, [groupId]: roomId }));
    };

    // Helper: default section mode per subject (electives → 'all', core → 'sections')
    const getDefaultMode = (sub: { subject_type: string }): 'all' | 'sections' =>
        sub.subject_type === 'Elective' ? 'all' : 'sections';

    // ─── DX: Auto-fill ────────────────────────────────────────────────────────
    const handleAutoFill = useCallback(() => {
        if (professors.length === 0) return;

        const sectionGroups = clusterGroups.filter(g => g.name !== 'WMC');
        const allGroup = clusterGroups.find(g => g.name === 'WMC');

        const newHomeRooms: Record<string, string> = {};
        const lectureRooms = rooms.filter(r => r.room_type === 'Lecture');
        sectionGroups.forEach((g, i) => { newHomeRooms[g.id] = lectureRooms[i % lectureRooms.length]?.id ?? ''; });

        // Set mode: use existing mode or smart default (electives → WMC)
        const newModes: Record<string, 'all' | 'sections'> = {};
        const newAssignments: Record<string, Record<string, string>> = {};

        clusterSubjects.forEach((sub, si) => {
            const pool = (expertiseMap[sub.id] ?? professors);
            const resolved = pool.length > 0 ? pool : professors;
            const mode = sectionModes[sub.id] ?? getDefaultMode(sub);
            newModes[sub.id] = mode;
            newAssignments[sub.id] = {};

            if (mode === 'all' && allGroup) {
                // Only assign to the "All" group
                newAssignments[sub.id][allGroup.id] = resolved[si % resolved.length].id;
            } else {
                // Assign to each individual section
                sectionGroups.forEach((g, gi) => {
                    newAssignments[sub.id][g.id] = resolved[(si + gi) % resolved.length].id;
                });
            }
        });

        setHomeRooms(newHomeRooms);
        setSectionModes(newModes);
        setAssignments(newAssignments);
    }, [professors, expertiseMap, clusterGroups, rooms, clusterSubjects]);

    // ─── Generate Timetable Handler ───────────────────────────────────────────
    const handleGenerate = useCallback(async () => {
        // Prepare solver input
        const solverInput = prepareSolverInput(
            clusterSubjects as SubjectFull[],
            clusterGroups,
            rooms,
            assignments,
            homeRooms,
        );

        if (solverInput.sessions.length === 0) {
            toast.error('No class sessions to schedule. Check your subject L-T-P data.');
            return;
        }

        // Reset state
        setIsRunning(true);
        setProgress(null);
        setSolverResult(null);
        setSaved(false);
        cancelTokenRef.current = { cancelled: false };

        toast(`Scheduling ${solverInput.sessions.length} sessions…`, { icon: '🧬' });

        try {
            // Build seed solution if a seed timetable is selected
            let seedSolution = undefined;
            if (seedTimetableId) {
                toast('Loading seed timetable…', { icon: '🌱' });
                const { data: slotRows, error: seedErr } = await supabase
                    .from('timetable_slots')
                    .select('subject_id, student_group_id, room_id, day_of_week, start_time, end_time, slot_type')
                    .eq('timetable_id', seedTimetableId);

                if (seedErr) {
                    toast.error(`Failed to load seed: ${seedErr.message}`);
                } else if (slotRows && slotRows.length > 0) {
                    seedSolution = buildSeedSolution(solverInput, slotRows as TimetableSlotRow[]);
                    toast.success(`Seeded from ${slotRows.length} existing slots`);
                } else {
                    toast('No slots found in seed timetable, using random start', { icon: '⚠️' });
                }
            }

            const result = await runSolver(
                solverInput,
                (p) => setProgress(p),
                cancelTokenRef.current,
                seedSolution,
            );
            setSolverResult(result);
            // Set default name based on cluster
            const cluster = clusters.find(c => c.id === selectedClusterId);
            if (cluster) {
                setTimetableName(`${cluster.department} Sem-${cluster.semester_number} (${cluster.batch_year})`);
            }
            if (result.fitness.hardViolations === 0) {
                toast.success('Feasible timetable found! 🎉');
            } else {
                toast(`Best effort: ${result.fitness.hardViolations} conflicts remain`, { icon: '⚠️' });
            }
        } catch (err) {
            toast.error(`Solver error: ${err instanceof Error ? err.message : 'Unknown'}`);
        } finally {
            setIsRunning(false);
        }
    }, [clusterSubjects, clusterGroups, rooms, assignments, homeRooms, seedTimetableId, clusters, selectedClusterId]);

    // ─── Cancel Solver ────────────────────────────────────────────────────────
    const handleCancel = useCallback(() => {
        cancelTokenRef.current.cancelled = true;
    }, []);

    // ─── Save to Supabase ─────────────────────────────────────────────────────
    const handleSave = useCallback(async () => {
        if (!solverResult) return;
        setSaving(true);

        try {
            const cluster = clusters.find(c => c.id === selectedClusterId);
            if (!cluster) throw new Error('Cluster not found');

            // Get or create timetable record
            const { data: timetable, error: ttErr } = await supabase
                .from('timetables')
                .insert({
                    name: timetableName.trim(),
                    academic_year: `${cluster.batch_year}-${cluster.batch_year + 1}`,
                    semester: cluster.semester_number,
                    status: 'draft',
                })
                .select('id')
                .single();

            if (ttErr) throw ttErr;

            // Prepare solver input for session info
            const solverInput = prepareSolverInput(
                clusterSubjects as SubjectFull[],
                clusterGroups,
                rooms,
                assignments,
                homeRooms,
            );

            // Build timetable_slots rows
            const slots = solverResult.solution.map((gene, i) => {
                const session = solverInput.sessions[i];
                const room = solverInput.rooms[gene.roomIndex];
                const startTime = slotToStartTime(gene.startBucket);
                const endTime = slotToEndTime(gene.startBucket + session.duration - 1);

                return {
                    timetable_id: timetable.id,
                    subject_id: session.subjectId,
                    professor_id: session.professorId,
                    room_id: room?.id ?? null,
                    student_group_id: session.groupId,
                    day_of_week: gene.day,
                    start_time: startTime,
                    end_time: endTime,
                    slot_type: session.slotType,
                };
            });

            const { error: slotErr } = await supabase
                .from('timetable_slots')
                .insert(slots);

            if (slotErr) throw slotErr;

            setSaved(true);
            toast.success(`Saved ${slots.length} slots to timetable "${timetable.id}"!`);
        } catch (err) {
            toast.error(`Save failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        } finally {
            setSaving(false);
        }
    }, [solverResult, clusters, selectedClusterId, clusterSubjects, clusterGroups, rooms, assignments, homeRooms, timetableName]);

    // ─── Derived ──────────────────────────────────────────────────────────────
    const roomableGroups = clusterGroups.filter(g => g.name !== 'WMC');
    const allGroup = clusterGroups.find(g => g.name === 'WMC');
    const sectionGroups = roomableGroups;

    // Count based on each subject's section mode
    let totalCells = 0;
    let filledCells = 0;
    clusterSubjects.forEach(sub => {
        const mode = sectionModes[sub.id] ?? getDefaultMode(sub);
        const relevantGroups = mode === 'all' && allGroup ? [allGroup] : sectionGroups;
        totalCells += relevantGroups.length;
        relevantGroups.forEach(g => {
            if (assignments[sub.id]?.[g.id]) filledCells++;
        });
    });

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
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold ml-2">
                            (1+1)-ES
                        </span>
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Configure constraints, then generate a conflict-free timetable using Evolution Strategy.
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    {selectedClusterId && !fetchingDetails && (
                        <button
                            onClick={handleAutoFill}
                            disabled={isRunning}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100 transition text-sm font-medium disabled:opacity-40"
                            title="Developer tool: instantly fills all fields with valid data"
                        >
                            <Wand2 className="w-4 h-4" />
                            Dev: Auto-Fill
                        </button>
                    )}

                    {/* Seed Timetable Picker */}
                    {seedTimetables.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-300 rounded-lg">
                            <Database className="w-4 h-4 text-green-600" />
                            <select
                                value={seedTimetableId}
                                onChange={(e) => setSeedTimetableId(e.target.value)}
                                disabled={isRunning}
                                className="bg-transparent text-sm font-medium text-green-800 outline-none cursor-pointer max-w-[200px]"
                            >
                                <option value="">Random Start</option>
                                {seedTimetables.map(t => (
                                    <option key={t.id} value={t.id}>
                                        🌱 {t.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <button
                        onClick={handleGenerate}
                        disabled={!isConfigComplete || isRunning}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                        <Sparkles className="w-4 h-4" />
                        {isRunning ? 'Running…' : 'Generate Timetable'}
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

            {/* ── Solver Progress (shown while running) ── */}
            {isRunning && (
                <SolverProgressCard progress={progress} onCancel={handleCancel} />
            )}

            {/* ── Solver Results (shown after completion) ── */}
            {solverResult && !isRunning && (
                <SolverResults
                    result={solverResult}
                    sessionCount={
                        prepareSolverInput(
                            clusterSubjects as SubjectFull[],
                            clusterGroups,
                            rooms,
                            assignments,
                            homeRooms,
                        ).sessions.length
                    }
                    timetableName={timetableName}
                    onNameChange={setTimetableName}
                    onSave={handleSave}
                    saving={saving}
                    saved={saved}
                />
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
                        sectionModes={sectionModes}
                        onAssign={handleAssignment}
                        onApplyToAll={handleApplyToAll}
                        onSectionModeChange={handleSectionModeChange}
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
                            onClick={handleGenerate}
                            disabled={!isConfigComplete || isRunning}
                            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Sparkles className="w-4 h-4" />
                            {isRunning ? 'Running…' : 'Generate Timetable'}
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
