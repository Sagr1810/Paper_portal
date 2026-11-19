import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import StatusBadge from './StatusBadge'
import { papersApi } from '../api/endpoints'
import { Download, Eye } from 'lucide-react'

// One row per paper the signed-in user is allowed to see (the server applies the
// college / department rules for each role).
export function usePaperDirectory() {
  return useQuery({
    queryKey: ['paper-directory'],
    queryFn: () => papersApi.directory().then(r => r.data),
  })
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`            // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(rows) {
  const header = ['Sr No', 'Faculty Name', 'Subject Code', 'Subject Name', 'Program', 'Semester', 'Department', 'Paper Title', 'Status', 'Latest Exam Cell Comment', 'Comment By']
  const lines = [
    header,
    ...rows.map((r, i) => [i + 1, r.faculty_name, r.subject_code, r.subject_name, r.program, r.semester, r.department_name, r.title, r.status, r.latest_comment, r.latest_comment_by]),
  ]
  return '\uFEFF' + lines.map(l => l.map(csvCell).join(',')).join('\r\n')
}

function downloadCsv(rows) {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `papers_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function PaperDirectory({ rows = [], loading = false, showDepartment = false, selectedRowId = null, onSelectRow }) {
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ q: '', status: '', department: '', faculty: '', semester: '', program: '' })
  const [checked, setChecked] = useState([])
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')

  const update = (patch) => { setFilters(p => ({ ...p, ...patch })); setChecked([]) }

  const statuses = useMemo(() => [...new Set(rows.map(r => r.status))].sort(), [rows])
  const departments = useMemo(() => {
    const m = new Map()
    rows.forEach(r => { if (r.department_id) m.set(r.department_id, r.department_name) })
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  }, [rows])
  const facultyNames = useMemo(() => [...new Set(rows.map(r => r.faculty_name).filter(Boolean))].sort(), [rows])
  const programs = useMemo(() => [...new Set(rows.map(r => r.program).filter(Boolean))].sort(), [rows])
  const semesters = useMemo(() => [...new Set(rows.map(r => r.semester).filter(v => v !== null && v !== undefined))].sort((a, b) => a - b), [rows])

  const filtered = rows.filter(r => {
    if (filters.semester && String(r.semester ?? '') !== filters.semester) return false
    if (filters.program && (r.program || '') !== filters.program) return false
    if (filters.status && r.status !== filters.status) return false
    if (filters.department && String(r.department_id) !== filters.department) return false
    if (filters.faculty && r.faculty_name !== filters.faculty) return false
    if (filters.q) {
      const q = filters.q.toLowerCase()
      const hay = [r.faculty_name, r.subject_code, r.subject_name, r.title, r.latest_comment].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const sortVal = (r) => {
    if (sortKey === 'faculty') return (r.faculty_name || '').toLowerCase()
    if (sortKey === 'subject') return (r.subject_code || '').toLowerCase()
    if (sortKey === 'program') return (r.program || '').toLowerCase()
    if (sortKey === 'semester') return r.semester ?? 999
    if (sortKey === 'department') return (r.department_name || '').toLowerCase()
    return r.status || ''
  }
  const shown = sortKey ? [...filtered].sort((a, b) => {
    const x = sortVal(a), y = sortVal(b)
    const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
    return sortDir === 'asc' ? c : -c
  }) : filtered

  const allChecked = shown.length > 0 && shown.every(r => checked.includes(r.id))
  const toggle = (id) => setChecked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const toggleAll = () => setChecked(allChecked ? [] : shown.map(r => r.id))
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const mark = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')
  const filtersActive = !!(filters.q || filters.status || filters.department || filters.faculty || filters.semester || filters.program)
  const colCount = showDepartment ? 10 : 9

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="label">Search</label>
          <input className="input" placeholder="Faculty, subject code, title or comment"
            value={filters.q} onChange={e => update({ q: e.target.value })} />
        </div>
        {showDepartment && (
          <div>
            <label className="label">Department</label>
            <select className="input" aria-label="Filter by department" value={filters.department}
              onChange={e => update({ department: e.target.value })}>
              <option value="">All departments</option>
              {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Faculty</label>
          <select className="input" aria-label="Filter by faculty" value={filters.faculty}
            onChange={e => update({ faculty: e.target.value })}>
            <option value="">All faculty</option>
            {facultyNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" aria-label="Filter by status" value={filters.status}
            onChange={e => update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Semester</label>
          <select className="input" aria-label="Filter by semester" value={filters.semester}
            onChange={e => update({ semester: e.target.value })}>
            <option value="">All semesters</option>
            {semesters.map(n => <option key={n} value={String(n)}>Semester {n}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Program</label>
          <select className="input" aria-label="Filter by program" value={filters.program}
            onChange={e => update({ program: e.target.value })}>
            <option value="">All programs</option>
            {programs.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {filtersActive && (
          <button className="btn-secondary text-sm"
            onClick={() => { setFilters({ q: '', status: '', department: '', faculty: '', semester: '', program: '' }); setChecked([]) }}>
            Clear filters
          </button>
        )}
        <button className="btn-secondary text-sm flex items-center gap-1" disabled={shown.length === 0}
          onClick={() => downloadCsv(shown)}>
          <Download size={14} /> Export shown (CSV)
        </button>
      </div>

      {checked.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3">
          <span className="text-sm font-medium text-blue-900">{checked.length} selected</span>
          <button className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50 flex items-center gap-1"
            onClick={() => downloadCsv(rows.filter(r => checked.includes(r.id)))}>
            <Download size={12} /> Export selected (CSV)
          </button>
          <button className="text-xs text-gray-500 hover:text-gray-700 ml-auto" onClick={() => setChecked([])}>Clear selection</button>
        </div>
      )}

      <p className="text-xs text-gray-400 mb-2">Showing {shown.length} of {rows.length} papers</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header w-8">
                <input type="checkbox" aria-label="Select all shown papers"
                  checked={allChecked} disabled={shown.length === 0} onChange={toggleAll} />
              </th>
              <th className="table-header">Sr No</th>
              <th className="table-header cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('faculty')}>Faculty Name{mark('faculty')}</th>
              <th className="table-header cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('subject')}>Subject Code{mark('subject')}</th>
              <th className="table-header cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('program')}>Program{mark('program')}</th>
              <th className="table-header cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('semester')}>Sem{mark('semester')}</th>
              {showDepartment && <th className="table-header cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('department')}>Department{mark('department')}</th>}
              <th className="table-header cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('status')}>Paper Status{mark('status')}</th>
              <th className="table-header">Comments</th>
              <th className="table-header"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={colCount} className="table-cell text-center text-gray-400 py-6">Loading…</td></tr>}
            {!loading && shown.map((r, i) => (
              <tr key={r.id}
                className={`cursor-pointer hover:bg-gray-50 ${selectedRowId === r.id ? 'bg-blue-50' : ''}`}
                onClick={() => onSelectRow && onSelectRow(r)}>
                <td className="table-cell" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select paper ${r.subject_code || r.id}`}
                    checked={checked.includes(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="table-cell text-gray-500">{i + 1}</td>
                <td className="table-cell font-medium">{r.faculty_name || '—'}</td>
                <td className="table-cell">
                  <p className="font-mono text-xs">{r.subject_code || '—'}</p>
                  {r.subject_name && <p className="text-xs text-gray-400">{r.subject_name}</p>}
                </td>
                <td className="table-cell text-xs">{r.program || '—'}</td>
                <td className="table-cell text-center">{r.semester ?? '—'}</td>
                {showDepartment && <td className="table-cell text-gray-500 text-xs">{r.department_name || '—'}</td>}
                <td className="table-cell"><StatusBadge status={r.status} /></td>
                <td className="table-cell">
                  {r.latest_comment ? (
                    <div className="max-w-xs">
                      <p className="text-xs text-gray-800 truncate" title={r.latest_comment}>{r.latest_comment}</p>
                      <p className="text-[10px] text-gray-400">
                        {r.latest_comment_by}{r.comment_count > 1 ? ` · +${r.comment_count - 1} earlier` : ''}
                      </p>
                    </div>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="table-cell" onClick={e => e.stopPropagation()}>
                  <button className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center gap-1"
                    onClick={() => navigate(`/papers/${r.id}`)}>
                    <Eye size={12} /> View
                  </button>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={colCount} className="table-cell text-center text-gray-400 py-6">No papers found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
