import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Download, ArrowLeft, Loader2, MapPin } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';

// --- Interfaces ---

interface MasterRoomViewerProps {
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
  isLunch?: boolean; // Used for both Lunch and Break styling
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

// --- Helper: Convert 24h to 12h ---
const convertTo12Hour = (time24: string) => {
  if (!time24) return '';
  const [hourStr, minute] = time24.split(':');
  let hour = parseInt(hourStr);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12; 
  return `${hour}:${minute} ${suffix}`;
};

export function MasterRoomViewer({ onBack }: MasterRoomViewerProps) {
  const [loading, setLoading] = useState(true);
  const [allSlots, setAllSlots] = useState<FetchedSlot[]>([]);
  const pdfRef = useRef<HTMLDivElement>(null);

  // --- Helpers ---
  const extractVal = (data: any, key: string) => {
    if (!data) return 'N/A';
    if (Array.isArray(data)) return data.length > 0 ? data[0][key] : 'N/A';
    return data[key] || 'N/A';
  };

  // --- 1. Load ALL Data ---
  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: published } = await supabase.from('timetables').select('id').eq('status', 'published');
      if (!published || published.length === 0) {
        setLoading(false);
        return;
      }
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
      const cleanSlots: FetchedSlot[] = rawData
        .filter(s => s.rooms?.name) 
        .map(s => ({
          id: s.id,
          day_of_week: s.day_of_week,
          start_time: s.start_time.slice(0, 5),
          end_time: s.end_time.slice(0, 5),
          slot_type: s.slot_type,
          subject_code: extractVal(s.subjects, 'code'),
          subject_name: extractVal(s.subjects, 'name'),
          professor_name: extractVal(s.professors, 'name'),
          room_name: extractVal(s.rooms, 'name'),
          group_name: extractVal(s.student_groups, 'name').replace('Sec', '').trim(),
          semester: s.student_groups?.semester || 0
        }));

