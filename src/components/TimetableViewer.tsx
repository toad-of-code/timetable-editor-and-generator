import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, Download, Filter } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';

// --- Interfaces ---

interface ViewerProps {
  timetableId?: string;
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
  group_name: string;
  room_name: string;
  professor_name: string;
  isConflict?: boolean;
}

interface TimeColumn {
  label: string;
  start: string;
  end: string;
  isLunch?: boolean;
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

export const TimetableViewer: React.FC<ViewerProps> = ({ timetableId, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [timetableName, setTimetableName] = useState('');
  const [allSlots, setAllSlots] = useState<FetchedSlot[]>([]);
  const [selectedTimetableId, setSelectedTimetableId] = useState<string>(timetableId || '');
  const [timetables, setTimetables] = useState<any[]>([]);
  const pdfRef = useRef<HTMLDivElement>(null);

  // --- View State ---
  const [selectedEntity, setSelectedEntity] = useState<string>('All Sections');

  // --- Helpers ---
  const extractVal = (data: any, key: string) => {
    if (!data) return 'N/A';
    if (Array.isArray(data)) return data.length > 0 ? data[0][key] : 'N/A';
    return data[key] || 'N/A';
  };

  const convertTo12Hour = (time24: string) => {
    if (!time24) return '';
    const [hourStr, minute] = time24.split(':');
    let hour = parseInt(hourStr);
    // const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12; // Convert 0 to 12
    return `${hour}:${minute}`;
  };
  // 1. Fetch Timetables
  useEffect(() => {
    const fetchTTs = async () => {
      const { data } = await supabase.from('timetables').select('id, name, semester').order('created_at', { ascending: false });
      if (data) {
        setTimetables(data);
        if (!selectedTimetableId && data.length > 0) setSelectedTimetableId(data[0].id);
      }
    };
    fetchTTs();
  }, [selectedTimetableId]);

  // 2. Fetch Slots
  useEffect(() => {
    if (!selectedTimetableId) return;
    setLoading(true);

    const fetchData = async () => {
      const { data: tt } = await supabase.from('timetables').select('name').eq('id', selectedTimetableId).single();
      if (tt) setTimetableName(tt.name);

      const { data, error } = await supabase
        .from('timetable_slots')
        .select(`
          id, day_of_week, start_time, end_time, slot_type,
          subjects (code, name), professors (name), rooms (name), student_groups (name)
        `)
        .eq('timetable_id', selectedTimetableId);

      if (error) { setLoading(false); return; }

      const rawData = data as any[];
      const cleanSlots: FetchedSlot[] = rawData.map(s => ({
        id: s.id,
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
        slot_type: s.slot_type,
        subject_code: extractVal(s.subjects, 'code'),
        subject_name: extractVal(s.subjects, 'name'),
        professor_name: extractVal(s.professors, 'name'),
        room_name: extractVal(s.rooms, 'name'),
        group_name: extractVal(s.student_groups, 'name').replace('Sec', '').trim()
      }));

      setAllSlots(cleanSlots);
      setLoading(false);
    };
    fetchData();
  }, [selectedTimetableId]);

  // 3. Derived Lists
  const allSections = useMemo(() => Array.from(new Set(allSlots.map(s => s.group_name))).sort(), [allSlots]);

  const dropdownOptions = useMemo(() => {
    const unique = new Set(['All Sections', ...allSections]);
    return Array.from(unique);
  }, [allSections]);

  useEffect(() => {
    if (dropdownOptions.length > 0 && !dropdownOptions.includes(selectedEntity)) {
      setSelectedEntity(dropdownOptions[0]);
    }
  }, [dropdownOptions]);

  // --- 4. DYNAMIC COLUMNS ---
  const dynamicTimeColumns = useMemo(() => {
    if (allSlots.length === 0) return [
      { label: '09:00-10:00', start: '09:00', end: '10:00' },
      { label: 'LUNCH', start: '13:00', end: '14:30', isLunch: true }
    ];

    const boundaries = new Set<string>();
    allSlots.forEach(s => {
      boundaries.add(s.start_time.slice(0, 5));
      boundaries.add(s.end_time.slice(0, 5));
    });

    boundaries.add('10:50');
    boundaries.add('11:00');
    boundaries.add('13:00');
    boundaries.add('14:30');

    const sortedTimes = Array.from(boundaries).sort();

    const filteredTimes = sortedTimes.filter(t => {
      if (t > '13:00' && t < '14:30') return false;
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

      const hasClass = allSlots.some(s => {
        const sStart = parseInt(s.start_time.slice(0, 5).replace(':', ''));
        const sEnd = parseInt(s.end_time.slice(0, 5).replace(':', ''));
        return (sStart < cEnd && sEnd > cStart);
      });

      if (isLunch || isBreak || hasClass) {
            cols.push({
                // 3. SET LABEL
                label: isLunch ? 'LUNCH' : isBreak ? 'BREAK' : `${convertTo12Hour(start)} - ${convertTo12Hour(end)}`,
                start: start,
                end: end,
                // Reuse isLunch flag for styling (gray background) OR add a new one
                isLunch: isLunch || isBreak 
            });
        }
    }

    return cols;
  }, [allSlots]);

  // 5. Smart Processing
  const processedSlots = useMemo(() => {
    const uniqueSlots: FetchedSlot[] = [];
    const seenMap = new Map<string, boolean>();

    allSlots.forEach(slot => {
      const dedupKey = `${slot.day_of_week}-${slot.start_time}-${slot.group_name}-${slot.subject_code}`;
      if (!seenMap.has(dedupKey)) {
        seenMap.set(dedupKey, true);
        uniqueSlots.push(slot);
      }
    });

    return uniqueSlots;
  }, [allSlots]);

  // --- Render Slot (NO TOOLTIP, ALL INFO ON CARD) ---
  // --- Render Slot (With Initials) ---
  // --- Render Slot (Full Names on Separate Lines) ---
  const renderSlotItem = (slot: FetchedSlot) => {
      const isLab = slot.slot_type === 'Practical';
      const isTutorial = slot.slot_type === 'Tutorial';
      
      const textColor = isLab ? 'text-orange-600' : isTutorial ? 'text-green-800' : 'text-black';
      const borderColor = 'border-gray-100'; 
      
      // 1. Split names by '&' to create an array
      const profNames = slot.professor_name !== 'Unknown' 
        ? slot.professor_name.split('&').map(n => n.trim()) 
        : [];

      return (
        <div key={slot.id} className={`w-full flex flex-col justify-center items-center text-[9px] leading-tight border-b ${borderColor} last:border-0 p-1 ${textColor} bg-transparent`}>
              {/* Line 1: Code & Type */}
              <div className="font-bold whitespace-nowrap">
                {slot.subject_code} ({slot.slot_type.charAt(0)})
              </div>

              {/* Line 2: Professor Names (Stacked) */}
              {profNames.length > 0 && (
                  <div className="flex flex-col items-center gap-0 my-0.5">
                      {profNames.map((name, idx) => (
                          <div key={idx} className="text-[8px] font-bold text-indigo-600 tracking-wide whitespace-nowrap">
                              {name}
                          </div>
                      ))}
                  </div>
              )}

              {/* Line 3: Room, Group, and Semester */}
              <div className="scale-90 opacity-90 whitespace-nowrap flex flex-wrap justify-center gap-1 items-center text-black">
                <span className="text-gray-600">{slot.room_name}</span>
                <span className="text-gray-300">•</span>
                <span className="font-semibold text-cyan-800">{slot.group_name}</span>
                {/* <span className="text-gray-300">•</span>
                <span className="text-gray-500 font-medium">Sem {slot.semester}</span> */}
              </div>
        </div>
      );
  };

  // --- Render Cell ---
  const renderCellContent = (dayIndex: number, column: TimeColumn) => {
    const colStart = parseInt(column.start.replace(':', ''));
    const colEnd = parseInt(column.end.replace(':', ''));

    let cellSlots = processedSlots.filter(s => {
      if (s.day_of_week !== dayIndex + 1) return false;
      const slotStart = parseInt(s.start_time.slice(0, 5).replace(':', ''));
      const slotEnd = parseInt(s.end_time.slice(0, 5).replace(':', ''));
      return (slotStart <= colStart && slotEnd >= colEnd);
    });

    if (selectedEntity !== 'All Sections') {
      cellSlots = cellSlots.filter(s =>
        s.group_name === selectedEntity ||
        s.group_name === 'All' ||
        s.group_name === 'all'
      );
    }

    if (cellSlots.length === 0) return null;
    // 2. CHECK IF CROWDED (More than 1 slot?)
    // If we have multiple slots (like electives), use a 2-column grid.
    // If it's just 1 slot, keep it simple.
    const isCrowded = cellSlots.length > 4;

    return (
      <div className="h-full flex flex-col justify-start overflow-y-auto custom-scrollbar">
        <div className={isCrowded ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1"}>
            {cellSlots.map(slot => renderSlotItem(slot))}
        </div>
      </div>
    );
  };

  // --- PDF Download (Fixed) ---
  const handleDownloadPDF = async () => {
    if (!pdfRef.current) return;

    try {
      const element = pdfRef.current;
      const width = element.scrollWidth;
      const height = element.scrollHeight;

      // 1. Generate Image (Capturing hidden overflow)
      const imgData = await toPng(element, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        width: width,
        height: height,
        style: {
          overflow: 'visible',
          maxHeight: 'none',
          maxWidth: 'none',
        }
      });

      // 2. Create Dynamic PDF
      const pxToMm = 0.264583;
      const pdfWidth = width * pxToMm;
      const pdfHeight = height * pxToMm;

      const pdf = new jsPDF({
        orientation: pdfWidth > pdfHeight ? 'l' : 'p',
        unit: 'mm',
        format: [pdfWidth + 10, pdfHeight + 10]
      });

      pdf.addImage(imgData, 'PNG', 5, 5, pdfWidth, pdfHeight);
      pdf.save(`timetable-${selectedEntity}.pdf`);

    } catch (err) {
      console.error('PDF Export failed:', err);
      alert('Could not generate PDF. Please check the console.');
    }
  };


  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-indigo-600" /></div>;

  return (
    <div className="p-4 bg-gray-50 min-h-screen font-sans">
      <div className="mb-6 bg-white p-4 rounded-lg shadow-sm border flex flex-col md:flex-row justify-between items-center gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          {onBack && <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5" /></button>}
          <div>
            <h1 className="text-xl font-bold text-gray-800">{timetableName}</h1>
            <div className="text-xs text-gray-500">
              Sem {timetables.find(t => t.id === selectedTimetableId)?.semester} • {allSections.length} Sections
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={selectedTimetableId} onChange={(e) => setSelectedTimetableId(e.target.value)} className="border p-2 rounded text-sm bg-gray-50 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500">
            {timetables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex items-center gap-1 border p-1 rounded bg-indigo-50 border-indigo-200">
            <Filter className="w-3 h-3 text-indigo-500 ml-1" />
            <select value={selectedEntity} onChange={(e) => setSelectedEntity(e.target.value)} className="bg-transparent text-sm font-semibold text-indigo-900 outline-none min-w-[120px]">
              {dropdownOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm rounded hover:bg-black transition shadow-sm">
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-white p-1 shadow-lg border border-gray-300 rounded-sm">
        <div ref={pdfRef} className="min-w-max">
          <table className="w-full border-collapse border border-black text-center text-xs">
            <thead>
              <tr className="bg-[#e6b8af] h-10">
                <th className="border border-black w-14 shadow-sm">Day</th>
                {dynamicTimeColumns.map((col, idx) => (
                  <th key={idx} className={`border border-black p-1 ${col.isLunch ? 'w-8 bg-gray-200' : ''}`}>
                    {col.isLunch ? <span className="writing-mode-vertical text-[9px] tracking-widest text-gray-600">{col.label}</span> : col.label}
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
                    if (col.isLunch) return <td key={cIdx} className="border border-black bg-gray-100 font-bold writing-mode-vertical text-[10px] tracking-widest text-gray-500 select-none">{col.label}</td>;
                    return (
                      <td key={cIdx} className="border border-black p-0 hover:bg-blue-50/10 transition-colors align-top h-65">
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

      <style>{`
        .writing-mode-vertical { writing-mode: vertical-rl; transform: rotate(180deg); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #999; }
      `}</style>
    </div>
  );
};

export default TimetableViewer;