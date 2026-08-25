import { supabase } from '../lib/supabase';
import type { EditorSlot } from '../solver/localSearch';

// ─── Generator Data Methods ──────────────────────────────────────────────────


export async function fetchActiveClusters() {
    return supabase
        .from('semester_clusters')
        .select('*')
        .eq('is_active', true)
        .order('batch_year', { ascending: false });
}

export async function fetchRooms() {
    return supabase.from('rooms').select('*').order('name');
}

export async function fetchProfessors() {
    return supabase.from('professors').select('*').order('name');
}

export async function fetchClusterRequirements(clusterId: string) {
    return supabase
        .from('cluster_requirements')
        .select('elective_basket, estimated_enrollment, subject:subject_id (id, code, name, credits, subject_type, lectures, tutorials, practicals, practical_duration)')
        .eq('cluster_id', clusterId);
}

export async function fetchStudentGroupsBySemester(semesterNumber: number) {
    return supabase
        .from('student_groups')
        .select('*')
        .eq('semester', semesterNumber)
        .order('name');
}

export async function fetchProfessorExpertise() {
    return supabase
        .from('professor_expertise')
        .select('subject_id, professor:professor_id (id, name, department)');

// ─── Editor Data Methods ─────────────────────────────────────────────────────
}

export async function fetchTimetables() {
    return supabase
        .from('timetables')
        .select('id, name, semester, status, academic_year, created_at, published_at, lunch_start, lunch_end')
        .order('created_at', { ascending: false });
}

export async function fetchRoomsForEditor() {
    return supabase.from('rooms').select('id, name, room_type, capacity').order('name');
}

export async function fetchProfessorsForEditor() {
    return supabase.from('professors').select('id, name').order('name');
}

