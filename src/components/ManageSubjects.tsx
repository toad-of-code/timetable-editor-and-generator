import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Plus, Pencil, Trash2, Save, X, Search,
  Loader2, AlertCircle, RefreshCw, ChevronUp, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Subject {
  id: string;
  code: string;
  name: string;
  lectures: number | null;
  tutorials: number | null;
  practicals: number | null;
  practical_duration: number | null;
  credits: number | null;
  subject_type: string;
  elective_group: string | null;
  created_at: string;
}

interface FormData {
  code: string;
  name: string;
  lectures: number;
  tutorials: number;
  practicals: number;
  practical_duration: number;
  credits: number;
  subject_type: string;
  elective_group: string;
}

const EMPTY_FORM: FormData = {
  code: '', name: '', lectures: 0, tutorials: 0, practicals: 0,
  practical_duration: 120, credits: 4, subject_type: 'Core', elective_group: '',
};

const SUBJECT_TYPES = ['Core', 'Elective', 'Minor'] as const;

type SortField = 'code' | 'name' | 'subject_type' | 'credits';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TypeBadge = ({ type }: { type: string }) => {
  const colors: Record<string, string> = {
    Core: 'bg-blue-100 text-blue-700',
    Elective: 'bg-purple-100 text-purple-700',
    Minor: 'bg-orange-100 text-orange-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  );
};

const formatLTP = (l: number | null, t: number | null, p: number | null) =>
  `${l ?? 0}-${t ?? 0}-${p ?? 0}`;

// ─── Component ──────────────────────────────────────────────────────────────

export function ManageSubjects() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
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
  const [sortField, setSortField] = useState<SortField>('code');
  const [sortAsc, setSortAsc] = useState(true);

  // ── Fetch ─────────────────────────────────────────────────────────────

  const fetchSubjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('subjects')
      .select('*')
      .order('code', { ascending: true });

    if (err) {
      setError(err.message);
    } else {
      setSubjects(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSubjects(); }, [fetchSubjects]);

  // ── Create ────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!addForm.code.trim() || !addForm.name.trim()) {
      toast.error('Code and Name are required');
      return;
    }
    setAddLoading(true);
    const { error: err } = await supabase.from('subjects').insert({
      code: addForm.code.trim(),
      name: addForm.name.trim(),
      lectures: addForm.lectures,
      tutorials: addForm.tutorials,
      practicals: addForm.practicals,
      practical_duration: addForm.practical_duration,
      credits: addForm.credits,
      subject_type: addForm.subject_type,
      elective_group: addForm.subject_type === 'Elective' ? (addForm.elective_group.trim() || null) : null,
    });
    setAddLoading(false);

    if (err) {
      toast.error(`Failed to add: ${err.message}`);
    } else {
      toast.success(`Subject "${addForm.code}" added`);
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      fetchSubjects();
    }
  };

  // ── Update ────────────────────────────────────────────────────────────

  const startEdit = (sub: Subject) => {
    setEditId(sub.id);
    setEditForm({
      code: sub.code,
      name: sub.name,
      lectures: sub.lectures ?? 0,
      tutorials: sub.tutorials ?? 0,
      practicals: sub.practicals ?? 0,
      practical_duration: sub.practical_duration ?? 120,
      credits: sub.credits ?? 4,
      subject_type: sub.subject_type,
      elective_group: sub.elective_group ?? '',
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditForm(EMPTY_FORM);
  };

  const handleUpdate = async () => {
    if (!editId) return;
    if (!editForm.code.trim() || !editForm.name.trim()) {
      toast.error('Code and Name are required');
      return;
    }
    setEditLoading(true);
    const { error: err } = await supabase
      .from('subjects')
      .update({
        code: editForm.code.trim(),
        name: editForm.name.trim(),
        lectures: editForm.lectures,
        tutorials: editForm.tutorials,
        practicals: editForm.practicals,
        practical_duration: editForm.practical_duration,
        credits: editForm.credits,
        subject_type: editForm.subject_type,
        elective_group: editForm.subject_type === 'Elective' ? (editForm.elective_group.trim() || null) : null,
      })
      .eq('id', editId);
    setEditLoading(false);

    if (err) {
      toast.error(`Failed to update: ${err.message}`);
    } else {
      toast.success('Subject updated');
      cancelEdit();
      fetchSubjects();
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────

  const handleDelete = async (sub: Subject) => {
    if (!confirm(`Delete subject "${sub.code} — ${sub.name}"? This cannot be undone.`)) return;

    const { error: err } = await supabase
      .from('subjects')
      .delete()
      .eq('id', sub.id);

    if (err) {
      toast.error(`Failed to delete: ${err.message}`);
    } else {
      toast.success(`"${sub.code}" deleted`);
      fetchSubjects();
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────

  const filtered = subjects
    .filter(s => {
      if (typeFilter !== 'ALL' && s.subject_type !== typeFilter) return false;
      if (search) {
        const term = search.toLowerCase();
        return (
          s.code.toLowerCase().includes(term) ||
          s.name.toLowerCase().includes(term) ||
          (s.elective_group ?? '').toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';
      if (sortField === 'credits') {
        aVal = a.credits ?? 0;
        bVal = b.credits ?? 0;
        const cmp = (aVal as number) - (bVal as number);
        return sortAsc ? cmp : -cmp;
      }
      aVal = (a[sortField] ?? '') as string;
      bVal = (b[sortField] ?? '') as string;
      const cmp = (aVal as string).localeCompare(bVal as string);
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

  const inp = 'w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 focus:outline-none transition bg-white';
  const numInp = `${inp} w-16 text-center`;

  // ── Render form fields for Add/Edit ───────────────────────────────────

  const renderFormFields = (form: FormData, setForm: React.Dispatch<React.SetStateAction<FormData>>, isAdd: boolean) => (
    <>
      <td className="px-3 py-2">
        <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Code *" className={`${inp} font-mono`} autoFocus={isAdd} />
      </td>
      <td className="px-3 py-2">
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Subject Name *" className={inp} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <input type="number" min={0} value={form.lectures} onChange={e => setForm(f => ({ ...f, lectures: +e.target.value }))} className={numInp} title="Lectures" />
          <span className="text-gray-300">-</span>
          <input type="number" min={0} value={form.tutorials} onChange={e => setForm(f => ({ ...f, tutorials: +e.target.value }))} className={numInp} title="Tutorials" />
          <span className="text-gray-300">-</span>
          <input type="number" min={0} value={form.practicals} onChange={e => setForm(f => ({ ...f, practicals: +e.target.value }))} className={numInp} title="Practicals" />
        </div>
      </td>
      <td className="px-3 py-2">
        <input type="number" min={0} value={form.credits} onChange={e => setForm(f => ({ ...f, credits: +e.target.value }))} className={numInp} />
      </td>
      <td className="px-3 py-2">
        <select value={form.subject_type} onChange={e => setForm(f => ({ ...f, subject_type: e.target.value }))} className={inp}>
          {SUBJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        {form.subject_type === 'Elective' ? (
          <input value={form.elective_group} onChange={e => setForm(f => ({ ...f, elective_group: e.target.value }))} placeholder="e.g. HSMC" className={inp} />
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">
      {/* Header */}
      <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <BookOpen className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Manage Subjects</h1>
            <p className="text-sm text-gray-500">Add, edit or remove course catalog entries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full font-medium">
            {filtered.length} / {subjects.length} records
          </span>
          <button onClick={fetchSubjects} title="Refresh" className="p-2 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition">
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
            placeholder="Search code, name, elective group…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-purple-400 focus:ring-1 focus:ring-purple-200 focus:outline-none bg-white"
          />
        </div>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-purple-400 focus:outline-none"
        >
          <option value="ALL">All Types</option>
          {SUBJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <button
          onClick={() => setShowAdd(prev => !prev)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Subject
        </button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-24 gap-3 text-purple-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm font-medium">Loading subjects…</span>
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
                <tr className="bg-gradient-to-r from-purple-50 to-violet-50 border-b-2 border-purple-100 text-purple-800">
                  <th className="px-3 py-3 text-left font-semibold w-10">#</th>
                  <th className="px-3 py-3 text-left font-semibold cursor-pointer select-none hover:text-purple-600" onClick={() => toggleSort('code')}>
                    Code <SortIcon field="code" />
                  </th>
                  <th className="px-3 py-3 text-left font-semibold cursor-pointer select-none hover:text-purple-600" onClick={() => toggleSort('name')}>
                    Name <SortIcon field="name" />
                  </th>
                  <th className="px-3 py-3 text-center font-semibold">L-T-P</th>
                  <th className="px-3 py-3 text-center font-semibold cursor-pointer select-none hover:text-purple-600" onClick={() => toggleSort('credits')}>
                    Credits <SortIcon field="credits" />
                  </th>
                  <th className="px-3 py-3 text-left font-semibold cursor-pointer select-none hover:text-purple-600" onClick={() => toggleSort('subject_type')}>
                    Type <SortIcon field="subject_type" />
                  </th>
                  <th className="px-3 py-3 text-left font-semibold">Elective Group</th>
                  <th className="px-3 py-3 text-center font-semibold w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* ── Add Row ── */}
                {showAdd && (
                  <tr className="bg-green-50/60 border-b border-green-100">
                    <td className="px-3 py-2 text-center text-green-600 font-bold text-xs">NEW</td>
                    {renderFormFields(addForm, setAddForm, true)}
                    <td className="px-3 py-2">
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
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400 italic text-sm">
                      {subjects.length === 0 ? 'No subjects yet. Click "Add Subject" to create one.' : 'No results match your search.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((sub, idx) => {
                    const isEditing = editId === sub.id;

                    return (
                      <tr
                        key={sub.id}
                        className={`border-b border-gray-50 hover:bg-purple-50/20 transition-colors ${
                          isEditing ? 'bg-amber-50/50'
                            : sub.subject_type === 'Elective' ? 'bg-purple-50/20'
                            : sub.subject_type === 'Minor' ? 'bg-orange-50/20'
                            : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                        }`}
                      >
                        <td className="px-3 py-2.5 text-center text-gray-400 font-mono text-xs">{idx + 1}</td>

                        {isEditing ? (
                          <>
                            {renderFormFields(editForm, setEditForm, false)}
                            <td className="px-3 py-2">
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
                            <td className="px-3 py-2.5 font-mono font-semibold text-indigo-700 text-xs">{sub.code}</td>
                            <td className="px-3 py-2.5 font-medium text-gray-800">{sub.name}</td>
                            <td className="px-3 py-2.5 text-center font-mono text-gray-500 text-xs">{formatLTP(sub.lectures, sub.tutorials, sub.practicals)}</td>
                            <td className="px-3 py-2.5 text-center font-mono font-semibold text-gray-700">{sub.credits ?? 4}</td>
                            <td className="px-3 py-2.5"><TypeBadge type={sub.subject_type} /></td>
                            <td className="px-3 py-2.5 text-xs text-gray-500">
                              {sub.elective_group ? (
                                <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold">
                                  {sub.elective_group}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={() => startEdit(sub)} className="p-1.5 rounded-md text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleDelete(sub)} className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition" title="Delete">
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
            <span className="font-bold text-purple-700">{subjects.length}</span>
            <span>subjects</span>
            <span className="ml-auto flex gap-3">
              <span>Core: <b className="text-blue-700">{subjects.filter(s => s.subject_type === 'Core').length}</b></span>
              <span>Elective: <b className="text-purple-700">{subjects.filter(s => s.subject_type === 'Elective').length}</b></span>
              <span>Minor: <b className="text-orange-700">{subjects.filter(s => s.subject_type === 'Minor').length}</b></span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
