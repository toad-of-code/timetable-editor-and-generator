import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Download, ArrowLeft, Loader2, Filter, Save, CheckSquare, Square, Layers } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';

interface CustomViewerProps {
  onBack?: () => void;
}

interface FetchedSlot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_type: 'Lecture' | 'Tutorial' | 'Practical';
  subject_code: string;
  subject_name: string;
  professor_name: string;
  room_name: string;
  group_name: string;
  semester: number;
}

interface TimeColumn {
  label: string;
  start: string;
  end: string;
  isLunch?: boolean;
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

export function StudentCustomTimetable({ onBack }: CustomViewerProps) {
  const [loading, setLoading] = useState(true);
  const [allSlots, setAllSlots] = useState<FetchedSlot[]>([]);
  
  // --- Selection State ---
  const [availableSemesters, setAvailableSemesters] = useState<number[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<number>(0);

  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  
  const [isConfigOpen, setIsConfigOpen] = useState(true);

  const pdfRef = useRef<HTMLDivElement>(null);

  // --- Helpers ---
  const convertTo12Hour = (time24: string) => {
    if (!time24) return '';
    const [hourStr, minute] = time24.split(':');
    let hour = parseInt(hourStr);
    hour = hour % 12 || 12; 
    return `${hour}:${minute}`;
  };

  // --- 1. Load Data & Restore State ---
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: published } = await supabase.from('timetables').select('id').eq('status', 'published');
      if (!published || published.length === 0) { setLoading(false); return; }
      const pubIds = published.map(p => p.id);

      const { data, error } = await supabase
        .from('timetable_slots')
        .select(`
          id, day_of_week, start_time, end_time, slot_type,
          subjects (code, name), professors (name), rooms (name), student_groups (name, semester)
        `)
        .in('timetable_id', pubIds);

      if (error) throw error;

      const rawData = data as any[];
      const cleanSlots: FetchedSlot[] = rawData.map(s => ({
          id: s.id,
          day_of_week: s.day_of_week,
          start_time: s.start_time.slice(0, 5),
          end_time: s.end_time.slice(0, 5),
          slot_type: s.slot_type,
          subject_code: s.subjects?.code || 'N/A',
          subject_name: s.subjects?.name || 'N/A',
          professor_name: s.professors?.name || 'TBA',
          room_name: s.rooms?.name || 'TBA',
          group_name: s.student_groups?.name?.replace('Sec', '').trim() || 'N/A',
          semester: s.student_groups?.semester || 0
      }));

      setAllSlots(cleanSlots);

      // Extract Semesters
      const sems = Array.from(new Set(cleanSlots.map(s => s.semester))).sort((a, b) => a - b);
      setAvailableSemesters(sems);

      // --- RESTORE FROM LOCAL STORAGE ---
      const savedSem = localStorage.getItem('my_custom_semester');
      const savedGroup = localStorage.getItem('my_custom_group');
      const savedSubs = localStorage.getItem('my_custom_subjects');

      if (savedSem && sems.includes(parseInt(savedSem))) {
          const semNum = parseInt(savedSem);
          setSelectedSemester(semNum);
          
          const semSlots = cleanSlots.filter(s => s.semester === semNum);
          // Get groups but HIDE 'All' from the selector (it's merged automatically)
          const groups = Array.from(new Set(semSlots.map(s => s.group_name)))
            .filter(g => g !== 'All' && g !== 'Sec All')
            .sort();
          setAvailableGroups(groups);

          if (savedGroup && groups.includes(savedGroup)) {
              setSelectedGroup(savedGroup);
              
              // RE-MERGE LOGIC: Group + All
              const relevantSlots = cleanSlots.filter(s => 
                  s.semester === semNum && 
                  (s.group_name === savedGroup || s.group_name === 'All')
              );
              const uniqueSubjects = Array.from(new Set(relevantSlots.map(s => s.subject_code))).sort();
              setAvailableSubjects(uniqueSubjects);

              if (savedSubs) {
                  setSelectedSubjects(JSON.parse(savedSubs));
                  setIsConfigOpen(false); // Auto-close if fully restored
              } else {
                  // Fallback: Select All if no specific subs saved
                  setSelectedSubjects(uniqueSubjects);
              }
          }
      }

    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // --- 2. Handle Semester Change ---
  const handleSemesterChange = (sem: number) => {
      setSelectedSemester(sem);
      localStorage.setItem('my_custom_semester', sem.toString());
      
      const semSlots = allSlots.filter(s => s.semester === sem);
      // Exclude 'All' from buttons
      const groups = Array.from(new Set(semSlots.map(s => s.group_name)))
        .filter(g => g !== 'All' && g !== 'Sec All')
        .sort();
      setAvailableGroups(groups);
      
      // Reset Downstream
      setSelectedGroup('');
      setAvailableSubjects([]);
      setSelectedSubjects([]);
      localStorage.removeItem('my_custom_group');
      localStorage.removeItem('my_custom_subjects');
  };

  // --- 3. Handle Group Change (The Magic Logic) ---
  const handleGroupChange = (g: string) => {
      setSelectedGroup(g);
      localStorage.setItem('my_custom_group', g);
      
      // 1. Find slots for Selected Group OR "All"
      const relevantSlots = allSlots.filter(s => 
          s.semester === selectedSemester && 
          (s.group_name === g || s.group_name === 'All')
      );
      
      // 2. Extract Subjects
      const uniqueSubjects = Array.from(new Set(relevantSlots.map(s => s.subject_code))).sort();
      setAvailableSubjects(uniqueSubjects);
      
      // 3. AUTO-SELECT ALL (User unchecks what they don't want)
      setSelectedSubjects(uniqueSubjects);
      localStorage.setItem('my_custom_subjects', JSON.stringify(uniqueSubjects));
  };

  // --- 4. Toggle Subjects ---
  const toggleSubject = (code: string) => {
    setSelectedSubjects(prev => {
        const next = prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code];
        localStorage.setItem('my_custom_subjects', JSON.stringify(next));
        return next;
    });
  };

