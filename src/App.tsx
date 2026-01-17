import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AuthForm } from './components/AuthForm';
import TimetableImporter from './components/TimetableImporter';
import TimetableViewer from './components/TimetableViewer';
import { ProfessorTimetableViewer } from './components/ProfessorTimetableViewer';
import { RoomTimetableViewer } from './components/RoomTimetableViewer';
import { MasterRoomViewer } from './components/MasterRoomViewer';
import { FreeRoomViewer } from './components/FreeRoomViewer';
import { StudentCustomTimetable } from './components/StudentCustomTimetable'; // 👈 1. Import New Component
import { Toaster } from 'react-hot-toast';

import { 
  FileSpreadsheet, 
  Users, 
  User, 
  MapPin, 
  LayoutGrid, 
  Coffee, 
  Sparkles, // 👈 2. Import Icon for Custom View
  LogOut 
} from 'lucide-react';
import { supabase } from './lib/supabase';

function AppContent() {
  const { user, loading } = useAuth();
  
  // 👈 3. Added 'my-timetable' to state type
  const [view, setView] = useState<'import' | 'student' | 'my-timetable' | 'prof' | 'room' | 'master-room' | 'free-room'>('import');

  if (loading) return <div className="h-screen flex items-center justify-center">Loading...</div>;

  // 🔒 AUTH GUARD
  if (!user) {
    return <AuthForm />;
  }

  const handleLogout = () => supabase.auth.signOut();

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Navigation Bar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between h-16 items-center">
            
            {/* View Selectors */}
            <div className="flex space-x-2 md:space-x-4 overflow-x-auto no-scrollbar items-center">
              <NavButton active={view === 'import'} onClick={() => setView('import')} icon={<FileSpreadsheet size={18} />} label="Import" />
              
              {/* 👇 4. Added My Timetable Button */}
              <NavButton active={view === 'my-timetable'} onClick={() => setView('my-timetable')} icon={<Sparkles size={18} />} label="My Timetable" />
              
              <NavButton active={view === 'student'} onClick={() => setView('student')} icon={<Users size={18} />} label="All Students" />
              <NavButton active={view === 'prof'} onClick={() => setView('prof')} icon={<User size={18} />} label="Professors" />
              <NavButton active={view === 'room'} onClick={() => setView('room')} icon={<MapPin size={18} />} label="Rooms" />
              
              <div className="h-6 w-px bg-gray-300 mx-1 hidden md:block"></div> {/* Separator */}

              <NavButton active={view === 'master-room'} onClick={() => setView('master-room')} icon={<LayoutGrid size={18} />} label="Occupancy" />
              <NavButton active={view === 'free-room'} onClick={() => setView('free-room')} icon={<Coffee size={18} />} label="Free Rooms" />
            </div>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-4 border-l pl-4 ml-4">
              <div className="text-xs text-right hidden sm:block">
                <div className="font-bold text-gray-700">Admin User</div>
                <div className="text-gray-400">{user.email}</div>
              </div>
              <button onClick={handleLogout} className="p-2 text-red-500 hover:bg-red-50 rounded-full" title="Sign Out">
                <LogOut size={18} />
              </button>
            </div>

          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-8 px-4">
        {view === 'import' && <TimetableImporter />}
        {view === 'my-timetable' && <StudentCustomTimetable onBack={() => setView('student')} />} {/* 👈 5. Render Component */}
        {view === 'student' && <TimetableViewer />}
        {view === 'prof' && <ProfessorTimetableViewer />}
        {view === 'room' && <RoomTimetableViewer />}
        {view === 'master-room' && <MasterRoomViewer />}
        {view === 'free-room' && <FreeRoomViewer />}
      </main>
      <Toaster position="bottom-center" toastOptions={{ duration: 4000 }} />
    
    </div>
    
  );
}

// Helper Component for Nav Buttons
function NavButton({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap
        ${active ? 'text-indigo-600 bg-indigo-50' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
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