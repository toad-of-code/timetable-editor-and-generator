import { useState, useEffect, useCallback } from 'react';
import {
  UserCog, Plus, Pencil, Trash2, Save, X, Search,
  Loader2, AlertCircle, RefreshCw, ChevronUp, ChevronDown, BookOpen,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Professor {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  created_at: string;
}

interface SubjectOption { id: string; code: string; name: string; }

interface Expertise {
  id: string;
  subject_id: string;
  preference_level: number;
  subject_code: string;
  subject_name: string;
}

interface FormData { name: string; email: string; department: string; }
const EMPTY_FORM: FormData = { name: '', email: '', department: '' };
type SortField = 'name' | 'email' | 'department' | 'created_at';

// ─── Expertise Sub-Panel ────────────────────────────────────────────────────

function ExpertisePanel({ professorId, allSubjects }: { professorId: string; allSubjects: SubjectOption[] }) {
  const [items, setItems] = useState<Expertise[]>([]);
  const [loading, setLoading] = useState(true);
  const [addSubjectId, setAddSubjectId] = useState('');
  const [addPref, setAddPref] = useState(1);
  const [addLoading, setAddLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('professor_expertise')
      .select('id, subject_id, preference_level, subject:subject_id (code, name)')
      .eq('professor_id', professorId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      subject_id: r.subject_id,
      preference_level: r.preference_level ?? 1,
      subject_code: r.subject?.code ?? '??',
      subject_name: r.subject?.name ?? '??',
    }));
    setItems(mapped);
    setLoading(false);
  }, [professorId]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleAdd = async () => {
    if (!addSubjectId) { toast.error('Select a subject'); return; }
    setAddLoading(true);
    const { error } = await supabase.from('professor_expertise').insert({
      professor_id: professorId, subject_id: addSubjectId, preference_level: addPref,
    });
    setAddLoading(false);
    if (error) toast.error(error.message); else { toast.success('Expertise added'); setAddSubjectId(''); setAddPref(1); fetch(); }
  };

  const handleUpdatePref = async (id: string, pref: number) => {
    const { error } = await supabase.from('professor_expertise').update({ preference_level: pref }).eq('id', id);
    if (error) toast.error(error.message); else fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this expertise?')) return;
    const { error } = await supabase.from('professor_expertise').delete().eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Removed'); fetch(); }
  };

  const assignedIds = new Set(items.map(e => e.subject_id));
  const available = allSubjects.filter(s => !assignedIds.has(s.id));

  const inp = 'text-xs border border-gray-200 rounded-lg px-2 py-1 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 focus:outline-none bg-white';

  return (
    <tr>
      <td colSpan={5} className="px-4 py-0">
        <div className="bg-indigo-50/50 border border-indigo-100 rounded-lg p-4 my-2">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <span className="text-xs font-bold text-indigo-800 uppercase tracking-wider">Subject Expertise</span>
            <span className="text-[10px] text-indigo-500 bg-indigo-100 px-2 py-0.5 rounded-full">{items.length} assigned</span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-indigo-400 text-xs py-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-indigo-700">
                  <th className="text-left py-1 px-2 font-semibold">Code</th>
                  <th className="text-left py-1 px-2 font-semibold">Subject Name</th>
                  <th className="text-center py-1 px-2 font-semibold w-28">Preference (1-5)</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(e => (
                  <tr key={e.id} className="border-t border-indigo-100 hover:bg-indigo-50/50">
                    <td className="py-1.5 px-2 font-mono font-semibold text-indigo-700">{e.subject_code}</td>
                    <td className="py-1.5 px-2 text-gray-700">{e.subject_name}</td>
                    <td className="py-1.5 px-2 text-center">
                      <select value={e.preference_level} onChange={ev => handleUpdatePref(e.id, +ev.target.value)} className={`${inp} w-16 text-center`}>
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <button onClick={() => handleDelete(e.id)} className="text-red-400 hover:text-red-600 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}

                {/* Add row */}
                <tr className="border-t border-indigo-200 bg-green-50/40">
                  <td colSpan={2} className="py-1.5 px-2">
                    <select value={addSubjectId} onChange={e => setAddSubjectId(e.target.value)} className={`${inp} w-full`}>
                      <option value="">— Select Subject —</option>
                      {available.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <select value={addPref} onChange={e => setAddPref(+e.target.value)} className={`${inp} w-16 text-center`}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <button onClick={handleAdd} disabled={addLoading} className="text-green-600 hover:text-green-800 transition disabled:opacity-50">
                      {addLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>

                {items.length === 0 && (
                  <tr><td colSpan={4} className="py-3 text-center text-gray-400 italic">No expertise assigned yet</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ManageProfessors() {
  const [professors, setProfessors] = useState<Professor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allSubjects, setAllSubjects] = useState<SubjectOption[]>([]);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<FormData>(EMPTY_FORM);
  const [addLoading, setAddLoading] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormData>(EMPTY_FORM);
  const [editLoading, setEditLoading] = useState(false);

  // Expanded expertise panel
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const fetchProfessors = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data, error: err }, { data: subs }] = await Promise.all([
      supabase.from('professors').select('*').order('name', { ascending: true }),
      supabase.from('subjects').select('id, code, name').order('code'),
    ]);
    if (err) setError(err.message); else setProfessors(data ?? []);
    setAllSubjects(subs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchProfessors(); }, [fetchProfessors]);

  const handleAdd = async () => {
    if (!addForm.name.trim()) { toast.error('Name is required'); return; }
    setAddLoading(true);
    const { error: err } = await supabase.from('professors').insert({
      name: addForm.name.trim(), email: addForm.email.trim() || null, department: addForm.department.trim() || null,
    });
    setAddLoading(false);
    if (err) toast.error(`Failed: ${err.message}`); else { toast.success(`"${addForm.name}" added`); setAddForm(EMPTY_FORM); setShowAdd(false); fetchProfessors(); }
  };

  const startEdit = (p: Professor) => { setEditId(p.id); setEditForm({ name: p.name, email: p.email ?? '', department: p.department ?? '' }); };
  const cancelEdit = () => { setEditId(null); setEditForm(EMPTY_FORM); };

  const handleUpdate = async () => {
    if (!editId || !editForm.name.trim()) { toast.error('Name is required'); return; }
    setEditLoading(true);
    const { error: err } = await supabase.from('professors').update({
      name: editForm.name.trim(), email: editForm.email.trim() || null, department: editForm.department.trim() || null,
    }).eq('id', editId);
    setEditLoading(false);
    if (err) toast.error(`Failed: ${err.message}`); else { toast.success('Updated'); cancelEdit(); fetchProfessors(); }
  };

  const handleDelete = async (p: Professor) => {
    if (!confirm(`Delete "${p.name}"?`)) return;
    const { error: err } = await supabase.from('professors').delete().eq('id', p.id);
    if (err) toast.error(`Failed: ${err.message}`); else { toast.success(`Deleted`); fetchProfessors(); }
  };

  const departments = [...new Set(professors.map(p => p.department).filter(Boolean))] as string[];
  const filtered = professors
    .filter(p => {
      if (deptFilter !== 'ALL' && p.department !== deptFilter) return false;
      if (search) { const t = search.toLowerCase(); return p.name.toLowerCase().includes(t) || (p.email ?? '').toLowerCase().includes(t) || (p.department ?? '').toLowerCase().includes(t); }
      return true;
    })
    .sort((a, b) => { const cmp = ((a[sortField] ?? '') as string).localeCompare((b[sortField] ?? '') as string); return sortAsc ? cmp : -cmp; });

  const toggleSort = (f: SortField) => { if (sortField === f) setSortAsc(v => !v); else { setSortField(f); setSortAsc(true); } };
  const SortIcon = ({ field }: { field: SortField }) => { if (sortField !== field) return null; return sortAsc ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />; };

  const inp = 'w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 focus:outline-none transition bg-white';

  return (
    <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">
      {/* Header */}
      <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg"><UserCog className="w-6 h-6 text-indigo-600" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Manage Professors</h1>
            <p className="text-sm text-gray-500">Add, edit, remove faculty & manage subject expertise</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full font-medium">{filtered.length} / {professors.length}</span>
          <button onClick={fetchProfessors} title="Refresh" className="p-2 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 focus:outline-none bg-white" />
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-400 focus:outline-none">
          <option value="ALL">All Departments</option>
          {departments.sort().map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition shadow-sm">
          <Plus className="w-4 h-4" /> Add Professor
        </button>
      </div>

      {loading && <div className="flex items-center justify-center py-24 gap-3 text-indigo-500"><Loader2 className="w-6 h-6 animate-spin" /><span className="text-sm font-medium">Loading…</span></div>}
      {error && <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mb-4"><AlertCircle className="w-5 h-5" /><span>{error}</span></div>}

      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-indigo-50 to-blue-50 border-b-2 border-indigo-100 text-indigo-800">
                  <th className="px-4 py-3 text-left font-semibold w-10">#</th>
                  <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => toggleSort('name')}>Name <SortIcon field="name" /></th>
                  <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => toggleSort('email')}>Email <SortIcon field="email" /></th>
                  <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => toggleSort('department')}>Department <SortIcon field="department" /></th>
                  <th className="px-4 py-3 text-center font-semibold w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {showAdd && (
                  <tr className="bg-green-50/60 border-b border-green-100">
                    <td className="px-4 py-2 text-center text-green-600 font-bold text-xs">NEW</td>
                    <td className="px-4 py-2"><input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *" className={inp} autoFocus /></td>
                    <td className="px-4 py-2"><input value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="email@iiita.ac.in" className={inp} /></td>
                    <td className="px-4 py-2"><input value={addForm.department} onChange={e => setAddForm(f => ({ ...f, department: e.target.value }))} placeholder="Dept" className={inp} /></td>
                    <td className="px-4 py-2"><div className="flex items-center justify-center gap-1">
                      <button onClick={handleAdd} disabled={addLoading} className="p-1.5 rounded-md text-green-600 hover:bg-green-100 transition disabled:opacity-50">{addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}</button>
                      <button onClick={() => { setShowAdd(false); setAddForm(EMPTY_FORM); }} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition"><X className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                )}

                {filtered.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 italic text-sm">{professors.length === 0 ? 'No professors yet.' : 'No results.'}</td></tr>
                ) : filtered.map((prof, idx) => {
                  const isEditing = editId === prof.id;
                  const isExpanded = expandedId === prof.id;
                  return (
                    <> 
                      <tr
                        key={prof.id}
                        className={`border-b border-gray-50 transition-colors cursor-pointer ${isEditing ? 'bg-amber-50/50' : isExpanded ? 'bg-indigo-50/40' : idx % 2 === 0 ? 'bg-white hover:bg-blue-50/30' : 'bg-slate-50/40 hover:bg-blue-50/30'}`}
                        onClick={() => !isEditing && setExpandedId(isExpanded ? null : prof.id)}
                      >
                        <td className="px-4 py-2.5 text-center text-gray-400 font-mono text-xs">{idx + 1}</td>
                        {isEditing ? (<>
                          <td className="px-4 py-2"><input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={inp} onClick={e => e.stopPropagation()} /></td>
                          <td className="px-4 py-2"><input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className={inp} onClick={e => e.stopPropagation()} /></td>
                          <td className="px-4 py-2"><input value={editForm.department} onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))} className={inp} onClick={e => e.stopPropagation()} /></td>
                          <td className="px-4 py-2" onClick={e => e.stopPropagation()}><div className="flex items-center justify-center gap-1">
                            <button onClick={handleUpdate} disabled={editLoading} className="p-1.5 rounded-md text-green-600 hover:bg-green-100 transition disabled:opacity-50">{editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}</button>
                            <button onClick={cancelEdit} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition"><X className="w-4 h-4" /></button>
                          </div></td>
                        </>) : (<>
                          <td className="px-4 py-2.5 font-medium text-gray-800">
                            {prof.name}
                            {isExpanded && <ChevronUp className="w-3 h-3 inline ml-1 text-indigo-400" />}
                            {!isExpanded && <ChevronDown className="w-3 h-3 inline ml-1 text-gray-300" />}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{prof.email ?? '—'}</td>
                          <td className="px-4 py-2.5">{prof.department ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">{prof.department}</span> : <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => startEdit(prof)} className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDelete(prof)} className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </>)}
                      </tr>
                      {isExpanded && !isEditing && <ExpertisePanel key={`exp-${prof.id}`} professorId={prof.id} allSubjects={allSubjects} />}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-gray-50 border-t border-gray-200 px-5 py-2.5 flex items-center text-xs text-gray-500">
            <span className="font-semibold text-gray-600">Total:</span>
            <span className="ml-2 font-bold text-indigo-700">{professors.length}</span>
            <span className="ml-1">professors</span>
            {departments.length > 0 && <span className="ml-auto">{departments.length} dept{departments.length !== 1 ? 's' : ''}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
