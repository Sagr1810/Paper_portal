import React, { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Layout from '../../components/Layout'
import StatCard from '../../components/StatCard'
import { dashboardApi, usersApi, masterApi, auditApi } from '../../api/endpoints'
import {
  Users, BookOpen, FileText, Upload, ClipboardList,
  Building2, AlertTriangle, Download, CheckCircle, XCircle, AlertCircle, Trash2, Plus, Pencil
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
  const [newUser, setNewUser] = useState({ email: '', name: '', password: '', role: 'faculty', college_id: '', department_id: '' })

  // User list: filters, selection, delete / bulk actions
  const [userFilters, setUserFilters] = useState({ q: '', college: '', department: '', role: '', status: 'all' })
  const [selectedIds, setSelectedIds] = useState([])
  const [userConfirm, setUserConfirm] = useState(null)        // { action, ids }
  const [userActionResult, setUserActionResult] = useState(null)
  const [purgeConfirm, setPurgeConfirm] = useState(null)      // { ids } while the "delete with data" box is open
  const [purgeAck, setPurgeAck] = useState(false)

  // What would be lost for each user in the open "delete with data" box
  const { data: purgeInfo, isLoading: purgeLoading, isError: purgeError } = useQuery({
    queryKey: ['purge-footprint', purgeConfirm?.ids],
    queryFn: () => Promise.all(purgeConfirm.ids.map(id => usersApi.footprint(id).then(r => r.data))),
    enabled: !!purgeConfirm,
    gcTime: 0,
    retry: false,
  })
  const purgeRows = purgeInfo || []
  const purgeEligible = purgeRows.filter(f => f.can_purge)
  const purgePapers = purgeEligible.reduce((n, f) => n + f.papers, 0)
  const purgeFinalized = purgeEligible.reduce((n, f) => n + (f.papers_by_status?.finalized || 0), 0)

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
  const { data: colleges = [] } = useQuery({
    queryKey: ['colleges'],
    queryFn: () => masterApi.colleges().then(r => r.data),
  })
  const collegeName = (id) => colleges.find(c => c.id === id)?.name || '—'
  // Role rules: principal / exam_cell -> college only; hod / faculty -> college + department
  const needsCollege = (role) => role !== 'owner'
  const needsDept = (role) => role === 'hod' || role === 'faculty'

  // User list filtering + selection (owner accounts are protected, never selectable)
  const ALL_ROLES = ['owner', 'principal', 'hod', 'faculty', 'exam_cell']
  const updateUserFilter = (patch) => {
    setUserFilters(p => ({ ...p, ...patch }))
    setSelectedIds([])
  }
  const filteredUsers = users.filter(u => {
    const f = userFilters
    if (f.college && String(u.college_id ?? '') !== f.college) return false
    if (f.department && String(u.department_id ?? '') !== f.department) return false
    if (f.role && u.role !== f.role) return false
    if (f.status === 'active' && !u.is_active) return false
    if (f.status === 'inactive' && u.is_active) return false
    if (f.q) {
      const q = f.q.toLowerCase()
      if (!(u.name || '').toLowerCase().includes(q) && !(u.email || '').toLowerCase().includes(q)) return false
    }
    return true
  })
  const selectableUsers = filteredUsers.filter(u => u.role !== 'owner')
  const allSelected = selectableUsers.length > 0 && selectableUsers.every(u => selectedIds.includes(u.id))
  const toggleUser = (id) => setSelectedIds(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const toggleAllUsers = () => setSelectedIds(allSelected ? [] : selectableUsers.map(u => u.id))
  const filtersActive = !!(userFilters.q || userFilters.college || userFilters.department || userFilters.role || userFilters.status !== 'all')
  const userLabel = (id) => users.find(u => u.id === id)
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
      setNewUser({ email: '', name: '', password: '', role: 'faculty', college_id: '', department_id: '' })
      toast.success('User created successfully')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to create user'),
  })

  const deactivateMut = useMutation({
    mutationFn: (id) => usersApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries(['users', 'dashboard']); toast.success('User deactivated') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed'),
  })

  const userActionMut = useMutation({
    mutationFn: ({ action, ids, confirm }) => usersApi.bulkAction(action, ids, confirm),
    onSuccess: (res, vars) => {
      qc.invalidateQueries()
      setUserConfirm(null)
      setPurgeConfirm(null)
      setSelectedIds([])
      setUserActionResult({ action: vars.action, ...res.data })
      const sm = res.data.summary || {}
      const done = (sm.deleted || 0) + (sm.purged || 0) + (sm.deactivated || 0) + (sm.activated || 0)
      const verb = { delete: 'deleted', purge: 'deleted', deactivate: 'deactivated', activate: 'activated' }[vars.action]
      if (done) toast.success(`${done} user${done === 1 ? '' : 's'} ${verb}`)
      else toast.error('No users were changed')
    },
    onError: (e) => {
      setUserConfirm(null)
      setPurgeConfirm(null)
      toast.error(e.response?.data?.detail || 'Action failed')
    },
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
  const [newDept, setNewDept] = useState({ college_id: '', name: '', program_type: 'bachelor' })
  const [deptDeleteConfirm, setDeptDeleteConfirm] = useState(null)

  const createDeptMut = useMutation({
    mutationFn: (data) => masterApi.createDepartment(data),
    onSuccess: () => {
      qc.invalidateQueries(['departments', 'dashboard'])
      setShowDeptForm(false)
      setNewDept({ college_id: '', name: '', program_type: 'bachelor' })
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

  // College state
  const [showCollegeForm, setShowCollegeForm] = useState(false)
  const [newCollegeName, setNewCollegeName] = useState('')
  const [editingCollege, setEditingCollege] = useState(null) // { id, name }
  const [collegeDeleteConfirm, setCollegeDeleteConfirm] = useState(null)

  const createCollegeMut = useMutation({
    mutationFn: (data) => masterApi.createCollege(data),
    onSuccess: () => {
      qc.invalidateQueries()
      setShowCollegeForm(false)
      setNewCollegeName('')
      toast.success('College created')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to create college'),
  })

  const updateCollegeMut = useMutation({
    mutationFn: ({ id, name }) => masterApi.updateCollege(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries()
      setEditingCollege(null)
      toast.success('College renamed')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to rename college'),
  })

  const deleteCollegeMut = useMutation({
    mutationFn: (id) => masterApi.deleteCollege(id),
    onSuccess: () => {
      qc.invalidateQueries()
      setCollegeDeleteConfirm(null)
      toast.success('College deactivated')
    },
    onError: (e) => {
      setCollegeDeleteConfirm(null)
      toast.error(e.response?.data?.detail || 'Failed to deactivate college')
    },
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

  const TABS = ['overview', 'colleges', 'departments', 'users', 'subjects', 'audit']

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
            <StatCard title="Colleges"           value={summary.colleges}          icon={Building2}     color="teal" />
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
                        onChange={e => setNewUser(p => ({ ...p, role: e.target.value, department_id: needsDept(e.target.value) ? p.department_id : '' }))}>
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    {needsCollege(newUser.role) && (
                      <div>
                        <label className="label">College *</label>
                        <select className="input" value={newUser.college_id}
                          onChange={e => setNewUser(p => ({ ...p, college_id: e.target.value, department_id: '' }))}>
                          <option value="">— Select college —</option>
                          {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                    {needsDept(newUser.role) && (
                      <div>
                        <label className="label">Department *</label>
                        <select className="input" value={newUser.department_id} disabled={!newUser.college_id}
                          onChange={e => setNewUser(p => ({ ...p, department_id: e.target.value }))}>
                          <option value="">{newUser.college_id ? '— Select department —' : 'Select a college first'}</option>
                          {departments
                            .filter(d => String(d.college_id) === String(newUser.college_id))
                            .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="sm:col-span-2 text-xs text-gray-500">
                      Principal and Exam Cell belong to a college only. HOD and Faculty belong to a college and a department.
                      {colleges.length === 0 && (
                        <span className="text-red-600"> No colleges yet. Create one in the Colleges tab first.</span>
                      )}
                    </div>
                    <div className="flex items-end">
                      <button className="btn-primary w-full"
                        disabled={
                          !newUser.email || !newUser.name || !newUser.password || createUserMut.isPending ||
                          (needsCollege(newUser.role) && !newUser.college_id) ||
                          (needsDept(newUser.role) && !newUser.department_id)
                        }
                        onClick={() => createUserMut.mutate({
                          ...newUser,
                          college_id: newUser.college_id ? +newUser.college_id : null,
                          department_id: needsDept(newUser.role) && newUser.department_id ? +newUser.department_id : null,
                        })}>
                        {createUserMut.isPending ? 'Creating…' : 'Create User'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="flex flex-wrap gap-3 items-end mb-3">
                <div className="flex-1 min-w-[12rem]">
                  <label className="label">Search</label>
                  <input className="input" placeholder="Name or email" value={userFilters.q}
                    onChange={e => updateUserFilter({ q: e.target.value })} />
                </div>
                <div>
                  <label className="label">College</label>
                  <select className="input" aria-label="Filter by college" value={userFilters.college}
                    onChange={e => updateUserFilter({ college: e.target.value, department: '' })}>
                    <option value="">All colleges</option>
                    {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Department</label>
                  <select className="input" aria-label="Filter by department" value={userFilters.department}
                    onChange={e => updateUserFilter({ department: e.target.value })}>
                    <option value="">All departments</option>
                    {departments
                      .filter(d => !userFilters.college || String(d.college_id) === userFilters.college)
                      .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Role</label>
                  <select className="input" aria-label="Filter by role" value={userFilters.role}
                    onChange={e => updateUserFilter({ role: e.target.value })}>
                    <option value="">All roles</option>
                    {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input" aria-label="Filter by status" value={userFilters.status}
                    onChange={e => updateUserFilter({ status: e.target.value })}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                {filtersActive && (
                  <button className="btn-secondary text-sm"
                    onClick={() => { setUserFilters({ q: '', college: '', department: '', role: '', status: 'all' }); setSelectedIds([]) }}>
                    Clear filters
                  </button>
                )}
              </div>

              {/* Bulk action bar */}
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3">
                  <span className="text-sm font-medium text-blue-900">{selectedIds.length} selected</span>
                  <button className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50"
                    onClick={() => setUserConfirm({ action: 'deactivate', ids: selectedIds })}>Deactivate</button>
                  <button className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50"
                    onClick={() => setUserConfirm({ action: 'activate', ids: selectedIds })}>Activate</button>
                  <button className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 flex items-center gap-1"
                    onClick={() => setUserConfirm({ action: 'delete', ids: selectedIds })}>
                    <Trash2 size={12} /> Delete selected
                  </button>
                  <button className="text-xs bg-white border border-red-400 text-red-700 px-3 py-1.5 rounded hover:bg-red-50 flex items-center gap-1"
                    onClick={() => { setPurgeAck(false); setUserConfirm(null); setPurgeConfirm({ ids: selectedIds }) }}>
                    <Trash2 size={12} /> Delete with their data
                  </button>
                  <button className="text-xs text-gray-500 hover:text-gray-700 ml-auto" onClick={() => setSelectedIds([])}>Clear selection</button>
                </div>
              )}

              {/* Confirm */}
              {userConfirm && (
                <div className={`border rounded-lg p-4 mb-3 ${userConfirm.action === 'delete' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-sm">
                      <p className="font-medium flex items-center gap-2">
                        <AlertTriangle size={16} className={userConfirm.action === 'delete' ? 'text-red-500' : 'text-yellow-600'} />
                        {userConfirm.action === 'delete' ? 'Permanently delete' : userConfirm.action === 'deactivate' ? 'Deactivate' : 'Activate'}{' '}
                        {userConfirm.ids.length} user{userConfirm.ids.length === 1 ? '' : 's'}?
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        {userConfirm.ids.slice(0, 5).map(id => userLabel(id)?.name || `#${id}`).join(', ')}
                        {userConfirm.ids.length > 5 ? ` and ${userConfirm.ids.length - 5} more` : ''}
                      </p>
                      {userConfirm.action === 'delete' && (
                        <p className="text-xs text-red-700 mt-1">
                          This cannot be undone. Users who created papers, questions or templates can't be deleted; they will be listed so you can deactivate them instead.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className={`text-xs text-white px-3 py-1.5 rounded ${userConfirm.action === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                        disabled={userActionMut.isPending}
                        onClick={() => userActionMut.mutate(userConfirm)}>
                        {userActionMut.isPending ? 'Working…' : 'Confirm'}
                      </button>
                      <button className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200"
                        onClick={() => setUserConfirm(null)}>Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete with data: shows exactly what will be lost */}
              {purgeConfirm && (
                <div className="border border-red-300 bg-red-50 rounded-lg p-4 mb-3 text-sm">
                  <p className="font-semibold text-red-800 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-red-500" />
                    Delete {purgeConfirm.ids.length} user{purgeConfirm.ids.length === 1 ? '' : 's'} and everything they created?
                  </p>
                  {purgeLoading && <p className="text-xs text-gray-600 mt-2">Checking what would be lost…</p>}
                  {purgeError && <p className="text-xs text-red-700 mt-2">Could not check these users. Owner accounts can't be deleted.</p>}
                  {!purgeLoading && !purgeError && purgeRows.length > 0 && (
                    <div className="mt-3 space-y-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-1 pr-3">User</th><th className="py-1 pr-3">Papers deleted</th><th className="py-1">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purgeRows.map(f => (
                            <tr key={f.user_id} className="border-t border-red-200 align-top">
                              <td className="py-1 pr-3">{f.name} <span className="text-gray-400">({f.role})</span></td>
                              <td className="py-1 pr-3">
                                {f.can_purge ? (
                                  <>
                                    <b>{f.papers}</b>
                                    {(f.papers_by_status?.finalized || 0) > 0 && (
                                      <span className="text-red-700"> ({f.papers_by_status.finalized} finalized)</span>
                                    )}
                                  </>
                                ) : '—'}
                              </td>
                              <td className="py-1 text-gray-600">
                                {f.can_purge
                                  ? (f.history_kept > 0 ? `${f.history_kept} action(s) on other people's papers stay, without a name` : '')
                                  : <span className="text-red-700">Can't be deleted: has {f.blockers.join(', ')}. Remove or reassign them first.</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {purgeEligible.length > 0 ? (
                        <>
                          <p className="text-red-800">
                            This permanently deletes <b>{purgeEligible.length}</b> user{purgeEligible.length === 1 ? '' : 's'} and
                            <b> {purgePapers}</b> paper{purgePapers === 1 ? '' : 's'}
                            {purgeFinalized > 0 ? <> (including <b>{purgeFinalized}</b> finalized)</> : null}, with all their questions, marks and comments. It cannot be undone.
                          </p>
                          <label className="flex items-center gap-2 text-red-900">
                            <input type="checkbox" checked={purgeAck} onChange={e => setPurgeAck(e.target.checked)} />
                            I understand this cannot be undone
                          </label>
                        </>
                      ) : (
                        <p className="text-red-800">None of these users can be deleted this way.</p>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button className="text-xs bg-red-700 text-white px-3 py-1.5 rounded hover:bg-red-800 disabled:opacity-50"
                      disabled={!purgeAck || purgeEligible.length === 0 || userActionMut.isPending}
                      onClick={() => userActionMut.mutate({ action: 'purge', ids: purgeEligible.map(f => f.user_id), confirm: true })}>
                      {userActionMut.isPending ? 'Deleting…' : `Delete ${purgeEligible.length} user${purgeEligible.length === 1 ? '' : 's'} and ${purgePapers} paper${purgePapers === 1 ? '' : 's'}`}
                    </button>
                    <button className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200"
                      onClick={() => setPurgeConfirm(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Result of the last action */}
              {userActionResult && (
                <div className="border border-gray-200 rounded-lg p-4 mb-3 bg-gray-50 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">
                      {Object.entries(userActionResult.summary || {}).map(([k, v]) => `${v} ${k}`).join(' · ')}
                    </p>
                    <button className="text-xs text-gray-500 hover:text-gray-700" onClick={() => setUserActionResult(null)}>Dismiss</button>
                  </div>
                  {userActionResult.results.filter(r => r.status === 'blocked' || r.status === 'skipped' || r.status === 'error' || r.status === 'purged').map(r => (
                    <p key={r.id} className="text-xs text-gray-600 mt-1">
                      <span className="font-medium">{r.name || r.email || `#${r.id}`}</span>: {r.message}
                    </p>
                  ))}
                  {userActionResult.action === 'delete' && userActionResult.results.some(r => r.status === 'blocked') && (
                    <button className="mt-3 text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50"
                      onClick={() => setUserConfirm({
                        action: 'deactivate',
                        ids: userActionResult.results.filter(r => r.status === 'blocked').map(r => r.id),
                      })}>
                      Deactivate the blocked users instead
                    </button>
                  )}
                  {userActionResult.action === 'delete' && userActionResult.results.some(r => r.status === 'blocked') && (
                    <button className="mt-3 ml-2 text-xs bg-white border border-red-400 text-red-700 px-3 py-1.5 rounded hover:bg-red-50"
                      onClick={() => {
                        setPurgeAck(false); setUserConfirm(null)
                        setPurgeConfirm({ ids: userActionResult.results.filter(r => r.status === 'blocked').map(r => r.id) })
                      }}>
                      Delete them with their data…
                    </button>
                  )}
                </div>
              )}

              {/* User table */}
              {usersLoading ? (
                <p className="text-gray-400 text-sm py-4 text-center">Loading users…</p>
              ) : (
                <div className="overflow-x-auto">
                  <p className="text-xs text-gray-400 mb-2">
                    Showing {filteredUsers.length} of {users.length} users
                  </p>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header w-8">
                          <input type="checkbox" aria-label="Select all shown users"
                            checked={allSelected} disabled={selectableUsers.length === 0}
                            onChange={toggleAllUsers} />
                        </th>
                        {['ID', 'Name', 'Email', 'Role', 'College', 'Department', 'Status', 'Actions'].map(h => (
                          <th key={h} className="table-header">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map(u => (
                        <tr key={u.id} className={`hover:bg-gray-50 ${selectedIds.includes(u.id) ? 'bg-blue-50' : ''}`}>
                          <td className="table-cell">
                            <input type="checkbox" aria-label={`Select ${u.name}`}
                              checked={selectedIds.includes(u.id)} disabled={u.role === 'owner'}
                              onChange={() => toggleUser(u.id)} />
                          </td>
                          <td className="table-cell text-gray-400 font-mono text-xs">#{u.id}</td>
                          <td className="table-cell font-medium">{u.name}</td>
                          <td className="table-cell text-gray-500 text-xs">{u.email}</td>
                          <td className="table-cell">
                            <span className={`badge ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="table-cell text-gray-500 text-xs">
                            {u.college_id ? collegeName(u.college_id) : '—'}
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
                            {u.role !== 'owner' && (
                              <div className="flex gap-3">
                                {u.is_active ? (
                                  <button className="text-yellow-600 hover:text-yellow-800 text-xs font-medium"
                                    onClick={() => setUserConfirm({ action: 'deactivate', ids: [u.id] })}>
                                    Deactivate
                                  </button>
                                ) : (
                                  <button className="text-green-600 hover:text-green-800 text-xs font-medium"
                                    onClick={() => setUserConfirm({ action: 'activate', ids: [u.id] })}>
                                    Activate
                                  </button>
                                )}
                                <button className="text-red-500 hover:text-red-700 text-xs font-medium"
                                  onClick={() => setUserConfirm({ action: 'delete', ids: [u.id] })}>
                                  Delete
                                </button>
                                <button className="text-red-700 hover:text-red-900 text-xs font-medium"
                                  title="Delete this user together with the papers they created"
                                  onClick={() => { setPurgeAck(false); setUserConfirm(null); setPurgeConfirm({ ids: [u.id] }) }}>
                                  Delete + data
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filteredUsers.length === 0 && (
                        <tr><td colSpan={9} className="table-cell text-center text-gray-400 py-6">No users found</td></tr>
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
                <code className="font-mono">name, email, password, role, college_name, department_name</code>
                <p className="mt-1">Valid roles: <code>owner · principal · hod · faculty · exam_cell</code></p>
                <p className="mt-0.5"><code>college_name</code> is required for every role except owner and must match an existing college exactly.</p>
                <p className="mt-0.5"><code>department_name</code> is required for <code>hod</code> and <code>faculty</code> (a department of that college); leave it blank for <code>principal</code> and <code>exam_cell</code>.</p>
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
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name} — {collegeName(d.college_id)}</option>)}
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
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name} — {collegeName(d.college_id)}</option>)}
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
        {/* ── Colleges ─────────────────────────────────────────────────── */}
        {activeTab === 'colleges' && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Colleges ({colleges.length})</h3>
              <button className="btn-primary text-sm" onClick={() => setShowCollegeForm(v => !v)}>
                {showCollegeForm ? 'Cancel' : '+ Add College'}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Set up in this order: <b>1. College</b> → <b>2. Departments</b> of that college → <b>3. Users</b>.
            </p>

            {showCollegeForm && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-xs text-gray-500 font-medium">New College</p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[16rem]">
                    <label className="label">College Name *</label>
                    <input className="input" placeholder="e.g. L.D. College of Engineering"
                      value={newCollegeName}
                      onChange={e => setNewCollegeName(e.target.value)} />
                  </div>
                  <button className="btn-primary"
                    disabled={!newCollegeName.trim() || createCollegeMut.isPending}
                    onClick={() => createCollegeMut.mutate({ name: newCollegeName.trim() })}>
                    {createCollegeMut.isPending ? 'Creating…' : 'Create College'}
                  </button>
                </div>
              </div>
            )}

            {collegeDeleteConfirm && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4">
                <div className="text-sm text-red-800 font-medium flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-500" />
                  Deactivate "{colleges.find(c => c.id === collegeDeleteConfirm)?.name}"? Its departments and users must be deactivated first.
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700"
                    disabled={deleteCollegeMut.isPending}
                    onClick={() => deleteCollegeMut.mutate(collegeDeleteConfirm)}>
                    {deleteCollegeMut.isPending ? 'Deactivating…' : 'Deactivate'}
                  </button>
                  <button className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200"
                    onClick={() => setCollegeDeleteConfirm(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {colleges.map(c => (
                <div key={c.id} className="border border-gray-200 rounded-lg p-4">
                  {editingCollege?.id === c.id ? (
                    <div className="space-y-2">
                      <input className="input" value={editingCollege.name}
                        onChange={e => setEditingCollege({ id: c.id, name: e.target.value })} />
                      <div className="flex gap-2">
                        <button className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
                          disabled={!editingCollege.name.trim() || updateCollegeMut.isPending}
                          onClick={() => updateCollegeMut.mutate({ id: c.id, name: editingCollege.name.trim() })}>
                          Save
                        </button>
                        <button className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200"
                          onClick={() => setEditingCollege(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{c.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {departments.filter(d => d.college_id === c.id).length} department(s)
                        </p>
                      </div>
                      <div className="flex gap-2 ml-2 shrink-0">
                        <button className="text-gray-300 hover:text-blue-500 transition-colors" title="Rename college"
                          onClick={() => setEditingCollege({ id: c.id, name: c.name })}>
                          <Pencil size={14} />
                        </button>
                        <button className="text-gray-300 hover:text-red-500 transition-colors" title="Deactivate college"
                          onClick={() => setCollegeDeleteConfirm(c.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {colleges.length === 0 && <p className="text-gray-400 text-sm">No colleges yet. Click "+ Add College" to start.</p>}
            </div>
          </div>
        )}

        {activeTab === 'departments' && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Departments ({departments.length})</h3>
              <button className="btn-primary text-sm flex items-center gap-1" onClick={() => setShowDeptForm(v => !v)}>
                {showDeptForm ? 'Cancel' : '+ Add Department'}
              </button>
            </div>

            {showDeptForm && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-xs text-gray-500 font-medium">New Department</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">College *</label>
                    <select className="input" value={newDept.college_id}
                      onChange={e => setNewDept(p => ({ ...p, college_id: e.target.value }))}>
                      <option value="">— Select college —</option>
                      {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {colleges.length === 0 && (
                      <p className="text-xs text-red-600 mt-1">Create a college first in the Colleges tab.</p>
                    )}
                  </div>
                  <div>
                    <label className="label">Department Name *</label>
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
                      disabled={!newDept.college_id || !newDept.name.trim() || createDeptMut.isPending}
                      onClick={() => createDeptMut.mutate({
                        college_id: +newDept.college_id,
                        name: newDept.name.trim(),
                        program_type: newDept.program_type,
                      })}>
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
                      <p className="text-xs text-blue-600 mt-0.5">{collegeName(d.college_id)}</p>
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
