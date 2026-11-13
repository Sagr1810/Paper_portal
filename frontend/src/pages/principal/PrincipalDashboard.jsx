import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import { CoPieChart, BloomsRadarChart } from '../../components/DistributionCharts'
import { dashboardApi, papersApi } from '../../api/endpoints'
import { CheckCircle, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'

export default function PrincipalDashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [comments, setComments] = useState('')

  const { data: summary } = useQuery({ queryKey: ['dashboard'], queryFn: () => dashboardApi.summary().then(r => r.data) })
  const { data: papers = [] } = useQuery({
    queryKey: ['papers', 'principal'],
    queryFn: () => papersApi.list({ status: 'hod_approved' }).then(r => r.data),
  })
  const { data: reviewing = [] } = useQuery({
    queryKey: ['papers', 'principal_review'],
    queryFn: () => papersApi.list({ status: 'principal_review' }).then(r => r.data),
  })
  const { data: analysis } = useQuery({
    queryKey: ['analysis', selectedPaper?.id],
    queryFn: () => papersApi.analysis(selectedPaper.id).then(r => r.data),
    enabled: !!selectedPaper,
  })

  const transitionMut = useMutation({
    mutationFn: ({ id, action }) => papersApi.transition(id, { action, comments }),
    onSuccess: () => { qc.invalidateQueries(['papers']); setSelectedPaper(null); setComments('') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Action failed'),
  })

  const allPapers = [...papers, ...reviewing]

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Principal Approval Dashboard</h2>

        {summary && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard title="Pending Approval" value={summary.pending_approval} icon={ClipboardList} color="orange" />
            <StatCard title="Approved Papers" value={summary.approved} icon={CheckCircle} color="green" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold mb-4">Approval Queue</h3>
            {allPapers.length === 0 && <p className="text-gray-400 text-sm">No papers awaiting approval</p>}
            {allPapers.map(p => (
              <div key={p.id}
                className={`border rounded-lg p-3 mb-2 cursor-pointer transition-colors ${selectedPaper?.id === p.id ? 'border-brand bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                onClick={() => setSelectedPaper(p)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-sm">{p.title}</p>
                    <p className="text-xs text-gray-500 capitalize">{p.exam_type?.replace('_', ' ')}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>

          {selectedPaper && (
            <div className="card">
              <h3 className="font-semibold mb-2">{selectedPaper.title}</h3>
              <StatusBadge status={selectedPaper.status} />

              {analysis && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm font-medium">Total Marks: {analysis.total_marks_calculated}</p>
                  {analysis.co_distribution && <CoPieChart data={analysis.co_distribution} />}
                  {analysis.blooms_distribution && <BloomsRadarChart data={analysis.blooms_distribution} />}
                </div>
              )}

              <div className="mt-4">
                <label className="label">Comments</label>
                <textarea className="input" rows={3} value={comments} onChange={e => setComments(e.target.value)} placeholder="Approval / return remarks…" />
              </div>

              <div className="flex gap-2 mt-3">
                {selectedPaper.status === 'hod_approved' && (
                  <button className="btn-primary" onClick={() => transitionMut.mutate({ id: selectedPaper.id, action: 'principal_review' })}>
                    Start Review
                  </button>
                )}
                {selectedPaper.status === 'principal_review' && (
                  <>
                    <button className="btn-primary" onClick={() => transitionMut.mutate({ id: selectedPaper.id, action: 'principal_approve' })}>
                      ✓ Approve
                    </button>
                    <button className="btn-danger" onClick={() => transitionMut.mutate({ id: selectedPaper.id, action: 'principal_return' })}>
                      ✗ Return
                    </button>
                  </>
                )}
                <button className="btn-secondary" onClick={() => navigate(`/papers/${selectedPaper.id}`)}>Full View</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
