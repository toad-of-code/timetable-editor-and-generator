import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AuthForm } from './components/AuthForm';
import TimetableImporter from './components/TimetableImporter';
import TimetableViewer from './components/TimetableViewer';
import { ProfessorTimetableViewer } from './components/ProfessorTimetableViewer';
import { RoomTimetableViewer } from './components/RoomTimetableViewer';
import { MasterRoomViewer } from './components/MasterRoomViewer';
import { FreeRoomViewer } from './components/FreeRoomViewer';
import { StudentCustomTimetable } from './components/StudentCustomTimetable';
import { GeneratorView } from './components/GeneratorView';
import { ReportCardView } from './components/ReportCardView';
import { Toaster } from 'react-hot-toast';

import {
  FileSpreadsheet,
  Users,
  User,
  MapPin,
  LayoutGrid,
  Coffee,
  Sparkles,
  Zap,
  LogOut,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from 'lucide-react';
import { supabase } from './lib/supabase';

type ViewType = 'import' | 'student' | 'my-timetable' | 'prof' | 'room' | 'master-room' | 'free-room' | 'generator' | 'report-card';

interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'import', label: 'Import', icon: <FileSpreadsheet size={20} /> },
  { id: 'generator', label: 'Generator', icon: <Zap size={20} /> },
  { id: 'my-timetable', label: 'My Timetable', icon: <Sparkles size={20} /> },
  { id: 'student', label: 'All Students', icon: <Users size={20} /> },
  { id: 'prof', label: 'Professors', icon: <User size={20} /> },
  { id: 'room', label: 'Rooms', icon: <MapPin size={20} /> },
  { id: 'master-room', label: 'Occupancy', icon: <LayoutGrid size={20} /> },
  { id: 'free-room', label: 'Free Rooms', icon: <Coffee size={20} /> },
  { id: 'report-card', label: 'Semester Subject List', icon: <ClipboardList size={20} /> },
];

// Separator appears before these items
const SEPARATOR_BEFORE = new Set<ViewType>(['master-room']);

function AppContent() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<ViewType>('import');
  const [collapsed, setCollapsed] = useState(false);

  if (loading) return <div className="h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <AuthForm />;

  const handleLogout = () => supabase.auth.signOut();

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-gray-900 overflow-hidden">

      {/* ── Sidebar ── */}
      <aside
        style={{ transition: 'width 0.25s ease' }}
        className={`relative flex flex-col bg-white border-r border-gray-200 shadow-sm z-40 flex-shrink-0 ${collapsed ? 'w-[64px]' : 'w-[220px]'
          }`}
      >
        {/* Logo / Brand */}
        <div className="flex items-center gap-3 h-16 px-4 border-b border-gray-100 overflow-hidden">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <CalendarDays size={18} />
          </div>
          {!collapsed && (
            <span className="font-bold text-gray-800 text-sm leading-tight whitespace-nowrap">
              Timetable<br />Manager
            </span>
          )}
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => (
            <div key={item.id}>
              {SEPARATOR_BEFORE.has(item.id) && (
                <div className="my-2 border-t border-gray-100" />
              )}
              <SidebarButton
                active={view === item.id}
                onClick={() => setView(item.id)}
                icon={item.icon}
                label={item.label}
                collapsed={collapsed}
              />
            </div>
          ))}
        </nav>

        {/* User & Logout */}
        <div className="border-t border-gray-100 p-3 space-y-2">
          {!collapsed && (
            <div className="px-2 text-xs text-gray-500 overflow-hidden">
              <div className="font-semibold text-gray-700 truncate">Admin User</div>
              <div className="truncate">{user.email}</div>
            </div>
          )}
          <button
            onClick={handleLogout}
            title="Sign Out"
            className={`flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm font-medium text-red-500 hover:bg-red-50 transition-colors ${collapsed ? 'justify-center' : ''
              }`}
          >
            <LogOut size={18} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>

        {/* Collapse Toggle Button */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors z-50"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        <main className="flex-1 p-6 md:p-8">
          {view === 'import' && <TimetableImporter />}
          {view === 'generator' && <GeneratorView />}
          {view === 'my-timetable' && <StudentCustomTimetable onBack={() => setView('student')} />}
          {view === 'student' && <TimetableViewer />}
          {view === 'prof' && <ProfessorTimetableViewer />}
          {view === 'room' && <RoomTimetableViewer />}
          {view === 'master-room' && <MasterRoomViewer />}
          {view === 'free-room' && <FreeRoomViewer />}
          {view === 'report-card' && <ReportCardView />}
        </main>
      </div>

      <Toaster position="bottom-center" toastOptions={{ duration: 4000 }} />
    </div>
  );
}

/* Sidebar nav button */
function SidebarButton({
  active,
  onClick,
  icon,
  label,
  collapsed,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 w-full px-2 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap overflow-hidden ${active
          ? 'bg-indigo-50 text-indigo-700'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
        } ${collapsed ? 'justify-center' : ''}`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}