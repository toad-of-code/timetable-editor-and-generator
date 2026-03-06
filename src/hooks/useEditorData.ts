import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { EditorSlot } from '../solver/localSearch';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TimetableMeta {
    id: string;
    name: string;
    semester: number;
    status: string;
    academic_year: string;
    created_at: string;
    published_at: string | null;
    lunch_start: string;
    lunch_end: string;
}

export interface EditorData {
    // Timetable list
    timetables: TimetableMeta[];
    loadingList: boolean;

    // Current timetable
    selectedTimetableId: string;
    setSelectedTimetableId: (id: string) => void;
    timetableMeta: TimetableMeta | null;

    // Slots
    slots: EditorSlot[];
    setSlots: React.Dispatch<React.SetStateAction<EditorSlot[]>>;
    loadingSlots: boolean;

    // Rooms & professors for editing
    rooms: { id: string; name: string; room_type: string }[];
    professors: { id: string; name: string }[];

    // Save & publish
    saveSlots: (slots: EditorSlot[]) => Promise<void>;
    publishTimetable: () => Promise<void>;
    saving: boolean;
    publishing: boolean;

    // Re-fetch
    refresh: () => void;
    error: string | null;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useEditorData(initialTimetableId?: string): EditorData {
    const [timetables, setTimetables] = useState<TimetableMeta[]>([]);
    const [loadingList, setLoadingList] = useState(true);

    const [selectedTimetableId, setSelectedTimetableId] = useState(initialTimetableId ?? '');
    const [timetableMeta, setTimetableMeta] = useState<TimetableMeta | null>(null);

    const [slots, setSlots] = useState<EditorSlot[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);

    const [rooms, setRooms] = useState<{ id: string; name: string; room_type: string }[]>([]);
    const [professors, setProfessors] = useState<{ id: string; name: string }[]>([]);

    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [refreshKey, setRefreshKey] = useState(0);
    const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

    // Sync external initial ID
    useEffect(() => {
        if (initialTimetableId) setSelectedTimetableId(initialTimetableId);
    }, [initialTimetableId]);

    // ── 1. Load timetable list + rooms + professors ──
    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoadingList(true);
            setError(null);
            try {
                const [ttRes, roomRes, profRes] = await Promise.all([
                    supabase
                        .from('timetables')
                        .select('id, name, semester, status, academic_year, created_at, published_at, lunch_start, lunch_end')
                        .order('created_at', { ascending: false }),
                    supabase.from('rooms').select('id, name, room_type').order('name'),
                    supabase.from('professors').select('id, name').order('name'),
                ]);
                if (ttRes.error) throw ttRes.error;
                if (roomRes.error) throw roomRes.error;
                if (profRes.error) throw profRes.error;
                if (!cancelled) {
                    setTimetables(ttRes.data ?? []);
                    setRooms(roomRes.data ?? []);
                    setProfessors(profRes.data ?? []);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load timetables');
            } finally {
                if (!cancelled) setLoadingList(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [refreshKey]);

    // ── 2. Load slots for selected timetable ──
    useEffect(() => {
        if (!selectedTimetableId) {
            setSlots([]);
            setTimetableMeta(null);
            return;
        }

        let cancelled = false;
        async function loadSlots() {
            setLoadingSlots(true);
            setError(null);
            try {
                // Load meta
                const meta = timetables.find(t => t.id === selectedTimetableId) ?? null;
                if (!cancelled) setTimetableMeta(meta);

                // Load slots with joined names
                const { data, error: slotErr } = await supabase
                    .from('timetable_slots')
                    .select(`
            id,
            timetable_id,
            subject_id,
            professor_id,
            room_id,
            student_group_id,
            day_of_week,
            start_time,
            end_time,
            slot_type,
            subject:subject_id (code, name, subject_type),
            professor:professor_id (name),
            room:room_id (name),
            student_group:student_group_id (name)
          `)
                    .eq('timetable_id', selectedTimetableId)
                    .order('day_of_week')
                    .order('start_time');

                if (slotErr) throw slotErr;
                if (cancelled) return;

                // Flatten joined data
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mapped: EditorSlot[] = (data ?? []).map((row: any) => ({
                    id: row.id,
                    timetable_id: row.timetable_id,
                    subject_id: row.subject_id,
                    professor_id: row.professor_id,
                    room_id: row.room_id,
                    student_group_id: row.student_group_id,
                    day_of_week: row.day_of_week,
                    start_time: row.start_time,
                    end_time: row.end_time,
                    slot_type: row.slot_type,
                    subject_code: row.subject?.code ?? '??',
                    subject_name: row.subject?.name ?? 'Unknown',
                    subject_type: row.subject?.subject_type ?? 'Core',
                    professor_name: row.professor?.name ?? 'TBD',
                    room_name: row.room?.name ?? '—',
                    group_name: row.student_group?.name ?? '??',
                }));

                setSlots(mapped);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load slots');
            } finally {
                if (!cancelled) setLoadingSlots(false);
            }
        }
        loadSlots();
        return () => { cancelled = true; };
    }, [selectedTimetableId, timetables]);

    // ── 3. Save edited slots back to DB ──
    const saveSlots = useCallback(async (editedSlots: EditorSlot[]) => {
        if (!selectedTimetableId) return;
        setSaving(true);
        setError(null);
        try {
            // Delete existing slots for this timetable and re-insert
            const { error: delErr } = await supabase
                .from('timetable_slots')
                .delete()
                .eq('timetable_id', selectedTimetableId);
            if (delErr) throw delErr;

            const rows = editedSlots.map(s => ({
                timetable_id: s.timetable_id,
                subject_id: s.subject_id,
                professor_id: s.professor_id,
                room_id: s.room_id,
                student_group_id: s.student_group_id,
                day_of_week: s.day_of_week,
                start_time: s.start_time,
                end_time: s.end_time,
                slot_type: s.slot_type,
            }));

            const { error: insErr } = await supabase
                .from('timetable_slots')
                .insert(rows);
            if (insErr) throw insErr;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
            throw err;
        } finally {
            setSaving(false);
        }
    }, [selectedTimetableId]);

    // ── 4. Publish timetable ──
    const publishTimetable = useCallback(async () => {
        if (!selectedTimetableId) return;
        setPublishing(true);
        setError(null);
        try {
            const { error: pubErr } = await supabase
                .from('timetables')
                .update({ status: 'published', published_at: new Date().toISOString() })
                .eq('id', selectedTimetableId);
            if (pubErr) throw pubErr;

            // Update local state
            setTimetableMeta(prev => prev ? { ...prev, status: 'published', published_at: new Date().toISOString() } : null);
            setTimetables(prev => prev.map(t =>
                t.id === selectedTimetableId
                    ? { ...t, status: 'published', published_at: new Date().toISOString() }
                    : t
            ));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to publish');
            throw err;
        } finally {
            setPublishing(false);
        }
    }, [selectedTimetableId]);

    return {
        timetables,
        loadingList,
        selectedTimetableId,
        setSelectedTimetableId,
        timetableMeta,
        slots,
        setSlots,
        loadingSlots,
        rooms,
        professors,
        saveSlots,
        publishTimetable,
        saving,
        publishing,
        refresh,
        error,
    };
}
