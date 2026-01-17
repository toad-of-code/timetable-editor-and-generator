import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, Download, Filter, FileSpreadsheet, Check, CheckSquare, Square } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import { useGoogleSheets } from '../hooks/useGoogleSheets';

// --- Interfaces ---

interface RoomTimetableViewerProps {
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
  semester: number;
}

interface TimeColumn {
  label: string;
  start: string;
  end: string;
  isLunch?: boolean;
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

export function RoomTimetableViewer({ onBack }: RoomTimetableViewerProps) {
  const [loading, setLoading] = useState(true);
  const [allSlots, setAllSlots] = useState<FetchedSlot[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);
  
  // 👇 Multi-Select State
  const [isMultiMode, setIsMultiMode] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());

  const pdfRef = useRef<HTMLDivElement>(null);

  // 👇 Initialize Hook (Using the new Workbook function)
  const { exportToWorkbook, isExporting } = useGoogleSheets();

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
    hour = hour % 12 || 12; 
    return `${hour}:${minute}`;
  };

  // --- 1. Load Data ---
  useEffect(() => {
    const loadAllData = async () => {
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

        const rooms = Array.from(new Set(cleanSlots.map(s => s.room_name))).sort();
        setAvailableRooms(rooms);
        if (rooms.length > 0 && !selectedRoom) setSelectedRoom(rooms[0]);

      } catch (err) {
        console.error('Error loading room data:', err);
      } finally {
        setLoading(false);
      }
    };
    loadAllData();
  }, []);

  // --- 2. Filter Logic (Single Mode) ---
  const roomSlots = useMemo(() => {
    return allSlots.filter(s => s.room_name === selectedRoom);
  }, [allSlots, selectedRoom]);

  // --- 3. Dynamic Columns ---
  // Calculates columns. In Multi-mode, it considers ALL slots to ensure the grid handles any room.
  const dynamicTimeColumns = useMemo(() => {
    const targetSlots = isMultiMode ? allSlots : roomSlots; 
    
    if (targetSlots.length === 0) return [
      { label: '09:00-10:00', start: '09:00', end: '10:00' },
      { label: 'LUNCH', start: '13:00', end: '14:30', isLunch: true }
    ];

    const boundaries = new Set<string>();
    targetSlots.forEach(s => {
      boundaries.add(s.start_time);
      boundaries.add(s.end_time);
    });

    boundaries.add('10:50');
    boundaries.add('11:00');
    boundaries.add('13:00');
    boundaries.add('14:30');

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
      const hasClass = targetSlots.some(s => {
         const sStart = parseInt(s.start_time.replace(':', ''));
         const sEnd = parseInt(s.end_time.replace(':', ''));
         return (sStart < cEnd && sEnd > cStart);
      });

      if (isLunch || isBreak || hasClass) {
        cols.push({
          label: isLunch ? 'LUNCH' : isBreak ? 'BREAK' : `${convertTo12Hour(start)} - ${convertTo12Hour(end)}`,
          start: start, end: end, isLunch: isLunch || isBreak
        });
      }
    }
    return cols;
  }, [roomSlots, isMultiMode, allSlots]);

  // --- 4. Processing (Deduplication) ---
  const processedSlots = useMemo(() => {
    const uniqueSlots: FetchedSlot[] = [];
    const seenMap = new Map<string, boolean>();
    roomSlots.forEach(slot => {
      const dedupKey = `${slot.day_of_week}-${slot.start_time}-${slot.group_name}-${slot.subject_code}`;
      if (!seenMap.has(dedupKey)) {
        seenMap.set(dedupKey, true);
        uniqueSlots.push(slot);
      }
    });
    return uniqueSlots;
  }, [roomSlots]);

  // --- Multi-Select Toggle Logic ---
  const toggleRoomSelection = (room: string) => {
    const newSet = new Set(selectedRooms);
    if (newSet.has(room)) newSet.delete(room);
    else newSet.add(room);
    setSelectedRooms(newSet);
  };

  // --- Export Workbook Handler ---
  const handleWorkbookExport = () => {
    // 1. Determine which rooms to export (List or Single)
    const roomsToExport = isMultiMode ? Array.from(selectedRooms) : [selectedRoom];
    
    if (roomsToExport.length === 0) {
        alert("Please select at least one room.");
        return;
    }

    // 2. Prepare Data for EACH room (creates a Sheet object for each)
    const sheetsData = roomsToExport.map(roomName => {
        // Filter slots specifically for THIS room in the loop
        const thisRoomSlots = allSlots.filter(s => s.room_name === roomName);
        
        // Process Logic (deduplication specific to this room)
        const processed: FetchedSlot[] = []; 
        const seen = new Set();
        thisRoomSlots.forEach(slot => {
             const key = `${slot.day_of_week}-${slot.start_time}-${slot.group_name}-${slot.subject_code}`;
             if(!seen.has(key)) { seen.add(key); processed.push(slot); }
        });

        // Build Rows
        const headerRow = ['Day', ...dynamicTimeColumns.map(c => c.label)];
        const bodyRows = DAYS.map((day, dayIndex) => {
            const row = [day];
            dynamicTimeColumns.forEach(col => {
                if(col.isLunch) {
                    row.push(col.label);
                } else {
                    const cS = parseInt(col.start.replace(':',''));
                    const cE = parseInt(col.end.replace(':',''));
                    
                    const cellSlots = processed.filter(s => {
                        if(s.day_of_week !== dayIndex + 1) return false;
                        const sS = parseInt(s.start_time.replace(':',''));
                        const sE = parseInt(s.end_time.replace(':',''));
                        return (sS <= cS && sE >= cE);
                    });

                    if(cellSlots.length === 0) row.push('');
                    else {
                        const txt = cellSlots.map(s => 
                            `${s.subject_code} (${s.slot_type.charAt(0)}) - ${s.group_name} - ${s.professor_name} - Sem ${s.semester}`
                        ).join('\n');
                        row.push(txt);
                    }
                }
            });
            return row;
        });

        return {
            title: roomName,
            rows: [headerRow, ...bodyRows]
        };
    });

    // 3. Launch Export
    const filename = isMultiMode ? `Campus Timetable (${roomsToExport.length} Rooms)` : `Room Schedule - ${selectedRoom}`;
    exportToWorkbook(filename, sheetsData);
  };

  // --- Render Functions (Table) ---
  const renderSlotItem = (slot: FetchedSlot) => {
    const isLab = slot.slot_type === 'Practical';
    const textColor = isLab ? 'text-orange-600' : 'text-black';
    const profNames = slot.professor_name !== 'Unknown' ? slot.professor_name.split('&').map(n => n.trim()) : [];

    return (
      <div key={slot.id} className={`w-full flex flex-col justify-center items-center text-[9px] leading-tight ${textColor} bg-transparent p-1 border-b border-gray-100 last:border-0`}>
        <div className="font-bold whitespace-nowrap">{slot.subject_code} ({slot.slot_type.charAt(0)})</div>
        {profNames.length > 0 && (
          <div className="flex flex-col items-center gap-0 my-0.5">
            {profNames.map((name, idx) => (
              <div key={idx} className="text-[8px] font-bold text-indigo-600 tracking-wide whitespace-nowrap">{name}</div>
            ))}
          </div>
        )}
        <div className="scale-90 opacity-90 whitespace-nowrap flex gap-1 items-center font-semibold text-indigo-800">
          <span>{slot.group_name}</span><span className="text-gray-400">•</span><span>Sem {slot.semester}</span>
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
    return <div className="h-full flex flex-col justify-start overflow-y-auto custom-scrollbar">{cellSlots.map(slot => renderSlotItem(slot))}</div>;
  };

  // --- PDF Export ---
  const handleDownloadPDF = async () => {
    if (!pdfRef.current) return;
    try {
      const element = pdfRef.current;
      const imgData = await toPng(element, { cacheBust: true, backgroundColor: '#ffffff', width: element.scrollWidth, height: element.scrollHeight, style: { overflow: 'visible', maxHeight: 'none', maxWidth: 'none', position: 'static' } });
      const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: [element.scrollWidth * 0.264583 + 10, element.scrollHeight * 0.264583 + 10] });
      pdf.addImage(imgData, 'PNG', 5, 5, element.scrollWidth * 0.264583, element.scrollHeight * 0.264583);
      pdf.save(`Room-${selectedRoom}.pdf`);
    } catch (err) { alert('PDF Error'); }
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-indigo-600" /></div>;

  return (
    <div className="min-h-screen w-full flex flex-col bg-gray-50 font-sans">

      {/* Controls Header */}
      <div className="bg-white p-4 shadow-sm border-b flex-shrink-0 flex flex-col md:flex-row justify-between items-center gap-4 z-20">
        <div className="flex items-center gap-3">
          {onBack && <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5" /></button>}
          <div>
            <h1 className="text-xl font-bold text-gray-800">Room Schedule</h1>
            <div className="text-xs text-gray-500">
              Consolidated View • {availableRooms.length} Rooms
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          
          {/* Toggle Multi-Select Mode */}
          <button 
            onClick={() => setIsMultiMode(!isMultiMode)}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded border transition ${isMultiMode ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}
          >
            {isMultiMode ? <CheckSquare className="w-4 h-4"/> : <Square className="w-4 h-4"/>}
            {isMultiMode ? 'Select Rooms' : 'Multi View'}
          </button>

          {!isMultiMode && (
            <div className="flex items-center gap-1 border p-1 rounded bg-indigo-50 border-indigo-200">
              <Filter className="w-3 h-3 text-indigo-500 ml-1" />
              <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)} className="bg-transparent text-sm font-semibold text-indigo-900 outline-none min-w-[120px]">
                {availableRooms.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
          
          <button onClick={handleWorkbookExport} disabled={isExporting} className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition shadow-sm disabled:opacity-50">
             {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <FileSpreadsheet className="w-3.5 h-3.5" />}
             {isExporting ? 'Exporting...' : (isMultiMode ? `Export ${selectedRooms.size} Sheets` : 'Export Sheet')}
          </button>

          {!isMultiMode && (
            <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm rounded hover:bg-black transition shadow-sm">
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-white p-2">
        
        {isMultiMode ? (
            /* MULTI-SELECT GRID UI */
            <div className="p-4">
                <h2 className="text-lg font-bold mb-4 text-gray-800">Select Rooms to Export</h2>
                <div className="text-xs text-gray-500 mb-4">Selected rooms will be created as separate tabs in one Google Sheet workbook.</div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {availableRooms.map(room => {
                        const isSelected = selectedRooms.has(room);
                        return (
                            <button 
                                key={room}
                                onClick={() => toggleRoomSelection(room)}
                                className={`p-3 rounded border text-sm font-semibold flex items-center justify-between transition-all ${
                                    isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-indigo-300'
                                }`}
                            >
                                {room}
                                {isSelected && <Check className="w-4 h-4 text-white"/>}
                            </button>
                        );
                    })}
                </div>
            </div>
        ) : (
            /* STANDARD TABLE UI */
            <div ref={pdfRef} className="min-w-max">
              <table className="w-full border-collapse border border-black text-center text-xs">
                <thead>
                  <tr className="bg-[#e6b8af] h-10 sticky top-0 z-10 shadow-sm">
                    <th className="border border-black w-14 bg-[#e6b8af]">Day</th>
                    {dynamicTimeColumns.map((col, idx) => (
                      <th key={idx} className={`border border-black p-1 ${col.isLunch ? 'w-8 bg-gray-200' : 'bg-[#e6b8af] min-w-[120px]'}`}>
                        {col.isLunch ? <span className="writing-mode-vertical text-[9px] tracking-widest text-gray-600">{col.label}</span> : col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((day, dayIndex) => (
                    <tr key={day} className="border-b border-black bg-white h-40">
                      <td className="border border-black bg-[#e6b8af] font-bold text-sm writing-mode-vertical md:writing-mode-horizontal">{day}</td>
                      {dynamicTimeColumns.map((col, cIdx) => {
                        if (col.isLunch) return <td key={cIdx} className="border border-black bg-gray-100 font-bold writing-mode-vertical text-[10px] tracking-widest text-gray-500 select-none">{col.label}</td>;
                        return (
                          <td key={cIdx} className="border border-black p-0 hover:bg-blue-50/10 transition-colors align-top h-40">
                            {renderCellContent(dayIndex, col)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}
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