      setAllSlots(cleanSlots);

    } catch (err) {
      console.error('Error loading room data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // --- 2. Dynamic Columns (With Break & Lunch) ---
  const dynamicTimeColumns = useMemo(() => {
    if (allSlots.length === 0) return [
        { label: '09:00 AM - 10:00 AM', start: '09:00', end: '10:00' }, 
        { label: 'LUNCH', start: '13:00', end: '14:30', isLunch: true }
    ];

    const boundaries = new Set<string>();
    allSlots.forEach(s => {
        boundaries.add(s.start_time);
        boundaries.add(s.end_time);
    });
    
    // Hardcoded Boundaries for Lunch and Break
    boundaries.add('10:50');
    boundaries.add('11:00');
    boundaries.add('13:00');
    boundaries.add('14:30');

    const sortedTimes = Array.from(boundaries).sort();
    const filteredTimes = sortedTimes.filter(t => {
        // Prevent creating small slots inside lunch or break if data is messy
        if (t > '13:00' && t < '14:30') return false; 
        if (t > '10:50' && t < '11:00') return false;
        return true;
    });

    let cols: TimeColumn[] = [];
    for (let i = 0; i < filteredTimes.length - 1; i++) {
        const start = filteredTimes[i];
        const end = filteredTimes[i+1];
        
        // Identify Special Slots
        const isLunch = (start === '13:00' && end === '14:30');
        const isBreak = (start === '10:50' && end === '11:00');

        const cStart = parseInt(start.replace(':', ''));
        const cEnd = parseInt(end.replace(':', ''));

        const hasClass = allSlots.some(s => {
            const sStart = parseInt(s.start_time.replace(':', ''));
            const sEnd = parseInt(s.end_time.replace(':', ''));
            return (sStart < cEnd && sEnd > cStart);
        });

        if (isLunch || isBreak || hasClass) {
            cols.push({
                label: isLunch ? 'LUNCH' : isBreak ? 'BREAK' : `${convertTo12Hour(start)} - ${convertTo12Hour(end)}`,
                start: start,
                end: end,
                // Reuse isLunch flag for gray/vertical styling
                isLunch: isLunch || isBreak 
            });
        }
    }
    return cols;
  }, [allSlots]);

  // --- 3. Processing ---
  const processedSlots = useMemo(() => {
    const uniqueSlots: FetchedSlot[] = [];
    const seenMap = new Map<string, boolean>();

    allSlots.forEach(slot => {
        const dedupKey = `${slot.day_of_week}-${slot.start_time}-${slot.room_name}-${slot.subject_code}`;
        if (!seenMap.has(dedupKey)) {
            seenMap.set(dedupKey, true);
            uniqueSlots.push(slot);
        }
    });
    return uniqueSlots;
  }, [allSlots]);

  // --- Render Slot ---
  const renderSlotItem = (slot: FetchedSlot) => {
      const isLab = slot.slot_type === 'Practical';
      const textColor = isLab ? 'text-orange-600' : 'text-black';
      
      return (
        <div key={slot.id} className={`w-full flex flex-col justify-center items-center text-[9px] leading-tight border-b border-gray-100 last:border-0 p-1.5 ${textColor} bg-transparent hover:bg-gray-50`}>
              <div className="font-bold text-[10px] text-indigo-700 whitespace-nowrap mb-0.5">
                {slot.room_name}
              </div>
              <div className="font-semibold text-gray-800 whitespace-nowrap">
                {slot.subject_code} ({slot.slot_type.charAt(0)})
              </div>
              <div className="scale-90 opacity-75 text-gray-500 font-medium whitespace-nowrap">
                {slot.group_name} • Sem {slot.semester}
              </div>
        </div>
      );
  };

  const renderCellContent = (dayIndex: number, column: TimeColumn) => {
    const colStart = parseInt(column.start.replace(':', ''));
    const colEnd = parseInt(column.end.replace(':', ''));

    let cellSlots = processedSlots.filter(s => {
      if (s.day_of_week !== dayIndex + 1) return false;
      const slotStart = parseInt(s.start_time.replace(':', ''));
      const slotEnd = parseInt(s.end_time.replace(':', ''));
      return (slotStart <= colStart && slotEnd >= colEnd);
    });

    if (cellSlots.length === 0) return null;

    cellSlots.sort((a, b) => a.room_name.localeCompare(b.room_name, undefined, { numeric: true }));

    // Rule: If > 5 items, use double columns
    const isCrowded = cellSlots.length > 5;

    return (
      <div className="h-full flex flex-col justify-start overflow-y-auto custom-scrollbar p-1">
        <div className={isCrowded ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1"}>
            {cellSlots.map(slot => renderSlotItem(slot))}
        </div>
      </div>
    );
  };

  // --- PDF Export ---
  const handleDownloadPDF = async () => {
    if (!pdfRef.current) return;
    try {
      const element = pdfRef.current;
      const width = element.scrollWidth;
      const height = element.scrollHeight;

      const imgData = await toPng(element, { 
        cacheBust: true, backgroundColor: '#ffffff', width, height,
        style: { overflow: 'visible', maxHeight: 'none', maxWidth: 'none' }
      });

      const pxToMm = 0.264583;
      const pdfWidth = width * pxToMm;
      const pdfHeight = height * pxToMm;

      const pdf = new jsPDF({
        orientation: pdfWidth > pdfHeight ? 'l' : 'p', 
        unit: 'mm', format: [pdfWidth + 10, pdfHeight + 10]
      });

      pdf.addImage(imgData, 'PNG', 5, 5, pdfWidth, pdfHeight);
      pdf.save(`All-Rooms-Master-View.pdf`);
    } catch (err) {
      console.error('PDF Error:', err);
      alert('PDF generation failed.');
    }
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-indigo-600"/></div>;

  return (
    <div className="p-4 bg-gray-50 min-h-screen font-sans">
      
      {/* Header */}
      <div className="mb-6 bg-white p-4 rounded-lg shadow-sm border flex flex-col md:flex-row justify-between items-center gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
            {onBack && <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5"/></button>}
            <div>
                <h1 className="text-xl font-bold text-gray-800">Campus Occupancy View</h1>
                <div className="text-xs text-gray-500">
                    Master Room Schedule • Showing all active rooms
                </div>
            </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
            <div className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded border border-indigo-100 flex items-center gap-2">
                <MapPin className="w-3 h-3" />
                All Rooms
            </div>
            <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm rounded hover:bg-black transition shadow-sm">
               <Download className="w-3.5 h-3.5" /> PDF
            </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto bg-white p-1 shadow-lg border border-gray-300 rounded-sm">
        <div ref={pdfRef}>
            <table className="w-full border-collapse border border-black text-center text-xs">
            <thead>
                <tr className="bg-[#e6b8af] h-10">
                <th className="border border-black w-24 shadow-sm">Day</th>
                {dynamicTimeColumns.map((col, idx) => (
                    <th key={idx} className={`border border-black p-1 ${col.isLunch ? 'w-8 bg-gray-200' : 'min-w-[140px]'}`}>
                    {/* 👇 Use dynamic label so LUNCH and BREAK display correctly */}
                    {col.isLunch ? <span className="writing-mode-vertical text-[9px] tracking-widest text-gray-600">{col.label}</span> : col.label}
                    </th>
                ))}
                </tr>
            </thead>
            <tbody>
                {DAYS.map((day, dayIndex) => (
                <tr key={day} className="border-b border-black bg-white h-100">
                    <td className="border border-black bg-[#e6b8af] font-bold text-sm writing-mode-vertical md:writing-mode-horizontal">
                        {day}
                    </td>
                    {dynamicTimeColumns.map((col, cIdx) => {
                        // 👇 Display 'LUNCH' or 'BREAK' vertically
                        if (col.isLunch) return <td key={cIdx} className="border border-black bg-gray-100 font-bold writing-mode-vertical text-[10px] tracking-widest text-gray-500 select-none">{col.label}</td>;
                        return (
                        <td key={cIdx} className="border border-black p-0 hover:bg-blue-50/10 transition-colors align-top h-100">
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
}