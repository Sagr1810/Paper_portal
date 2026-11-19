import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import PaperDirectory, { usePaperDirectory } from '../../components/PaperDirectory'
import { dashboardApi, papersApi } from '../../api/endpoints'
import { FileText, CheckCircle, Download } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ExamCellDashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [comments, setComments] = useState('')
  const { data: directoryRows = [], isLoading: directoryLoading } = usePaperDirectory()

  const { data: summary } = useQuery({ queryKey: ['dashboard'], queryFn: () => dashboardApi.summary().then(r => r.data) })
  const { data: approved = [] } = useQuery({
    queryKey: ['papers', 'principal_approved'],
    queryFn: () => papersApi.list({ status: 'principal_approved' }).then(r => r.data),
  })
  const { data: inReview = [] } = useQuery({
    queryKey: ['papers', 'exam_cell_review'],
    queryFn: () => papersApi.list({ status: 'exam_cell_review' }).then(r => r.data),
  })
  const { data: finalized = [] } = useQuery({
    queryKey: ['papers', 'finalized'],
    queryFn: () => papersApi.list({ status: 'finalized' }).then(r => r.data),
  })

  const transitionMut = useMutation({
    mutationFn: ({ id, action }) => papersApi.transition(id, { action, comments }),
    onSuccess: () => { qc.invalidateQueries(['papers']); setSelectedPaper(null); setComments('') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Action failed'),
  })

  const exportPaper = async (id, fmt) => {
    try {
      const res = await papersApi.export(id, fmt)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `paper_${id}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error('Export failed')
    }
  }

  const allPending = [...approved, ...inReview]

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Exam Cell Dashboard</h2>

        {summary && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard title="Pending Finalization" value={summary.pending_finalize} icon={FileText} color="orange" />
            <StatCard title="Finalized Papers" value={summary.finalized} icon={CheckCircle} color="green" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pending */}
          <div className="card lg:col-span-1">
            <h3 className="font-semibold mb-4">Pending Finalization</h3>
            {allPending.length === 0 && <p className="text-gray-400 text-sm">No pending papers</p>}
            {allPending.map(p => (
              <div key={p.id}
                className={`border rounded-lg p-3 mb-2 cursor-pointer ${selectedPaper?.id === p.id ? 'border-brand bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                onClick={() => setSelectedPaper(p)}
              >
                <p className="font-medium text-sm">{p.title}</p>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-500">{p.exam_type?.replace('_', ' ')}</p>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          {selectedPaper && (
            <div className="card lg:col-span-1">
              <h3 className="font-semibold mb-2">{selectedPaper.title}</h3>
              <StatusBadge status={selectedPaper.status} />

              <div className="mt-4">
                <label className="label">Comments</label>
                <textarea className="input" rows={3} value={comments} onChange={e => setComments(e.target.value)} />
              </div>

              <div className="flex gap-2 mt-3 flex-wrap">
                {selectedPaper.status === 'principal_approved' && (
                  <button className="btn-primary" onClick={() => transitionMut.mutate({ id: selectedPaper.id, action: 'exam_cell_review' })}>
                    Start Review
                  </button>
                )}
                {selectedPaper.status === 'exam_cell_review' && (
                  <button className="btn-primary" onClick={() => {
                    if (!window.confirm('Finalize this paper? This action cannot be undone.')) return
                    transitionMut.mutate({ id: selectedPaper.id, action: 'finalize' })
                  }}>
                    ✓ Finalize
                  </button>
                )}
                <button className="btn-secondary" onClick={() => navigate(`/papers/${selectedPaper.id}`)}>View</button>
              </div>
            </div>
          )}

          {/* Finalized */}
          <div className="card lg:col-span-1">
            <h3 className="font-semibold mb-4">Finalized Papers</h3>
            {finalized.length === 0 && <p className="text-gray-400 text-sm">None yet</p>}
            {finalized.map(p => (
              <div key={p.id} className="border border-gray-200 rounded-lg p-3 mb-2">
                <p className="font-medium text-sm">{p.title}</p>
                <div className="flex gap-2 mt-2">
                  {['pdf', 'docx', 'xlsx'].map(fmt => (
                    <button key={fmt} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                      onClick={() => exportPaper(p.id, fmt)}>
                      <Download size={12} /> {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card mt-6">
          <h3 className="font-semibold mb-1">All papers in your college</h3>
          <p className="text-xs text-gray-500 mb-4">Search, filter and export every paper with its faculty, subject code, status and comments.</p>
          <PaperDirectory rows={directoryRows} loading={directoryLoading} showDepartment />
        </div>
      </div>
    </Layout>
  )
}