  const selectAllSubjects = () => {
    setSelectedSubjects(availableSubjects);
    localStorage.setItem('my_custom_subjects', JSON.stringify(availableSubjects));
  };

  const deselectAllSubjects = () => {
    setSelectedSubjects([]);
    localStorage.setItem('my_custom_subjects', JSON.stringify([]));
  };

  // --- 5. Filter Slots ---
  const filteredSlots = useMemo(() => {
      return allSlots.filter(s => 
          s.semester === selectedSemester &&
          // Match Group OR All
          (s.group_name === selectedGroup || s.group_name === 'All') && 
          // Match Checked Subjects
          selectedSubjects.includes(s.subject_code)
      );
  }, [allSlots, selectedSemester, selectedGroup, selectedSubjects]);


  // --- 6. Dynamic Columns ---
  const dynamicTimeColumns = useMemo(() => {
    if (filteredSlots.length === 0) return [
      { label: '09:00-10:00', start: '09:00', end: '10:00' },
      { label: 'LUNCH', start: '13:00', end: '14:30', isLunch: true }
    ];

    const boundaries = new Set<string>();
    filteredSlots.forEach(s => { boundaries.add(s.start_time); boundaries.add(s.end_time); });
    boundaries.add('10:50'); boundaries.add('11:00'); boundaries.add('13:00'); boundaries.add('14:30');

    const sortedTimes = Array.from(boundaries).sort();
    const filteredTimes = sortedTimes.filter(t => {
      if (t > '13:00' && t < '14:30') return false;
      if (t > '10:50' && t < '11:00') return false;
      return true;
    });

    let cols: TimeColumn[] = [];
    for (let i = 0; i < filteredTimes.length - 1; i++) {
      const start = filteredTimes[i];
      const end = filteredTimes[i + 1];
      const isLunch = (start === '13:00' && end === '14:30');
      const isBreak = (start === '10:50' && end === '11:00');
      const cStart = parseInt(start.replace(':', ''));
      const cEnd = parseInt(end.replace(':', ''));

      const hasClass = filteredSlots.some(s => {
        const sStart = parseInt(s.start_time.replace(':', ''));
        const sEnd = parseInt(s.end_time.replace(':', ''));
        return (sStart < cEnd && sEnd > cStart);
      });

      if (isLunch || isBreak || hasClass) {
        cols.push({
          label: isLunch ? 'LUNCH' : isBreak ? 'BREAK' : `${convertTo12Hour(start)} - ${convertTo12Hour(end)}`,
          start, end, isLunch: isLunch || isBreak
        });
      }
    }
    return cols;
  }, [filteredSlots]);

