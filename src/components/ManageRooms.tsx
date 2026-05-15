import { useState, useEffect, useCallback } from 'react';
import {
  Building2, Plus, Pencil, Trash2, Save, X, Search,
  Loader2, AlertCircle, RefreshCw, ChevronUp, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Room {
  id: string;
  name: string;
  capacity: number;
  room_type: string;
  created_at: string;
}

interface FormData {
  name: string;
  capacity: number;
  room_type: string;
}

const EMPTY_FORM: FormData = { name: '', capacity: 60, room_type: 'Lecture' };

const ROOM_TYPES = ['Lecture', 'Lab'] as const;

type SortField = 'name' | 'capacity' | 'room_type';

// ─── Helpers ────────────────────────────────────────────────────────────────

const RoomTypeBadge = ({ type }: { type: string }) => {
  const colors: Record<string, string> = {
    Lecture: 'bg-blue-100 text-blue-700',
    Lab: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${colors[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  );
};

/** Simple capacity bar, max 200 */
const CapacityBar = ({ capacity }: { capacity: number }) => {
  const pct = Math.min((capacity / 200) * 100, 100);
  const color = capacity > 120 ? 'bg-indigo-500' : capacity > 60 ? 'bg-blue-400' : 'bg-sky-300';
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono font-semibold text-gray-700 text-xs w-8 text-right">{capacity}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[60px]">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────────────────────────

export function ManageRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<FormData>(EMPTY_FORM);
  const [addLoading, setAddLoading] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormData>(EMPTY_FORM);
  const [editLoading, setEditLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

  // Sort
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // ── Fetch ─────────────────────────────────────────────────────────────

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('rooms')
      .select('*')
      .order('name', { ascending: true });

    if (err) {
      setError(err.message);
    } else {
      setRooms(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  // ── Create ────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!addForm.name.trim()) {
      toast.error('Room name is required');
      return;
    }
    if (addForm.capacity <= 0) {
      toast.error('Capacity must be greater than 0');
      return;
    }
    setAddLoading(true);
    const { error: err } = await supabase.from('rooms').insert({
      name: addForm.name.trim(),
      capacity: addForm.capacity,
      room_type: addForm.room_type,
    });
    setAddLoading(false);

    if (err) {
      toast.error(`Failed to add: ${err.message}`);
    } else {
      toast.success(`Room "${addForm.name}" added`);
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      fetchRooms();
    }
  };

  // ── Update ────────────────────────────────────────────────────────────

  const startEdit = (room: Room) => {
    setEditId(room.id);
    setEditForm({
      name: room.name,
      capacity: room.capacity,
      room_type: room.room_type,
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditForm(EMPTY_FORM);
  };

  const handleUpdate = async () => {
    if (!editId) return;
    if (!editForm.name.trim()) {
      toast.error('Room name is required');
      return;
    }
    setEditLoading(true);
    const { error: err } = await supabase
      .from('rooms')
      .update({
        name: editForm.name.trim(),
        capacity: editForm.capacity,
        room_type: editForm.room_type,
      })
      .eq('id', editId);
    setEditLoading(false);

    if (err) {
      toast.error(`Failed to update: ${err.message}`);
    } else {
      toast.success('Room updated');
      cancelEdit();
      fetchRooms();
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────

  const handleDelete = async (room: Room) => {
    if (!confirm(`Delete room "${room.name}"? This cannot be undone.`)) return;

    const { error: err } = await supabase
      .from('rooms')
      .delete()
      .eq('id', room.id);

    if (err) {
      toast.error(`Failed to delete: ${err.message}`);
    } else {
      toast.success(`"${room.name}" deleted`);
      fetchRooms();
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────

  const filtered = rooms
    .filter(r => {
      if (typeFilter !== 'ALL' && r.room_type !== typeFilter) return false;
      if (search) {
        const term = search.toLowerCase();
        return r.name.toLowerCase().includes(term);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortField === 'capacity') {
        const cmp = a.capacity - b.capacity;
        return sortAsc ? cmp : -cmp;
      }
      const aVal = (a[sortField] ?? '') as string;
      const bVal = (b[sortField] ?? '') as string;
      const cmp = aVal.localeCompare(bVal);
      return sortAsc ? cmp : -cmp;
    });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(prev => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  };

  // ── Input helpers ─────────────────────────────────────────────────────

  const inp = 'w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-teal-400 focus:ring-1 focus:ring-teal-200 focus:outline-none transition bg-white';

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">
      {/* Header */}
      <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-100 rounded-lg">
            <Building2 className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Manage Rooms</h1>
            <p className="text-sm text-gray-500">Add, edit or remove classrooms and labs</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full font-medium">
            {filtered.length} / {rooms.length} records
          </span>
          <button onClick={fetchRooms} title="Refresh" className="p-2 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search room name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-teal-400 focus:ring-1 focus:ring-teal-200 focus:outline-none bg-white"
          />
        </div>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-teal-400 focus:outline-none"
        >
          <option value="ALL">All Types</option>
          {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <button
          onClick={() => setShowAdd(prev => !prev)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Room
        </button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-24 gap-3 text-teal-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm font-medium">Loading rooms…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-teal-50 to-emerald-50 border-b-2 border-teal-100 text-teal-800">
                  <th className="px-4 py-3 text-left font-semibold w-10">#</th>
                  <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-teal-600" onClick={() => toggleSort('name')}>
                    Room Name <SortIcon field="name" />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-teal-600 min-w-[180px]" onClick={() => toggleSort('capacity')}>
                    Capacity <SortIcon field="capacity" />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-teal-600" onClick={() => toggleSort('room_type')}>
                    Type <SortIcon field="room_type" />
                  </th>
                  <th className="px-4 py-3 text-center font-semibold w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* ── Add Row ── */}
                {showAdd && (
                  <tr className="bg-green-50/60 border-b border-green-100">
                    <td className="px-4 py-2 text-center text-green-600 font-bold text-xs">NEW</td>
                    <td className="px-4 py-2">
                      <input
                        value={addForm.name}
                        onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. CC1-1001 *"
                        className={`${inp} font-mono`}
                        autoFocus
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        value={addForm.capacity}
                        onChange={e => setAddForm(f => ({ ...f, capacity: +e.target.value }))}
                        className={`${inp} w-24`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={addForm.room_type}
                        onChange={e => setAddForm(f => ({ ...f, room_type: e.target.value }))}
                        className={inp}
                      >
                        {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={handleAdd} disabled={addLoading} className="p-1.5 rounded-md text-green-600 hover:bg-green-100 transition disabled:opacity-50" title="Save">
                          {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        </button>
                        <button onClick={() => { setShowAdd(false); setAddForm(EMPTY_FORM); }} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition" title="Cancel">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* ── Data Rows ── */}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400 italic text-sm">
                      {rooms.length === 0 ? 'No rooms yet. Click "Add Room" to create one.' : 'No results match your search.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((room, idx) => {
                    const isEditing = editId === room.id;

                    return (
                      <tr
                        key={room.id}
                        className={`border-b border-gray-50 hover:bg-teal-50/20 transition-colors ${
                          isEditing ? 'bg-amber-50/50'
                            : room.room_type === 'Lab' ? 'bg-emerald-50/20'
                            : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                        }`}
                      >
                        <td className="px-4 py-2.5 text-center text-gray-400 font-mono text-xs">{idx + 1}</td>

                        {isEditing ? (
                          <>
                            <td className="px-4 py-2">
                              <input
                                value={editForm.name}
                                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                className={`${inp} font-mono`}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                min={1}
                                value={editForm.capacity}
                                onChange={e => setEditForm(f => ({ ...f, capacity: +e.target.value }))}
                                className={`${inp} w-24`}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={editForm.room_type}
                                onChange={e => setEditForm(f => ({ ...f, room_type: e.target.value }))}
                                className={inp}
                              >
                                {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={handleUpdate} disabled={editLoading} className="p-1.5 rounded-md text-green-600 hover:bg-green-100 transition disabled:opacity-50" title="Save">
                                  {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                </button>
                                <button onClick={cancelEdit} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition" title="Cancel">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{room.name}</td>
                            <td className="px-4 py-2.5"><CapacityBar capacity={room.capacity} /></td>
                            <td className="px-4 py-2.5"><RoomTypeBadge type={room.room_type} /></td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={() => startEdit(room)} className="p-1.5 rounded-md text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleDelete(room)} className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition" title="Delete">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 border-t border-gray-200 px-5 py-2.5 flex items-center gap-4 text-xs text-gray-500">
            <span className="font-semibold text-gray-600">Total:</span>
            <span className="font-bold text-teal-700">{rooms.length}</span>
            <span>rooms</span>
            <span className="ml-auto flex gap-3">
              <span>Lecture: <b className="text-blue-700">{rooms.filter(r => r.room_type === 'Lecture').length}</b></span>
              <span>Lab: <b className="text-emerald-700">{rooms.filter(r => r.room_type === 'Lab').length}</b></span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
