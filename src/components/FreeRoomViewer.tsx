import  { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Download, ArrowLeft, Loader2, Building2, FileSpreadsheet } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import { useGoogleSheets } from '../hooks/useGoogleSheets'; // 👈 Import the hook

// ... (Keep Interfaces: FreeRoomViewerProps, FetchedSlot, TimeColumn, DAYS) ...
// ... (Keep Helper: getBuildingName) ...

interface FreeRoomViewerProps {
  onBack?: () => void;
}

interface FetchedSlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_name: string;
}

interface TimeColumn {
  label: string;
  start: string;
  end: string;
  isLunch?: boolean;
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

export function FreeRoomViewer({ onBack }: FreeRoomViewerProps) {
  // --- State ---
  const [loading, setLoading] = useState(true);
  const [busySlots, setBusySlots] = useState<FetchedSlot[]>([]);
  const [allRooms, setAllRooms] = useState<string[]>([]);
  const [availableBuildings, setAvailableBuildings] = useState<string[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<string>('All');
  
  const pdfRef = useRef<HTMLDivElement>(null);

  // 👇 Initialize the Hook
  const { exportToWorkbook: exportToSheets, isExporting } = useGoogleSheets();

  // --- Helper: Extract Building Name ---
  const getBuildingName = (roomName: string) => {
    if (!roomName) return 'Other';
    const parts = roomName.split('-');
    if (parts[0] === 'CC' && parts.length >= 2) return `${parts[0]}-${parts[1]}`;
    return parts[0]; 
  };

  // --- 1. Load Data ---
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: published } = await supabase.from('timetables').select('id').eq('status', 'published');
      if (!published || published.length === 0) { setLoading(false); return; }
      const pubIds = published.map(p => p.id);

      const { data: slotData } = await supabase
        .from('timetable_slots')
        .select(`day_of_week, start_time, end_time, rooms (name)`)
        .in('timetable_id', pubIds);

      const cleanBusy = (slotData || []).filter((s:any) => s.rooms?.name).map((s:any) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time.slice(0, 5),
          end_time: s.end_time.slice(0, 5),
          room_name: s.rooms.name
      }));
      setBusySlots(cleanBusy);

      const distinctRooms = Array.from(new Set(cleanBusy.map((s:any) => s.room_name))).sort();
      setAllRooms(distinctRooms as string[]);
      const buildings = Array.from(new Set((distinctRooms as string[]).map(r => getBuildingName(r)))).sort();
      setAvailableBuildings(buildings);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // --- 2. Columns ---
  const timeColumns: TimeColumn[] = [
    { label: '08:50 - 09:50', start: '08:50', end: '09:50' },
    { label: '09:50 - 10:50', start: '09:50', end: '10:50' },
    { label: 'BREAK', start: '10:50', end: '11:00', isLunch: true },
    { label: '11:00 - 12:00', start: '11:00', end: '12:00' },
    { label: '12:00 - 01:00', start: '12:00', end: '13:00' },
    { label: 'LUNCH', start: '13:00', end: '14:30', isLunch: true },
    { label: '02:30 - 03:30', start: '14:30', end: '15:30' },
    { label: '03:30 - 04:30', start: '15:30', end: '16:30' },
    { label: '04:30 - 05:30', start: '16:30', end: '17:30' },
    { label: '05:30 - 06:30', start: '17:30', end: '18:30' },
  ];

  // --- 3. Filter Logic ---
  const getFreeRoomsForCell = (dayIndex: number, column: TimeColumn) => {
    const colStart = parseInt(column.start.replace(':', ''));
    const colEnd = parseInt(column.end.replace(':', ''));

    const busyRooms = new Set(
      busySlots.filter(s => {
          if (s.day_of_week !== dayIndex + 1) return false;
          const sStart = parseInt(s.start_time.replace(':', ''));
          const sEnd = parseInt(s.end_time.replace(':', ''));
          return (sStart < colEnd && sEnd > colStart);
      }).map(s => s.room_name)
    );

    return allRooms.filter(room => {
        if (busyRooms.has(room)) return false;
        if (selectedBuilding !== 'All' && getBuildingName(room) !== selectedBuilding) return false;
        return true;
    });
  };

  // --- 4. Render Cell ---
  const renderCellContent = (dayIndex: number, column: TimeColumn) => {
    const freeRooms = getFreeRoomsForCell(dayIndex, column);
    if (freeRooms.length === 0) return <div className="text-gray-300 text-[10px] italic p-2">None</div>;
    return (
      <div className="h-full flex flex-col justify-start overflow-y-auto custom-scrollbar p-1">
        <div className="flex flex-wrap gap-1 justify-center">
          {freeRooms.map(room => (
            <span key={room} className="px-1.5 py-0.5 bg-green-100 text-green-800 border border-green-200 rounded text-[9px] font-bold shadow-sm whitespace-nowrap">
              {room}
            </span>
          ))}
        </div>
      </div>
    );
  };

  // --- 5. Export Handlers ---
  const handleGoogleSheetExport = () => {
    const headerRow = ['Day', ...timeColumns.map(c => c.label)];
    const bodyRows = DAYS.map((day, dayIndex) => {
        const row = [day];
        timeColumns.forEach(col => {
            if (col.isLunch) {
                row.push(col.label);
            } else {
                const rooms = getFreeRoomsForCell(dayIndex, col);
                row.push(rooms.join(', '));
            }
        });
        return row;
    });
    const allData = [headerRow, ...bodyRows];
    exportToSheets(`Free Rooms - ${selectedBuilding}`, [
  { 
    title: selectedBuilding || "Free Rooms", 
    rows: allData 
  }
]);
  };

  const handleDownloadPDF = async () => {
    if (!pdfRef.current) return;
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';
    try {
      const element = pdfRef.current;
      const imgData = await toPng(element, { cacheBust: true, backgroundColor: '#ffffff', width: element.scrollWidth, height: element.scrollHeight, style: { overflow: 'visible', height: 'auto', position: 'static' } });
      const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: [element.scrollWidth * 0.264583 + 10, element.scrollHeight * 0.264583 + 10] });
      pdf.addImage(imgData, 'PNG', 5, 5, element.scrollWidth * 0.264583, element.scrollHeight * 0.264583);
      pdf.save(`Free-Rooms-${selectedBuilding}.pdf`);
    } catch (err) { alert('PDF Error'); } finally { document.body.style.cursor = originalCursor; }
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-green-600"/></div>;

  return (
    <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">
      <div className="mb-6 bg-white p-4 rounded-lg shadow-sm border flex flex-col md:flex-row justify-between items-center gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
            {onBack && <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5"/></button>}
            <div>
                <h1 className="text-xl font-bold text-gray-800">Free Room Finder</h1>
                <div className="text-xs text-gray-500">
                    Showing available rooms for {selectedBuilding === 'All' ? 'Entire Campus' : selectedBuilding}
                </div>
            </div>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded hover:border-indigo-400 transition-colors">
                <Building2 className="w-3.5 h-3.5 text-gray-500"/>
                <select value={selectedBuilding} onChange={(e) => setSelectedBuilding(e.target.value)} className="text-xs font-semibold text-gray-700 bg-transparent outline-none cursor-pointer">
                    <option value="All">All Buildings</option>
                    {availableBuildings.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
            </div>
            
            {/* 👇 GOOGLE SHEETS BUTTON */}
            <button 
                onClick={handleGoogleSheetExport} 
                disabled={isExporting}
                className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition shadow-sm disabled:opacity-50"
            >
               {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <FileSpreadsheet className="w-3.5 h-3.5" />}
               {isExporting ? 'Creating...' : 'Sheets'}
            </button>

            <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm rounded hover:bg-black transition shadow-sm">
               <Download className="w-3.5 h-3.5" /> PDF
            </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-white p-1 shadow-lg border border-gray-300 rounded-sm">
        <div ref={pdfRef}>
            <table className="w-full border-collapse border border-black text-center text-xs table-fixed">
            <thead>
                <tr className="bg-[#d9ead3] h-10">
                <th className="border border-black w-14 shadow-sm">Day</th>
                {timeColumns.map((col, idx) => (
                    <th key={idx} className={`border border-black p-1 ${col.isLunch ? 'w-8 bg-gray-100' : ''}`}>
                    {col.isLunch ? <span className="writing-mode-vertical text-[9px] tracking-widest text-gray-600">{col.label}</span> : col.label}
                    </th>
                ))}
                </tr>
            </thead>
            <tbody>
                {DAYS.map((day, dayIndex) => (
                <tr key={day} className="border-b border-black bg-white h-64">
                    <td className="border border-black bg-[#d9ead3] font-bold text-sm writing-mode-vertical md:writing-mode-horizontal">{day}</td>
                    {timeColumns.map((col, cIdx) => {
                        if (col.isLunch) return <td key={cIdx} className="border border-black bg-gray-50 font-bold writing-mode-vertical text-[10px] tracking-widest text-gray-400 select-none">{col.label}</td>;
                        return <td key={cIdx} className="border border-black p-0 hover:bg-green-50/20 transition-colors align-top h-64">{renderCellContent(dayIndex, col)}</td>;
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
      `}</style>
    </div>
  );
}