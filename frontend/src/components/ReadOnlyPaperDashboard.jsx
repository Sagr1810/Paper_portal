import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import Layout from './Layout'
import StatCard from './StatCard'
import StatusBadge from './StatusBadge'
import PaperDirectory, { usePaperDirectory } from './PaperDirectory'
import { InlinePaperViewer } from '../pages/faculty/FacultyDashboard'
import { papersApi } from '../api/endpoints'
import { FileText, CheckCircle, ClipboardList, MessageSquare } from 'lucide-react'

// Read-only dashboard for HOD and Principal: the papers they are allowed to see
// (principal = whole college, HOD = own department) with the exam cell's comments.
export default function ReadOnlyPaperDashboard({ title, scopeText, showDepartment }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(null)
  const { data: rows = [], isLoading } = usePaperDirectory()

  const { data: analysis } = useQuery({
    queryKey: ['analysis-summary', selected?.id],
    queryFn: () => papersApi.analysis(selected.id).then(r => r.data),
    enabled: !!selected,
    retry: false,
  })
  const { data: selPaper } = useQuery({
    queryKey: ['paper-summary', selected?.id],
    queryFn: () => papersApi.get(selected.id).then(r => r.data),
    enabled: !!selected,
    retry: false,
  })
  const { data: history = [] } = useQuery({
    queryKey: ['history-summary', selected?.id],
    queryFn: () => papersApi.history(selected.id).then(r => r.data),
    enabled: !!selected,
    retry: false,
  })
  const examCellComments = history.filter(h => h.actor_role === 'exam_cell' && h.comments)

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        {scopeText && <p className="text-sm text-gray-500 mb-6">{scopeText}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard title="Total Papers" value={rows.length} icon={FileText} color="blue" />
          <StatCard title="With Exam Cell" value={rows.filter(r => r.status === 'exam_cell_review').length} icon={ClipboardList} color="orange" />
          <StatCard title="Finalized" value={rows.filter(r => r.status === 'finalized').length} icon={CheckCircle} color="green" />
          <StatCard title="With Comments" value={rows.filter(r => r.comment_count > 0).length} icon={MessageSquare} color="purple" />
        </div>

        <div className="card mb-6">
          <PaperDirectory rows={rows} loading={isLoading} showDepartment={showDepartment}
            selectedRowId={selected?.id} onSelectRow={setSelected} />
        </div>

        {selected && (
          <div className="card">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold">{selected.title}</h3>
                <p className="text-xs text-gray-500">
                  {selected.faculty_name} · {selected.subject_code}{selected.department_name ? ` · ${selected.department_name}` : ''}
                </p>
              </div>
              <StatusBadge status={selected.status} />
            </div>

            {selPaper && (
              <div className="mt-4">
                <InlinePaperViewer paper={selPaper} analysis={analysis ?? null} history={history} readOnly />
              </div>
            )}

            <div className="mt-4">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <MessageSquare size={14} className="text-blue-500" /> Exam Cell Comments
              </h4>
              {examCellComments.length === 0 && <p className="text-gray-400 text-sm">No exam cell comments yet.</p>}
              {examCellComments.map(h => (
                <div key={h.id} className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50">
                  <p className="text-sm text-gray-800">{h.comments}</p>
                  <p className="text-xs text-gray-400 mt-1">{h.actor_name || 'Exam Cell'} · {new Date(h.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-3">
              <button className="btn-secondary" onClick={() => navigate(`/papers/${selected.id}`)}>Full View</button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