export async function fetchTimetableSlots(timetableId: string) {
    return supabase
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
            subject:subject_id (code, name, subject_type, elective_group),
            professor:professor_id (name),
            room:room_id (name),
            student_group:student_group_id (name)
        `)
        .eq('timetable_id', timetableId)
        .order('day_of_week')
        .order('start_time');
}

export async function replaceTimetableSlots(timetableId: string, editedSlots: EditorSlot[]) {
    const { error: delErr } = await supabase
        .from('timetable_slots')
        .delete()
        .eq('timetable_id', timetableId);
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

    return supabase.from('timetable_slots').insert(rows);
}

export async function publishTimetableStatus(timetableId: string) {
    return supabase
        .from('timetables')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', timetableId);
// --- Viewer Data Methods -----------------------------------------------------
}

export async function fetchPublishedTimetables() {
    return supabase.from('timetables').select('id, name, semester').eq('status', 'published').order('created_at', { ascending: false });
}

export async function fetchPublishedTimetableIds() {
    return supabase.from('timetables').select('id').eq('status', 'published');
}

export async function getTimetableName(id: string) {
    return supabase.from('timetables').select('name').eq('id', id).single();
}

export async function fetchAllRoomNames() {
    return supabase.from('rooms').select('name').order('name');
}

export async function fetchAllRoomNamesAndTypes() {
    return supabase.from('rooms').select('name, room_type').order('name');

// --- Management Data Methods -------------------------------------------------
}

export async function fetchSubjectsForManage() {
    return supabase.from('subjects').select('id, code, name').order('code');
}

export async function fetchSubjectsWithType() {
    return supabase.from('subjects').select('id, code, name, subject_type').order('code');
}

export async function fetchSemesterClusters() {
    return supabase.from('semester_clusters').select('*').order('semester_number');

// Professors
}

export async function insertProfessor(data: any) {
    return supabase.from('professors').insert(data);
}

export async function updateProfessor(id: string, data: any) {
    return supabase.from('professors').update(data).eq('id', id);
}

export async function deleteProfessor(id: string) {
    return supabase.from('professors').delete().eq('id', id);

// Professor Expertise
}

export async function insertProfessorExpertise(data: any) {
    return supabase.from('professor_expertise').insert(data);
}

export async function updateProfessorExpertisePref(id: string, pref: number) {
    return supabase.from('professor_expertise').update({ preference_level: pref }).eq('id', id);
}

export async function deleteProfessorExpertise(id: string) {
    return supabase.from('professor_expertise').delete().eq('id', id);

// Rooms
}

export async function insertRoom(data: any) {
    return supabase.from('rooms').insert(data);

// Subjects
}

export async function insertSubject(data: any) {
    return supabase.from('subjects').insert(data);

// Semester Clusters
}

export async function insertSemesterCluster(data: any) {
    return supabase.from('semester_clusters').insert(data);
}

export async function updateSemesterCluster(id: string, data: any) {
    return supabase.from('semester_clusters').update(data).eq('id', id);
}

export async function deleteSemesterCluster(id: string) {
    return supabase.from('semester_clusters').delete().eq('id', id);

// Cluster Requirements
}

export async function insertClusterRequirement(data: any) {
    return supabase.from('cluster_requirements').insert(data);
}

export async function updateClusterRequirement(id: string, data: any) {
    return supabase.from('cluster_requirements').update(data).eq('id', id);
}

export async function deleteClusterRequirement(id: string) {
    return supabase.from('cluster_requirements').delete().eq('id', id);
}

export async function deleteClusterRequirementsByCluster(clusterId: string) {
    return supabase.from('cluster_requirements').delete().eq('cluster_id', clusterId);

// --- Shared Viewer Queries ---------------------------------------------------
}

export async function fetchViewerSlots(timetableId: string) {
    return supabase
        .from('timetable_slots')
        .select(`
          id, day_of_week, start_time, end_time, slot_type,
          subjects (code, name, subject_type), professors (name), rooms (name), student_groups (name)
        `)
        .eq('timetable_id', timetableId);
}

export async function fetchAllPublishedSlots(publishedIds: string[]) {
    return supabase
        .from('timetable_slots')
        .select(`
          id, timetable_id, day_of_week, start_time, end_time, slot_type,
          subjects (code, name, subject_type), professors (name), rooms (name), student_groups (name, semester)
        `)
        .in('timetable_id', publishedIds);
}

export async function updateRoom(id: string, data: any) {
    return supabase.from('rooms').update(data).eq('id', id);
}

export async function deleteRoom(id: string) {
    return supabase.from('rooms').delete().eq('id', id);
}

export async function updateSubject(id: string, data: any) {
    return supabase.from('subjects').update(data).eq('id', id);
}

export async function deleteSubject(id: string) {
    return supabase.from('subjects').delete().eq('id', id);
}

export async function fetchAllSubjects() {
    return supabase.from('subjects').select('*').order('code', { ascending: true });
}

export async function fetchClusterRequirementsForMapping(clusterId: string) {
    return supabase
        .from('cluster_requirements')
        .select('id, subject_id, elective_basket, estimated_enrollment, subject:subject_id (code, name, subject_type)')
        .eq('cluster_id', clusterId);

// --- Importer Methods --------------------------------------------------------
}

export async function upsertSubjects(data: any[], opts?: any) { return supabase.from('subjects').upsert(data, opts || { onConflict: 'code' }); }

export async function upsertProfessors(data: any[], opts?: any) { return supabase.from('professors').upsert(data, opts || { onConflict: 'name' }); }

export async function upsertRooms(data: any[], opts?: any) { return supabase.from('rooms').upsert(data, opts || { onConflict: 'name' }); }

export async function upsertStudentGroups(data: any[], opts?: any) { return supabase.from('student_groups').upsert(data, opts || { onConflict: 'name' }); }

export async function fetchSubjectsForImport() { return supabase.from('subjects').select('id, code'); }

export async function fetchProfessorsForImport() { return supabase.from('professors').select('id, name'); }

export async function fetchRoomsForImport() { return supabase.from('rooms').select('id, name'); }

export async function fetchStudentGroupsForImport() { return supabase.from('student_groups').select('id, name, semester'); }

export async function fetchTimetablesBySemester(semester: number) { return supabase.from('timetables').select('id').eq('semester', semester); }

export async function deleteTimetableSlotsByTimetableIds(ids: string[]) { return supabase.from('timetable_slots').delete().in('timetable_id', ids); }

export async function deleteTimetablesByIds(ids: string[]) { return supabase.from('timetables').delete().in('id', ids); }

export async function insertTimetable(data: any) { return supabase.from('timetables').insert(data).select().single(); }

export async function insertTimetableSlots(data: any[]) { return supabase.from('timetable_slots').insert(data); }

export async function insertClusterRequirements(data: any[]) { return supabase.from('cluster_requirements').insert(data); }

export async function deleteProfessorExpertiseBySubjects(subjectIds: string[]) { return supabase.from('professor_expertise').delete().in('subject_id', subjectIds); }

export async function insertProfessorExpertises(data: any[]) { return supabase.from('professor_expertise').insert(data); }

export async function fetchProfessorExpertiseByProfessor(professorId: string) {
    return supabase
        .from('professor_expertise')
        .select('id, subject_id, preference_level, subject:subject_id (code, name)')
        .eq('professor_id', professorId);
}

export async function fetchSemesterClusterBySemesterAndDept(semester: number, dept: string) {
    return supabase.from('semester_clusters').select('id').eq('semester_number', semester).eq('department', dept);
}

export async function insertSemesterClusterAndReturnId(data: any) {
    return supabase.from('semester_clusters').insert(data).select('id').single();
}
