import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Plus, Trash2, Save, X, Loader2, AlertCircle, RefreshCw, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface Cluster { id: string; batch_year: number; semester_number: number; department: string | null; is_active: boolean; }
interface SubjectOption { id: string; code: string; name: string; subject_type: string; }
interface Mapping { id: string; subject_id: string; elective_basket: string | null; estimated_enrollment: number | null; code: string; name: string; subject_type: string; }
interface ClusterForm { batch_year: number; semester_number: number; department: string; }

const EMPTY_CLUSTER: ClusterForm = { batch_year: new Date().getFullYear(), semester_number: 1, department: 'IT' };

export function ManageSemesterMapping() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [allSubjects, setAllSubjects] = useState<SubjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add cluster
  const [showAddCluster, setShowAddCluster] = useState(false);
  const [clusterForm, setClusterForm] = useState<ClusterForm>(EMPTY_CLUSTER);
  const [clusterSaving, setClusterSaving] = useState(false);

  // Edit cluster
  const [editClusterId, setEditClusterId] = useState<string | null>(null);
  const [editClusterForm, setEditClusterForm] = useState<ClusterForm>(EMPTY_CLUSTER);

  // Add mapping
  const [addSubjectId, setAddSubjectId] = useState('');
  const [addBasket, setAddBasket] = useState('');
  const [addEnrollment, setAddEnrollment] = useState(100);
  const [addLoading, setAddLoading] = useState(false);

  // Edit mapping
  const [editMapId, setEditMapId] = useState<string | null>(null);
  const [editBasket, setEditBasket] = useState('');
  const [editEnrollment, setEditEnrollment] = useState(100);

  const fetchClusters = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data: cl, error: e1 }, { data: subs }] = await Promise.all([
      supabase.from('semester_clusters').select('*').order('semester_number'),
      supabase.from('subjects').select('id, code, name, subject_type').order('code'),
    ]);
    if (e1) setError(e1.message); else setClusters(cl ?? []);
    setAllSubjects(subs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchClusters(); }, [fetchClusters]);

  const fetchMappings = useCallback(async (clusterId: string) => {
    if (!clusterId) { setMappings([]); return; }
    setMapLoading(true);
    const { data, error: err } = await supabase
      .from('cluster_requirements')
      .select('id, subject_id, elective_basket, estimated_enrollment, subject:subject_id (code, name, subject_type)')
      .eq('cluster_id', clusterId);
    if (err) toast.error(err.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setMappings((data ?? []).map((r: any) => ({
      id: r.id, subject_id: r.subject_id,
      elective_basket: r.elective_basket, estimated_enrollment: r.estimated_enrollment,
      code: r.subject?.code ?? '??', name: r.subject?.name ?? '??', subject_type: r.subject?.subject_type ?? 'Core',
    })));
    setMapLoading(false);
  }, []);

  useEffect(() => { fetchMappings(selectedId); }, [selectedId, fetchMappings]);

  // ── Cluster CRUD ──
  const handleAddCluster = async () => {
    setClusterSaving(true);
    const { error: err } = await supabase.from('semester_clusters').insert({
      batch_year: clusterForm.batch_year, semester_number: clusterForm.semester_number,
      department: clusterForm.department.trim() || 'IT', is_active: true,
    });
    setClusterSaving(false);
    if (err) toast.error(err.message); else { toast.success('Cluster created'); setShowAddCluster(false); setClusterForm(EMPTY_CLUSTER); fetchClusters(); }
  };

  const handleUpdateCluster = async () => {
    if (!editClusterId) return;
    const { error: err } = await supabase.from('semester_clusters').update({
      batch_year: editClusterForm.batch_year, semester_number: editClusterForm.semester_number,
      department: editClusterForm.department.trim() || 'IT',
    }).eq('id', editClusterId);
    if (err) toast.error(err.message); else { toast.success('Cluster updated'); setEditClusterId(null); fetchClusters(); }
  };

  const handleDeleteCluster = async (id: string) => {
    if (!confirm('Delete this cluster and all its subject mappings?')) return;
    await supabase.from('cluster_requirements').delete().eq('cluster_id', id);
    const { error: err } = await supabase.from('semester_clusters').delete().eq('id', id);
    if (err) toast.error(err.message); else { toast.success('Cluster deleted'); if (selectedId === id) setSelectedId(''); fetchClusters(); }
  };

  const handleToggleActive = async (c: Cluster) => {
    const { error: err } = await supabase.from('semester_clusters').update({ is_active: !c.is_active }).eq('id', c.id);
    if (err) toast.error(err.message); else fetchClusters();
  };

  // ── Mapping CRUD ──
  const handleAddMapping = async () => {
    if (!addSubjectId || !selectedId) { toast.error('Select a subject'); return; }
    setAddLoading(true);
    const { error: err } = await supabase.from('cluster_requirements').insert({
      cluster_id: selectedId, subject_id: addSubjectId,
      elective_basket: addBasket.trim() || null, estimated_enrollment: addEnrollment,
    });
    setAddLoading(false);
    if (err) toast.error(err.message); else { toast.success('Subject mapped'); setAddSubjectId(''); setAddBasket(''); setAddEnrollment(100); fetchMappings(selectedId); }
  };

  const startEditMap = (m: Mapping) => { setEditMapId(m.id); setEditBasket(m.elective_basket ?? ''); setEditEnrollment(m.estimated_enrollment ?? 100); };

  const handleUpdateMapping = async () => {
    if (!editMapId) return;
    const { error: err } = await supabase.from('cluster_requirements').update({
      elective_basket: editBasket.trim() || null, estimated_enrollment: editEnrollment,
    }).eq('id', editMapId);
    if (err) toast.error(err.message); else { toast.success('Updated'); setEditMapId(null); fetchMappings(selectedId); }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Remove this subject from the semester?')) return;
    const { error: err } = await supabase.from('cluster_requirements').delete().eq('id', id);
    if (err) toast.error(err.message); else { toast.success('Removed'); fetchMappings(selectedId); }
  };

  const mappedIds = new Set(mappings.map(m => m.subject_id));
  const available = allSubjects.filter(s => !mappedIds.has(s.id));
  const inp = 'text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200 focus:outline-none bg-white';

  const TypeBadge = ({ type }: { type: string }) => {
    const c: Record<string, string> = { Core: 'bg-blue-100 text-blue-700', Elective: 'bg-purple-100 text-purple-700', Minor: 'bg-orange-100 text-orange-700' };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c[type] ?? 'bg-gray-100 text-gray-600'}`}>{type}</span>;
  };

  return (
    <div className="p-4 bg-gray-50 min-h-screen font-sans pb-20">
      {/* Header */}
      <div className="mb-6 bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg"><GitBranch className="w-6 h-6 text-emerald-600" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Semester Subject Mapping</h1>
            <p className="text-sm text-gray-500">Manage clusters & assign subjects to semesters</p>
          </div>
        </div>
        <button onClick={fetchClusters} className="p-2 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {loading && <div className="flex items-center justify-center py-24 gap-3 text-emerald-500"><Loader2 className="w-6 h-6 animate-spin" /><span className="text-sm">Loading…</span></div>}
      {error && <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mb-4"><AlertCircle className="w-5 h-5" />{error}</div>}

      {!loading && !error && (<>
        {/* ── Cluster Cards ── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Semester Clusters</h2>
            <button onClick={() => setShowAddCluster(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition">
              <Plus className="w-3.5 h-3.5" /> New Cluster
            </button>
          </div>

          {/* Add cluster form */}
          {showAddCluster && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-3 flex flex-wrap items-end gap-3">
              <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Batch Year</label><input type="number" value={clusterForm.batch_year} onChange={e => setClusterForm(f => ({ ...f, batch_year: +e.target.value }))} className={`${inp} w-24 block mt-1`} /></div>
              <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Semester</label><input type="number" min={1} max={8} value={clusterForm.semester_number} onChange={e => setClusterForm(f => ({ ...f, semester_number: +e.target.value }))} className={`${inp} w-20 block mt-1`} /></div>
              <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Department</label><input value={clusterForm.department} onChange={e => setClusterForm(f => ({ ...f, department: e.target.value }))} className={`${inp} w-24 block mt-1`} /></div>
              <button onClick={handleAddCluster} disabled={clusterSaving} className="px-3 py-1.5 text-xs text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50">{clusterSaving ? 'Saving…' : 'Create'}</button>
              <button onClick={() => setShowAddCluster(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {clusters.map(c => {
              const isSelected = selectedId === c.id;
              const isEditingCluster = editClusterId === c.id;
              return (
                <div key={c.id}
                  onClick={() => { if (!isEditingCluster) setSelectedId(isSelected ? '' : c.id); }}
                  className={`relative rounded-xl border-2 p-3 cursor-pointer transition-all ${isSelected ? 'border-emerald-500 bg-emerald-50 shadow-md' : 'border-gray-200 bg-white hover:border-emerald-300 hover:shadow-sm'} ${!c.is_active ? 'opacity-50' : ''}`}
                >
                  {isEditingCluster ? (
                    <div className="space-y-2" onClick={e => e.stopPropagation()}>
                      <input type="number" value={editClusterForm.batch_year} onChange={e => setEditClusterForm(f => ({ ...f, batch_year: +e.target.value }))} className={`${inp} w-full`} />
                      <input type="number" min={1} max={8} value={editClusterForm.semester_number} onChange={e => setEditClusterForm(f => ({ ...f, semester_number: +e.target.value }))} className={`${inp} w-full`} />
                      <input value={editClusterForm.department} onChange={e => setEditClusterForm(f => ({ ...f, department: e.target.value }))} className={`${inp} w-full`} />
                      <div className="flex gap-1">
                        <button onClick={handleUpdateCluster} className="text-green-600 hover:bg-green-100 p-1 rounded"><Save className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditClusterId(null)} className="text-gray-400 hover:bg-gray-100 p-1 rounded"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ) : (<>
                    <div className="text-lg font-bold text-gray-800">Sem {c.semester_number}</div>
                    <div className="text-xs text-gray-500">{c.department ?? 'IT'} · {c.batch_year}</div>
                    <div className="flex items-center gap-1 mt-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleToggleActive(c)} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.is_active ? 'Active' : 'Inactive'}</button>
                      <button onClick={() => { setEditClusterId(c.id); setEditClusterForm({ batch_year: c.batch_year, semester_number: c.semester_number, department: c.department ?? 'IT' }); }} className="p-1 text-gray-400 hover:text-emerald-600 transition"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => handleDeleteCluster(c.id)} className="p-1 text-gray-400 hover:text-red-600 transition"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </>)}
                  {isSelected && <div className="absolute top-1 right-2 w-2 h-2 rounded-full bg-emerald-500" />}
                </div>
              );
            })}
            {clusters.length === 0 && <div className="col-span-full text-center py-8 text-gray-400 text-sm italic">No clusters yet. Create one above.</div>}
          </div>
        </div>

        {/* ── Subject Mappings Table ── */}
        {selectedId && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 flex items-center justify-between">
              <span className="text-white font-bold text-sm">
                Subjects for Sem {clusters.find(c => c.id === selectedId)?.semester_number} · {clusters.find(c => c.id === selectedId)?.department ?? 'IT'}
              </span>
              <span className="text-white/70 text-xs">{mappings.length} subjects mapped</span>
            </div>

            {mapLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-emerald-500"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading…</span></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-emerald-50 border-b-2 border-emerald-100 text-emerald-800">
                      <th className="px-3 py-2.5 text-left font-semibold w-10">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Code</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Subject Name</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Type</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Elective Basket</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Est. Enrollment</th>
                      <th className="px-3 py-2.5 text-center font-semibold w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m, idx) => {
                      const isEditing = editMapId === m.id;
                      return (
                        <tr key={m.id} className={`border-b border-gray-50 hover:bg-emerald-50/20 transition ${isEditing ? 'bg-amber-50/50' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                          <td className="px-3 py-2 text-center text-gray-400 font-mono text-xs">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono font-semibold text-indigo-700 text-xs">{m.code}</td>
                          <td className="px-3 py-2 font-medium text-gray-800">{m.name}</td>
                          <td className="px-3 py-2"><TypeBadge type={m.subject_type} /></td>
                          {isEditing ? (<>
                            <td className="px-3 py-2"><input value={editBasket} onChange={e => setEditBasket(e.target.value)} placeholder="e.g. HSMC" className={`${inp} w-full`} /></td>
                            <td className="px-3 py-2"><input type="number" min={0} value={editEnrollment} onChange={e => setEditEnrollment(+e.target.value)} className={`${inp} w-20 text-center mx-auto block`} /></td>
                            <td className="px-3 py-2"><div className="flex items-center justify-center gap-1">
                              <button onClick={handleUpdateMapping} className="p-1 text-green-600 hover:bg-green-100 rounded"><Save className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setEditMapId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="w-3.5 h-3.5" /></button>
                            </div></td>
                          </>) : (<>
                            <td className="px-3 py-2 text-xs">{m.elective_basket ? <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold">{m.elective_basket}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2 text-center font-mono text-gray-700">{m.estimated_enrollment ?? '—'}</td>
                            <td className="px-3 py-2"><div className="flex items-center justify-center gap-1">
                              <button onClick={() => startEditMap(m)} className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteMapping(m.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div></td>
                          </>)}
                        </tr>
                      );
                    })}

                    {/* Add mapping row */}
                    <tr className="bg-green-50/50 border-t-2 border-green-100">
                      <td className="px-3 py-2 text-center text-green-600 font-bold text-xs">+</td>
                      <td colSpan={2} className="px-3 py-2">
                        <select value={addSubjectId} onChange={e => setAddSubjectId(e.target.value)} className={`${inp} w-full`}>
                          <option value="">— Select Subject to Add —</option>
                          {available.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.subject_type})</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2"><input value={addBasket} onChange={e => setAddBasket(e.target.value)} placeholder="Basket" className={`${inp} w-full`} /></td>
                      <td className="px-3 py-2"><input type="number" min={0} value={addEnrollment} onChange={e => setAddEnrollment(+e.target.value)} className={`${inp} w-20 text-center mx-auto block`} /></td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={handleAddMapping} disabled={addLoading} className="p-1.5 text-green-600 hover:bg-green-100 rounded transition disabled:opacity-50">
                          {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>

                    {mappings.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 italic text-sm">No subjects mapped yet. Use the row above to add one.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="bg-gray-50 border-t border-gray-200 px-5 py-2.5 flex items-center gap-4 text-xs text-gray-500">
              <span className="font-semibold text-gray-600">Total:</span>
              <span className="font-bold text-emerald-700">{mappings.length}</span> subjects
              <span className="ml-auto flex gap-3">
                <span>Core: <b className="text-blue-700">{mappings.filter(m => m.subject_type === 'Core').length}</b></span>
                <span>Elective: <b className="text-purple-700">{mappings.filter(m => m.subject_type === 'Elective').length}</b></span>
                <span>Minor: <b className="text-orange-700">{mappings.filter(m => m.subject_type === 'Minor').length}</b></span>
              </span>
            </div>
          </div>
        )}

        {!selectedId && clusters.length > 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            <GitBranch className="w-10 h-10 mx-auto mb-3 text-gray-200" />
            Select a cluster above to manage its subject mappings
          </div>
        )}
      </>)}
    </div>
  );
}
