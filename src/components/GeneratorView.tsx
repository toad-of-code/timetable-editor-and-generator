import { useState, useCallback, useRef, useEffect } from 'react';
import { Settings, Calendar, Sparkles, AlertCircle, Loader2, Wand2, Database, Lock } from 'lucide-react';
import { useGeneratorData } from '../hooks/useGeneratorData';
import { ClusterSelector } from './generator/ClusterSelector';
import { HomeRoomMapper } from './generator/HomeRoomMapper';
import { AssignmentMatrix } from './generator/AssignmentMatrix';
import { SolverProgressCard } from './generator/SolverProgress';
import { SolverResults } from './generator/SolverResults';
import { prepareSolverInput, buildSeedSolution, buildLockedSessions } from '../solver/dataPrep';
import type { TimetableSlotRow, PublishedSlotRow } from '../solver/dataPrep';
import { runSolver } from '../solver/solver';
import { generateSolverLog, downloadLogFile } from '../solver/solverLog';
import { slotToStartTime, slotToEndTime } from '../solver/constants';
import { supabase } from '../lib/supabase';
import type { SolverProgress, SolverResult } from '../solver/types';
import type { SubjectFull } from '../solver/dataPrep';
import { EditorView } from './EditorView';
import toast from 'react-hot-toast';

