import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Upload, Database, Loader2, FileSpreadsheet,
  User, Pencil, Trash2, Save, X
} from 'lucide-react';

// --- Constants & Types ---

// 1. EXACT IGNORE (Garbage)
const IGNORE_EXACT = [
  'LUNCH', 'BREAK', 'RECESS', 'TEA', 'TIME TABLE', 'DEPARTMENT'
];

// 2. KEYWORD IGNORE (Headers to Ditch)
const IGNORE_KEYWORDS = [
  'BASKET', 'MDM', 'HSMC', 'OPEN ELECTIVE', 'PROGRAM ELECTIVE', 'MINOR', 'MINORS'
];

interface ParsedSlot {
  id: string; // client-side unique id for keying rows
  day: string;
  timeStart: string;
  timeEnd: string;
  subjectCode: string;
  type: 'Lecture' | 'Tutorial' | 'Practical';
  section: string;
  room: string;
  facultyName: string;
  rawString: string;
  isMinor?: boolean;
}

interface DebugRow {
  rowNum: number;
  rawText: string;
  status: 'Parsed' | 'Info' | 'Failed';
  reason?: string;
}

interface ProfDiagnostic {
  code: string;
  name: string;
  facultyString: string;
  parsed: string;
}

interface Props {
  onNavigate?: (view: string, id?: string) => void;
}

// --- Helper Functions ---

const normalizeIgnore = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const sanitize = (val: any) => {
  if (val === null || val === undefined) return '';
  return String(val).replace(/С/g, 'C').replace(/–/g, '-').replace(/\s+/g, ' ').trim();
};

const normalizeRoom = (val: string) => {
  if (!val || val === 'TBA') return 'TBA';
  let clean = val.replace(/\s*-\s*/, '-').replace(/\s+/g, '-').toUpperCase();
  clean = clean.replace(/([A-Z]+)(\d+)/, '$1-$2');
  return clean;
};

const to24Hour = (timeStr: string) => {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr);
  if (h >= 1 && h <= 7) h += 12;
  return `${h}:${mStr}`;
};

const addTwoHours = (timeStr: string) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  return `${h + 2}:${m.toString().padStart(2, '0')}`;
};

