import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Layout from '../../components/Layout'
import StatusBadge from '../../components/StatusBadge'
import {
  DistributionBarChart,
  CoPieChart,
  BloomsBellChart,
  BLOOMS_NAMES,
  BLOOMS_BG,
  BLOOMS_TEXT,
  BLOOMS_COLORS,
} from '../../components/DistributionCharts'
import { papersApi } from '../../api/endpoints'
import { InlinePaperViewer } from '../faculty/FacultyDashboard'
import { ArrowLeft, Clock, BookOpen, FileText, ChevronDown, ChevronRight } from 'lucide-react'


// ─────────────────────────────────────────────────────────────────────────────
// SectionSlotTable — collapsible per-section table matching the slot editor view
// Columns: Slot | Marks | Type | CO | Bloom's
// Question text (if assigned) appears as a sub-row beneath the slot row.
// ─────────────────────────────────────────────────────────────────────────────
function SectionSlotTable({ sections }) {
  const [collapsed, setCollapsed] = useState({})
  const toggle = (id) => setCollapsed(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="space-y-3">
      {sections.map((sec) => {
        const isOpen = !collapsed[sec.id]
        const totalSlots = sec.questions?.length ?? 0

        return (
          <div key={sec.id} className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Section header row */}
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
              onClick={() => toggle(sec.id)}
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-bold text-sm text-gray-800">{sec.section_name}</span>
                <span className="text-xs text-gray-500">
                  {totalSlots} slot{totalSlots !== 1 ? 's' : ''} · {sec.marks_allocated}m
                </span>
              </div>
              {sec.instructions && (
                <span className="text-xs text-gray-400 italic truncate max-w-xs hidden sm:block">
                  {sec.instructions}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {['Slot', 'Marks', 'Type', 'CO', "Bloom's"].map(h => (
                        <th key={h} className="table-header py-2 text-xs font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(sec.questions || []).map((pq) => {
                      const isOr = pq.is_optional
                      const slotLabel = pq.slot_label || pq.slot_id || `#${pq.id}`
                      const co = pq.co_code
                      const bl = pq.blooms_code
                      const diff = pq.difficulty || pq.slot_difficulty
                      const unit = pq.unit_code

                      return (
                        <React.Fragment key={pq.id}>
                          {/* Main slot row */}
                          <tr className={`border-b border-gray-100 ${isOr ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                            {/* Slot */}
                            <td className="table-cell py-2 font-mono font-semibold text-gray-700 whitespace-nowrap">
                              {isOr && (
                                <span className="text-amber-600 font-bold mr-1">OR</span>
                              )}
                              {slotLabel}
                            </td>
                            {/* Marks */}
                            <td className="table-cell py-2 text-center font-bold text-blue-700">
                              {pq.assigned_marks}
                            </td>
                            {/* Type */}
                            <td className="table-cell py-2 text-gray-500">
                              {isOr ? 'Alternative' : 'Mandatory'}
                            </td>
                            {/* CO */}
                            <td className="table-cell py-2">
                              {co ? (
                                <span
                                  className="inline-block rounded px-1.5 py-0.5 font-semibold text-xs"
                                  style={{ background: '#f3e8ff', color: '#7c3aed' }}
                                  title={`Course Outcome: ${co}`}
                                >
                                  {co}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            {/* Bloom's */}
                            <td className="table-cell py-2">
                              {bl ? (
                                <span
                                  className="inline-block rounded px-1.5 py-0.5 font-semibold text-xs"
                                  style={{
                                    background: BLOOMS_BG[bl] ?? '#f0fdf4',
                                    color: BLOOMS_TEXT[bl] ?? '#15803d',
                                    borderLeft: `3px solid ${BLOOMS_COLORS[bl] ?? '#22c55e'}`,
                                  }}
                                  title={`Bloom's: ${BLOOMS_NAMES[bl] ?? bl}`}
                                >
                                  {bl}
                                  <span className="opacity-60 ml-1 font-normal">{BLOOMS_NAMES[bl] ?? ''}</span>
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          </tr>

                          {/* Question text sub-row (only if text is assigned) */}
                          {pq.question_text && (
                            <tr className={`border-b border-gray-100 ${isOr ? 'bg-amber-50/60' : 'bg-gray-50/60'}`}>
                              <td
                                colSpan={5}
                                className="px-4 pb-2 pt-0.5 text-xs text-gray-700 leading-relaxed"
                              >
                                <span className="text-gray-400 mr-1.5">↳</span>
                                {pq.question_text}
                                {(diff || unit) && (
                                  <span className="ml-2 inline-flex gap-1">
                                    {unit && (
                                      <span className="badge bg-gray-100 text-gray-500">{unit}</span>
                                    )}
                                    {diff && (
                                      <span className={`badge ${
                                        diff === 'hard' ? 'bg-red-100 text-red-600'
                                        : diff === 'easy' ? 'bg-green-100 text-green-600'
                                        : 'bg-yellow-100 text-yellow-600'
                                      }`}>{diff}</span>
                                    )}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


export default function PaperDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: paper, isLoading } = useQuery({
    queryKey: ['paper', id],
    queryFn: () => papersApi.get(id).then(r => r.data),
  })
  const { data: analysis } = useQuery({
    queryKey: ['analysis', id],
    queryFn: () => papersApi.analysis(id).then(r => r.data),
    enabled: !!paper,
  })
  const { data: history = [] } = useQuery({
    queryKey: ['history', id],
    queryFn: () => papersApi.history(id).then(r => r.data),
  })

  if (isLoading) return <Layout><div className="p-8 text-center">Loading…</div></Layout>
  if (!paper) return <Layout><div className="p-8 text-center text-red-500">Paper not found</div></Layout>

  const totalMarks = paper.configuration_total_marks ?? analysis?.total_marks_calculated
  const duration = paper.duration_minutes

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <button className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} /> Back
        </button>

        {/* ── Paper Header ── */}
        <div className="card mb-4">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{paper.title}</h2>
              {(paper.subject_name || paper.subject_code) && (
                <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1">
                  <BookOpen size={13} />
                  {paper.subject_code && <span className="font-medium">{paper.subject_code}</span>}
                  {paper.subject_code && paper.subject_name && <span>·</span>}
                  {paper.subject_name && <span>{paper.subject_name}</span>}
                </p>
              )}
              <p className="text-sm text-gray-500 mt-0.5 capitalize">
                {paper.exam_type?.replace(/_/g, ' ')}
                {paper.academic_year && <> · Year: {paper.academic_year}</>}
              </p>
            </div>
            <StatusBadge status={paper.status} />
          </div>

          {/* Info row */}
          <div className="flex flex-wrap gap-4 text-sm border-t pt-3">
            {totalMarks != null && (
              <div className="flex items-center gap-1.5 text-gray-700">
                <FileText size={14} className="text-blue-500" />
                <span className="font-medium">Total Marks:</span>
                <span className="font-bold text-blue-600">{totalMarks}</span>
              </div>
            )}
            {duration && (
              <div className="flex items-center gap-1.5 text-gray-700">
                <Clock size={14} className="text-purple-500" />
                <span className="font-medium">Duration:</span>
                <span className="font-bold text-purple-600">
                  {duration >= 60
                    ? `${Math.floor(duration / 60)}h ${duration % 60 > 0 ? `${duration % 60}m` : ''}`.trim()
                    : `${duration} min`}
                </span>
              </div>
            )}
          </div>

          {/* Exam instructions */}
          {paper.configuration_instructions && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 italic">
              <span className="font-semibold not-italic">Instructions: </span>
              {paper.configuration_instructions}
            </div>
          )}
        </div>

        {/* Same summary the faculty see: cards, CO bars, Bloom's chart, slots, history */}
        <div className="card">
          <InlinePaperViewer paper={paper} analysis={analysis ?? null} history={history} readOnly />
        </div>
      </div>
    </Layout>
  )
}
