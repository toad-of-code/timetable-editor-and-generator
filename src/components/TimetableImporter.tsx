import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Upload, Database, Loader2, FileSpreadsheet, Bug, CheckCircle, AlertTriangle, User } from 'lucide-react';

// --- Constants & Types ---

const TYPE_MAP: Record<string, 'Lecture' | 'Tutorial' | 'Practical'> = { 
  'L': 'Lecture', 'T': 'Tutorial', 'P': 'Practical' 
};

// 1. EXACT IGNORE (Garbage)
const IGNORE_EXACT = [
  'LUNCH', 'BREAK', 'RECESS', 'TEA', 'TIME TABLE', 'DEPARTMENT'
];

// 2. KEYWORD IGNORE (Headers to Ditch)
const IGNORE_KEYWORDS = [
  'BASKET', 'MDM', 'HSMC', 'OPEN ELECTIVE', 'PROGRAM ELECTIVE', 'MINOR', 'MINORS'
];

interface ParsedSlot {
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

// --- The Robust Parser (Heuristic) ---
const parseSlotHeuristically = (rawText: string) => {
  let text = rawText.trim();
  
  // 1. EXACT MATCH IGNORE
  const cleanText = normalizeIgnore(text);
  if (IGNORE_EXACT.some(ig => normalizeIgnore(ig) === cleanText)) {
      return { skipped: true, reason: `Ignored Garbage: ${text}` };
  }

  // A. EXTRACT TYPE (L/T/P)
  let type: 'Lecture' | 'Tutorial' | 'Practical' = 'Lecture';
  const typeMatch = text.match(/\((L|T|P)\)/i);
  if (typeMatch) {
    const code = typeMatch[1].toUpperCase();
    if (code === 'T') type = 'Tutorial';
    if (code === 'P') type = 'Practical';
    text = text.replace(typeMatch[0], ' '); 
  }

  // B. EXTRACT ROOM
  let room = 'TBA';
  const roomRegex = /\(((?:CC[1-3]|LT)\s*[-]?\s*\d{4})\)/i; 
  const roomMatch = text.match(roomRegex) || text.match(/\(([A-Z0-9\s-]{3,})\)$/); 

  if (roomMatch) {
    room = normalizeRoom(roomMatch[1]);
    text = text.replace(roomMatch[0], ' ');
  }

  // C. EXTRACT SECTION
  let section = 'All'; 
  const secMatch = text.match(/(?:Sec|Group)\.?\s*([A-Z0-9-/]{1,5})/i);
  if (secMatch) {
    section = `Sec ${secMatch[1]}`;
    text = text.replace(secMatch[0], ' ');
  }

  // D. EXTRACT SUBJECT
  let subject = text.replace(/\s+[-–]\s+/g, ' ').trim(); 
  subject = subject.replace(/[()]/g, '').trim(); 

  if (!subject || subject.length < 2) {
      return { skipped: true, reason: `Subject empty after cleanup` };
  }

  return { subject, type, section, room, skipped: false };
};

// --- Main Component ---

const TimetableImporter: React.FC<Props> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [tableName, setTableName] = useState('');
  const [semester, setSemester] = useState<number>(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [parsedSlots, setParsedSlots] = useState<ParsedSlot[]>([]);
  const [debugData, setDebugData] = useState<DebugRow[]>([]);
  const [subjectMap, setSubjectMap] = useState<Record<string, string>>({});
  
  // NEW: State for Professor Diagnostics
  const [profDiagnostics, setProfDiagnostics] = useState<ProfDiagnostic[]>([]);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setLogs(['Reading file...']);
    setParsedSlots([]);
    setDebugData([]);
    setProfDiagnostics([]); // Clear previous diagnostics
    
    if (!tableName) setTableName(file.name.replace(/\.xlsx?$/, ''));

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const bstr = event.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]]; // Get the sheet object
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
  
  const processExcelData = async (rows: any[][], sheet: any) => {
    addLog(`🔍 Processing ${rows.length} rows...`);
    
    const facultyMap: Record<string, { default: string; [key: string]: string }> = {};
    const subjectNameMap: Record<string, string> = {};
    const extractedSlots: ParsedSlot[] = [];
    const debugRows: DebugRow[] = [];
    const diagnostics: ProfDiagnostic[] = []; // Temp diagnostics array
    
    // Retrieve merged ranges from the sheet
    const merges = sheet['!merges'] || [];

    // --- 1. HEADER DETECTION ---
    const TIME_ROW_INDEX = 1; 
    const colToTime: Record<number, {start: string, end: string}> = {};
    
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
        const match = t.match(/(\d{1,2}[:.]\d{2})\s*[-to]+\s*(\d{1,2}[:.]\d{2})/i);
        
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

    // --- 2. EXTRACT METADATA (Fixed: Prevents Overwriting) ---
    let metadataStartRow = -1;
    let codeColIdx = 0;    // Default Col A
    let nameColIdx = 2;    // Default Col C
    let facultyColIdx = 3; // Default Col D

    // Scan for Header Row
    rows.forEach((row, idx) => {
        const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
        if (rowStr.includes('course code') && rowStr.includes('faculties')) {
            metadataStartRow = idx;
            // Dynamically find indices
            row.forEach((cell: any, cIdx: number) => {
                const cStr = String(cell).toLowerCase();
                if (cStr.includes('course code')) codeColIdx = cIdx;
                if (cStr.includes('course name')) nameColIdx = cIdx;
                if (cStr.includes('faculties') || cStr.includes('faculty')) facultyColIdx = cIdx;
            });
            addLog(`✅ Found Metadata Header at Row ${idx + 1}`);
        }
    });

    if (metadataStartRow !== -1) {
      for (let r = metadataStartRow + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[codeColIdx]) continue;
        
        const code = sanitize(row[codeColIdx]); 
        const name = sanitize(row[nameColIdx]); 
        const rawFaculty = sanitize(row[facultyColIdx]); 

        if (code) {
           if (name) subjectNameMap[code] = name;
           
           const profs: any = { default: 'Unknown' };
           // 👇 FIX: Use an array to collect ALL results
           const parsedList: string[] = []; 

           if (rawFaculty && rawFaculty.toLowerCase() !== 'unknown') {
               const parts = rawFaculty.split(/,(?![^(]*\))/); 
               
               parts.forEach((p: string) => {
                   const cleanP = p.trim();
                   const match = cleanP.match(/([^(]+)\(([^)]+)\)/);
                   
                   if (match) {
                       const pName = match[1].trim();
                       const sections = match[2].split(/[,&]/).map(s => s.trim());
                       
                       sections.forEach(sec => {
                           const key = sec.replace('Sec', '').trim();
                           profs[key] = pName; 
                           profs[`Sec ${key}`] = pName;
                       });
                       // 👇 Push to list instead of overwriting variable
                       parsedList.push(sections.map(s => `${s}: ${pName}`).join(', '));
                       
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
           
           // Add to Diagnostics
           diagnostics.push({
               code,
               name,
               facultyString: rawFaculty || "Empty",
               // 👇 Join the array to show everything
               parsed: parsedList.length > 0 ? parsedList.join(' | ') : "Default: Unknown"
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

      const timeCols = Object.keys(colToTime).map(Number).sort((a,b) => a-b);
      
      for (let i = 0; i < timeCols.length; i++) {
        const c = timeCols[i];
        const timeRange = colToTime[c];
        let cellText = sanitize(row[c]);

        if (IGNORE_EXACT.some(w => cellText.toUpperCase() === w)) continue;

        if (cellText.length > 2) {
           // Heuristic: Add newlines before section brackets to separate combined slots
           cellText = cellText.replace(/(\))(\s+)([A-Z]{2,})/g, '$1\n$3');
           const lines = cellText.split(/\r?\n/).filter(l => l.trim().length > 0);

           lines.forEach(line => {
             let cleanLine = sanitize(line);
             
             // Remove keywords instead of skip
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

                // --- MERGE DETECTION LOGIC ---
                let finalEnd = timeRange.end;
                const mergeRange = merges.find((m: any) => m.s.r === r && m.s.c === c);

                if (mergeRange) {
                    const endColIdx = mergeRange.e.c;
                    if (colToTime[endColIdx]) {
                        finalEnd = colToTime[endColIdx].end;
                    }
                } 
                else if (type === 'Practical') {
                    finalEnd = addTwoHours(timeRange.start);
                }

                extractedSlots.push({
                    day: currentDay, 
                    timeStart: timeRange.start, 
                    timeEnd: finalEnd,
                    subjectCode: subject, 
                    type, 
                    section: section, 
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
                        reason: result.reason || 'Heuristic skipped' 
                    });
                 }
             }
           });
        }
      }
    }
    setSubjectMap(subjectNameMap);
    setDebugData(debugRows);
    setParsedSlots(extractedSlots);
    if (extractedSlots.length > 0) addLog(`✅ Parsed ${extractedSlots.length} slots.`);
    else addLog(`❌ Parsed 0 slots.`);
  };

  const handleUploadToDB = async () => {
    if (parsedSlots.length === 0 || !user) return;
    setLoading(true);
    const safeSemester = Number(semester) || 1; 

    try {
      addLog(`⚙️ Preparing Database (Force Mode)...`);

      // 1. EXTRACT UNIQUE ENTITIES
      const uniqueSubjects = [...new Set(parsedSlots.map(s => s.subjectCode))];
      const uniqueProfs = [...new Set(parsedSlots.map(s => s.facultyName))];
      const uniqueRooms = [...new Set(parsedSlots.map(s => s.room))];
      const uniqueGroups = [...new Set(parsedSlots.map(s => s.section))]; 

      addLog(`📦 Found: ${uniqueSubjects.length} Subjs, ${uniqueProfs.length} Profs, ${uniqueRooms.length} Rooms, ${uniqueGroups.length} Groups`);

      // 2. UPSERT ENTITIES
      if (uniqueSubjects.length > 0) {
        const { error: subErr } = await supabase.from('subjects').upsert(
            uniqueSubjects.map(c => ({ 
                code: c, 
                name: subjectMap[c] || c, 
                credits: 4,
                subject_type: 'Core' 
            })), 
            { onConflict: 'code' }
        );
        if (subErr) throw new Error(`Subjects Error: ${subErr.message}`);
      }

      // B. Professors (Fixed: Cleaner Email Generation)
      if (uniqueProfs.length > 0) {
        const distinctNames = Array.from(new Set([...uniqueProfs, 'Unknown']));
        const { error: profErr } = await supabase.from('professors').upsert(
            distinctNames.map(n => {
                // 1. Remove Title (Prof., Dr., etc.)
                let clean = n.replace(/^(Prof\.|Dr\.|Mr\.|Mrs\.|Ms\.)\s*/i, '');
                
                // 2. Remove all other punctuation (dots, commas, etc)
                clean = clean.replace(/[^a-zA-Z\s]/g, '');
                
                // 3. Trim extra spaces and join with a single dot
                const emailPrefix = clean.trim().split(/\s+/).join('.').toLowerCase();

                return { 
                    name: n, 
                    email: `${emailPrefix}@iiita.ac.in` 
                };
            }), 
            { onConflict: 'email' }
        );
        if (profErr) throw new Error(`Profs Error: ${profErr.message}`);
      }

      if (uniqueRooms.length > 0) {
        const { error: roomErr } = await supabase.from('rooms').upsert(
            uniqueRooms.map(n => ({ name: n, capacity: 60, room_type:"Lecture" })), 
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

      // 3. FETCH IDS
      const { data: dbSubjects } = await supabase.from('subjects').select('id, code');
      const { data: dbProfs } = await supabase.from('professors').select('id, name');
      const { data: dbRooms } = await supabase.from('rooms').select('id, name');
      const { data: dbGroups } = await supabase.from('student_groups')
        .select('id, name')
        .eq('semester', safeSemester);

      const findId = (list: any[], key: string, val: string) => list?.find((item: any) => item[key]?.toLowerCase() === val?.toLowerCase())?.id;
      const unknownProfId = findId(dbProfs || [], 'name', 'Unknown');

      // 4. CLEAN AND PREPARE TIMETABLE
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

      // 5. INSERT SLOTS
      addLog('🚀 Mapping slots...');
      let dropCount = 0;

      const slotsToInsert = parsedSlots.map((slot, i) => {
        const subId = findId(dbSubjects || [], 'code', slot.subjectCode);
        const profId = findId(dbProfs || [], 'name', slot.facultyName) || unknownProfId;
        const roomId = findId(dbRooms || [], 'name', slot.room);
        const groupId = findId(dbGroups || [], 'name', slot.section);
        
        if (!subId || !groupId) {
            dropCount++;
            return null; 
        }

        return {
          timetable_id: ttData.id, 
          subject_id: subId, 
          professor_id: profId, 
          room_id: roomId, 
          student_group_id: groupId,
          day_of_week: ['MON','TUE','WED','THU','FRI'].findIndex(d => slot.day.includes(d)) + 1,
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
        if (onNavigate) setTimeout(() => onNavigate('view-timetable', ttData.id), 1000);
      } else {
        addLog('❌ Error: All slots failed to map. Check unique constraints.');
      }

    } catch (err: any) {
      addLog(`❌ Failed: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100 mb-8">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <FileSpreadsheet className="text-green-600" /> Import Excel Timetable
      </h2>
      
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input type="text" value={tableName} onChange={e=>setTableName(e.target.value)} className="block w-full border p-2 rounded" placeholder="e.g. Computer Science Sem 1" />
        </div>
        <div>
            <label className="block text-sm font-medium mb-1">Semester</label>
            <select value={semester} onChange={e=>setSemester(Number(e.target.value))} className="block w-full border p-2 rounded">
                {[1,2,3,4,5,6,7,8].map(s=><option key={s} value={s}>Sem {s}</option>)}
            </select>
        </div>
      </div>

      <div className="border-2 border-dashed border-gray-300 p-8 text-center relative rounded-lg hover:bg-gray-50 transition-colors">
        <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        <Upload className="mx-auto h-10 w-10 text-gray-400 mb-2" />
        <p className="text-sm text-gray-500">Click to upload Excel File</p>
      </div>

      {/* --- PROFESSOR DIAGNOSTICS TABLE --- */}
      {profDiagnostics.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-600"/> 
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

      {/* --- SLOT PARSER DIAGNOSTICS --- */}
      {(debugData.length > 0) && (
        <div className="mt-6 border rounded-lg overflow-hidden">
            <div className="bg-gray-100 p-2 font-bold text-xs text-gray-600 uppercase border-b flex items-center gap-2">
                <Bug className="w-4 h-4"/> Parser Diagnostics
            </div>
            <div className="max-h-60 overflow-y-auto bg-gray-50 p-2 space-y-1">
                {debugData.map((d, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs p-2 rounded border ${d.status === 'Parsed' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                        {d.status === 'Parsed' ? <CheckCircle className="w-3 h-3"/> : <AlertTriangle className="w-3 h-3"/>}
                        <span className="font-mono bg-white px-1 border rounded text-[10px] w-12 text-center">Row {d.rowNum}</span>
                        <span className="flex-1 font-mono break-all">{d.rawText}</span>
                        {d.reason && <span className="text-gray-500 italic">({d.reason})</span>}
                    </div>
                ))}
            </div>
        </div>
      )}

      {(logs.length > 0) && (
        <div className="mt-4 bg-slate-900 text-green-400 p-4 rounded h-40 overflow-y-auto text-xs font-mono">
            {logs.map((l,i)=><div key={i}>{l}</div>)}
            {loading && <div className="text-yellow-400 mt-2 flex gap-2"><Loader2 className="animate-spin w-3 h-3"/> Working...</div>}
        </div>
      )}

      {parsedSlots.length > 0 && !loading && (
        <button onClick={handleUploadToDB} className="w-full mt-4 bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-2">
            <Database className="w-4 h-4"/> Save to Database
        </button>
      )}
    </div>
  );
};

export default TimetableImporter;