const formatExcelTime = (val: any): string => {
  const sVal = String(val).trim();
  if (!sVal) return '';
  if (sVal.includes(':') || sVal.includes('-')) return sVal.replace('.', ':');
  if (!isNaN(Number(val))) {
    const totalMinutes = Math.round(Number(val) * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}:${m.toString().padStart(2, '0')}`;
  }
  return sVal;
};

let _slotCounter = 0;
const newSlotId = () => `slot-${Date.now()}-${++_slotCounter}`;

// --- The Robust Parser (Heuristic) ---
const parseSlotHeuristically = (rawText: string) => {
  let text = rawText.trim();

  const cleanText = normalizeIgnore(text);
  if (IGNORE_EXACT.some(ig => normalizeIgnore(ig) === cleanText)) {
    return { skipped: true, reason: `Ignored Garbage: ${text}` };
  }

  let type: 'Lecture' | 'Tutorial' | 'Practical' = 'Lecture';
  const typeMatch = text.match(/\((L|T|P)\)/i);
  if (typeMatch) {
    const code = typeMatch[1].toUpperCase();
    if (code === 'T') type = 'Tutorial';
    if (code === 'P') type = 'Practical';
    text = text.replace(typeMatch[0], ' ');
  }

  let room = 'TBA';
  const roomRegex = /\(((?:CC[1-3]|LT)\s*[-]?\s*\d{4})\)/i;
  const roomMatch = text.match(roomRegex) || text.match(/\(([A-Z0-9\s-]{3,})\)$/);
  if (roomMatch) {
    room = normalizeRoom(roomMatch[1]);
    text = text.replace(roomMatch[0], ' ');
  }

  let section = 'All';
  const secMatch = text.match(/(?:Sec|Group)\.?\s*([A-Z0-9-/]{1,5})/i);
  if (secMatch) {
    section = `Sec ${secMatch[1]}`;
    text = text.replace(secMatch[0], ' ');
  }

  let subject = text.replace(/\s+[-–]\s+/g, ' ').trim();
  subject = subject.replace(/[()]/g, '').trim();

  if (!subject || subject.length < 2) {
    return { skipped: true, reason: `Subject empty after cleanup` };
  }

  return { subject, type, section, room, skipped: false };
};

// ------------------------------------------------------------------
// EDITABLE SLOT ROW COMPONENT
// ------------------------------------------------------------------
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const TYPES = ['Lecture', 'Tutorial', 'Practical'] as const;

interface EditableRowProps {
  slot: ParsedSlot;
  onChange: (id: string, field: keyof ParsedSlot, value: string) => void;
  onDelete: (id: string) => void;
}

const EditableRow: React.FC<EditableRowProps> = ({ slot, onChange, onDelete }) => {
  const td = 'px-2 py-1 border-r border-gray-100';
  const inp = 'w-full text-xs border border-transparent rounded px-1 py-0.5 focus:border-indigo-300 focus:bg-indigo-50 focus:outline-none transition';

  return (
    <tr className="hover:bg-gray-50 group">
      <td className={td}>
        <select
          value={slot.day}
          onChange={e => onChange(slot.id, 'day', e.target.value)}
          className={inp}
        >
          {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </td>
      <td className={td}>
        <input
          value={slot.timeStart}
          onChange={e => onChange(slot.id, 'timeStart', e.target.value)}
          className={`${inp} w-20`}
          placeholder="9:00"
        />
      </td>
      <td className={td}>
        <input
          value={slot.timeEnd}
          onChange={e => onChange(slot.id, 'timeEnd', e.target.value)}
          className={`${inp} w-20`}
          placeholder="10:00"
        />
      </td>
      <td className={td}>
        <input
          value={slot.subjectCode}
          onChange={e => onChange(slot.id, 'subjectCode', e.target.value)}
          className={`${inp} font-mono font-semibold`}
        />
      </td>
      <td className={td}>
        <select
          value={slot.type}
          onChange={e => onChange(slot.id, 'type', e.target.value)}
          className={inp}
        >
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className={td}>
        <input
          value={slot.section}
          onChange={e => onChange(slot.id, 'section', e.target.value)}
          className={inp}
        />
      </td>
      <td className={td}>
        <input
          value={slot.room}
          onChange={e => onChange(slot.id, 'room', e.target.value)}
          className={inp}
        />
      </td>
      <td className={td}>
        <input
          value={slot.facultyName}
          onChange={e => onChange(slot.id, 'facultyName', e.target.value)}
          className={inp}
        />
      </td>
      <td className="px-2 py-1 text-center">
        <button
          onClick={() => onDelete(slot.id)}
          title="Delete slot"
          className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
};

// ------------------------------------------------------------------
// MAIN COMPONENT
// ------------------------------------------------------------------

const TimetableImporter: React.FC<Props> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [tableName, setTableName] = useState('');
  const [semester, setSemester] = useState<number>(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [parsedSlots, setParsedSlots] = useState<ParsedSlot[]>([]);
  const [subjectMap, setSubjectMap] = useState<Record<string, string>>({});
  const [ltpsMap, setLtpsMap] = useState<Record<string, { L: number; T: number; P: number; S: number }>>({});
  const [profDiagnostics, setProfDiagnostics] = useState<ProfDiagnostic[]>([]);

  // Review mode: after parse but before DB upload
  const [reviewMode, setReviewMode] = useState(false);
  const [filterDay, setFilterDay] = useState<string>('ALL');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  // ---- FILE UPLOAD ----
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setReviewMode(false);
    setLogs(['Reading file...']);
    setParsedSlots([]);
    setProfDiagnostics([]);
    setLtpsMap({});

    if (!tableName) setTableName(file.name.replace(/\.xlsx?$/, ''));

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const bstr = event.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

        await processExcelData(rows, sheet);

      } catch (err: any) {
        addLog(`❌ Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  // ---- PARSE EXCEL ----
  const processExcelData = async (rows: any[][], sheet: any) => {
    addLog(`🔍 Processing ${rows.length} rows...`);

    const facultyMap: Record<string, { default: string;[key: string]: string }> = {};
    const subjectNameMap: Record<string, string> = {};
    const subjectLtpsMap: Record<string, { L: number; T: number; P: number; S: number }> = {};
    const extractedSlots: ParsedSlot[] = [];
    const debugRows: DebugRow[] = [];
    const diagnostics: ProfDiagnostic[] = [];

    const merges = sheet['!merges'] || [];

    // --- 1. HEADER DETECTION ---
    const TIME_ROW_INDEX = 1;
    const colToTime: Record<number, { start: string; end: string }> = {};

    if (rows.length <= TIME_ROW_INDEX) {
      addLog(`❌ Error: File too short.`);
      setLoading(false);
      return;
    }

    const headerRow = rows[TIME_ROW_INDEX];
    let foundTimes = 0;

    addLog(`🔎 Inspecting Row 2 for times...`);
    headerRow.forEach((cell: any, cIdx: number) => {
      const t = formatExcelTime(cell);
      const match = t.match(/(\d{1,2}[:.]?\d{2})\s*[-to]+\s*(\d{1,2}[:.]?\d{2})/i);
      if (match) {
        const start = to24Hour(match[1].replace('.', ':'));
        const end = to24Hour(match[2].replace('.', ':'));
        addLog(`   👉 Col ${cIdx}: Found time ${start}-${end}`);
        if (start && end) {
          colToTime[cIdx] = { start, end };
          foundTimes++;
        }
      }
    });

    if (foundTimes === 0) {
      addLog(`❌ Error: No time ranges found in Row 2.`);
      setLoading(false);
      return;
    }

    // --- 2. EXTRACT METADATA ---
    let metadataStartRow = -1;
    let codeColIdx = 0;
    let nameColIdx = 2;
    let ltpsColIdx = -1;   // column like "L-T-P-S (Hours)"
    let facultyColIdx = 3;

    rows.forEach((row, idx) => {
      const rowStr = row.map((c: any) => String(c).toLowerCase()).join(' ');
      if (rowStr.includes('course code') && rowStr.includes('faculties')) {
        metadataStartRow = idx;
        row.forEach((cell: any, cIdx: number) => {
          const cStr = String(cell).toLowerCase().replace(/[\s()]/g, '');
          if (cStr.includes('coursecode')) codeColIdx = cIdx;
          if (cStr.includes('coursename')) nameColIdx = cIdx;
          if (cStr.includes('faculties') || cStr.includes('faculty')) facultyColIdx = cIdx;
          // Match "L-T-P-S", "LTPS", "L-T-P", "LTP", "hours", "credit"
          if (/l.?t.?p|hours|credit/i.test(cStr)) ltpsColIdx = cIdx;
        });
        addLog(`✅ Found Metadata Header at Row ${idx + 1}${ltpsColIdx !== -1 ? ` (L-T-P-S col: ${ltpsColIdx})` : ' ⚠️ no L-T-P-S col found'}`);
      }
    });

    if (metadataStartRow !== -1) {
      for (let r = metadataStartRow + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[codeColIdx]) continue;

        const code = sanitize(row[codeColIdx]);
        const name = sanitize(row[nameColIdx]);
        const rawFaculty = sanitize(row[facultyColIdx]);
        const rawLtps = ltpsColIdx !== -1 ? sanitize(row[ltpsColIdx]) : '';

        if (code) {
          if (name) subjectNameMap[code] = name;
          // Parse "3-1-0-0" or "3-0-2" into L, T, P, S
          if (rawLtps) {
            const parts = rawLtps.split(/[-–]/).map((p: string) => parseInt(p.trim(), 10));
            const [L = 0, T = 0, P = 0, S = 0] = parts.map(n => isNaN(n) ? 0 : n);
            subjectLtpsMap[code] = { L, T, P, S };
          }

          const profs: any = { default: 'Unknown' };
          const parsedList: string[] = [];

          if (rawFaculty && rawFaculty.toLowerCase() !== 'unknown') {
            const parts = rawFaculty.split(/,(?![^(]*\))/);
            parts.forEach((p: string) => {
              const cleanP = p.trim();
              const match = cleanP.match(/([^(]+)\(([^)]+)\)/);
              if (match) {
                const pName = match[1].trim();
                const sections = match[2].split(/[,&]/).map((s: string) => s.trim());
                sections.forEach((sec: string) => {
                  const key = sec.replace('Sec', '').trim();
                  profs[key] = pName;
                  profs[`Sec ${key}`] = pName;
                });
                parsedList.push(sections.map((s: string) => `${s}: ${pName}`).join(', '));
                if (parts.length === 1) profs.default = pName;
              } else {
                if (cleanP) {
                  profs.default = cleanP;
                  parsedList.push(`All: ${cleanP}`);
                }
              }
            });
          }

          facultyMap[code] = profs;
          diagnostics.push({
            code,
            name,
            facultyString: rawFaculty || 'Empty',
            parsed: parsedList.length > 0 ? parsedList.join(' | ') : 'Default: Unknown'
          });
        }
      }
      setProfDiagnostics(diagnostics);
    }

    // --- 3. PARSE THE GRID ---
    let currentDay = '';
    const endRow = metadataStartRow !== -1 ? metadataStartRow : rows.length;

    for (let r = TIME_ROW_INDEX + 1; r < endRow; r++) {
      const row = rows[r];
      if (!row) continue;

      const rawDay = sanitize(row[0]).toUpperCase();
      if (['MON', 'TUE', 'WED', 'THU', 'FRI'].some(d => rawDay.includes(d))) {
        currentDay = rawDay;
      }

      if (!currentDay) continue;

      const timeCols = Object.keys(colToTime).map(Number).sort((a, b) => a - b);

      for (let i = 0; i < timeCols.length; i++) {
        const c = timeCols[i];
        const timeRange = colToTime[c];
        let cellText = sanitize(row[c]);

        if (IGNORE_EXACT.some(w => cellText.toUpperCase() === w)) continue;

        if (cellText.length > 2) {
          cellText = cellText.replace(/(\))(\s+)([A-Z][A-Za-z0-9]{1,})/g, '$1\n$3');
          const lines = cellText.split(/\r?\n/).filter(l => l.trim().length > 0);

          lines.forEach(line => {
            let cleanLine = sanitize(line);

            IGNORE_KEYWORDS.forEach(k => {
              const regex = new RegExp(k, 'gi');
              cleanLine = cleanLine.replace(regex, '');
            });
            cleanLine = cleanLine.replace(/^[-:\s\d]+/, '').trim();

            if (cleanLine.length < 2) return;

            const result = parseSlotHeuristically(cleanLine);

            if (!result.skipped && result.subject) {
              const { subject, type, section, room } = result as any;
              const profMap = facultyMap[subject] || { default: 'Unknown' };
              const shortGroup = section.replace('Sec ', '').trim();
              const specificProf = profMap[section] || profMap[shortGroup] || profMap.default;

              let finalEnd = timeRange.end;
              const mergeRange = merges.find((m: any) => m.s.r === r && m.s.c === c);
              if (mergeRange) {
                const endColIdx = mergeRange.e.c;
                if (colToTime[endColIdx]) finalEnd = colToTime[endColIdx].end;
              } else if (type === 'Practical') {
                finalEnd = addTwoHours(timeRange.start);
              }

              extractedSlots.push({
                id: newSlotId(),
                day: currentDay,
                timeStart: timeRange.start,
                timeEnd: finalEnd,
                subjectCode: subject,
                type,
                section,
                room,
                facultyName: specificProf,
                rawString: cleanLine,
                isMinor: subjectNameMap[subject]?.toLowerCase().includes('minor')
              });

              debugRows.push({ rowNum: r + 1, rawText: cleanLine, status: 'Parsed' });
            } else {
              const upperLine = cleanLine.toUpperCase();
              if (!IGNORE_EXACT.some(ig => upperLine === ig)) {
                debugRows.push({
                  rowNum: r + 1,
                  rawText: cleanLine,
                  status: 'Failed',
                  reason: (result as any).reason || 'Heuristic skipped'
                });
              }
            }
          });
        }
      }
    }

    setSubjectMap(subjectNameMap);
    setLtpsMap(subjectLtpsMap);
    setParsedSlots(extractedSlots);

    const ltpsCount = Object.keys(subjectLtpsMap).length;
    addLog(ltpsCount > 0
      ? `📊 L-T-P-S read for ${ltpsCount} subjects.`
      : `⚠️ No L-T-P-S column found — credits will default to 4.`);

    if (extractedSlots.length > 0) {
      addLog(`✅ Parsed ${extractedSlots.length} slots. Review and edit below before saving.`);
      setReviewMode(true);
    } else {
      addLog(`❌ Parsed 0 slots.`);
    }
  };

  // ---- SLOT EDITING ----
  const handleSlotChange = (id: string, field: keyof ParsedSlot, value: string) => {
    setParsedSlots(prev =>
      prev.map(s => s.id === id ? { ...s, [field]: value } : s)
    );
  };

  const handleSlotDelete = (id: string) => {
    setParsedSlots(prev => prev.filter(s => s.id !== id));
  };

  const handleAddRow = () => {
    const newSlot: ParsedSlot = {
      id: newSlotId(),
      day: 'MON',
      timeStart: '9:00',
      timeEnd: '10:00',
      subjectCode: '',
      type: 'Lecture',
      section: 'All',
      room: 'TBA',
      facultyName: 'Unknown',
      rawString: ''
    };
    setParsedSlots(prev => [...prev, newSlot]);
  };

  // Filtered view
  const filteredSlots = parsedSlots.filter(s => {
    if (filterDay !== 'ALL' && s.day !== filterDay) return false;
    if (filterType !== 'ALL' && s.type !== filterType) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        s.subjectCode.toLowerCase().includes(term) ||
        s.facultyName.toLowerCase().includes(term) ||
        s.section.toLowerCase().includes(term) ||
        s.room.toLowerCase().includes(term)
      );
    }
    return true;
  });

  // ---- UPLOAD TO DB ----
  const handleUploadToDB = async () => {
    if (parsedSlots.length === 0 || !user) return;
    setLoading(true);
    const safeSemester = Number(semester) || 1;

    try {
      addLog(`⚙️ Preparing Database (Force Mode)...`);

      const uniqueSubjects = [...new Set(parsedSlots.map(s => s.subjectCode))];
      const uniqueProfs = [...new Set(parsedSlots.map(s => s.facultyName))];
      const uniqueRooms = [...new Set(parsedSlots.map(s => s.room))];
      const uniqueGroups = [...new Set(parsedSlots.map(s => s.section))];

      addLog(`📦 Found: ${uniqueSubjects.length} Subjs, ${uniqueProfs.length} Profs, ${uniqueRooms.length} Rooms, ${uniqueGroups.length} Groups`);

      if (uniqueSubjects.length > 0) {
        const { error: subErr } = await supabase.from('subjects').upsert(
          uniqueSubjects.map(c => {
            const ltps = ltpsMap[c];
            const credits = ltps ? ltps.L + ltps.T + (ltps.P / 2) + ltps.S : 4;
            return {
              code: c,
              name: subjectMap[c] || c,
              credits,
              lectures: ltps?.L ?? null,
              tutorials: ltps?.T ?? null,
              practicals: ltps?.P ?? null,
              subject_type: 'Core'
            };
          }),
          { onConflict: 'code' }
        );
        if (subErr) throw new Error(`Subjects Error: ${subErr.message}`);
      }

      if (uniqueProfs.length > 0) {
        const distinctNames = Array.from(new Set([...uniqueProfs, 'Unknown']));
        const { error: profErr } = await supabase.from('professors').upsert(
          distinctNames.map(n => {
            let clean = n.replace(/^(Prof\.|Dr\.|Mr\.|Mrs\.|Ms\.)\s*/i, '');
            clean = clean.replace(/[^a-zA-Z\s]/g, '');
            const emailPrefix = clean.trim().split(/\s+/).join('.').toLowerCase();
            return { name: n, email: `${emailPrefix}@iiita.ac.in` };
          }),
          { onConflict: 'email' }
        );
        if (profErr) throw new Error(`Profs Error: ${profErr.message}`);
      }

      if (uniqueRooms.length > 0) {
        // Determine room_type from actual usage:
        // 'Lab' only if EVERY slot in that room is Practical; otherwise 'Lecture'
        const roomTypesMap: Record<string, Set<string>> = {};
        for (const slot of parsedSlots) {
          if (!slot.room) continue;
          if (!roomTypesMap[slot.room]) roomTypesMap[slot.room] = new Set();
          roomTypesMap[slot.room].add(slot.type);
        }

        const { error: roomErr } = await supabase.from('rooms').upsert(
          uniqueRooms.map(n => {
            const types = roomTypesMap[n];
            const isPurelyPractical = types && types.size === 1 && types.has('Practical');
            return { name: n, capacity: 60, room_type: isPurelyPractical ? 'Lab' : 'Lecture' };
          }),
          { onConflict: 'name' }
        );
        if (roomErr) throw new Error(`Rooms Error: ${roomErr.message}`);
      }

      if (uniqueGroups.length > 0) {
        const { error: grpErr } = await supabase.from('student_groups').upsert(
          uniqueGroups.map(n => ({
            name: n,
            semester: safeSemester,
            program: 'B.Tech',
            student_count: 60,
            group_type: 'Core'
          })),
          { onConflict: 'name,semester' }
        );
        if (grpErr) throw new Error(`Groups Error: ${grpErr.message}`);
      }

      addLog(`✅ All dependencies synced.`);

      const { data: dbSubjects } = await supabase.from('subjects').select('id, code');
      const { data: dbProfs } = await supabase.from('professors').select('id, name');
      const { data: dbRooms } = await supabase.from('rooms').select('id, name');
      const { data: dbGroups } = await supabase.from('student_groups')
        .select('id, name')
        .eq('semester', safeSemester);

      const findId = (list: any[], key: string, val: string) =>
        list?.find((item: any) => item[key]?.toLowerCase() === val?.toLowerCase())?.id;
      const unknownProfId = findId(dbProfs || [], 'name', 'Unknown');

      addLog(`🧹 Cleaning old slots for Sem ${safeSemester}...`);

      const { data: oldTTs } = await supabase.from('timetables').select('id').eq('semester', safeSemester);
      if (oldTTs && oldTTs.length > 0) {
        const ids = oldTTs.map(t => t.id);
        await supabase.from('timetable_slots').delete().in('timetable_id', ids);
        await supabase.from('timetables').delete().in('id', ids);
      }

      const { data: ttData, error: ttError } = await supabase.from('timetables').insert({
        name: tableName || `Imported Sem ${safeSemester}`,
        academic_year: '2025-26',
        semester: safeSemester,
        status: 'published',
        lunch_start: '13:00',
        lunch_end: '14:30',
        created_by: user.id
      }).select('id').single();

      if (ttError) throw ttError;

      addLog('🚀 Mapping slots...');
      let dropCount = 0;

      const slotsToInsert = parsedSlots.map((slot) => {
        const subId = findId(dbSubjects || [], 'code', slot.subjectCode);
        const profId = findId(dbProfs || [], 'name', slot.facultyName) || unknownProfId;
        const roomId = findId(dbRooms || [], 'name', slot.room);
        const groupId = findId(dbGroups || [], 'name', slot.section);

        if (!subId || !groupId) { dropCount++; return null; }

        return {
          timetable_id: ttData.id,
          subject_id: subId,
          professor_id: profId,
          room_id: roomId,
          student_group_id: groupId,
          day_of_week: ['MON', 'TUE', 'WED', 'THU', 'FRI'].findIndex(d => slot.day.includes(d)) + 1,
          start_time: slot.timeStart,
          end_time: slot.timeEnd,
          slot_type: slot.type
        };
      }).filter(Boolean);

      if (slotsToInsert.length > 0) {
        const { error: insertErr } = await supabase.from('timetable_slots').insert(slotsToInsert);
        if (insertErr) throw insertErr;
        addLog(`🎉 SUCCESS! Inserted ${slotsToInsert.length} slots.`);
        if (dropCount > 0) addLog(`⚠️ Warning: ${dropCount} slots were dropped.`);
      } else {
        addLog('❌ Error: All slots failed to map. Check unique constraints.');
      }

      // ── STEP: semester_clusters ─────────────────────────────────────
      addLog('📂 Syncing semester cluster...');
      const batchYear = new Date().getFullYear();

      // Delete existing cluster for this semester+dept so we get a clean upsert
      const { data: existingClusters } = await supabase
        .from('semester_clusters')
        .select('id')
        .eq('semester_number', safeSemester)
        .eq('department', 'IT');

      let clusterId: string | null = existingClusters?.[0]?.id ?? null;

      if (!clusterId) {
        const { data: clusterData, error: clusterErr } = await supabase
          .from('semester_clusters')
          .insert({ batch_year: batchYear, semester_number: safeSemester, department: 'IT', is_active: true })
          .select('id').single();
        if (clusterErr) throw new Error(`Cluster Error: ${clusterErr.message}`);
        clusterId = clusterData.id;
        addLog(`✅ Created cluster: Batch ${batchYear}, Sem ${safeSemester}`);
      } else {
        addLog(`✅ Reusing existing cluster for Sem ${safeSemester}`);
      }

      // ── STEP: cluster_requirements ──────────────────────────────────
      if (clusterId && dbSubjects && dbSubjects.length > 0) {
        addLog('📋 Syncing cluster requirements...');

        // Remove old requirements for this cluster then re-insert fresh
        await supabase.from('cluster_requirements').delete().eq('cluster_id', clusterId);

        const subjectIdsForCluster = uniqueSubjects
          .map(code => findId(dbSubjects, 'code', code))
          .filter(Boolean);

        if (subjectIdsForCluster.length > 0) {
          const { error: crErr } = await supabase.from('cluster_requirements').insert(
            subjectIdsForCluster.map(sid => ({ cluster_id: clusterId, subject_id: sid }))
          );
          if (crErr) throw new Error(`Cluster Requirements Error: ${crErr.message}`);
          addLog(`✅ Linked ${subjectIdsForCluster.length} subjects to cluster.`);
        }
      }

      // ── STEP: professor_expertise ───────────────────────────────────
      if (dbSubjects && dbProfs) {
        addLog('🎓 Syncing professor expertise...');

        // Build unique (professor_id, subject_id) pairs from parsed slots
        const expertisePairs = new Set<string>();
        const expertiseRows: { professor_id: string; subject_id: string; preference_level: number }[] = [];

        for (const slot of parsedSlots) {
          const profId = findId(dbProfs, 'name', slot.facultyName);
          const subId = findId(dbSubjects, 'code', slot.subjectCode);
          if (!profId || !subId) continue;
          const key = `${profId}|${subId}`;
          if (expertisePairs.has(key)) continue;
          expertisePairs.add(key);
          expertiseRows.push({ professor_id: profId, subject_id: subId, preference_level: 1 });
        }

        if (expertiseRows.length > 0) {
          // Delete stale expertise for subjects in this import, then re-insert
          const importedSubjectIds = uniqueSubjects
            .map(code => findId(dbSubjects, 'code', code))
            .filter(Boolean);
          if (importedSubjectIds.length > 0) {
            await supabase.from('professor_expertise').delete().in('subject_id', importedSubjectIds);
          }
          const { error: expErr } = await supabase.from('professor_expertise').insert(expertiseRows);
          if (expErr) throw new Error(`Expertise Error: ${expErr.message}`);
          addLog(`✅ Saved ${expertiseRows.length} professor→subject expertise links.`);
        }
      }

      if (slotsToInsert.length > 0 && onNavigate) {
        setTimeout(() => onNavigate('view-timetable', ttData.id), 1000);
      }

    } catch (err: any) {
      addLog(`❌ Failed: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100 mb-8">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <FileSpreadsheet className="text-green-600" /> Import Excel Timetable
      </h2>

      {/* Config */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text" value={tableName}
            onChange={e => setTableName(e.target.value)}
            className="block w-full border p-2 rounded"
            placeholder="e.g. Computer Science Sem 1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Semester</label>
          <select
            value={semester}
            onChange={e => setSemester(Number(e.target.value))}
            className="block w-full border p-2 rounded"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map(s => <option key={s} value={s}>Sem {s}</option>)}
          </select>
        </div>
      </div>

      {/* File Drop Zone */}
      <div className="border-2 border-dashed border-gray-300 p-8 text-center relative rounded-lg hover:bg-gray-50 transition-colors">
        <input
          type="file" accept=".xlsx,.xls"
          onChange={handleFileUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <Upload className="mx-auto h-10 w-10 text-gray-400 mb-2" />
        <p className="text-sm text-gray-500">
          {parsedSlots.length > 0 ? `✅ ${parsedSlots.length} slots parsed — click to re-upload` : 'Click to upload Excel File'}
        </p>
      </div>

      {/* --- FACULTY DIAGNOSTICS TABLE --- */}
      {profDiagnostics.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-600" />
            Faculty Extraction Diagnostics
          </h3>
          <div className="overflow-x-auto border rounded-lg shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-indigo-50 text-indigo-900 font-semibold border-b">
                <tr>
                  <th className="p-3 w-24">Code</th>
                  <th className="p-3 w-1/3">Course Name</th>
                  <th className="p-3 w-1/3">Raw Excel Data</th>
                  <th className="p-3">Parsed Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {profDiagnostics.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3 font-mono font-bold text-gray-700">{item.code}</td>
                    <td className="p-3 text-gray-600">{item.name}</td>
                    <td className="p-3 font-mono text-xs text-orange-700 bg-orange-50/50 rounded">{item.facultyString}</td>
                    <td className="p-3 text-green-700 font-medium text-xs">{item.parsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}



      {/* --- LOG CONSOLE --- */}
      {logs.length > 0 && (
        <div className="mt-4 bg-slate-900 text-green-400 p-4 rounded h-40 overflow-y-auto text-xs font-mono">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
          {loading && (
            <div className="text-yellow-400 mt-2 flex gap-2">
              <Loader2 className="animate-spin w-3 h-3" /> Working...
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          REVIEW & EDIT TABLE
          ============================================================ */}
      {reviewMode && parsedSlots.length > 0 && !loading && (
        <div className="mt-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Pencil className="w-5 h-5 text-indigo-600" />
              Review & Edit Slots
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({filteredSlots.length} of {parsedSlots.length} shown)
              </span>
            </h3>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search subject / faculty / room..."
                className="text-sm border rounded px-3 py-1.5 w-56 focus:outline-none focus:border-indigo-400"
              />

              {/* Day filter */}
              <select
                value={filterDay}
                onChange={e => setFilterDay(e.target.value)}
                className="text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400"
              >
                <option value="ALL">All Days</option>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>

              {/* Type filter */}
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400"
              >
                <option value="ALL">All Types</option>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              {/* Add row */}
              <button
                onClick={handleAddRow}
                className="text-sm bg-gray-100 hover:bg-gray-200 border rounded px-3 py-1.5 flex items-center gap-1 transition"
              >
                + Add Row
              </button>

              {/* Discard */}
              <button
                onClick={() => { setParsedSlots([]); setReviewMode(false); }}
                className="text-sm bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded px-3 py-1.5 flex items-center gap-1 transition"
              >
                <X className="w-4 h-4" /> Discard
              </button>
            </div>
          </div>

          {/* Editable Table */}
          <div className="overflow-auto border rounded-lg shadow-sm max-h-[60vh]">
            <table className="w-full text-xs text-left min-w-[900px]">
              <thead className="bg-indigo-50 text-indigo-900 font-semibold border-b sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 w-20">Day</th>
                  <th className="px-2 py-2 w-20">Start</th>
                  <th className="px-2 py-2 w-20">End</th>
                  <th className="px-2 py-2 w-32">Subject Code</th>
                  <th className="px-2 py-2 w-24">Type</th>
                  <th className="px-2 py-2 w-24">Section</th>
                  <th className="px-2 py-2 w-28">Room</th>
                  <th className="px-2 py-2">Faculty</th>
                  <th className="px-2 py-2 w-10 text-center">
                    <Trash2 className="w-3.5 h-3.5 mx-auto text-gray-400" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSlots.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-gray-400 italic">
                      No slots match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredSlots.map(slot => (
                    <EditableRow
                      key={slot.id}
                      slot={slot}
                      onChange={handleSlotChange}
                      onDelete={handleSlotDelete}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Summary bar */}
          <div className="mt-3 flex items-center gap-6 text-xs text-gray-500">
            {DAYS.map(d => {
              const count = parsedSlots.filter(s => s.day === d).length;
              return <span key={d}><strong className="text-gray-700">{d}</strong>: {count}</span>;
            })}
            <span className="ml-auto">
              🗑 <strong className="text-gray-700">{parsedSlots.filter(s => !s.subjectCode).length}</strong> empty subject rows (will be dropped)
            </span>
          </div>

          {/* ---- LTP HOUR CROSS-CHECK ---- */}
          {(() => {
            const subjects = [...new Set(parsedSlots.map(s => s.subjectCode).filter(Boolean))].sort();
            if (subjects.length === 0) return null;

            // Helper: count unique (day|section) combos for a given type
            const uniqCount = (slots: ParsedSlot[], type: string) => {
              const seen = new Set<string>();
              slots.filter(s => s.type === type).forEach(s => seen.add(`${s.day}|${s.section}`));
              return seen.size;
            };

            type CellStatus = 'ok' | 'bad' | 'noref';
            const checkCell = (got: number, expected: number | undefined): CellStatus =>
              expected === undefined ? 'noref' : got === expected ? 'ok' : 'bad';

            const tableRows = subjects.map(code => {
              const slots = parsedSlots.filter(s => s.subjectCode === code);
              const parsedL = uniqCount(slots, 'Lecture');
              const parsedT = uniqCount(slots, 'Tutorial');
              const parsedP = uniqCount(slots, 'Practical');
              const excelLtps = ltpsMap[code];
              const allOk = !excelLtps || (
                parsedL === excelLtps.L &&
                parsedT === excelLtps.T &&
                parsedP === excelLtps.P
              );
              return { code, name: subjectMap[code] || code, parsedL, parsedT, parsedP, excelLtps, allOk };
            });

            const anyBad = tableRows.some(r => !r.allOk);

            const CellBadge = ({ got, exp }: { got: number; exp: number | undefined }) => {
              const st = checkCell(got, exp);
              if (st === 'noref') return <span className="text-gray-400">—</span>;
              if (st === 'ok') return (
                <span className="font-bold text-green-700">{got}</span>
              );
              return (
                <span className="font-bold text-red-600 flex items-center justify-center gap-0.5">
                  {got}<span className="text-[9px] opacity-70">/{exp}</span>
                </span>
              );
            };

            return (
              <div className="mt-5 border rounded-lg overflow-hidden shadow-sm">
                <div className={`px-3 py-2 font-semibold text-xs uppercase flex items-center gap-2 border-b
                  ${anyBad ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
                  📊 LTP Cross-Check
                  <span className="font-normal normal-case opacity-70 ml-1">
                    — parsed hrs/week vs Excel L-T-P-S &nbsp;
                    <span className="italic text-[10px]">(green = match, red = got/expected)</span>
                  </span>
                  {anyBad && (
                    <span className="ml-auto px-2 py-0.5 bg-amber-200 text-amber-900 rounded-full text-[10px] font-bold">
                      ⚠ Mismatch
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-600 border-b">
                      <tr>
                        <th className="px-3 py-1.5 font-semibold">Code</th>
                        <th className="px-3 py-1.5 font-semibold">Course Name</th>
                        <th className="px-3 py-1.5 font-semibold text-center">Excel L-T-P-S</th>
                        <th className="px-3 py-1.5 font-semibold text-blue-700 text-center">L (parsed)</th>
                        <th className="px-3 py-1.5 font-semibold text-purple-700 text-center">T (parsed)</th>
                        <th className="px-3 py-1.5 font-semibold text-orange-700 text-center">P (parsed)</th>
                        <th className="px-3 py-1.5 font-semibold text-center">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tableRows.map(r => (
                        <tr key={r.code} className={r.allOk ? 'hover:bg-gray-50' : 'bg-red-50 hover:bg-red-100'}>
                          <td className="px-3 py-1 font-mono font-bold text-gray-700">{r.code}</td>
                          <td className="px-3 py-1 text-gray-600 max-w-[200px] truncate" title={r.name}>{r.name}</td>
                          <td className="px-3 py-1 text-center font-mono text-gray-500">
                            {r.excelLtps
                              ? `${r.excelLtps.L}-${r.excelLtps.T}-${r.excelLtps.P}-${r.excelLtps.S}`
                              : <span className="italic text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-1 text-center">
                            <CellBadge got={r.parsedL} exp={r.excelLtps?.L} />
                          </td>
                          <td className="px-3 py-1 text-center">
                            <CellBadge got={r.parsedT} exp={r.excelLtps?.T} />
                          </td>
                          <td className="px-3 py-1 text-center">
                            <CellBadge got={r.parsedP} exp={r.excelLtps?.P} />
                          </td>
                          <td className="px-3 py-1 text-center font-semibold text-gray-700">
                            {r.parsedL + r.parsedT + (r.parsedP / 2)}
                            {r.excelLtps && (
                              <span className="text-gray-400 font-normal text-[10px]">
                                /{r.excelLtps.L + r.excelLtps.T + (r.excelLtps.P / 2) + r.excelLtps.S}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Save Button */}
          <button
            onClick={handleUploadToDB}
            className="w-full mt-4 bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            Confirm &amp; Save {parsedSlots.length} Slots to Database
          </button>
        </div>
      )}

      {/* Old fallback button (no review mode, e.g. re-upload scenario) */}
      {!reviewMode && parsedSlots.length > 0 && !loading && (
        <button
          onClick={handleUploadToDB}
          className="w-full mt-4 bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-2"
        >
          <Database className="w-4 h-4" /> Save to Database
        </button>
      )}
    </div>
  );
};

export default TimetableImporter;