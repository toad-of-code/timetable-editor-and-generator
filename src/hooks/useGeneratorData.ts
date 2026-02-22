import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ─── Shared Types ──────────────────────────────────────────────────────────────
// These are exported so sub-components can import them instead of re-declaring.

export interface Cluster {
    id: string;
    batch_year: number;
    semester_number: number;
    department: string;
}

export interface Subject {
    id: string;
    code: string;
    name: string;
    credits: number;
    subject_type: string;
}

export interface Group {
    id: string;
    name: string;
    student_count: number;
}

export interface Room {
    id: string;
    name: string;
    capacity: number;
    room_type: string;
}

export interface Professor {
    id: string;
    name: string;
    department: string;
}

// ─── Typed Supabase response shapes (replaces `as unknown as X` casts) ────────

interface SubjectRow {
    subject: Subject | null;
}

interface ExpertiseRow {
    subject_id: string;
    professor: Professor | null;
}

// ─── Hook Return Type ─────────────────────────────────────────────────────────

export interface GeneratorData {
    // Master data
    clusters: Cluster[];
    rooms: Room[];
    professors: Professor[];
    // Cluster-specific data
    clusterSubjects: Subject[];
    clusterGroups: Group[];
    expertiseMap: Record<string, Professor[]>;
    // Status
    loading: boolean;
    fetchingDetails: boolean;
    error: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGeneratorData(selectedClusterId: string): GeneratorData {
    const [clusters, setClusters] = useState<Cluster[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [professors, setProfessors] = useState<Professor[]>([]);

    const [clusterSubjects, setClusterSubjects] = useState<Subject[]>([]);
    const [clusterGroups, setClusterGroups] = useState<Group[]>([]);
    const [expertiseMap, setExpertiseMap] = useState<Record<string, Professor[]>>({});

    const [loading, setLoading] = useState(true);
    const [fetchingDetails, setFetchingDetails] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 1. On mount: load clusters, rooms, all professors
    useEffect(() => {
        async function fetchInitialData() {
            try {
                setLoading(true);
                const [clustersRes, roomsRes, profsRes] = await Promise.all([
                    supabase
                        .from('semester_clusters')
                        .select('*')
                        .eq('is_active', true)
                        .order('batch_year', { ascending: false }),
                    supabase.from('rooms').select('*').order('name'),
                    supabase.from('professors').select('*').order('name'),
                ]);
                if (clustersRes.error) throw clustersRes.error;
                if (roomsRes.error) throw roomsRes.error;
                if (profsRes.error) throw profsRes.error;

                setClusters(clustersRes.data ?? []);
                setRooms(roomsRes.data ?? []);
                setProfessors(profsRes.data ?? []);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Failed to load initial data');
            } finally {
                setLoading(false);
            }
        }
        fetchInitialData();
    }, []);

    // 2. When a cluster is selected: load its subjects, groups, and expertise map
    useEffect(() => {
        if (!selectedClusterId) {
            setClusterSubjects([]);
            setClusterGroups([]);
            setExpertiseMap({});
            return;
        }

        async function fetchClusterDetails() {
            try {
                setFetchingDetails(true);
                const cluster = clusters.find(c => c.id === selectedClusterId);
                if (!cluster) return;

                const [reqRes, groupRes, expertiseRes] = await Promise.all([
                    supabase
                        .from('cluster_requirements')
                        .select('subject:subject_id (id, code, name, credits, subject_type)')
                        .eq('cluster_id', selectedClusterId),
                    supabase
                        .from('student_groups')
                        .select('*')
                        .eq('semester', cluster.semester_number)
                        .order('name'),
                    supabase
                        .from('professor_expertise')
                        .select('subject_id, professor:professor_id (id, name, department)'),
                ]);

                if (reqRes.error) throw reqRes.error;
                if (groupRes.error) throw groupRes.error;
                if (expertiseRes.error) throw expertiseRes.error;

                // Type-safe extraction — no `as unknown as X` needed
                const subjects = (reqRes.data as SubjectRow[])
                    .map(row => row.subject)
                    .filter((s): s is Subject => s !== null);

                setClusterSubjects(subjects);
                setClusterGroups(groupRes.data ?? []);

                // Build expertise map: subjectId → Professor[]
                const newMap: Record<string, Professor[]> = {};
                for (const row of expertiseRes.data as ExpertiseRow[]) {
                    if (!row.professor?.id) continue;
                    if (!newMap[row.subject_id]) newMap[row.subject_id] = [];
                    newMap[row.subject_id].push(row.professor);
                }
                setExpertiseMap(newMap);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Failed to load cluster details');
            } finally {
                setFetchingDetails(false);
            }
        }

        fetchClusterDetails();
    }, [selectedClusterId, clusters]);

    return {
        clusters,
        rooms,
        professors,
        clusterSubjects,
        clusterGroups,
        expertiseMap,
        loading,
        fetchingDetails,
        error,
    };
}