  // --- Render Cell ---
  const renderCellContent = (dayIndex: number, column: TimeColumn) => {
    const colStart = parseInt(column.start.replace(':', ''));
    const colEnd = parseInt(column.end.replace(':', ''));

    const cellSlots = filteredSlots.filter(s => {
      if (s.day_of_week !== dayIndex + 1) return false;
      const sStart = parseInt(s.start_time.replace(':', ''));
      const sEnd = parseInt(s.end_time.replace(':', ''));
      return (sStart <= colStart && sEnd >= colEnd);
    });

    if (cellSlots.length === 0) return null;

    return (
      <div className="h-full flex flex-col justify-start overflow-y-auto custom-scrollbar p-1 gap-1">
        {cellSlots.map(slot => (
             <div key={slot.id} className="w-full flex flex-col justify-center items-center text-[9px] leading-tight text-black bg-indigo-50/50 p-1 border border-indigo-100 rounded shadow-sm">
                <div className="font-bold text-indigo-700 whitespace-nowrap">{slot.subject_code}</div>
                <div className="text-[8px] font-semibold text-gray-600">{slot.room_name}</div>
                {/* Visual Hint for Merged Classes */}
                {slot.group_name !== selectedGroup && (
                   <div className="text-[8px] text-gray-400 italic">({slot.group_name})</div>
                )}
                <div className="text-[8px] text-gray-500 scale-90">{slot.professor_name.split('&')[0]}</div>
             </div>
        ))}
      </div>
    );
  };

