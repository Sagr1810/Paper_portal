import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Layout from '../../components/Layout'
import { questionsApi, masterApi } from '../../api/endpoints'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import { Search, Plus, Trash2 } from 'lucide-react'

export default function QuestionBank() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [filters, setFilters] = useState({ subject_id: '', search: '' })
  const [showForm, setShowForm] = useState(false)
  const [newQ, setNewQ] = useState({
    subject_id: '', unit_id: '', co_id: '', blooms_id: '',
    question_text: '', question_type: 'short', difficulty: 'medium', default_marks: 2, tags: '',
  })

  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: () => masterApi.subjects().then(r => r.data) })
  const { data: questions = [] } = useQuery({
    queryKey: ['questions', filters],
    queryFn: () => questionsApi.list({ subject_id: filters.subject_id || undefined, search: filters.search || undefined }).then(r => r.data),
  })
  const { data: units = [] } = useQuery({
    queryKey: ['units', newQ.subject_id],
    queryFn: () => masterApi.units(newQ.subject_id).then(r => r.data),
    enabled: !!newQ.subject_id,
  })
  const { data: cos = [] } = useQuery({
    queryKey: ['cos', newQ.subject_id],
    queryFn: () => masterApi.cos(newQ.subject_id).then(r => r.data),
    enabled: !!newQ.subject_id,
  })
  const { data: blooms = [] } = useQuery({ queryKey: ['blooms'], queryFn: () => masterApi.blooms().then(r => r.data) })

  const createMut = useMutation({
    mutationFn: (data) => questionsApi.create(data),
    onSuccess: () => { qc.invalidateQueries(['questions']); setShowForm(false); toast.success('Question added') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed'),
  })
  const deleteMut = useMutation({
    mutationFn: (id) => questionsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries(['questions']); toast.success('Question removed') },
  })

  const canEdit = ['owner', 'faculty'].includes(role)

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Question Bank</h2>
          {canEdit && (
            <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
              <Plus size={16} className="inline mr-1" /> Add Question
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="card mb-4 flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="Search questions…"
                value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} />
            </div>
          </div>
          <select className="input flex-1 min-w-48" value={filters.subject_id} onChange={e => setFilters(p => ({ ...p, subject_id: e.target.value }))}>
            <option value="">All Subjects</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.subject_code} — {s.subject_name}</option>)}
          </select>
        </div>

        {/* Add form */}
        {showForm && canEdit && (
          <div className="card mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Question Text *</label>
              <textarea className="input" rows={3} value={newQ.question_text} onChange={e => setNewQ(p => ({ ...p, question_text: e.target.value }))} />
            </div>
            <div>
              <label className="label">Subject *</label>
              <select className="input" value={newQ.subject_id} onChange={e => setNewQ(p => ({ ...p, subject_id: e.target.value, unit_id: '', co_id: '' }))}>
                <option value="">Select…</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Unit</label>
              <select className="input" value={newQ.unit_id} onChange={e => setNewQ(p => ({ ...p, unit_id: e.target.value }))}>
                <option value="">Select…</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.unit_code} — {u.unit_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Course Outcome</label>
              <select className="input" value={newQ.co_id} onChange={e => setNewQ(p => ({ ...p, co_id: e.target.value }))}>
                <option value="">Select…</option>
                {cos.map(c => <option key={c.id} value={c.id}>{c.co_code}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Bloom's Level</label>
              <select className="input" value={newQ.blooms_id} onChange={e => setNewQ(p => ({ ...p, blooms_id: e.target.value }))}>
                <option value="">Select…</option>
                {blooms.map(b => <option key={b.id} value={b.id}>{b.level_code} — {b.level_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={newQ.question_type} onChange={e => setNewQ(p => ({ ...p, question_type: e.target.value }))}>
                {['mcq','short','long','numerical','case_study'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Difficulty</label>
              <select className="input" value={newQ.difficulty} onChange={e => setNewQ(p => ({ ...p, difficulty: e.target.value }))}>
                {['easy','medium','hard'].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Marks</label>
              <input type="number" className="input" value={newQ.default_marks} onChange={e => setNewQ(p => ({ ...p, default_marks: +e.target.value }))} />
            </div>
            <div>
              <label className="label">Tags (comma-separated)</label>
              <input className="input" value={newQ.tags} onChange={e => setNewQ(p => ({ ...p, tags: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button className="btn-primary" disabled={!newQ.question_text || !newQ.subject_id || createMut.isPending}
                onClick={() => createMut.mutate({
                  ...newQ,
                  subject_id: +newQ.subject_id,
                  unit_id: newQ.unit_id ? +newQ.unit_id : null,
                  co_id: newQ.co_id ? +newQ.co_id : null,
                  blooms_id: newQ.blooms_id ? +newQ.blooms_id : null,
                  tags: newQ.tags ? newQ.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
                })}>
                Save
              </button>
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="card overflow-x-auto">
          <p className="text-sm text-gray-500 mb-3">{questions.length} questions</p>
          <table className="w-full">
            <thead>
              <tr>{['Question', 'Type', 'CO', 'Bloom\'s', 'Unit', 'Difficulty', 'Marks', canEdit ? 'Actions' : ''].filter(Boolean).map(h => <th key={h} className="table-header">{h}</th>)}</tr>
            </thead>
            <tbody>
              {questions.map(q => (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="table-cell max-w-xs">
                    <p className="line-clamp-2 text-xs">{q.question_text}</p>
                    {q.tags?.length > 0 && <div className="flex gap-1 mt-1">{q.tags.map(t => <span key={t} className="badge bg-gray-100 text-gray-600 text-xs">{t}</span>)}</div>}
                  </td>
                  <td className="table-cell capitalize">{q.question_type}</td>
                  <td className="table-cell">{q.co_code || '—'}</td>
                  <td className="table-cell">{q.blooms_code || '—'}</td>
                  <td className="table-cell">{q.unit_code || '—'}</td>
                  <td className="table-cell capitalize">{q.difficulty}</td>
                  <td className="table-cell">{q.default_marks}</td>
                  {canEdit && (
                    <td className="table-cell">
                      <button className="text-red-500 hover:text-red-700" onClick={() => deleteMut.mutate(q.id)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {questions.length === 0 && <tr><td colSpan={8} className="table-cell text-center text-gray-400">No questions found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