export function GeneratorView() {
    // ─── UI / Config State ────────────────────────────────────────────────────
    const [selectedClusterId, setSelectedClusterId] = useState('');
    const [homeRooms, setHomeRooms] = useState<Record<string, string>>({});
    const [assignments, setAssignments] = useState<Record<string, Record<string, string>>>({});
    const [sectionModes, setSectionModes] = useState<Record<string, 'all' | 'sections' | 'itbi'>>({});

    // ─── Solver State ─────────────────────────────────────────────────────────
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<SolverProgress | null>(null);
    const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [timetableName, setTimetableName] = useState('');
    const cancelTokenRef = useRef({ cancelled: false });

    // ─── Editor Transition State ──────────────────────────────────────────────
    const [editorTimetableId, setEditorTimetableId] = useState<string | null>(null);
    const [savedTimetableId, setSavedTimetableId] = useState<string | null>(null);

    // ─── Seed Timetable State ─────────────────────────────────────────────────
    const [seedTimetables, setSeedTimetables] = useState<{ id: string; name: string; semester: number }[]>([]);
    const [seedTimetableId, setSeedTimetableId] = useState<string>('');
    /** IDs of timetables whose slots should be locked (treated as fixed constraints). */
    const [lockedTimetableIds, setLockedTimetableIds] = useState<Set<string>>(new Set());

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
        setLockedTimetableIds(new Set());
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
        const sectionGroups = clusterGroups.filter(g => g.name !== 'WMC' && !/IT[\s-]*BI/i.test(g.name));
        const all: Record<string, string> = {};
        sectionGroups.forEach(g => { all[g.id] = profId; });
        setAssignments(prev => ({ ...prev, [subjectId]: all }));
    };

    const handleSectionModeChange = (subjectId: string, mode: 'all' | 'sections' | 'itbi') => {
        setSectionModes(prev => ({ ...prev, [subjectId]: mode }));
        // Clear assignments for this subject when switching modes
        setAssignments(prev => ({ ...prev, [subjectId]: {} }));
    };

    const handleHomeRoom = (groupId: string, roomId: string) => {
        setHomeRooms(prev => ({ ...prev, [groupId]: roomId }));
    };

    // Helper: detect IT-BI group (robust matching for variations)
    const isITBIGroup = (name: string) => /IT[\s-]*BI/i.test(name);

    // Helper: default section mode per subject (electives → 'all', core → 'sections')
    const getDefaultMode = (sub: { subject_type: string }): 'all' | 'sections' =>
        (sub.subject_type === 'Elective' || sub.subject_type === 'Minor') ? 'all' : 'sections';

    // ─── Floor Home Room Policy ───────────────────────────────────────────────
    // Rooms follow the naming pattern CC-3-5xyy where:
    //   x   = floor digit derived from semester: sem 1-2 → 0, sem 3-4 → 1, sem 5-6 → 2
    //   yy  = section suffix: A → 06, B → 07, C → 54, D → 55
    // Example: Sem 3, Section B → CC-3-5107

    const SECTION_ROOM_SUFFIX: Record<string, string> = { A: '06', B: '07', C: '54', D: '55' };

    function getFloorDigit(semester: number): string {
        if (semester <= 2) return '0';
        if (semester <= 4) return '1';
        return '2';
    }

    /** Extract section letter (A-D) from a group name — e.g. "Sec A", "IT-B", "C" → A/B/C/D */
    function getSectionLetter(groupName: string): string | null {
        const m = groupName.match(/\b([A-D])\b/i);
        return m ? m[1].toUpperCase() : null;
    }

    /** Build homeRooms map using the floor policy. Returns only the entries that could be matched. */
    const buildFloorHomeRooms = useCallback((): Record<string, string> => {
        const cluster = clusters.find(c => c.id === selectedClusterId);
        if (!cluster) return {};
        const floor = getFloorDigit(cluster.semester_number);
        const result: Record<string, string> = {};
        for (const group of clusterGroups) {
            if (group.name === 'WMC' || isITBIGroup(group.name)) continue;
            const letter = getSectionLetter(group.name);
            const suffix = letter ? SECTION_ROOM_SUFFIX[letter] : null;
            if (!suffix) continue;
            const targetName = `CC-3-5${floor}${suffix}`;
            const room = rooms.find(r => r.name === targetName);
            if (room) result[group.id] = room.id;
        }
        return result;
    }, [clusters, selectedClusterId, clusterGroups, rooms]);

    // Auto-apply floor home rooms whenever a cluster + its data finishes loading
    useEffect(() => {
        if (!selectedClusterId || fetchingDetails || clusterGroups.length === 0 || rooms.length === 0) return;
        const floorRooms = buildFloorHomeRooms();
        if (Object.keys(floorRooms).length > 0) {
            setHomeRooms(prev => ({ ...prev, ...floorRooms }));
        }
    }, [selectedClusterId, fetchingDetails, clusterGroups, rooms, buildFloorHomeRooms]);

    // ─── DX: Auto-fill ────────────────────────────────────────────────────────
    const handleAutoFill = useCallback(() => {
        if (professors.length === 0) return;

        const allGroups = clusterGroups.filter(g => g.name !== 'WMC');
        const sectionGroups = allGroups.filter(g => !isITBIGroup(g.name));
        const allGroup = clusterGroups.find(g => g.name === 'WMC');

        // Use floor policy home rooms — fall back to round-robin if no match found
        const floorRooms = buildFloorHomeRooms();
        const lectureRooms = rooms.filter(r => r.room_type === 'Lecture');
        const newHomeRooms: Record<string, string> = {};
        allGroups.forEach((g, i) => {
            newHomeRooms[g.id] = floorRooms[g.id] ?? lectureRooms[i % lectureRooms.length]?.id ?? '';
        });

        // Set mode: use existing mode or smart default (electives → WMC)
        const newModes: Record<string, 'all' | 'sections' | 'itbi'> = {};
        const newAssignments: Record<string, Record<string, string>> = {};

        clusterSubjects.forEach((sub, si) => {
            const pool = (expertiseMap[sub.id] ?? professors);
            const resolved = pool.length > 0 ? pool : professors;
            const mode = sectionModes[sub.id] ?? getDefaultMode(sub);
            newModes[sub.id] = mode;
            newAssignments[sub.id] = {};

            const itbiGroup = clusterGroups.find(g => isITBIGroup(g.name));

            if (mode === 'itbi' && itbiGroup) {
                // Only assign to IT-BI group
                newAssignments[sub.id][itbiGroup.id] = resolved[si % resolved.length].id;
            } else if (mode === 'all' && allGroup) {
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
    }, [professors, expertiseMap, clusterGroups, rooms, clusterSubjects, sectionModes]);

    // ─── Generate Timetable Handler ───────────────────────────────────────────
    const handleGenerate = useCallback(async () => {
        const solverInput = prepareSolverInput(
            clusterSubjects as SubjectFull[],
            clusterGroups,
            professors,
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

        const normalSessionCount = solverInput.sessions.length;

        try {
            // ── Fetch selected locked timetable slots ──
            let lockedGenes: import('../solver/types').Gene[] = [];

            if (lockedTimetableIds.size > 0) {
                const { data: publishedRaw, error: pubErr } = await supabase
                    .from('timetable_slots')
                    .select(`
                        subject_id, student_group_id, professor_id, room_id,
                        day_of_week, start_time, end_time, slot_type,
                        subject:subject_id (code, subject_type),
                        student_group:student_group_id (name)
                    `)
                    .in('timetable_id', [...lockedTimetableIds]);
                if (pubErr) {
                    toast('Could not load locked timetables — generating without constraints', { icon: '⚠️' });
                } else if (publishedRaw && publishedRaw.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const publishedSlots: PublishedSlotRow[] = (publishedRaw as any[]).map(r => ({
                        subject_id: r.subject_id,
                        student_group_id: r.student_group_id,
                        professor_id: r.professor_id,
                        room_id: r.room_id,
                        day_of_week: r.day_of_week,
                        start_time: r.start_time,
                        end_time: r.end_time,
                        slot_type: r.slot_type,
                        subject_code: r.subject?.code ?? '??',
                        subject_type: r.subject?.subject_type ?? 'Core',
                        group_name: r.student_group?.name ?? '??',
                    }));

                    const locked = buildLockedSessions(
                        publishedSlots,
                        solverInput.rooms,
                        normalSessionCount,
                    );

                    solverInput.sessions = [...solverInput.sessions, ...locked.sessions];
                    lockedGenes = locked.genes;
                    toast(`Locking ${locked.sessions.length} slots from ${lockedTimetableIds.size} timetable(s)`, { icon: '🔒' });
                }
            }

            toast(`Scheduling ${normalSessionCount} sessions…`, { icon: '🧬' });

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

            // ── Pin locked genes into seed/initial solution ──
            // The solver's generateInitialSolution() puts placeholders for locked sessions.
            // We need to overwrite those with the correct fixed positions.
            const result = await runSolver(
                solverInput,
                (p) => setProgress(p),
                cancelTokenRef.current,
                seedSolution,
                lockedGenes,
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

            // ── Auto-download solver log ──
            const logClusterName = cluster
                ? `${cluster.department} Sem-${cluster.semester_number} (${cluster.batch_year})`
                : 'Unknown Cluster';
            const logContent = generateSolverLog(solverInput, result, logClusterName);
            const logTs = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            downloadLogFile(logContent, `solver-log_${logTs}.txt`);
        } catch (err) {
            toast.error(`Solver error: ${err instanceof Error ? err.message : 'Unknown'}`);
        } finally {
            setIsRunning(false);
        }
    }, [clusterSubjects, clusterGroups, rooms, assignments, homeRooms, seedTimetableId, clusters, selectedClusterId, lockedTimetableIds, professors]);

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
                professors,
                rooms,
                assignments,
                homeRooms,
            );

            // Build timetable_slots rows — ONLY from normal (non-locked) sessions.
            // solverResult.solution may include extra locked genes from published timetables,
            // but the fresh solverInput only contains normal sessions.
            const normalCount = solverInput.sessions.length;
            const slots = solverResult.solution
                .slice(0, normalCount)
                .map((gene, i) => ({ gene, session: solverInput.sessions[i] }))
                .map(({ gene, session }) => {
                    const room = solverInput.rooms[gene.roomIndex];
                    const startTime = slotToStartTime(gene.startBucket);
                    const endTime = slotToEndTime(gene.startBucket + session.duration - 1);

                    return {
                        timetable_id: timetable.id,
                        subject_id: session.subjectId,
                        professor_id: session.professorId || null,
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
            setSavedTimetableId(timetable.id);
            toast.success(`Saved ${slots.length} slots to timetable "${timetable.id}"!`);
        } catch (err) {
            toast.error(`Save failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        } finally {
            setSaving(false);
        }
    }, [solverResult, clusters, selectedClusterId, clusterSubjects, clusterGroups, rooms, assignments, homeRooms, timetableName, professors]);

    // ─── Derived ──────────────────────────────────────────────────────────────
    const roomableGroups = clusterGroups.filter(g => g.name !== 'WMC');
    const allGroup = clusterGroups.find(g => g.name === 'WMC');
    const sectionGroups = roomableGroups.filter(g => !isITBIGroup(g.name));

    // Count based on each subject's section mode
    let totalCells = 0;
    let filledCells = 0;
    clusterSubjects.forEach(sub => {
        const mode = sectionModes[sub.id] ?? getDefaultMode(sub);
        const itbiGroup = clusterGroups.find(g => isITBIGroup(g.name));
        const relevantGroups = mode === 'all' && allGroup ? [allGroup]
            : mode === 'itbi' && itbiGroup ? [itbiGroup]
                : sectionGroups;
        totalCells += relevantGroups.length;
        relevantGroups.forEach(g => {
            if (assignments[sub.id]?.[g.id]) filledCells++;
        });
    });

    const isConfigComplete =
        totalCells > 0 &&
        filledCells === totalCells &&
        roomableGroups.every(g => homeRooms[g.id]);

    // ─── If editor is active, render EditorView ──────────────────────────────
    if (editorTimetableId) {
        return (
            <EditorView
                initialTimetableId={editorTimetableId}
                onBack={() => setEditorTimetableId(null)}
            />
        );
    }

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

                    {/* Lock Timetable Picker */}
                    {seedTimetables.length > 0 && (
                        <details className="relative" onClick={(e) => e.stopPropagation()}>
                            <summary
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer list-none select-none transition ${lockedTimetableIds.size > 0
                                    ? 'bg-orange-50 border-orange-300 text-orange-800'
                                    : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
                                    }`}
                            >
                                <Lock className="w-4 h-4" />
                                {lockedTimetableIds.size > 0
                                    ? `${lockedTimetableIds.size} Locked`
                                    : 'Lock TTs'}
                            </summary>
                            <div className="absolute right-0 top-10 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-[240px] max-h-64 overflow-y-auto">
                                <p className="text-xs text-gray-500 mb-2 font-medium">Select timetables to lock as constraints:</p>
                                {seedTimetables.map(t => (
                                    <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            disabled={isRunning}
                                            checked={lockedTimetableIds.has(t.id)}
                                            onChange={() => {
                                                setLockedTimetableIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(t.id)) next.delete(t.id);
                                                    else next.add(t.id);
                                                    return next;
                                                });
                                            }}
                                            className="accent-orange-500"
                                        />
                                        <span className="text-sm text-gray-700 truncate">{t.name}</span>
                                        <span className="ml-auto text-xs text-gray-400">Sem {t.semester}</span>
                                    </label>
                                ))}
                                {lockedTimetableIds.size > 0 && (
                                    <button
                                        onClick={() => setLockedTimetableIds(new Set())}
                                        className="mt-2 w-full text-xs text-red-500 hover:text-red-700 text-center py-1"
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>
                        </details>
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
                            professors,
                            rooms,
                            assignments,
                            homeRooms,
                        ).sessions.length
                    }
                    timetableName={timetableName}
                    onNameChange={setTimetableName}
                    onSave={handleSave}
                    onEdit={savedTimetableId ? () => setEditorTimetableId(savedTimetableId) : undefined}
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
