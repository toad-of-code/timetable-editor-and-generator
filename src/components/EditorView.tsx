import { useState, useCallback, useMemo, useRef } from 'react';
import {
    Loader2, Save, CheckCircle2, AlertTriangle, GripVertical,
    Undo2, Send, Pencil, Calendar, Filter,
} from 'lucide-react';
import { useEditorData } from '../hooks/useEditorData';
import {
    solutionFromSlots, checkFeasibility,
    type EditorSlot, type FeasibilityResult,
} from '../solver/localSearch';
import { SLOT_START_TIMES, SLOT_END_TIMES } from '../solver/constants';
import toast from 'react-hot-toast';

// ─── Types ─────────────────────────────────────────────────────────────────────

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;

interface TimeColumn {
    label: string;
    start: string;
    end: string;
    isLunch?: boolean;
    isBreak?: boolean;
}

// ─── Helper: convert 24h time to 12h ──────────────────────────────────────────

function convertTo12Hour(time24: string): string {
    if (!time24) return '';
    const [hourStr, minute] = time24.split(':');
    let hour = parseInt(hourStr);
    hour = hour % 12 || 12;
    return `${hour}:${minute}`;
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface EditorViewProps {
    initialTimetableId?: string;
    onBack?: () => void;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function EditorView({ initialTimetableId, onBack }: EditorViewProps) {
    const {
        timetables, loadingList,
        selectedTimetableId, setSelectedTimetableId, timetableMeta,
        slots, setSlots, loadingSlots,
        rooms, professors,
        saveSlots, publishTimetable,
        saving, publishing,
        error,
    } = useEditorData(initialTimetableId);

    // ── Undo stack ──
    const [undoStack, setUndoStack] = useState<EditorSlot[][]>([]);
    const canUndo = undoStack.length > 0;

    // ── Editing slot ──
    const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

    // ── Feasibility ──
    const [feasibility, setFeasibility] = useState<FeasibilityResult | null>(null);
    const [isFeasibilityDirty, setIsFeasibilityDirty] = useState(false);

    // ── Drag state ──
    const dragSlotId = useRef<string | null>(null);

    // ── Section filter (same style as TimetableViewer) ──

    const allSections = useMemo(() =>
        Array.from(new Set(slots.map(s => s.group_name))).sort(),
        [slots],
    );

    const [selectedEntity, setSelectedEntity] = useState<string>('All Sections');
    const dropdownOptions = useMemo(() => ['All Sections', ...allSections], [allSections]);

    if (dropdownOptions.length > 0 && !dropdownOptions.includes(selectedEntity)) {
        setSelectedEntity(dropdownOptions[0]);
    }

    // ── Dynamic time columns (same pattern as TimetableViewer) ──
    const dynamicTimeColumns = useMemo(() => {
        if (slots.length === 0) return [
            { label: '9:00 - 10:00', start: '09:00', end: '10:00' },
            { label: 'LUNCH', start: '13:00', end: '14:30', isLunch: true },
        ];

        const boundaries = new Set<string>();
        slots.forEach(s => {
            boundaries.add(s.start_time.slice(0, 5));
            boundaries.add(s.end_time.slice(0, 5));
        });
        boundaries.add('10:50');
        boundaries.add('11:00');
        boundaries.add('13:00');
        boundaries.add('14:30');

        const sortedTimes = Array.from(boundaries).sort();
        const filteredTimes = sortedTimes.filter(t => !(t > '13:00' && t < '14:30'));

        const cols: TimeColumn[] = [];
        for (let i = 0; i < filteredTimes.length - 1; i++) {
            const start = filteredTimes[i];
            const end = filteredTimes[i + 1];
            const isLunch = start === '13:00' && end === '14:30';
            const isBreak = start === '10:50' && end === '11:00';

            const cStart = parseInt(start.replace(':', ''));
            const cEnd = parseInt(end.replace(':', ''));
            const hasClass = slots.some(s => {
                const sStart = parseInt(s.start_time.slice(0, 5).replace(':', ''));
                const sEnd = parseInt(s.end_time.slice(0, 5).replace(':', ''));
                return sStart < cEnd && sEnd > cStart;
            });

            if (isLunch || isBreak || hasClass) {
                cols.push({
                    label: isLunch ? 'LUNCH' : isBreak ? 'BREAK' : `${convertTo12Hour(start)} - ${convertTo12Hour(end)}`,
                    start, end,
                    isLunch: isLunch || isBreak,
                    isBreak,
                });
            }
        }
        return cols;
    }, [slots]);

    // ── Processed/deduped slots ──
    const processedSlots = useMemo(() => {
        const unique: EditorSlot[] = [];
        const seen = new Set<string>();
        slots.forEach(slot => {
            const key = `${slot.day_of_week}-${slot.start_time}-${slot.group_name}-${slot.subject_code}`;
            if (!seen.has(key)) { seen.add(key); unique.push(slot); }
        });
        return unique;
    }, [slots]);

    // ── Identify conflicting slot IDs (for red highlight) ──
    const conflictSlotIds = useMemo(() => {
        const ids = new Set<string>();
        const timeOverlaps = (a: EditorSlot, b: EditorSlot) =>
            a.start_time.slice(0, 5) < b.end_time.slice(0, 5) && b.start_time.slice(0, 5) < a.end_time.slice(0, 5);

        for (let i = 0; i < slots.length; i++) {
            for (let j = i + 1; j < slots.length; j++) {
                const a = slots[i], b = slots[j];
                if (a.day_of_week !== b.day_of_week) continue;
                if (!timeOverlaps(a, b)) continue;

                // Room clash
                if (a.room_id && a.room_id === b.room_id) {
                    ids.add(a.id); ids.add(b.id);
                }
                // Professor clash
                if (a.professor_id && a.professor_id === b.professor_id
                    && a.professor_name !== 'Unknown' && a.professor_name !== 'TBD') {
                    ids.add(a.id); ids.add(b.id);
                }

                const bothElectives = (a.subject_type === 'Elective' || a.subject_type === 'Minor') &&
                    (b.subject_type === 'Elective' || b.subject_type === 'Minor');

                // Section clash (same group)
                if (a.student_group_id === b.student_group_id) {
                    if (!bothElectives) {
                        ids.add(a.id); ids.add(b.id);
                    }
                }

                // WMC vs section clash
                const aWB = a.group_name === 'WMC' || a.group_name === 'IT-BI';
                const bWB = b.group_name === 'WMC' || b.group_name === 'IT-BI';
                if (aWB !== bWB) {
                    if (!bothElectives) {
                        ids.add(a.id); ids.add(b.id);
                    }
                }
            }
        }
        return ids;
    }, [slots]);

    // ── Feasibility tracking ──
    // Moved to manual button check

    const pushUndo = useCallback(() => {
        setUndoStack(prev => [...prev.slice(-30), slots.map(s => ({ ...s }))]);
    }, [slots]);

    const handleUndo = useCallback(() => {
        if (undoStack.length === 0) return;
        const prev = undoStack[undoStack.length - 1];
        setSlots(prev);
        const newStack = undoStack.slice(0, -1);
        setUndoStack(newStack);
        setIsFeasibilityDirty(true);
        // Clear feasibility when fully undone (back to original)
        if (newStack.length === 0) setFeasibility(null);
    }, [undoStack, setSlots]);

    // ── Drag & Drop ──

    const handleDragStart = useCallback((slotId: string) => {
        dragSlotId.current = slotId;
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const handleDrop = useCallback((dayIndex: number, col: TimeColumn) => {
        const sid = dragSlotId.current;
        if (!sid || col.isLunch) return;
        dragSlotId.current = null;

        const slot = slots.find(s => s.id === sid);
        if (!slot) return;

        const newDay = dayIndex + 1;
        const newStart = col.start;

        // Calculate end time based on duration (slice to handle Supabase HH:MM:SS format)
        const oldStartStr = slot.start_time.slice(0, 5);
        const oldEndStr = slot.end_time.slice(0, 5);
        const oldStartIdx = SLOT_START_TIMES.indexOf(oldStartStr);
        const oldEndIdx = SLOT_END_TIMES.indexOf(oldEndStr);
        const duration = Math.max(1, oldEndIdx - oldStartIdx + 1);
        const newStartIdx = SLOT_START_TIMES.indexOf(newStart);
        if (newStartIdx < 0) { toast.error('Invalid slot'); return; }
        const newEndIdx = newStartIdx + duration - 1;
        if (newEndIdx >= SLOT_END_TIMES.length) {
            toast.error('Session does not fit in this time slot');
            return;
        }
        const newEnd = SLOT_END_TIMES[newEndIdx];

        if (slot.day_of_week === newDay && slot.start_time === newStart) return;

        pushUndo();
        const updated = slots.map(s =>
            s.id === sid ? { ...s, day_of_week: newDay, start_time: newStart, end_time: newEnd } : s
        );
        setSlots(updated);
        setIsFeasibilityDirty(true);
        toast(`Moved ${slot.subject_code} to ${DAYS[dayIndex]} ${convertTo12Hour(newStart)}`, { icon: '📦' });
    }, [slots, setSlots, pushUndo]);

    // ── Inline edits ──

    const handleRoomChange = useCallback((slotId: string, newRoomId: string) => {
        pushUndo();
        const room = rooms.find(r => r.id === newRoomId);
        setSlots(prev => prev.map(s =>
            s.id === slotId ? { ...s, room_id: newRoomId, room_name: room?.name ?? '—' } : s
        ));
        setIsFeasibilityDirty(true);
    }, [rooms, setSlots, pushUndo]);

    const handleProfChange = useCallback((slotId: string, newProfId: string) => {
        pushUndo();
        const prof = professors.find(p => p.id === newProfId);
        setSlots(prev => prev.map(s =>
            s.id === slotId ? { ...s, professor_id: newProfId, professor_name: prof?.name ?? 'TBD' } : s
        ));
        setIsFeasibilityDirty(true);
    }, [professors, setSlots, pushUndo]);

    // ── Save / Publish ──

    const handleSave = useCallback(async () => {
        try { await saveSlots(slots); toast.success('Timetable saved!'); setUndoStack([]); }
        catch { toast.error('Save failed'); }
    }, [slots, saveSlots]);

    const handlePublish = useCallback(async () => {
        try {
            await saveSlots(slots);
            await publishTimetable();
            toast.success('Timetable published! 🎉');
            setUndoStack([]);
        } catch { toast.error('Publish failed'); }
    }, [slots, saveSlots, publishTimetable]);

    // ── Feasibility check ──

    const handleCheckFeasibility = useCallback(() => {
        if (slots.length === 0) return;
        const roomList = rooms.map(r => ({ id: r.id, name: r.name, roomType: r.room_type }));
        const roomIdToIndex = new Map<string, number>();
        roomList.forEach((r, i) => roomIdToIndex.set(r.id, i));

        const sessions = slots.map((s, i) => {
            const startIdx = SLOT_START_TIMES.indexOf(s.start_time.slice(0, 5));
            const endIdx = SLOT_END_TIMES.indexOf(s.end_time.slice(0, 5));
            const duration = Math.max(1, endIdx - startIdx + 1);
            const isElective = s.subject_type === 'Elective' || s.subject_type === 'Minor';
            const profIsUnknown = s.professor_name === 'Unknown' || s.professor_name === 'TBD';
            return {
                id: i, subjectId: s.subject_id, subjectCode: s.subject_code,
                groupId: s.student_group_id, professorId: profIsUnknown ? '' : (s.professor_id ?? ''),
                duration, slotType: s.slot_type as 'Lecture' | 'Tutorial' | 'Practical',
                homeRoomIndex: s.room_id ? (roomIdToIndex.get(s.room_id) ?? 0) : 0,
                isElective, electiveSlotIndex: isElective ? 0 : -1,
                basketName: null, // feasibility check doesn't use basket constraints
                isWMCGroup: s.group_name === 'WMC' || /IT[\s-]*BI/i.test(s.group_name ?? ''),
            };
        });

        const solverInput = {
            sessions, rooms: roomList, numDays: 5, numBuckets: 8,
            config: {
                maxGenerations: 0, reportInterval: 0, initialSigma: 2, gapWeight: 1,
                hardPenalty: 1000, adaptationWindow: 50, sigmaIncrease: 1.22, sigmaDecrease: 0.82
            },
        };

        const solution = solutionFromSlots(solverInput, slots);
        const result = checkFeasibility(solverInput, solution);
        setFeasibility(result);
        setIsFeasibilityDirty(false);
        if (result.feasible) toast.success('No conflicts detected! ✅');
        else toast(`${result.fitness.hardViolations} conflict(s) found`, { icon: '⚠️' });
    }, [slots, rooms]);

    // Used to be automatic, now manual via button

    // ── Render slot item (TimetableViewer style) ──

    const renderSlotItem = (slot: EditorSlot) => {
        const isLab = slot.slot_type === 'Practical';
        const isTutorial = slot.slot_type === 'Tutorial';
        const textColor = isLab ? 'text-orange-600' : isTutorial ? 'text-green-800' : 'text-black';
        const isEditing = editingSlotId === slot.id;

        const isConflict = conflictSlotIds.has(slot.id);

        return (
            <div
                key={slot.id}
                draggable={!isEditing}
                onDragStart={() => !isEditing && handleDragStart(slot.id)}
                className={`group w-full flex flex-col justify-center items-center text-[9px] leading-tight
          border-b last:border-0 p-1 ${textColor}
          ${isConflict ? 'bg-red-50 border-red-300 ring-1 ring-red-300' : 'bg-transparent border-gray-100'}
          ${!isEditing ? 'cursor-grab active:cursor-grabbing' : ''}
          hover:bg-blue-50/30 transition-colors relative`}
            >
                {/* Drag handle (shown on hover) */}
                {!isEditing && (
                    <GripVertical className="absolute top-0.5 right-0.5 w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
                )}

                {/* Line 1: Code & Type */}
                <div className="font-bold whitespace-nowrap">
                    {slot.subject_code} ({slot.slot_type.charAt(0)})
                </div>

                {/* Line 2: Professor */}
                {slot.professor_name && slot.professor_name !== 'TBD' && (
                    <div className="text-[8px] font-bold text-indigo-600 tracking-wide whitespace-nowrap">
                        {slot.professor_name}
                    </div>
                )}

                {/* Line 3: Room & Group */}
                <div className="scale-90 opacity-90 whitespace-nowrap flex flex-wrap justify-center gap-1 items-center text-black">
                    <span className="text-gray-600">{slot.room_name}</span>
                    <span className="text-gray-300">•</span>
                    <span className="font-semibold text-cyan-800">{slot.group_name}</span>
                </div>

                {/* Inline editing panel */}
                {isEditing && (
                    <div
                        className="mt-1 w-full space-y-1 bg-white rounded p-2 border border-gray-200 shadow-sm"
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.stopPropagation()}
                        draggable={false}
                    >
                        <div>
                            <label className="text-[8px] uppercase font-bold text-gray-400 block">Room</label>
                            <select
                                value={slot.room_id ?? ''}
                                onChange={(e) => handleRoomChange(slot.id, e.target.value)}
                                className="w-full text-[10px] px-1 py-0.5 rounded border border-gray-200 bg-white"
                            >
                                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[8px] uppercase font-bold text-gray-400 block">Professor</label>
                            <select
                                value={slot.professor_id ?? ''}
                                onChange={(e) => handleProfChange(slot.id, e.target.value)}
                                className="w-full text-[10px] px-1 py-0.5 rounded border border-gray-200 bg-white"
                            >
                                {professors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <button
                            onClick={() => setEditingSlotId(null)}
                            className="text-[9px] text-indigo-600 font-semibold hover:underline"
                        >Done</button>
                    </div>
                )}

                {/* Edit button (shown on hover) */}
                {!isEditing && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setEditingSlotId(slot.id); }}
                        className="absolute bottom-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity
              w-4 h-4 rounded-full bg-white/90 border border-gray-200 flex items-center justify-center
              hover:bg-indigo-50 hover:border-indigo-300"
                        title="Edit slot"
                    >
                        <Pencil className="w-2.5 h-2.5 text-gray-500" />
                    </button>
                )}
            </div>
        );
    };

    // ── Render cell (TimetableViewer style) ──

    const renderCellContent = (dayIndex: number, column: TimeColumn) => {
        const colStart = parseInt(column.start.replace(':', ''));
        const colEnd = parseInt(column.end.replace(':', ''));

        let cellSlots = processedSlots.filter(s => {
            if (s.day_of_week !== dayIndex + 1) return false;
            const sStart = parseInt(s.start_time.slice(0, 5).replace(':', ''));
            const sEnd = parseInt(s.end_time.slice(0, 5).replace(':', ''));
            return sStart <= colStart && sEnd >= colEnd;
        });

        if (selectedEntity !== 'All Sections') {
            cellSlots = cellSlots.filter(s =>
                s.group_name === selectedEntity || s.group_name === 'WMC' || s.group_name === 'all'
            );
        }

        if (cellSlots.length === 0) return null;
        const isCrowded = cellSlots.length > 4;

        return (
            <div className="h-full flex flex-col justify-start overflow-y-auto custom-scrollbar">
                <div className={isCrowded ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1"}>
                    {cellSlots.map(slot => renderSlotItem(slot))}
                </div>
            </div>
        );
    };

    // ── Loading state ──
    if (loadingList) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] gap-3 text-indigo-500">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-sm font-medium">Loading timetables…</span>
            </div>
        );
    }

    // ── No timetable selected → show timetable list ──
    if (!selectedTimetableId) {
        return (
            <div className="p-4 bg-gray-50 min-h-screen font-sans">
                {/* Header */}
                <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                    <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Pencil className="w-5 h-5 text-indigo-600" />
                        Timetable Editor
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Select a timetable to edit. Drag & drop classes, change rooms/professors, then publish.
                    </p>
                </div>

                {timetables.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center max-w-md mx-auto">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Calendar className="w-8 h-8 text-gray-300" />
                        </div>
                        <h2 className="text-lg font-bold text-gray-700 mb-2">No Timetables Available</h2>
                        <p className="text-sm text-gray-500">
                            Generate a timetable from the <b>Generator</b> tab or import one from the <b>Import</b> tab first.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {timetables.map(tt => (
                            <button
                                key={tt.id}
                                onClick={() => {
                                    setSelectedTimetableId(tt.id);
                                    setUndoStack([]);
                                    setFeasibility(null);
                                    setSelectedEntity('All Sections');
                                }}
                                className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 text-left
                  hover:border-indigo-300 hover:shadow-md transition-all group"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <h3 className="font-bold text-gray-800 text-sm group-hover:text-indigo-700 transition-colors">
                                            {tt.name}
                                        </h3>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            {tt.academic_year} · Semester {tt.semester}
                                        </p>
                                    </div>
                                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border
                    ${tt.status === 'published'
                                            ? 'bg-green-100 border-green-300 text-green-700'
                                            : tt.status === 'archived'
                                                ? 'bg-gray-100 border-gray-300 text-gray-500'
                                                : 'bg-amber-100 border-amber-300 text-amber-700'
                                        }`}>
                                        {tt.status}
                                    </div>
                                </div>
                                <div className="text-[10px] text-gray-400">
                                    Created {new Date(tt.created_at).toLocaleDateString()}
                                    {tt.published_at && ` · Published ${new Date(tt.published_at).toLocaleDateString()}`}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ── Main Editor View ──
    return (
        <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">

            {/* ── Sticky Header (same style as TimetableViewer) ── */}
            <div className="mb-6 bg-white p-4 rounded-lg shadow-sm border flex flex-col md:flex-row justify-between items-center gap-4 sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full">
                            <span className="text-sm">←</span>
                        </button>
                    )}
                    <div>
                        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                            <Pencil className="w-4 h-4 text-indigo-600" />
                            {timetableMeta?.name ?? 'Editor'}
                        </h1>
                        <div className="text-xs text-gray-500">
                            Sem {timetableMeta?.semester} • {allSections.length} Sections
                            {timetableMeta && (
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase
                  ${timetableMeta.status === 'published' ? 'bg-green-100 text-green-700' :
                                        timetableMeta.status === 'archived' ? 'bg-gray-100 text-gray-500' :
                                            'bg-amber-100 text-amber-700'}`}>
                                    {timetableMeta.status}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                    {/* Timetable picker */}
                    <select
                        value={selectedTimetableId}
                        onChange={(e) => {
                            setSelectedTimetableId(e.target.value);
                            setUndoStack([]);
                            setFeasibility(null);
                            setSelectedEntity('All Sections');
                        }}
                        className="border p-2 rounded text-sm bg-gray-50 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        {timetables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>

                    {/* Section filter */}
                    <div className="flex items-center gap-1 border p-1 rounded bg-indigo-50 border-indigo-200">
                        <Filter className="w-3 h-3 text-indigo-500 ml-1" />
                        <select
                            value={selectedEntity}
                            onChange={(e) => setSelectedEntity(e.target.value)}
                            className="bg-transparent text-sm font-semibold text-indigo-900 outline-none min-w-[120px]"
                        >
                            {dropdownOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>

                    {/* Feasibility indicator */}
                    {isFeasibilityDirty ? (
                        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-semibold border bg-gray-50 border-gray-200 text-gray-500">
                            <AlertTriangle className="w-3.5 h-3.5" /> Out of Sync
                        </div>
                    ) : feasibility && (
                        <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-semibold border
              ${feasibility.feasible
                                ? 'bg-green-50 border-green-200 text-green-700'
                                : 'bg-red-50 border-red-200 text-red-700'}`}>
                            {feasibility.feasible
                                ? <><CheckCircle2 className="w-3.5 h-3.5" /> OK</>
                                : <><AlertTriangle className="w-3.5 h-3.5" /> {feasibility.fitness.hardViolations}</>}
                        </div>
                    )}

                    {/* Check Feasibility Button */}
                    <button
                        onClick={handleCheckFeasibility}
                        disabled={!isFeasibilityDirty && feasibility !== null}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-50 transition disabled:opacity-40 shadow-sm"
                    >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Check
                    </button>

                    {/* Undo */}
                    <button
                        onClick={handleUndo}
                        disabled={!canUndo}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition disabled:opacity-30"
                    >
                        <Undo2 className="w-3.5 h-3.5" /> Undo
                    </button>

                    {/* Save */}
                    <button
                        onClick={handleSave}
                        disabled={saving || undoStack.length === 0}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 transition disabled:opacity-40 shadow-sm"
                    >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {saving ? 'Saving…' : 'Save'}
                    </button>

                    {/* Publish */}
                    <button
                        onClick={handlePublish}
                        disabled={publishing || timetableMeta?.status === 'published'}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded transition shadow-sm
              ${timetableMeta?.status === 'published'
                                ? 'bg-green-600 text-white cursor-default'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40'}`}
                    >
                        {publishing
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</>
                            : timetableMeta?.status === 'published'
                                ? <><CheckCircle2 className="w-3.5 h-3.5" /> Published</>
                                : <><Send className="w-3.5 h-3.5" /> Publish</>}
                    </button>

                    {/* Back to list */}
                    <button
                        onClick={() => {
                            setSelectedTimetableId('');
                            setUndoStack([]);
                            setFeasibility(null);
                        }}
                        className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded hover:bg-gray-50 transition"
                    >
                        All TTs
                    </button>
                </div>
            </div>

            {/* ── Error ── */}
            {error && (
                <div className="flex items-center gap-3 p-4 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* ── Violation details with explanations ── */}
            {feasibility && !feasibility.feasible && feasibility.fitness.violationBreakdown && (() => {
                const bd = feasibility.fitness.violationBreakdown as Record<string, number>;
                const VIOLATION_INFO: Record<string, { label: string; icon: string; color: string; explanation: string }> = {
                    timeBoundary: { label: 'Time Boundary', icon: '⏰', color: 'bg-red-100 text-red-700 border-red-200', explanation: 'A class extends past the last slot (18:30). Move it earlier in the day.' },
                    breakCrossing: { label: 'Break Crossing', icon: '☕', color: 'bg-orange-100 text-orange-700 border-orange-200', explanation: 'A multi-slot session spans across a break or lunch period. Move it so it fits within one block.' },
                    roomOverlap: { label: 'Room Overlap', icon: '🏫', color: 'bg-red-100 text-red-700 border-red-200', explanation: 'Two or more classes are assigned to the same room at the same time. Change the room or move one class.' },
                    professorOverlap: { label: 'Professor Overlap', icon: '👨‍🏫', color: 'bg-orange-100 text-orange-700 border-orange-200', explanation: 'A professor is double-booked — teaching two classes at the same time. Change the professor or move a class.' },
                    groupOverlap: { label: 'Section Overlap', icon: '👥', color: 'bg-purple-100 text-purple-700 border-purple-200', explanation: 'A student group has two non-elective classes at the same time. Move one to a different slot.' },
                    electiveSync: { label: 'Elective Sync', icon: '🔗', color: 'bg-teal-100 text-teal-700 border-teal-200', explanation: 'Electives in the same group must run at the same day & time so students can choose. Align their slots.' },
                    labRoom: { label: 'Lab Room', icon: '🔬', color: 'bg-amber-100 text-amber-700 border-amber-200', explanation: 'A practical/lab session is assigned to a non-lab room. Change the room to a Lab.' },
                    wmcSectionOverlap: { label: 'WMC–Section Overlap', icon: '⚡', color: 'bg-teal-100 text-teal-700 border-teal-200', explanation: 'A whole-batch (WMC) class overlaps with a section-level class. Move one so they don\'t collide.' },
                    homeRoom: { label: 'Home Room', icon: '🏠', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', explanation: 'A lecture/tutorial is not in its assigned home room. Change the room back to the section\'s home room.' },
                };
                const active = Object.entries(bd).filter(([, v]) => v > 0);
                if (active.length === 0) return null;
                return (
                    <div className="mb-3 rounded-lg border bg-red-50 border-red-200 p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className="w-4 h-4 text-red-600" />
                            <span className="text-[11px] uppercase tracking-wider font-bold text-red-600">
                                {feasibility.fitness.hardViolations} Conflict{feasibility.fitness.hardViolations > 1 ? 's' : ''} Detected
                            </span>
                        </div>
                        <div className="space-y-2">
                            {active.map(([key, count]) => {
                                const info = VIOLATION_INFO[key];
                                if (!info) return null;
                                return (
                                    <div key={key} className={`flex items-start gap-3 px-3 py-2 rounded-lg border ${info.color} bg-white/60`}>
                                        <span className="text-base mt-0.5 flex-shrink-0">{info.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-xs">{info.label}</span>
                                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${info.color}`}>
                                                    ×{count}
                                                </span>
                                            </div>
                                            <p className="text-[10px] mt-0.5 opacity-80 leading-snug">{info.explanation}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {feasibility.fitness.gapPenalty > 0 && (
                            <div className="mt-2 flex items-start gap-3 px-3 py-2 rounded-lg border bg-blue-50 border-blue-200 text-blue-700 bg-white/60">
                                <span className="text-base mt-0.5 flex-shrink-0">📊</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-xs">Free-Period Gaps</span>
                                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                                            {feasibility.fitness.gapPenalty}
                                        </span>
                                    </div>
                                    <p className="text-[10px] mt-0.5 opacity-80 leading-snug">
                                        Empty slots between classes for students. Not a hard conflict, but reducing gaps improves the schedule quality.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* ── Loading slots ── */}
            {loadingSlots && (
                <div className="flex items-center justify-center py-16 gap-3 text-indigo-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Loading timetable slots…</span>
                </div>
            )}

            {/* ── Timetable Grid (TimetableViewer style) ── */}
            {!loadingSlots && slots.length > 0 && (
                <>
                    <div className="overflow-x-auto bg-white p-1 shadow-lg border border-gray-300 rounded-sm">
                        <div className="min-w-max">
                            <table className="w-full border-collapse border border-black text-center text-xs">
                                <thead>
                                    <tr className="bg-[#e6b8af] h-10">
                                        <th className="border border-black w-14 shadow-sm">Day</th>
                                        {dynamicTimeColumns.map((col, idx) => (
                                            <th key={idx} className={`border border-black p-1 ${col.isLunch ? 'w-8 bg-gray-200' : ''}`}>
                                                {col.isLunch
                                                    ? <span className="writing-mode-vertical text-[9px] tracking-widest text-gray-600">{col.label}</span>
                                                    : col.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {DAYS.map((day, dayIndex) => (
                                        <tr key={day} className="border-b border-black bg-white h-65">
                                            <td className="border border-black bg-[#e6b8af] font-bold text-sm writing-mode-vertical md:writing-mode-horizontal">
                                                {day}
                                            </td>
                                            {dynamicTimeColumns.map((col, cIdx) => {
                                                if (col.isLunch) {
                                                    return (
                                                        <td key={cIdx} className="border border-black bg-gray-100 font-bold writing-mode-vertical text-[10px] tracking-widest text-gray-500 select-none">
                                                            {col.label}
                                                        </td>
                                                    );
                                                }
                                                return (
                                                    <td
                                                        key={cIdx}
                                                        onDragOver={handleDragOver}
                                                        onDrop={() => handleDrop(dayIndex, col)}
                                                        className="border border-black p-0 hover:bg-blue-50/20 transition-colors align-top h-65"
                                                    >
                                                        {renderCellContent(dayIndex, col)}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mt-3 text-xs text-gray-400 text-center">
                        💡 Drag & drop class items between cells. Click the ✏️ icon on hover to edit room/professor.
                        Click 'Check' in the top bar to verify constraints.
                    </div>
                </>
            )}

            {/* ── No slots ── */}
            {!loadingSlots && slots.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center text-gray-400">
                    <AlertTriangle className="w-10 h-10 mb-3 text-gray-200" />
                    <h3 className="text-sm font-semibold text-gray-500">No slots found for this timetable</h3>
                    <p className="text-xs mt-1 max-w-sm">
                        This timetable has no scheduled slots. Generate one first in the Generator view.
                    </p>
                </div>
            )}

            <style>{`
        .writing-mode-vertical { writing-mode: vertical-rl; transform: rotate(180deg); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #999; }
      `}</style>
        </div>
    );
}
