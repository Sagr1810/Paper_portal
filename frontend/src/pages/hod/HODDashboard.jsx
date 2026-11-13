import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import { DistributionBarChart, BloomsRadarChart, CoPieChart } from '../../components/DistributionCharts'
import { dashboardApi, papersApi, masterApi } from '../../api/endpoints'
import { ClipboardList, CheckCircle, XCircle, Filter } from 'lucide-react'
import toast from 'react-hot-toast'

// All statuses the HOD might see for their dept papers
const ALL_STATUSES = [
  { value: '', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'hod_review', label: 'In Review' },
  { value: 'hod_approved', label: 'Approved' },
  { value: 'hod_returned', label: 'Returned' },
  { value: 'draft', label: 'Draft' },
  { value: 'exam_cell_review', label: 'Exam Cell' },
  { value: 'finalized', label: 'Finalized' },
]

export default function HODDashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [comments, setComments] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: summary } = useQuery({ queryKey: ['dashboard'], queryFn: () => dashboardApi.summary().then(r => r.data) })

  // Fetch all dept papers (auto-scoped by backend to HOD's department)
  const { data: allDeptPapers = [], isLoading: papersLoading } = useQuery({
    queryKey: ['papers', 'hod-dept', statusFilter],
    queryFn: () => papersApi.list(statusFilter ? { status: statusFilter } : {}).then(r => r.data),
  })

  // Pending-action papers (submitted + hod_review)
  const pendingPapers = useMemo(
    () => allDeptPapers.filter(p => ['submitted', 'hod_review'].includes(p.status)),
    [allDeptPapers]
  )

  const displayPapers = statusFilter ? allDeptPapers : pendingPapers

  const { data: analysis } = useQuery({
    queryKey: ['analysis', selectedPaper?.id],
    queryFn: () => papersApi.analysis(selectedPaper.id).then(r => r.data),
    enabled: !!selectedPaper,
  })

  const transitionMut = useMutation({
    mutationFn: ({ id, action }) => papersApi.transition(id, { action, comments }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries(['papers'])
      toast.success(vars.action === 'hod_approve' ? 'Paper approved' : 'Paper returned')
      setSelectedPaper(null)
      setComments('')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Action failed'),
  })

  // Status summary counts for dept papers
  const statusCounts = useMemo(() => {
    const counts = {}
    allDeptPapers.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1 })
    return counts
  }, [allDeptPapers])

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">HOD Review Dashboard</h2>

        {summary && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard title="Pending Review" value={summary.pending_review} icon={ClipboardList} color="orange" />
            <StatCard title="Approved Today" value={summary.approved_today} icon={CheckCircle} color="green" />
            <StatCard title="Total Reviewed" value={summary.total_reviewed} icon={ClipboardList} color="blue" />
          </div>
        )}

        {/* Department-wise status summary row */}
        {allDeptPapers.length > 0 && (
          <div className="card mb-6">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Filter size={14} className="text-blue-500" /> Department Paper Status Summary
            </h3>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.filter(s => s.value && statusCounts[s.value]).map(s => (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(prev => prev === s.value ? '' : s.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    statusFilter === s.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {s.label}
                  <span className={`rounded-full px-1.5 text-xs font-bold ${statusFilter === s.value ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {statusCounts[s.value]}
                  </span>
                </button>
              ))}
              {statusFilter && (
                <button
                  className="text-xs text-blue-600 hover:underline px-2"
                  onClick={() => setStatusFilter('')}
                >
                  Clear filter
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Queue / Status view */}
          <div className="card">
            <h3 className="font-semibold mb-4">
              {statusFilter
                ? `${ALL_STATUSES.find(s => s.value === statusFilter)?.label || statusFilter} Papers`
                : 'Review Queue (Pending Action)'}
              <span className="text-gray-400 font-normal text-sm ml-2">({displayPapers.length})</span>
            </h3>
            {papersLoading && <p className="text-gray-400 text-sm">Loading…</p>}
            {!papersLoading && displayPapers.length === 0 && (
              <p className="text-gray-400 text-sm">
                {statusFilter ? 'No papers with this status.' : 'No papers pending review.'}
              </p>
            )}
            {displayPapers.map(p => (
              <div key={p.id}
                className={`border rounded-lg p-3 mb-2 cursor-pointer transition-colors ${selectedPaper?.id === p.id ? 'border-brand bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                onClick={() => setSelectedPaper(p)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-sm">{p.title}</p>
                    <p className="text-xs text-gray-500 capitalize">{p.exam_type?.replace('_', ' ')} · {p.academic_year}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>

          {/* Review panel */}
          {selectedPaper && (
            <div className="card">
              <h3 className="font-semibold mb-2">Reviewing: {selectedPaper.title}</h3>
              <StatusBadge status={selectedPaper.status} />

              {analysis && (
                <div className="mt-4 space-y-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm font-medium mb-1">Total Marks: {analysis.total_marks_calculated}</p>
                    {analysis.validation_errors?.length > 0 && (
                      <div className="mt-2">
                        {analysis.validation_errors.map((e, i) => (
                          <p key={i} className="text-xs text-red-600">⚠ {e}</p>
                        ))}
                      </div>
                    )}
                  </div>
                  {analysis.co_distribution && <CoPieChart data={analysis.co_distribution} />}
                  {analysis.blooms_distribution && <DistributionBarChart data={analysis.blooms_distribution} title="Bloom's Distribution" />}
                  {analysis.unit_distribution && <DistributionBarChart data={analysis.unit_distribution} title="Unit Coverage" />}
                </div>
              )}

              <div className="mt-4">
                <label className="label">Comments</label>
                <textarea className="input" rows={3} value={comments} onChange={e => setComments(e.target.value)} placeholder="Review comments (required for return)…" />
              </div>

              <div className="flex gap-2 mt-3">
                {['submitted', 'hod_review'].includes(selectedPaper.status) && (
                  <button
                    className="btn-primary"
                    disabled={transitionMut.isPending}
                    onClick={() => transitionMut.mutate({ id: selectedPaper.id, action: selectedPaper.status === 'submitted' ? 'hod_review' : 'hod_approve' })}
                  >
                    {selectedPaper.status === 'submitted' ? 'Start Review' : '✓ Approve'}
                  </button>
                )}
                {selectedPaper.status === 'hod_review' && (
                  <button
                    className="btn-danger"
                    disabled={transitionMut.isPending}
                    onClick={() => transitionMut.mutate({ id: selectedPaper.id, action: 'hod_return' })}
                  >
                    ✗ Return
                  </button>
                )}
                <button className="btn-secondary" onClick={() => navigate(`/papers/${selectedPaper.id}`)}>
                  Full View
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