  // --- PDF Export ---
  const handleDownloadPDF = async () => {
    if (!pdfRef.current) return;
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';
    try {
      const element = pdfRef.current;
      const imgData = await toPng(element, { 
        cacheBust: true, 
        backgroundColor: '#ffffff', 
        width: element.scrollWidth, 
        height: element.scrollHeight, 
        style: { overflow: 'visible', height: 'auto', position: 'static' } 
      });
      const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: [element.scrollWidth * 0.264583 + 10, element.scrollHeight * 0.264583 + 10] });
      pdf.addImage(imgData, 'PNG', 5, 5, element.scrollWidth * 0.264583, element.scrollHeight * 0.264583);
      pdf.save(`My-Schedule.pdf`);
    } catch (err) { 
        console.error(err);
        alert('PDF Generation Failed'); 
    } finally {
        document.body.style.cursor = originalCursor;
    }
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-indigo-600" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-20">
      
      {/* 1. CONFIGURATION PANEL */}
      <div className={`bg-white border-b transition-all duration-300 ${isConfigOpen ? 'p-4' : 'h-0 overflow-hidden p-0 border-0'}`}>
         <div className="max-w-4xl mx-auto">
            <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <Filter className="w-4 h-4 text-indigo-600"/> Customize Your View
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-2">1. SELECT SEMESTER</label>
                    <div className="flex flex-wrap gap-2">
                        {availableSemesters.map(sem => (
                            <button 
                                key={sem} 
                                onClick={() => handleSemesterChange(sem)}
                                className={`px-3 py-1.5 text-xs rounded-full border transition-all flex items-center gap-1 ${selectedSemester === sem ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
                            >
                                <Layers className="w-3 h-3" /> Sem {sem}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={`${!selectedSemester ? 'opacity-50 pointer-events-none' : ''}`}>
                    <label className="block text-xs font-semibold text-gray-500 mb-2">2. SELECT SECTION</label>
                    <div className="flex flex-wrap gap-2">
                        {availableGroups.length === 0 ? <span className="text-xs text-gray-400 italic">Select semester first</span> : 
                            availableGroups.map(g => (
                                <button 
                                    key={g} 
                                    onClick={() => handleGroupChange(g)}
                                    className={`px-3 py-1.5 text-xs rounded-full border transition-all ${selectedGroup === g ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
                                >
                                    Sec {g}
                                </button>
                        ))}
                    </div>
                </div>
            </div>

            {selectedGroup && (
                <div className="mt-6 pt-4 border-t border-dashed">
                    <div className="flex justify-between items-end mb-2">
                        <label className="block text-xs font-semibold text-gray-500">3. CONFIRM YOUR SUBJECTS</label>
                        <div className="flex gap-2">
                            <button onClick={selectAllSubjects} className="text-[10px] text-indigo-600 font-semibold hover:underline">Select All</button>
                            <span className="text-gray-300">|</span>
                            <button onClick={deselectAllSubjects} className="text-[10px] text-gray-500 hover:text-red-500">Clear</button>
                        </div>
                    </div>
                    
                    <div className="text-xs text-gray-400 mb-2 italic">Uncheck any optional subjects you are <strong>not</strong> taking. Core subjects are already selected.</div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100 max-h-40 overflow-y-auto custom-scrollbar">
                        {availableSubjects.map(sub => {
                            const isSelected = selectedSubjects.includes(sub);
                            return (
                                <div 
                                    key={sub} 
                                    onClick={() => toggleSubject(sub)}
                                    className={`cursor-pointer flex items-center gap-2 p-1.5 rounded border text-xs select-none transition-all ${isSelected ? 'bg-white border-indigo-200 text-indigo-800 shadow-sm' : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-100'}`}
                                >
                                    {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-indigo-600"/> : <Square className="w-3.5 h-3.5 text-gray-300"/>}
                                    <span className="truncate font-medium">{sub}</span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
            
            <div className="mt-4 flex justify-end">
                <button onClick={() => setIsConfigOpen(false)} className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 shadow-sm">
                    <Save className="w-3 h-3"/> Save & View Timetable
                </button>
            </div>
         </div>
      </div>

      {/* HEADER BAR (Clean, Non-Sticky) */}
      <div className="bg-white p-4 shadow-sm border-b flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
            {onBack && <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5" /></button>}
            <div>
                <h1 className="text-xl font-bold text-gray-800">My Timetable</h1>
                <div className="text-xs text-gray-500 flex items-center gap-2">
                    {selectedSemester ? `Sem ${selectedSemester}` : ''}
                    {selectedGroup ? ` • Sec ${selectedGroup}` : ' • No Selection'} 
                </div>
            </div>
        </div>
        <div className="flex items-center gap-2">
            {!isConfigOpen && (
                <button onClick={() => setIsConfigOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded hover:bg-gray-200 border border-gray-200">
                    <Filter className="w-3.5 h-3.5"/> Edit
                </button>
            )}
            <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded hover:bg-black">
               <Download className="w-3.5 h-3.5" /> PDF
            </button>
        </div>
      </div>

      {/* TIMETABLE GRID */}
      <div className="overflow-x-auto bg-white p-2">
        <div ref={pdfRef} className="min-w-max">
            {(!selectedGroup || !selectedSemester) ? (
                <div className="h-64 flex flex-col items-center justify-center text-gray-400">
                    <Filter className="w-10 h-10 mb-2 opacity-20"/>
                    <p className="text-sm">Please select your Semester & Section above.</p>
                </div>
            ) : (
                <table className="w-full border-collapse border border-black text-center text-xs">
                <thead>
                    <tr className="bg-[#fff2cc] h-10 shadow-sm">
                    <th className="border border-black w-14 bg-[#fff2cc]">Day</th>
                    {dynamicTimeColumns.map((col, idx) => (
                        <th key={idx} className={`border border-black p-1 ${col.isLunch ? 'w-8 bg-gray-200' : 'bg-[#fff2cc] min-w-[100px]'}`}>
                        {col.isLunch ? <span className="writing-mode-vertical text-[9px] tracking-widest text-gray-600">{col.label}</span> : col.label}
                        </th>
                    ))}
                    </tr>
                </thead>
                <tbody>
                    {DAYS.map((day, dayIndex) => (
                    <tr key={day} className="border-b border-black bg-white h-40">
                        <td className="border border-black bg-[#fff2cc] font-bold text-sm writing-mode-vertical md:writing-mode-horizontal">
                            {day}
                        </td>
                        {dynamicTimeColumns.map((col, cIdx) => {
                            if (col.isLunch) return <td key={cIdx} className="border border-black bg-gray-100 font-bold writing-mode-vertical text-[10px] tracking-widest text-gray-500 select-none">{col.label}</td>;
                            return (
                            <td key={cIdx} className="border border-black p-0 hover:bg-indigo-50/20 transition-colors align-top h-40">
                                {renderCellContent(dayIndex, col)}
                            </td>
                            );
                        })}
                    </tr>
                    ))}
                </tbody>
                </table>
            )}
        </div>
      </div>

      <style>{`
        .writing-mode-vertical { writing-mode: vertical-rl; transform: rotate(180deg); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
      `}</style>
    </div>
  );
}