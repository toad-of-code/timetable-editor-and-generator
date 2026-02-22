import React, { useState, useEffect } from 'react';
import { ClipboardList, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CourseResult {
    id: string;
    courseName: string;
    superscript?: string;
    code: string;
    type: 'Core' | 'Elective' | 'Minor' | 'ProtoMakers' | 'Project';
    credit: string;
    electiveGroup?: string;   // e.g. 'HSMC', 'Basket 1', 'Basket 2'
    isBasket?: boolean;
    highlight?: boolean;
}

interface SemesterData {
    semesterNum: number;
    academicYear: string;
    totalCredits: number;
    courses: CourseResult[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format credit from DB fields → "L+T+P=Credits", or just the credit number if L/T/P aren't set */
function formatCredit(
    lectures: number | null,
    tutorials: number | null,
    practicals: number | null,
    credits: number | null
): string {
    const l = lectures ?? 0;
    const t = tutorials ?? 0;
    const p = practicals ?? 0;
    const sum = l + t + (p / 2);
    // If L/T/P are not stored, just show the credit number
    if (sum === 0) return String(credits ?? 0);
    return `${l}+${t}+${p}=${credits ?? sum}`;
}

/** Map DB subject_type to local union */
function mapType(raw: string | null): CourseResult['type'] {
    const s = (raw ?? '').toLowerCase();
    if (s === 'elective') return 'Elective';
    if (s === 'minor') return 'Minor';
    if (s === 'project') return 'Project';
    if (s === 'protomakers') return 'ProtoMakers';
    return 'Core';
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchSemesterSubjects(): Promise<SemesterData[]> {
    // 1. Fetch all timetables ordered by semester
    const { data: timetables, error: ttErr } = await supabase
        .from('timetables')
        .select('id, semester, academic_year')
        .order('semester', { ascending: true });

    if (ttErr) throw ttErr;
    if (!timetables || timetables.length === 0) return [];

    // 2. Fetch all timetable_slots with subject details for those timetables
    const ttIds = timetables.map((t) => t.id);

    const { data: slots, error: slotErr } = await supabase
        .from('timetable_slots')
        .select(`
            timetable_id,
            subject:subject_id (
                id,
                code,
                name,
                subject_type,
                elective_group,
                lectures,
                tutorials,
                practicals,
                credits
            )
        `)
        .in('timetable_id', ttIds);

    if (slotErr) throw slotErr;

    // 3. Group subjects by timetable_id, deduplicate by subject id
    const ttToSubjects = new Map<string, Map<string, any>>();

    for (const slot of slots ?? []) {
        const sub = slot.subject as any;
        if (!sub?.id) continue;
        if (!ttToSubjects.has(slot.timetable_id)) {
            ttToSubjects.set(slot.timetable_id, new Map());
        }
        ttToSubjects.get(slot.timetable_id)!.set(sub.id, sub);
    }

    // 4. Build SemesterData[], one per timetable (deduplicate by semester number)
    const semMap = new Map<number, SemesterData>();

    for (const tt of timetables) {
        const sem: number = tt.semester;
        if (semMap.has(sem)) continue; // keep first timetable per semester

        const subjectMap = ttToSubjects.get(tt.id) ?? new Map();
        const courses: CourseResult[] = [];
        let idx = 1;

        for (const sub of subjectMap.values()) {
            const isElective = mapType(sub.subject_type) === 'Elective';
            courses.push({
                id: sub.id,
                courseName: sub.name ?? sub.code,
                code: sub.code ?? '—',
                type: mapType(sub.subject_type),
                credit: formatCredit(sub.lectures, sub.tutorials, sub.practicals, sub.credits),
                electiveGroup: sub.elective_group ?? undefined,
                isBasket: isElective,
                highlight: isElective,
            });
            idx++;
        }

        // Sort: Core first, then Elective/Minor
        courses.sort((a, b) => {
            const order: Record<string, number> = { Core: 0, Project: 1, ProtoMakers: 2, Elective: 3, Minor: 4 };
            return (order[a.type] ?? 9) - (order[b.type] ?? 9);
        });

        // Re-number after sort
        courses.forEach((c, i) => { (c as any)._idx = i + 1; });

        // For Electives: a student picks ONE per group (HSMC, Basket 1, Basket 2, etc.)
        // Count the max-credit elective from each distinct group
        const coreCredits = courses
            .filter(c => c.type !== 'Elective')
            .reduce((sum, c) => {
                const parts = c.credit.split('=');
                return sum + (parseInt(parts[1] ?? parts[0] ?? '0') || 0);
            }, 0);

        const electiveCredits = (() => {
            const electives = courses.filter(c => c.type === 'Elective');
            if (electives.length === 0) return 0;
            // group by electiveGroup (fallback: 'Elective' if no group stored)
            const groups = new Map<string, number[]>();
            electives.forEach(c => {
                const g = c.electiveGroup ?? 'Elective';
                const val = parseInt(c.credit.split('=')[1] ?? c.credit.split('=')[0] ?? '0') || 0;
                if (!groups.has(g)) groups.set(g, []);
                groups.get(g)!.push(val);
            });
            // Sum the max credit from each group
            let total = 0;
            groups.forEach(vals => { total += Math.max(...vals); });
            return total;
        })();

        const totalCredits = coreCredits + electiveCredits;

        semMap.set(sem, {
            semesterNum: sem,
            academicYear: tt.academic_year ?? '—',
            totalCredits,
            courses,
        });
    }

    return Array.from(semMap.values()).sort((a, b) => a.semesterNum - b.semesterNum);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const TypeBadge = ({ type }: { type: CourseResult['type'] }) => {
    const colors: Record<string, string> = {
        Core: 'bg-blue-100 text-blue-700',
        Elective: 'bg-purple-100 text-purple-700',
        Minor: 'bg-orange-100 text-orange-700',
        ProtoMakers: 'bg-teal-100 text-teal-700',
        Project: 'bg-green-100 text-green-700',
    };
    return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[type] ?? 'bg-gray-100 text-gray-600'}`}>
            {type}
        </span>
    );
};

function CourseRow({ course, idx }: { course: CourseResult; idx: number }) {
    const rowBg = course.highlight
        ? 'bg-yellow-50'
        : idx % 2 === 0
            ? 'bg-white'
            : 'bg-slate-50/60';

    return (
        <>
            {/* Elective separator */}
            {course.isBasket && idx === 1 || (course.isBasket) ? null : null}

            <tr className={`border-b border-gray-100 text-xs hover:bg-blue-50/30 transition-colors ${rowBg}`}>
                <td className="px-3 py-2.5 text-center text-gray-400 font-mono w-10">{idx}</td>

                <td className="px-3 py-2.5 min-w-[220px]">
                    <div className="font-medium text-gray-800 leading-tight">
                        {course.courseName}
                        {course.superscript && (
                            <sup className="text-indigo-500 font-bold ml-0.5 text-[9px]">{course.superscript}</sup>
                        )}
                    </div>
                </td>

                <td className="px-3 py-2.5 font-mono text-indigo-700 whitespace-nowrap text-xs">{course.code}</td>
                <td className="px-3 py-2.5"><TypeBadge type={course.type} /></td>
                <td className="px-3 py-2.5 text-center font-mono text-gray-600 whitespace-nowrap">{course.credit}</td>
            </tr>
        </>
    );
}

// ─── Semester Block ───────────────────────────────────────────────────────────

function SemesterBlock({ data, defaultOpen }: { data: SemesterData; defaultOpen: boolean }) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="mb-4 rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div
                className="flex items-center justify-between gap-3 px-5 py-3 bg-gradient-to-r from-indigo-600 to-blue-500 cursor-pointer"
                onClick={() => setOpen((o) => !o)}
            >
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-white font-bold text-sm tracking-wide">
                        Jan-Jun 2026
                    </span>
                    <span className="bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full">
                        Semester {data.semesterNum}
                    </span>
                    <span className="bg-white/10 text-white/80 text-xs px-2 py-0.5 rounded-full">
                        {data.courses.length} subjects · {data.totalCredits} credits
                    </span>
                </div>
                <div className="text-white/80 flex-shrink-0">
                    {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
            </div>

            {/* Table */}
            {open && (
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="bg-blue-50 border-b-2 border-blue-100 text-blue-800">
                                {['#', 'Course Name', 'Code', 'Type', 'Credits (L+T+P)'].map((h) => (
                                    <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.courses.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-6 text-center text-gray-400 italic text-xs">
                                        No subjects found for this semester
                                    </td>
                                </tr>
                            ) : (() => {
                                const core = data.courses.filter(c => c.type !== 'Elective' && c.type !== 'Minor');
                                const minors = data.courses.filter(c => c.type === 'Minor');
                                const electives = data.courses.filter(c => c.type === 'Elective');
                                let counter = 0;
                                return (
                                    <>
                                        {/* ── Core subjects ── */}
                                        {core.map(c => (
                                            <CourseRow key={c.id} course={c} idx={++counter} />
                                        ))}

                                        {/* ── Minor (MDM) section ── */}
                                        {minors.length > 0 && (
                                            <>
                                                <tr>
                                                    <td colSpan={5} className="px-3 py-1.5 bg-gradient-to-r from-orange-500 to-amber-400 text-white">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-xs tracking-wider uppercase">Minor (MDM)</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {minors.map(c => (
                                                    <CourseRow key={c.id} course={c} idx={++counter} />
                                                ))}
                                            </>
                                        )}

                                        {/* ── Per-group Elective sections ── */}
                                        {electives.length > 0 && (() => {
                                            // Build ordered group → courses map (preserving first-seen order)
                                            const groupMap = new Map<string, CourseResult[]>();
                                            electives.forEach(c => {
                                                const g = c.electiveGroup ?? 'Electives';
                                                if (!groupMap.has(g)) groupMap.set(g, []);
                                                groupMap.get(g)!.push(c);
                                            });
                                            return Array.from(groupMap.entries()).map(([groupName, courses]) => (
                                                <React.Fragment key={groupName}>
                                                    <tr>
                                                        <td colSpan={5} className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-violet-500 text-white">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-xs tracking-wider uppercase">{groupName}</span>
                                                                <span className="text-white/70 text-[10px] font-normal">(student picks one)</span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {courses.map(c => (
                                                        <CourseRow key={c.id} course={c} idx={++counter} />
                                                    ))}
                                                </React.Fragment>
                                            ));
                                        })()}
                                    </>
                                );
                            })()}
                        </tbody>
                    </table>

                    {/* Footer */}
                    <div className="bg-gray-50 border-t border-gray-200 px-5 py-2.5 flex items-center gap-4 text-xs text-gray-500">
                        <span className="font-semibold text-gray-600">Summary</span>
                        <span className="ml-auto font-medium">
                            <span className="font-bold text-indigo-700">{data.totalCredits}</span> Total Credits
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function ReportCardView() {
    const [semesters, setSemesters] = useState<SemesterData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchSemesterSubjects()
            .then(setSemesters)
            .catch((err) => setError(err.message ?? 'Failed to load data'))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">
            {/* Page Header */}
            <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 rounded-lg">
                        <ClipboardList className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800">Semester Wise Subject List</h1>
                        <p className="text-sm text-gray-500">Semester-wise course overview</p>
                    </div>
                </div>
                <div className="text-xs text-gray-400 border border-gray-200 rounded-lg px-4 py-2 bg-gray-50">
                    <span className="text-yellow-600 font-semibold">⚑ Yellow rows</span> — Elective / Basket courses
                </div>
            </div>

            {/* States */}
            {loading && (
                <div className="flex items-center justify-center py-24 gap-3 text-indigo-500">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-sm font-medium">Loading subjects…</span>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {!loading && !error && semesters.length === 0 && (
                <div className="text-center py-24 text-gray-400 text-sm">
                    No timetable data found. Import a timetable first.
                </div>
            )}

            {/* Semester Blocks */}
            {!loading && !error && semesters.map((s) => (
                <SemesterBlock
                    key={s.semesterNum}
                    data={s}
                    defaultOpen={false}
                />
            ))}
        </div>
    );
}
