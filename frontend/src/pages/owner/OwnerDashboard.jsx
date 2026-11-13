import React, { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Layout from '../../components/Layout'
import StatCard from '../../components/StatCard'
import { dashboardApi, usersApi, masterApi, auditApi } from '../../api/endpoints'
import {
  Users, BookOpen, FileText, Upload, ClipboardList,
  Building2, AlertTriangle, Download, CheckCircle, XCircle, AlertCircle, Trash2, Plus
} from 'lucide-react'
import toast from 'react-hot-toast'

const ROLE_OPTIONS = ['owner', 'principal', 'hod', 'faculty', 'exam_cell']
const ROLE_COLORS = {
  owner: 'bg-purple-100 text-purple-700',
  principal: 'bg-orange-100 text-orange-700',
  hod: 'bg-green-100 text-green-700',
  faculty: 'bg-blue-100 text-blue-700',
  exam_cell: 'bg-red-100 text-red-700',
}

export default function OwnerDashboard() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState('overview')

  // Single user form state
  const [showUserForm, setShowUserForm] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', name: '', password: '', role: 'faculty', department_id: '' })

  // Bulk upload state
  const [bulkFile, setBulkFile] = useState(null)
  const [bulkResult, setBulkResult] = useState(null)
  const [bulkFilter, setBulkFilter] = useState('all') // all | created | skipped | error
  const fileInputRef = useRef(null)

  // Queries
  const { data: summary } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.summary().then(r => r.data),
  })
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: activeTab === 'users',
  })
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => masterApi.departments().then(r => r.data),
  })
  const { data: auditLogs = [] } = useQuery({
    queryKey: ['audit'],
    queryFn: () => auditApi.list({ limit: 100 }).then(r => r.data),
    enabled: activeTab === 'audit',
  })

  // Mutations
  const createUserMut = useMutation({
    mutationFn: (data) => usersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries(['users', 'dashboard'])
      setShowUserForm(false)
      setNewUser({ email: '', name: '', password: '', role: 'faculty', department_id: '' })
      toast.success('User created successfully')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to create user'),
  })

  const deactivateMut = useMutation({
    mutationFn: (id) => usersApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries(['users', 'dashboard']); toast.success('User deactivated') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed'),
  })

  const bulkUploadMut = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('file', bulkFile)
      return usersApi.bulkUpload(fd)
    },
    onSuccess: (res) => {
      const d = res.data
      setBulkResult(d)
      qc.invalidateQueries(['users', 'dashboard'])
      if (d.errors === 0) toast.success(`${d.created} users created, ${d.skipped} skipped`)
      else toast.error(`${d.created} created, ${d.skipped} skipped, ${d.errors} errors`)
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Bulk upload failed'),
  })

  const downloadTemplate = async () => {
    try {
      const res = await usersApi.bulkTemplate()
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = 'users_template.csv'; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Failed to download template') }
  }

  // Filtered bulk results
  const filteredResults = bulkResult?.results?.filter(r =>
    bulkFilter === 'all' ? true : r.status === bulkFilter
  ) || []

  // Department state
  const [showDeptForm, setShowDeptForm] = useState(false)
  const [newDept, setNewDept] = useState({ name: '', program_type: 'bachelor' })
  const [deptDeleteConfirm, setDeptDeleteConfirm] = useState(null)

  const createDeptMut = useMutation({
    mutationFn: (data) => masterApi.createDepartment(data),
    onSuccess: () => {
      qc.invalidateQueries(['departments', 'dashboard'])
      setShowDeptForm(false)
      setNewDept({ name: '', program_type: 'bachelor' })
      toast.success('Department created')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to create department'),
  })

  const deleteDeptMut = useMutation({
    mutationFn: (id) => masterApi.deleteDepartment(id),
    onSuccess: () => {
      qc.invalidateQueries(['departments', 'dashboard'])
      setDeptDeleteConfirm(null)
      toast.success('Department deactivated')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed'),
  })

  // Subject / Unit / CO state
  const [showSubjectForm, setShowSubjectForm] = useState(false)
  const [newSubject, setNewSubject] = useState({ department_id: '', subject_code: '', subject_name: '', semester: '' })
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('')
  const [expandedSubject, setExpandedSubject] = useState(null) // subject id whose panel is open
  const [newUnit, setNewUnit] = useState({ unit_code: '', unit_name: '', weight_percent: '', description: '' })
  const [showUnitForm, setShowUnitForm] = useState(false)
  const [newCO, setNewCO] = useState({ co_code: '', description: '', po_mapping: '' })
  const [showCOForm, setShowCOForm] = useState(false)

  // Subjects list
  const { data: subjects = [], isLoading: subjectsLoading } = useQuery({
    queryKey: ['subjects', selectedDeptFilter],
    queryFn: () => masterApi.subjects(selectedDeptFilter || undefined).then(r => r.data),
    enabled: activeTab === 'subjects',
  })

  // Units + COs for the expanded subject
  const { data: units = [], refetch: refetchUnits } = useQuery({
    queryKey: ['units', expandedSubject],
    queryFn: () => masterApi.units(expandedSubject).then(r => r.data),
    enabled: !!expandedSubject,
  })
  const { data: cos = [], refetch: refetchCOs } = useQuery({
    queryKey: ['cos', expandedSubject],
    queryFn: () => masterApi.cos(expandedSubject).then(r => r.data),
    enabled: !!expandedSubject,
  })

  const createSubjectMut = useMutation({
    mutationFn: (data) => masterApi.createSubject(data),
    onSuccess: () => {
      qc.invalidateQueries(['subjects'])
      setShowSubjectForm(false)
      setNewSubject({ department_id: '', subject_code: '', subject_name: '', semester: '' })
      toast.success('Subject created')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to create subject'),
  })

  const createUnitMut = useMutation({
    mutationFn: (data) => masterApi.createUnit(data),
    onSuccess: () => {
      refetchUnits()
      setShowUnitForm(false)
      setNewUnit({ unit_code: '', unit_name: '', weight_percent: '', description: '' })
      toast.success('Unit added')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to add unit'),
  })

  const createCOMut = useMutation({
    mutationFn: (data) => masterApi.createCO(data),
    onSuccess: () => {
      refetchCOs()
      setShowCOForm(false)
      setNewCO({ co_code: '', description: '', po_mapping: '' })
      toast.success('CO added')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to add CO'),
  })

  const TABS = ['overview', 'users', 'departments', 'subjects', 'audit']

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Owner Dashboard</h2>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
                activeTab === t ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* ── Overview ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <StatCard title="Total Users"       value={summary.users}            icon={Users}         color="blue" />
            <StatCard title="Departments"        value={summary.departments}       icon={Building2}     color="purple" />
            <StatCard title="Questions"          value={summary.questions}         icon={BookOpen}      color="green" />
            <StatCard title="Papers"             value={summary.papers}            icon={FileText}      color="orange" />
            <StatCard title="Pending Approvals"  value={summary.pending_approvals} icon={AlertTriangle} color="red" />
            <StatCard title="CSV Imports"        value={summary.imports}           icon={Upload}        color="teal" />
          </div>
        )}

        {/* ── Users ────────────────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <div className="space-y-6">

            {/* ── Single user form ── */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">User Management</h3>
                <button className="btn-primary text-sm" onClick={() => setShowUserForm(v => !v)}>
                  {showUserForm ? 'Cancel' : '+ Add Single User'}
                </button>
              </div>

              {showUserForm && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-5">
                  <p className="text-xs text-gray-500 mb-3 font-medium">New User Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Full Name *</label>
                      <input className="input" placeholder="e.g. Dr. Priya Sharma"
                        value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Email *</label>
                      <input className="input" type="email" placeholder="user@college.edu"
                        value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Password * (min 8 chars)</label>
                      <input className="input" type="password" placeholder="••••••••"
                        value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Role *</label>
                      <select className="input" value={newUser.role}
                        onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Department</label>
                      <select className="input" value={newUser.department_id}
                        onChange={e => setNewUser(p => ({ ...p, department_id: e.target.value }))}>
                        <option value="">— None —</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button className="btn-primary w-full"
                        disabled={!newUser.email || !newUser.name || !newUser.password || createUserMut.isPending}
                        onClick={() => createUserMut.mutate({
                          ...newUser,
                          department_id: newUser.department_id ? +newUser.department_id : null,
                        })}>
                        {createUserMut.isPending ? 'Creating…' : 'Create User'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* User table */}
              {usersLoading ? (
                <p className="text-gray-400 text-sm py-4 text-center">Loading users…</p>
              ) : (
                <div className="overflow-x-auto">
                  <p className="text-xs text-gray-400 mb-2">{users.length} total users</p>
                  <table className="w-full">
                    <thead>
                      <tr>
                        {['ID', 'Name', 'Email', 'Role', 'Department', 'Status', 'Actions'].map(h => (
                          <th key={h} className="table-header">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-gray-50">
                          <td className="table-cell text-gray-400 font-mono text-xs">#{u.id}</td>
                          <td className="table-cell font-medium">{u.name}</td>
                          <td className="table-cell text-gray-500 text-xs">{u.email}</td>
                          <td className="table-cell">
                            <span className={`badge ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="table-cell text-gray-500 text-xs">
                            {departments.find(d => d.id === u.department_id)?.name || '—'}
                          </td>
                          <td className="table-cell">
                            <span className={`badge ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="table-cell">
                            {u.is_active && (
                              <button className="text-red-500 hover:text-red-700 text-xs font-medium"
                                onClick={() => { if (window.confirm(`Deactivate ${u.email}?`)) deactivateMut.mutate(u.id) }}>
                                Deactivate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && (
                        <tr><td colSpan={7} className="table-cell text-center text-gray-400 py-6">No users found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Bulk CSV Upload ── */}
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-1">Bulk Upload Users via CSV</h3>
              <p className="text-xs text-gray-500 mb-4">
                Upload a CSV file to create multiple users at once. Existing emails are skipped automatically.
              </p>

              {/* CSV format info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
                <p className="font-semibold mb-1">Required CSV columns:</p>
                <code className="font-mono">name, email, password, role, department_name</code>
                <p className="mt-1">Valid roles: <code>owner · principal · hod · faculty · exam_cell</code></p>
                <p className="mt-0.5"><code>department_name</code> is optional — must match exact department name or leave blank.</p>
              </div>

              {/* Download template + upload */}
              <div className="flex flex-wrap gap-3 mb-4">
                <button className="btn-secondary text-sm flex items-center gap-2" onClick={downloadTemplate}>
                  <Download size={15} /> Download Template CSV
                </button>
                <button className="btn-secondary text-sm flex items-center gap-2"
                  onClick={() => fileInputRef.current?.click()}>
                  <Upload size={15} />
                  {bulkFile ? bulkFile.name : 'Choose CSV File'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => { setBulkFile(e.target.files[0]); setBulkResult(null) }}
                />
                {bulkFile && (
                  <button
                    className="btn-primary text-sm flex items-center gap-2"
                    disabled={bulkUploadMut.isPending}
                    onClick={() => bulkUploadMut.mutate()}>
                    <Upload size={15} />
                    {bulkUploadMut.isPending ? 'Uploading…' : 'Upload & Create Users'}
                  </button>
                )}
              </div>

              {/* Result summary */}
              {bulkResult && (
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{bulkResult.total_rows}</p>
                      <p className="text-xs text-gray-500">Total Rows</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-green-700">{bulkResult.created}</p>
                      <p className="text-xs text-green-600">Created</p>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-yellow-700">{bulkResult.skipped}</p>
                      <p className="text-xs text-yellow-600">Skipped (duplicate)</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-red-700">{bulkResult.errors}</p>
                      <p className="text-xs text-red-600">Errors</p>
                    </div>
                  </div>

                  {/* Filter buttons */}
                  <div className="flex gap-2 mb-3 flex-wrap">
                    {['all','created','skipped','error'].map(f => (
                      <button key={f}
                        onClick={() => setBulkFilter(f)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          bulkFilter === f
                            ? 'bg-gray-800 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        {f === 'all' ? `All (${bulkResult.results.length})` :
                         f === 'created' ? `Created (${bulkResult.created})` :
                         f === 'skipped' ? `Skipped (${bulkResult.skipped})` :
                         `Errors (${bulkResult.errors})`}
                      </button>
                    ))}
                  </div>

                  {/* Per-row results */}
                  <div className="overflow-x-auto max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr>
                          {['Row', 'Email', 'Status', 'Message'].map(h => (
                            <th key={h} className="table-header text-xs">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredResults.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="table-cell font-mono">{r.row}</td>
                            <td className="table-cell">{r.email}</td>
                            <td className="table-cell">
                              <span className={`badge flex items-center gap-1 w-fit ${
                                r.status === 'created' ? 'bg-green-100 text-green-700' :
                                r.status === 'skipped' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {r.status === 'created' && <CheckCircle size={10} />}
                                {r.status === 'skipped' && <AlertCircle size={10} />}
                                {r.status === 'error'   && <XCircle size={10} />}
                                {r.status}
                              </span>
                            </td>
                            <td className="table-cell text-gray-500">{r.message}</td>
                          </tr>
                        ))}
                        {filteredResults.length === 0 && (
                          <tr><td colSpan={4} className="table-cell text-center text-gray-400 py-4">
                            No {bulkFilter === 'all' ? '' : bulkFilter} rows
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <button className="btn-secondary text-xs mt-3"
                    onClick={() => { setBulkFile(null); setBulkResult(null); if (fileInputRef.current) fileInputRef.current.value = '' }}>
                    Upload Another File
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Subjects + Units + COs ────────────────────────────────────── */}
        {activeTab === 'subjects' && (
          <div className="space-y-4">
            {/* ── Subject create + list card ── */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Subjects</h3>
                <button className="btn-primary text-sm" onClick={() => setShowSubjectForm(v => !v)}>
                  {showSubjectForm ? 'Cancel' : '+ Add Subject'}
                </button>
              </div>

              {showSubjectForm && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-3 font-medium">New Subject</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Department *</label>
                      <select className="input" value={newSubject.department_id}
                        onChange={e => setNewSubject(p => ({ ...p, department_id: e.target.value }))}>
                        <option value="">— Select —</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Subject Code *</label>
                      <input className="input" placeholder="e.g. CS301"
                        value={newSubject.subject_code}
                        onChange={e => setNewSubject(p => ({ ...p, subject_code: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Subject Name *</label>
                      <input className="input" placeholder="e.g. Data Structures"
                        value={newSubject.subject_name}
                        onChange={e => setNewSubject(p => ({ ...p, subject_name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Semester</label>
                      <input className="input" type="number" placeholder="e.g. 3" min="1" max="8"
                        value={newSubject.semester}
                        onChange={e => setNewSubject(p => ({ ...p, semester: e.target.value }))} />
                    </div>
                    <div className="flex items-end sm:col-span-2">
                      <button className="btn-primary"
                        disabled={!newSubject.department_id || !newSubject.subject_code || !newSubject.subject_name || createSubjectMut.isPending}
                        onClick={() => createSubjectMut.mutate({
                          department_id: +newSubject.department_id,
                          subject_code: newSubject.subject_code,
                          subject_name: newSubject.subject_name,
                          semester: newSubject.semester ? +newSubject.semester : null,
                        })}>
                        {createSubjectMut.isPending ? 'Creating…' : 'Create Subject'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 font-medium">Filter:</label>
                <select className="input w-auto text-sm" value={selectedDeptFilter}
                  onChange={e => setSelectedDeptFilter(e.target.value)}>
                  <option value="">All Departments</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              {subjectsLoading ? (
                <p className="text-gray-400 text-sm py-4 text-center">Loading…</p>
              ) : subjects.length === 0 ? (
                <p className="text-gray-400 text-sm py-4 text-center">No subjects yet. Click "+ Add Subject".</p>
              ) : (
                <div className="space-y-2">
                  {subjects.map(s => (
                    <div key={s.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      {/* Subject row — click to expand */}
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                        onClick={() => {
                          const next = expandedSubject === s.id ? null : s.id
                          setExpandedSubject(next)
                          setShowUnitForm(false)
                          setShowCOForm(false)
                        }}>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-blue-700 font-semibold text-sm">{s.subject_code}</span>
                          <span className="font-medium text-gray-900">{s.subject_name}</span>
                          <span className="text-xs text-gray-400">{departments.find(d => d.id === s.department_id)?.name}</span>
                          {s.semester && <span className="badge bg-gray-100 text-gray-600">Sem {s.semester}</span>}
                        </div>
                        <span className="text-gray-400 text-xs">{expandedSubject === s.id ? '▲ Close' : '▼ Units & COs'}</span>
                      </button>

                      {/* Expanded panel: Units + COs */}
                      {expandedSubject === s.id && (
                        <div className="border-t border-gray-200 bg-gray-50 p-4 grid grid-cols-1 md:grid-cols-2 gap-6">

                          {/* ── Units ── */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold text-gray-700">Syllabus Units</h4>
                              <button className="text-xs text-blue-600 hover:underline font-medium"
                                onClick={() => { setShowUnitForm(v => !v); setShowCOForm(false) }}>
                                {showUnitForm ? 'Cancel' : '+ Add Unit'}
                              </button>
                            </div>

                            {showUnitForm && (
                              <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="label text-xs">Unit Code *</label>
                                    <input className="input text-sm" placeholder="e.g. U1"
                                      value={newUnit.unit_code}
                                      onChange={e => setNewUnit(p => ({ ...p, unit_code: e.target.value }))} />
                                  </div>
                                  <div>
                                    <label className="label text-xs">Weight % *</label>
                                    <input className="input text-sm" type="number" placeholder="e.g. 20" min="0" max="100"
                                      value={newUnit.weight_percent}
                                      onChange={e => setNewUnit(p => ({ ...p, weight_percent: e.target.value }))} />
                                  </div>
                                </div>
                                <div>
                                  <label className="label text-xs">Unit Name *</label>
                                  <input className="input text-sm" placeholder="e.g. Arrays and Linked Lists"
                                    value={newUnit.unit_name}
                                    onChange={e => setNewUnit(p => ({ ...p, unit_name: e.target.value }))} />
                                </div>
                                <div>
                                  <label className="label text-xs">Description</label>
                                  <input className="input text-sm" placeholder="Optional description"
                                    value={newUnit.description}
                                    onChange={e => setNewUnit(p => ({ ...p, description: e.target.value }))} />
                                </div>
                                <button className="btn-primary text-xs w-full"
                                  disabled={!newUnit.unit_code || !newUnit.unit_name || createUnitMut.isPending}
                                  onClick={() => createUnitMut.mutate({
                                    subject_id: s.id,
                                    unit_code: newUnit.unit_code,
                                    unit_name: newUnit.unit_name,
                                    weight_percent: newUnit.weight_percent ? +newUnit.weight_percent : 0,
                                    description: newUnit.description || null,
                                  })}>
                                  {createUnitMut.isPending ? 'Adding…' : 'Add Unit'}
                                </button>
                              </div>
                            )}

                            {units.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">No units yet.</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr>
                                    <th className="table-header text-xs">Code</th>
                                    <th className="table-header text-xs">Name</th>
                                    <th className="table-header text-xs">Weight %</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {units.map(u => (
                                    <tr key={u.id} className="hover:bg-white">
                                      <td className="table-cell font-mono text-xs text-blue-600">{u.unit_code}</td>
                                      <td className="table-cell text-xs">{u.unit_name}</td>
                                      <td className="table-cell text-xs text-right font-semibold">{u.weight_percent}%</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>

                          {/* ── Course Outcomes ── */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold text-gray-700">Course Outcomes (COs)</h4>
                              <button className="text-xs text-blue-600 hover:underline font-medium"
                                onClick={() => { setShowCOForm(v => !v); setShowUnitForm(false) }}>
                                {showCOForm ? 'Cancel' : '+ Add CO'}
                              </button>
                            </div>

                            {showCOForm && (
                              <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="label text-xs">CO Code *</label>
                                    <input className="input text-sm" placeholder="e.g. CO1"
                                      value={newCO.co_code}
                                      onChange={e => setNewCO(p => ({ ...p, co_code: e.target.value }))} />
                                  </div>
                                  <div>
                                    <label className="label text-xs">PO Mapping</label>
                                    <input className="input text-sm" placeholder="e.g. PO1,PO2"
                                      value={newCO.po_mapping}
                                      onChange={e => setNewCO(p => ({ ...p, po_mapping: e.target.value }))} />
                                  </div>
                                </div>
                                <div>
                                  <label className="label text-xs">Description *</label>
                                  <input className="input text-sm" placeholder="e.g. Apply sorting algorithms"
                                    value={newCO.description}
                                    onChange={e => setNewCO(p => ({ ...p, description: e.target.value }))} />
                                </div>
                                <button className="btn-primary text-xs w-full"
                                  disabled={!newCO.co_code || !newCO.description || createCOMut.isPending}
                                  onClick={() => createCOMut.mutate({
                                    subject_id: s.id,
                                    co_code: newCO.co_code,
                                    description: newCO.description,
                                    po_mapping: newCO.po_mapping || null,
                                  })}>
                                  {createCOMut.isPending ? 'Adding…' : 'Add CO'}
                                </button>
                              </div>
                            )}

                            {cos.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">No COs yet.</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr>
                                    <th className="table-header text-xs">Code</th>
                                    <th className="table-header text-xs">Description</th>
                                    <th className="table-header text-xs">PO</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cos.map(c => (
                                    <tr key={c.id} className="hover:bg-white">
                                      <td className="table-cell font-mono text-xs text-purple-600 font-semibold">{c.co_code}</td>
                                      <td className="table-cell text-xs">{c.description}</td>
                                      <td className="table-cell text-xs text-gray-400">{c.po_mapping || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>

                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Departments ──────────────────────────────────────────────── */}
        {activeTab === 'departments' && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Departments ({departments.length})</h3>
              <button className="btn-primary text-sm flex items-center gap-1" onClick={() => setShowDeptForm(v => !v)}>
                {showDeptForm ? 'Cancel' : '+ Add Department / College'}
              </button>
            </div>

            {showDeptForm && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-xs text-gray-500 font-medium">New Department / College</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Department / College Name *</label>
                    <input className="input" placeholder="e.g. Computer Science & Engineering"
                      value={newDept.name}
                      onChange={e => setNewDept(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Program Type</label>
                    <select className="input" value={newDept.program_type}
                      onChange={e => setNewDept(p => ({ ...p, program_type: e.target.value }))}>
                      <option value="bachelor">Bachelor</option>
                      <option value="master">Master</option>
                    </select>
                  </div>
                  <div className="flex items-end sm:col-span-2">
                    <button className="btn-primary"
                      disabled={!newDept.name.trim() || createDeptMut.isPending}
                      onClick={() => createDeptMut.mutate({ name: newDept.name.trim(), program_type: newDept.program_type })}>
                      {createDeptMut.isPending ? 'Creating…' : 'Create Department'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {deptDeleteConfirm && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4">
                <div className="text-sm text-red-800 font-medium flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-500" />
                  Deactivate "{departments.find(d => d.id === deptDeleteConfirm)?.name}"? Users in this department won't be affected.
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700"
                    disabled={deleteDeptMut.isPending}
                    onClick={() => deleteDeptMut.mutate(deptDeleteConfirm)}>
                    {deleteDeptMut.isPending ? 'Deactivating…' : 'Deactivate'}
                  </button>
                  <button className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200"
                    onClick={() => setDeptDeleteConfirm(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {departments.map(d => (
                <div key={d.id} className="border border-gray-200 rounded-lg p-4 relative">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{d.name}</p>
                      <p className="text-xs text-gray-400 capitalize mt-0.5">{d.program_type} program</p>
                    </div>
                    {d.is_active && (
                      <button
                        className="text-gray-300 hover:text-red-500 transition-colors ml-2 shrink-0"
                        title="Deactivate department"
                        onClick={() => setDeptDeleteConfirm(d.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <span className={`badge mt-2 ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {d.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
              {departments.length === 0 && <p className="text-gray-400 text-sm">No departments found</p>}
            </div>
          </div>
        )}

        {/* ── Audit Log ────────────────────────────────────────────────── */}
        {activeTab === 'audit' && (
          <div className="card">
            <h3 className="font-semibold mb-4">Audit Log (last 100 actions)</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Time', 'Action', 'Resource', 'Resource ID', 'Details'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="table-cell text-gray-400 text-xs whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="table-cell">
                        <span className="badge bg-gray-100 text-gray-700">{log.action}</span>
                      </td>
                      <td className="table-cell text-gray-600">{log.resource_type || '—'}</td>
                      <td className="table-cell text-gray-400 font-mono text-xs">{log.resource_id ?? '—'}</td>
                      <td className="table-cell text-xs text-gray-500 max-w-xs truncate">
                        {log.detail_json ? JSON.stringify(log.detail_json) : '—'}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr><td colSpan={5} className="table-cell text-center text-gray-400 py-6">No audit logs yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
