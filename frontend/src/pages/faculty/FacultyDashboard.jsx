import SyllabusUploadPanel from '../../components/SyllabusUploadPanel'
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import { dashboardApi, papersApi, masterApi } from '../../api/endpoints'
import { getDepartmentId } from '../../api/auth'
import {
  FileText, BookOpen, Plus, RefreshCw, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle2, Zap, BarChart2, Sliders, Eye, TrendingUp, Download,
  Search, Pencil, Trash2, X, Upload, FileUp, ShieldAlert
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  BloomsBellChart as BloomsBellChartWidget,
  BLOOMS_BG as CHART_BLOOMS_BG,
  BLOOMS_TEXT as CHART_BLOOMS_TEXT,
  BLOOMS_COLORS as CHART_BLOOMS_COLORS,
  BLOOMS_NAMES as CHART_BLOOMS_NAMES,
  BLOOMS_ORDER as CHART_BLOOMS_ORDER,
} from '../../components/DistributionCharts'

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Largest-Remainder (Hamilton) integer mark allocation
// Mirrors the Python _largest_remainder() in auto_assign_engine.py.
// Guarantees sum(result.values()) === Math.round(totalMarks).
// ─────────────────────────────────────────────────────────────────────────────

function largestRemainder(targetsPct, totalMarks) {
  const total = Math.round(totalMarks)
  const keys = Object.keys(targetsPct)
  if (total <= 0 || keys.length === 0) return Object.fromEntries(keys.map(k => [k, 0]))

  const pctSum = keys.reduce((s, k) => s + (targetsPct[k] || 0), 0)
  if (pctSum <= 0) return Object.fromEntries(keys.map(k => [k, 0]))

  // Exact fractional allocation
  const exact = Object.fromEntries(keys.map(k => [k, (targetsPct[k] || 0) / pctSum * total]))

  // Floor each
  const floors = Object.fromEntries(keys.map(k => [k, Math.floor(exact[k])]))
  let remainderNeeded = total - keys.reduce((s, k) => s + floors[k], 0)

  // Award remainders to keys with largest fractional parts
  const sorted = [...keys].sort((a, b) => (exact[b] - floors[b]) - (exact[a] - floors[a]))
  for (let i = 0; i < remainderNeeded; i++) floors[sorted[i]] += 1

  return floors
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BLOOMS_ORDER = ['R', 'U', 'Ap', 'An', 'E', 'C']
const BLOOMS_NAMES = { R: 'Remember', U: 'Understand', Ap: 'Apply', An: 'Analyze', E: 'Evaluate', C: 'Create' }
const BLOOMS_COLORS = { R: '#3b82f6', U: '#22c55e', Ap: '#f59e0b', An: '#ef4444', E: '#8b5cf6', C: '#06b6d4' }
const CO_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16']

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: Summary Table (CO + Bloom's final distribution)
// ─────────────────────────────────────────────────────────────────────────────

function SummaryTable({ summaryData, totalMarks }) {
  if (!summaryData) return null
  const { co_table = [], blooms_table = [], co_ok, blooms_ok } = summaryData

  // paper_total_marks = full paper total (e.g. 88m) from config.total_marks
  // answered_marks    = what a student actually answers (mandatory slots only, e.g. 50m)
  // Both are supplied by the backend; fall back to the prop for legacy responses.
  const paperTotal   = summaryData.paper_total_marks ?? totalMarks
  const answeredMark = summaryData.answered_marks    ?? totalMarks

  return (
    <div className="space-y-6">
      {/* Overall status banner */}
      <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${co_ok && blooms_ok ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        {co_ok && blooms_ok
          ? <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          : <AlertCircle size={16} className="text-amber-600 shrink-0" />}
        <div>
          <div className={`text-sm font-semibold ${co_ok && blooms_ok ? 'text-green-800' : 'text-amber-800'}`}>
            {co_ok && blooms_ok
              ? 'All CO & Bloom\'s targets met within ±2% deviation'
              : 'Some targets deviate >2% — review the table below'}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
            <span>Total marks: <strong>{paperTotal}m</strong></span>
            <span className="text-gray-300">|</span>
            <span>Deviation tolerance: ±2%</span>
          </div>
        </div>
      </div>

      {/* CO Summary Table */}
      <div>
        <h5 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
          Course Outcome (CO) Distribution Summary
        </h5>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="table-header py-2">CO</th>
                <th className="table-header py-2 text-right">Target %</th>
                <th className="table-header py-2 text-right">Target Marks</th>
                <th className="table-header py-2 text-right">Actual Marks</th>
                <th className="table-header py-2 text-right">Actual %</th>
                <th className="table-header py-2 text-right">Deviation</th>
                <th className="table-header py-2 text-center">Status</th>
                <th className="table-header py-2 text-right">Slots</th>
              </tr>
            </thead>
            <tbody>
              {co_table.map((row, i) => (
                <tr key={row.co_code} className={`border-b border-gray-100 ${row.status === 'ok' ? '' : 'bg-amber-50'}`}>
                  <td className="table-cell py-2">
                    <span className="font-bold text-sm" style={{ color: CO_COLORS[i % CO_COLORS.length] }}>
                      {row.co_code}
                    </span>
                  </td>
                  <td className="table-cell py-2 text-right font-mono text-gray-600">{row.target_pct}%</td>
                  <td className="table-cell py-2 text-right font-mono text-indigo-700 font-semibold">
                    {row.target_marks ?? '—'}m
                  </td>
                  <td className="table-cell py-2 text-right font-mono font-bold text-emerald-700">
                    {row.actual_marks ?? '—'}m
                  </td>
                  <td className="table-cell py-2 text-right font-mono font-bold"
                    style={{ color: row.status === 'ok' ? '#166534' : '#92400e' }}>
                    {row.actual_pct}%
                  </td>
                  <td className="table-cell py-2 text-right font-mono">
                    <span className={`${row.deviation > 1 ? 'text-amber-700 font-bold' : 'text-green-700'}`}>
                      ±{row.deviation}%
                    </span>
                  </td>
                  <td className="table-cell py-2 text-center">
                    {row.status === 'ok'
                      ? <CheckCircle2 size={13} className="text-green-500 mx-auto" />
                      : <AlertCircle size={13} className="text-amber-500 mx-auto" />}
                  </td>
                  <td className="table-cell py-2 text-right text-gray-600">{row.slot_count}</td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                <td className="table-cell py-2 font-bold">TOTAL</td>
                <td className="table-cell py-2 text-right font-mono">100%</td>
                <td className="table-cell py-2 text-right font-mono text-indigo-700">
                  {paperTotal}m
                </td>
                <td className="table-cell py-2 text-right font-mono text-emerald-700 font-bold">
                  {co_table.reduce((a, r) => a + (r.actual_marks ?? 0), 0).toFixed(1)}m
                </td>
                <td className="table-cell py-2 text-right font-mono">100%</td>
                <td colSpan={3} className="table-cell py-2 text-gray-400 text-xs">
                  {co_ok ? 'All COs within ±2%' : 'Some COs exceed ±2%'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Bloom's Summary Table */}
      <div>
        <h5 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
          Bloom's Taxonomy Distribution Summary
        </h5>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="table-header py-2">Level</th>
                <th className="table-header py-2">Name</th>
                <th className="table-header py-2 text-right">Target %</th>
                <th className="table-header py-2 text-right">Target Marks</th>
                <th className="table-header py-2 text-right">Actual Marks</th>
                <th className="table-header py-2 text-right">Actual %</th>
                <th className="table-header py-2 text-right">Deviation</th>
                <th className="table-header py-2 text-center">Status</th>
                <th className="table-header py-2 text-right">Slots</th>
              </tr>
            </thead>
            <tbody>
              {blooms_table.map(row => (
                <tr key={row.level_code} className={`border-b border-gray-100 ${row.status === 'ok' ? '' : 'bg-amber-50'}`}>
                  <td className="table-cell py-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-white font-bold text-xs"
                      style={{ backgroundColor: BLOOMS_COLORS[row.level_code] || '#94a3b8' }}
                    >{row.level_code}</span>
                  </td>
                  <td className="table-cell py-2 text-gray-700">{BLOOMS_NAMES[row.level_code] || row.level_code}</td>
                  <td className="table-cell py-2 text-right font-mono text-gray-600">{row.target_pct}%</td>
                  <td className="table-cell py-2 text-right font-mono text-indigo-700 font-semibold">
                    {row.target_marks ?? '—'}m
                  </td>
                  <td className="table-cell py-2 text-right font-mono font-bold text-emerald-700">
                    {row.actual_marks ?? '—'}m
                  </td>
                  <td className="table-cell py-2 text-right font-mono font-bold"
                    style={{ color: row.status === 'ok' ? '#166534' : '#92400e' }}>
                    {row.actual_pct}%
                  </td>
                  <td className="table-cell py-2 text-right font-mono">
                    <span className={`${row.deviation > 1 ? 'text-amber-700 font-bold' : 'text-green-700'}`}>
                      ±{row.deviation}%
                    </span>
                  </td>
                  <td className="table-cell py-2 text-center">
                    {row.status === 'ok'
                      ? <CheckCircle2 size={13} className="text-green-500 mx-auto" />
                      : <AlertCircle size={13} className="text-amber-500 mx-auto" />}
                  </td>
                  <td className="table-cell py-2 text-right text-gray-600">{row.slot_count}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                <td colSpan={2} className="table-cell py-2 font-bold">TOTAL</td>
                <td className="table-cell py-2 text-right font-mono">
                  100%
                </td>
                <td className="table-cell py-2 text-right font-mono text-indigo-700">
                  {paperTotal}m
                </td>
                <td className="table-cell py-2 text-right font-mono text-emerald-700 font-bold">
                  {blooms_table.reduce((a, r) => a + (r.actual_marks ?? 0), 0).toFixed(1)}m
                </td>
                <td className="table-cell py-2 text-right font-mono">100%</td>
                <td colSpan={3} className="table-cell py-2 text-gray-400 text-xs">
                  {blooms_ok ? "All levels within ±2%" : "Some levels exceed ±2%"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART: Bloom's Bell Curve (horizontal bar, R → C ordered)
// ─────────────────────────────────────────────────────────────────────────────

function BloomsBellChart({ actual, targets }) {
  const maxPct = Math.max(
    ...BLOOMS_ORDER.map(k => Math.max(actual?.[k]?.percent || 0, targets?.[k] || 0)),
    1
  )

  return (
    <div className="space-y-2.5">
      {BLOOMS_ORDER.map(code => {
        const actualPct = actual?.[code]?.percent || 0
        const actualMarks = actual?.[code]?.marks || 0
        const targetPct = targets?.[code] || 0
        const color = BLOOMS_COLORS[code]
        const actualW = Math.round((actualPct / maxPct) * 100)
        const targetW = Math.round((targetPct / maxPct) * 100)
        const gap = Math.abs(actualPct - targetPct)
        const hasGap = gap > 5

        return (
          <div key={code}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium w-20 text-gray-600 shrink-0">{BLOOMS_NAMES[code]}</span>
              <div className="flex-1 relative h-5 bg-gray-100 rounded overflow-hidden">
                {/* Target ghost bar */}
                {targetPct > 0 && (
                  <div
                    className="absolute top-0 left-0 h-full rounded opacity-20"
                    style={{ width: `${targetW}%`, backgroundColor: color }}
                  />
                )}
                {/* Actual bar */}
                <div
                  className="h-full rounded transition-all duration-500"
                  style={{ width: `${actualW}%`, backgroundColor: color }}
                />
                {/* Target tick mark */}
                {targetPct > 0 && (
                  <div
                    className="absolute top-0 h-full w-0.5 bg-gray-500 opacity-60"
                    style={{ left: `${targetW}%` }}
                  />
                )}
              </div>
              <div className="flex items-center gap-1 w-28 justify-end shrink-0">
                <span className="text-xs font-mono font-bold" style={{ color }}>
                  {actualPct.toFixed(1)}%
                </span>
                {targetPct > 0 && (
                  <span className="text-xs text-gray-400">/{targetPct}%</span>
                )}
                {hasGap && <AlertCircle size={10} className="text-amber-500" />}
              </div>
            </div>
            {actualMarks > 0 && (
              <div className="ml-22 text-xs text-gray-400 ml-[88px]">{actualMarks}m</div>
            )}
          </div>
        )
      })}
      <div className="flex gap-4 pt-1 text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 bg-gray-400 rounded opacity-40" /> Target
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 bg-blue-500 rounded" /> Actual
        </div>
        <div className="flex items-center gap-1">
          <div className="w-0.5 h-3 bg-gray-600" /> Target mark
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART: CO Gantt / Stacked bar
// ─────────────────────────────────────────────────────────────────────────────

function COGanttChart({ actual, targets, totalMarks }) {
  const entries = Object.entries(actual || {})
  const coList = Object.keys({ ...actual, ...targets })

  return (
    <div className="space-y-3">
      {/* Stacked actual bar */}
      <div>
        <div className="text-xs text-gray-500 mb-1 font-medium">Actual distribution</div>
        <div className="flex h-8 rounded overflow-hidden border border-gray-200">
          {entries.map(([co, d], i) => (
            <div
              key={co}
              className="flex items-center justify-center text-white text-xs font-bold transition-all duration-500"
              style={{
                width: `${d.percent}%`,
                backgroundColor: CO_COLORS[i % CO_COLORS.length],
                minWidth: d.percent > 0 ? '2px' : '0',
              }}
              title={`${co}: ${d.marks}m (${d.percent}%)`}
            >
              {d.percent >= 8 ? co : ''}
            </div>
          ))}
          {entries.length === 0 && (
            <div className="flex-1 bg-gray-100 flex items-center justify-center text-xs text-gray-400">
              Set targets and auto-assign
            </div>
          )}
        </div>
      </div>

      {/* Target bar for comparison */}
      {Object.keys(targets || {}).length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1 font-medium">Target distribution</div>
          <div className="flex h-4 rounded overflow-hidden border border-gray-200">
            {coList.map((co, i) => {
              const tgt = targets[co] || 0
              return (
                <div
                  key={co}
                  className="transition-all duration-500"
                  style={{
                    width: `${tgt}%`,
                    backgroundColor: CO_COLORS[i % CO_COLORS.length],
                    opacity: 0.4,
                    minWidth: tgt > 0 ? '2px' : '0',
                  }}
                  title={`${co} target: ${tgt}%`}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Legend + per-CO detail */}
      <div className="grid grid-cols-2 gap-1.5">
        {coList.map((co, i) => {
          const act = actual?.[co]
          const tgt = targets?.[co] || 0
          const gap = act ? Math.abs(act.percent - tgt) : tgt
          return (
            <div key={co} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
              <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: CO_COLORS[i % CO_COLORS.length] }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gray-800">{co}</div>
                <div className="text-xs text-gray-500">
                  {act ? `${act.marks}m · ${act.percent}%` : '0m'}
                  {tgt > 0 && <span className="text-gray-400"> / {tgt}%</span>}
                </div>
              </div>
              {gap > 5 && <AlertCircle size={10} className="text-amber-500 shrink-0" />}
              {gap <= 5 && act && <CheckCircle2 size={10} className="text-green-500 shrink-0" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: CO Target Sliders
// ─────────────────────────────────────────────────────────────────────────────

function COTargetPanel({ cos, coTargets, onChange, totalMarks = 0 }) {
  // CO targets represent paper weightage — equal distribution across COs.
  // They are fixed (equal split) but user can override individual COs.
  const total = Object.values(coTargets).reduce((a, b) => a + b, 0)
  const coMarks = totalMarks > 0 ? largestRemainder(coTargets, totalMarks) : {}

  // Auto-distribute equally across all COs
  const handleEqualDistribute = () => {
    if (!cos.length) return
    const each = Math.round((100 / cos.length) * 10) / 10
    cos.forEach((co, i) => {
      const val = i === cos.length - 1
        ? Math.round((100 - each * (cos.length - 1)) * 10) / 10
        : each
      onChange(co.co_code, val)
    })
  }

  if (cos.length === 0) {
    return (
      <div>
        <h5 className="text-sm font-semibold text-gray-700 mb-3">CO Weightage Targets</h5>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <div className="font-semibold mb-1">⚠ No Course Outcomes (COs) found for this subject</div>
          <div className="text-xs">Go to <strong>My Subjects → expand subject → + Add CO</strong></div>
        </div>
      </div>
    )
  }

  const remaining = Math.round((100 - total) * 10) / 10
  const isBalanced = Math.abs(remaining) < 0.5

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h5 className="text-sm font-semibold text-gray-700">CO Weightage <span className="text-gray-400 font-normal">(paper marks distribution)</span></h5>
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={handleEqualDistribute}
          title="Distribute marks equally across all COs"
        >⟳ Equal split</button>
      </div>
      <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded px-2 py-1.5 mb-3">
        CO targets define how paper marks are distributed across course outcomes. These are used by auto-assign to allocate slots. Equal distribution is the default.
      </div>
      <div className="space-y-2">
        {cos.map((co, i) => {
          const val = coTargets[co.co_code] || 0
          const marks = coMarks[co.co_code] ?? 0
          const pct = total > 0 ? (val / total) * 100 : 0
          return (
            <div key={co.id} className="flex items-center gap-2">
              {/* Color dot + CO code */}
              <div className="w-24 shrink-0 flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CO_COLORS[i % CO_COLORS.length] }} />
                <span className="text-xs font-bold" style={{ color: CO_COLORS[i % CO_COLORS.length] }}>{co.co_code}</span>
              </div>
              {/* Progress bar */}
              <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, val)}%`, background: CO_COLORS[i % CO_COLORS.length] + 'cc' }}
                />
              </div>
              {/* Marks badge */}
              {totalMarks > 0 && (
                <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 shrink-0 w-10 text-center">
                  {marks}m
                </span>
              )}
              {/* % input */}
              <input
                type="number" min="0" max="100" step="5"
                className="w-12 text-xs border border-gray-200 rounded px-1.5 py-0.5 text-right font-mono shrink-0"
                value={val}
                onChange={e => onChange(co.co_code, Math.min(100, Math.max(0, +e.target.value)))}
              />
              <span className="text-xs text-gray-400 shrink-0">%</span>
            </div>
          )
        })}
      </div>
      <div className={`mt-2 text-xs px-2 py-1 rounded flex items-center justify-between ${isBalanced ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
        <span>Total: <strong>{total.toFixed(1)}%</strong></span>
        {!isBalanced && <span>{remaining > 0 ? `${remaining}% unallocated` : `${Math.abs(remaining)}% over`} — will be normalised</span>}
        {isBalanced && <span>✓ Balanced</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: Bloom's Target Sliders
// ─────────────────────────────────────────────────────────────────────────────

function BloomsTargetPanel({ bloomsTargets, onChange, totalMarks = 0 }) {
  const total = BLOOMS_ORDER.reduce((a, k) => a + (bloomsTargets[k] || 0), 0)

  // Per-level integer marks using Largest-Remainder
  const blMarks = totalMarks > 0 ? largestRemainder(bloomsTargets, totalMarks) : {}

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h5 className="text-sm font-semibold text-gray-700">Bloom's Taxonomy Targets</h5>
        <div className={`text-xs font-mono px-2 py-0.5 rounded ${Math.abs(100 - total) < 1 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {total.toFixed(1)}% / 100%
        </div>
      </div>
      <div className="space-y-3">
        {BLOOMS_ORDER.map(code => {
          const val = bloomsTargets[code] || 0
          const color = BLOOMS_COLORS[code]
          const marks = blMarks[code] ?? 0
          return (
            <div key={code}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">{BLOOMS_NAMES[code]}</span>
                <div className="flex items-center gap-1.5">
                  {totalMarks > 0 && val > 0 && (
                    <span className="text-xs font-mono bg-purple-50 border border-purple-200 text-purple-700 rounded px-1.5 py-0.5">
                      {marks}m
                    </span>
                  )}
                  <input
                    type="number"
                    min="0" max="100" step="5"
                    className="w-14 text-xs border border-gray-200 rounded px-1.5 py-0.5 text-right font-mono"
                    value={val}
                    onChange={e => onChange(code, Math.min(100, Math.max(0, +e.target.value)))}
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
              </div>
              <input
                type="range"
                min="0" max="100" step="5"
                value={val}
                className="w-full h-1.5 rounded appearance-none cursor-pointer"
                style={{ accentColor: color }}
                onChange={e => onChange(code, +e.target.value)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: Assigned Slots Table — editable CO + Bloom's dropdowns per slot
// ─────────────────────────────────────────────────────────────────────────────

function AssignedSlotsTable({ sections, autoAssignedSlots, cos, bloomsLevels, paperId, canEdit, onSlotUpdated, coTargets = {}, totalMarks = 0 }) {
  // slot_db_id → assigned data
  const assignMap = useMemo(() => {
    const m = {}
    for (const s of autoAssignedSlots || []) m[s.slot_db_id] = s
    return m
  }, [autoAssignedSlots])

  const [localOverrides, setLocalOverrides] = useState({})
  const [savingSlot, setSavingSlot] = useState({})
  const [expanded, setExpanded] = useState({})

  // ── Import CSV state ────────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [slotTemplates, setSlotTemplates] = useState([])
  const importFileRef = React.useRef(null)

  // Load template list when panel opens
  useEffect(() => {
    if (!showImport || slotTemplates.length > 0) return
    papersApi.slotTemplates().then(r => setSlotTemplates(r.data || [])).catch(() => {})
  }, [showImport, slotTemplates.length])

  const handleDownloadTemplate = async (tpl) => {
    try {
      const r = await papersApi.downloadSlotTemplate(tpl.id)
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url; a.download = tpl.filename; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download template')
    }
  }

  const handleImportFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setImporting(true)
    setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await papersApi.importSlotsCsv(paperId, fd)
      setImportResult(r.data)
      toast.success(`Imported! ${r.data.slots_updated} slot(s) updated.`)
      onSlotUpdated?.()
    } catch (err) {
      const msg = err.response?.data?.detail || 'Import failed'
      toast.error(msg)
      setImportResult({ error: msg })
    } finally {
      setImporting(false)
      // Reset file input so same file can be re-uploaded
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }

  const coById   = useMemo(() => Object.fromEntries(cos.map(c => [c.id, c])), [cos])
  const bloomsById = useMemo(() => Object.fromEntries(bloomsLevels.map(b => [b.id, b])), [bloomsLevels])

  // Build a flat map of all slots across all sections for OR-sync
  const allSlots = useMemo(() => {
    const m = {}
    for (const sec of sections) for (const q of sec.questions || []) m[q.id] = q
    return m
  }, [sections])

  // Get all slots in the same OR group
  const getOrGroupSlots = (q) => {
    if (!q.choice_group) return []
    return Object.values(allSlots).filter(s => s.choice_group === q.choice_group && s.id !== q.id)
  }

  const getSlotCO = (q) => {
    const ov = localOverrides[q.id]
    if (ov?.co_id !== undefined) return coById[ov.co_id]?.co_code ?? null
    return assignMap[q.id]?.assigned_co ?? q.co_code ?? null
  }

  const getSlotBlooms = (q) => {
    const ov = localOverrides[q.id]
    if (ov?.blooms_id !== undefined) return bloomsById[ov.blooms_id]?.level_code ?? null
    return assignMap[q.id]?.assigned_blooms ?? q.blooms_code ?? null
  }

  // When CO changes — save the slot; if it's a mandatory slot, pre-fill unset OR peers too
  const handleCOChange = async (q, coId) => {
    const parsed = coId ? parseInt(coId) : null
    // Only pre-fill OR peers that have no CO yet (don't overwrite independent OR choices)
    const orPeers = q.is_optional ? [] : getOrGroupSlots(q).filter(p => p.is_optional && !getSlotCO(p))

    setLocalOverrides(p => {
      const next = { ...p, [q.id]: { ...(p[q.id] || {}), co_id: parsed } }
      for (const peer of orPeers) next[peer.id] = { ...(p[peer.id] || {}), co_id: parsed }
      return next
    })

    if (!canEdit) return
    setSavingSlot(p => ({ ...p, [q.id]: true }))
    try {
      await papersApi.updateSlot(paperId, q.id, { co_id: parsed })
      if (orPeers.length) {
        await Promise.all(orPeers.map(peer => papersApi.updateSlot(paperId, peer.id, { co_id: parsed })))
      }
      onSlotUpdated?.()
    } catch {
      toast.error('Failed to save CO assignment')
    } finally {
      setSavingSlot(p => ({ ...p, [q.id]: false }))
    }
  }

  // When Bloom's changes — save slot; pre-fill unset OR peers if this is mandatory
  const handleBloomsChange = async (q, bloomsId) => {
    const parsed = bloomsId ? parseInt(bloomsId) : null
    const orPeers = q.is_optional ? [] : getOrGroupSlots(q).filter(p => p.is_optional && !getSlotBlooms(p))

    setLocalOverrides(p => {
      const next = { ...p, [q.id]: { ...(p[q.id] || {}), blooms_id: parsed } }
      for (const peer of orPeers) next[peer.id] = { ...(p[peer.id] || {}), blooms_id: parsed }
      return next
    })

    if (!canEdit) return
    setSavingSlot(p => ({ ...p, [q.id]: true }))
    try {
      await papersApi.updateSlot(paperId, q.id, { blooms_id: parsed })
      if (orPeers.length) {
        await Promise.all(orPeers.map(peer => papersApi.updateSlot(paperId, peer.id, { blooms_id: parsed })))
      }
      onSlotUpdated?.()
    } catch {
      toast.error("Failed to save Bloom's assignment")
    } finally {
      setSavingSlot(p => ({ ...p, [q.id]: false }))
    }
  }

  const exportCsv = () => {
    // Exact format matching sample_data CSVs:
    // Col:  Que | Mark | Q.N | sub-label | OR | MARKS | CO | BLOOM'S
    // Rules:
    //  • Que      = slot_id  (e.g. "Q1. A", "2A", "2B")
    //  • Mark     = assigned_marks
    //  • Q.N      = "Q.N" label only on the FIRST sub-question row of the section
    //  • sub-label = slot_label stored in DB (e.g. "(a)", "I", "II")
    //  • OR row   = blank row with just "OR" in col 5
    //  • MARKS    = same as Mark (duplicate col 6)
    //  • CO       = assigned CO code
    //  • BLOOM'S  = assigned Bloom's level code
    const esc = (v) => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const row = (...cols) => cols.map(esc).join(',')

    const lines = []
    lines.push(row('Que', 'Mark', '', '', '', 'MARKS', 'CO', "BLOOM'S"))

    for (const sec of sections) {
      const qs = sec.questions || []

      // Build ordered groups: each group = [canonical, ...orPeers]
      // A canonical is any non-OR slot. Its peers are OR slots in the same choice_group.
      const seen = new Set()
      const groups = []
      for (const q of qs) {
        if (seen.has(q.id)) continue
        seen.add(q.id)
        if (!q.is_optional) {
          // mandatory: find all OR peers sharing the same choice_group
          const peers = q.choice_group
            ? qs.filter(p => p.choice_group === q.choice_group && p.id !== q.id)
            : []
          peers.forEach(p => seen.add(p.id))
          groups.push([q, ...peers])
        } else if (!q.choice_group) {
          // standalone optional with no group
          groups.push([q])
        }
      }
      // catch any orphaned OR slots
      for (const q of qs) {
        if (!seen.has(q.id)) { seen.add(q.id); groups.push([q]) }
      }

      // Q.N label: e.g. "Q.2" — section index +1, only printed on first sub-question row
      const secIdx = sections.indexOf(sec)
      const qNum = `Q.${secIdx + 1}`
      let qNumPrinted = false

      for (const group of groups) {
        const [canon, ...peers] = group
        const co = getSlotCO(canon) || ''
        const bl = getSlotBlooms(canon) || ''

        // Que column = slot_id; sub-label column = slot_label
        const queLabel = canon.slot_id || canon.slot_label || ''
        const subLabel = canon.slot_label || ''

        if (peers.length > 0) {
          // canonical row — print Q.N only on first row of section
          lines.push(row(queLabel, canon.assigned_marks, qNumPrinted ? '' : qNum, subLabel, '', canon.assigned_marks, co, bl))
          qNumPrinted = true
          // OR separator
          lines.push(row('', '', '', '', 'OR', '', '', ''))
          // OR alternative rows — Que=slot_id, sub=slot_label, blank Q.N
          for (const peer of peers) {
            const pco = getSlotCO(peer) || ''
            const pbl = getSlotBlooms(peer) || ''
            lines.push(row(peer.slot_id || peer.slot_label || '', peer.assigned_marks, '', peer.slot_label || '', '', peer.assigned_marks, pco, pbl))
          }
        } else {
          lines.push(row(queLabel, canon.assigned_marks, qNumPrinted ? '' : qNum, subLabel, '', canon.assigned_marks, co, bl))
          qNumPrinted = true
        }
      }
      // blank separator row between sections
      lines.push(row('', '', '', '', '', '', '', ''))
    }

    // Total row — matches sample: ,88,,,,,TOTAL,
    lines.push(row('', totalMarks, '', '', '', '', 'TOTAL', ''))

    // CO Target Marks appendix (target % and mark allocation)
    if (Object.keys(coTargets).length > 0 && totalMarks > 0) {
      lines.push(row('', '', '', '', '', '', '', ''))
      lines.push(row('CO Target Marks', '', '', '', '', '', '', ''))
      // Use Largest-Remainder so marks always sum exactly to totalMarks
      const pctSum = Object.values(coTargets).reduce((a, v) => a + v, 0)
      const norm = pctSum > 0 ? Object.fromEntries(Object.entries(coTargets).map(([k, v]) => [k, v / pctSum * 100])) : coTargets
      const exact = Object.fromEntries(Object.entries(norm).map(([k, v]) => [k, v / 100 * totalMarks]))
      const floors = Object.fromEntries(Object.entries(exact).map(([k, v]) => [k, Math.floor(v)]))
      const needed = totalMarks - Object.values(floors).reduce((a, v) => a + v, 0)
      const sorted = Object.keys(exact).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])))
      sorted.slice(0, needed).forEach(k => { floors[k]++ })
      for (const coCode of Object.keys(coTargets)) {
        lines.push(row(coCode, `${coTargets[coCode]}%`, `${floors[coCode]}m`, '', '', '', '', ''))
      }
    }

    const csv = lines.join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `paper_${paperId}_slots.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // Group questions within a section: canonical slots with their OR peers nested
  /**
   * Converts a flat questions array into display blocks matching the sample CSVs.
   *
   * Three OR patterns from the sample data:
   *
   * Pattern A — per-sub OR (Q2):  each mandatory sub has its own alt immediately after it
   *   mandatory 2A  → block { mandatories:[2A], ors:[] }
   *   mandatory 2B  → block { mandatories:[2B], ors:[2B_alt0] }
   *   mandatory 2C  → block { mandatories:[2C], ors:[2C_alt0] }
   *
   * Pattern B-partial (Q3):  3A is free; 3B+3C share a group with their alts
   *   mandatory 3A  → block { mandatories:[3A], ors:[] }
   *   group Q3_or   → block { mandatories:[3B,3C], ors:[3B_alt0,3C_alt0] }
   *
   * Pattern B-full (Q4/Q5):  all mandatories share one group
   *   group Q4_or   → block { mandatories:[4A,4B,4C], ors:[4A_alt0,4B_alt0,4C_alt0] }
   *
   * Each block renders as:
   *   mandatory row(s)       ← editable CO/Bloom's dropdowns
   *   [— OR —] divider       ← only if ors.length > 0
   *   OR alt row(s)          ← read-only badges, "same as above"
   */
  const buildSectionBlocks = (questions) => {
    const mandatories = questions.filter(q => !q.is_optional)
    const orAlts      = questions.filter(q =>  q.is_optional)

    // Group OR alts by their choice_group
    const altsByGroup = {}
    for (const q of orAlts) {
      const g = q.choice_group || `__solo_${q.id}`
      ;(altsByGroup[g] = altsByGroup[g] || []).push(q)
    }

    // Each mandatory gets put into a group keyed by its choice_group (or its own id if none)
    const mandByGroup = {}
    const groupOrder  = []
    for (const q of mandatories) {
      const g = q.choice_group || `__solo_${q.id}`
      if (!mandByGroup[g]) { mandByGroup[g] = []; groupOrder.push(g) }
      mandByGroup[g].push(q)
    }

    // Any OR alt whose group has NO mandatories gets its own solo block
    for (const g of Object.keys(altsByGroup)) {
      if (!mandByGroup[g]) { mandByGroup[g] = []; groupOrder.push(g) }
    }

    return groupOrder.map(g => ({
      mandatories: mandByGroup[g] || [],
      ors: altsByGroup[g] || [],
    }))
  }

  // ── Slot row renderer — shared between mandatory and OR rows ──────────────
  const SlotRow = ({ q, isOr = false, isFirst = false, rowBg = 'bg-white' }) => {
    const assignedCO  = getSlotCO(q)
    const assignedBL  = getSlotBlooms(q)
    const isSaving    = savingSlot[q.id]
    const currentCOId = cos.find(c => c.co_code === assignedCO)?.id ?? ''
    const currentBLId = bloomsLevels.find(b => b.level_code === assignedBL)?.id ?? ''

    // Sub-label: show "(a)", "(b)" etc. as primary; slot_id like "2A" as secondary chip
    const subLabel  = q.slot_label || ''
    const slotId    = q.slot_id || ''
    // Strip "_alt0" suffix from OR slot_id for display: "2B_alt0" → "2B"
    const dispSlotId = slotId.replace(/_alt\d+$/, '')

    const bg = isOr ? 'bg-amber-50/60' : rowBg

    return (
      <tr className={`${bg} border-b border-gray-100`}>
        {/* Sub-label column: (a) / (b) / Roman numeral */}
        <td className="px-2 py-1.5 align-middle">
          <div className="flex items-center gap-1.5">
            {isOr && (
              <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest leading-none">OR</span>
            )}
            <div>
              <span className={`font-semibold text-[12px] ${isOr ? 'text-amber-700' : 'text-gray-800'}`}>
                {subLabel || dispSlotId}
              </span>
              {subLabel && dispSlotId && dispSlotId !== subLabel && (
                <span className={`block text-[10px] font-mono leading-none mt-0.5 ${isOr ? 'text-amber-400' : 'text-gray-400'}`}>
                  {dispSlotId}
                </span>
              )}
            </div>
          </div>
        </td>
        {/* Marks */}
        <td className="px-1 py-1.5 text-center align-middle">
          <span className={`text-[11px] font-bold ${isOr ? 'text-amber-600' : 'text-blue-700'}`}>
            {q.assigned_marks}m
          </span>
        </td>
        {/* CO */}
        <td className="px-2 py-1.5 align-middle">
          {canEdit ? (
            <div className="flex items-center gap-1">
              <select
                className="input text-xs py-0 px-1.5 h-6 w-full"
                value={currentCOId}
                onChange={e => handleCOChange(q, e.target.value)}
                disabled={isSaving}
              >
                <option value="">— CO —</option>
                {cos.map(c => <option key={c.id} value={c.id}>{c.co_code}</option>)}
              </select>
              {isSaving && <RefreshCw size={9} className="animate-spin text-blue-400 shrink-0" />}
            </div>
          ) : (
            assignedCO
              ? <span className="inline-flex items-center font-bold text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">{assignedCO}</span>
              : <span className="text-gray-300 text-xs">—</span>
          )}
        </td>
        {/* Bloom's */}
        <td className="px-2 py-1.5 align-middle">
          {canEdit ? (
            <select
              className="input text-xs py-0 px-1.5 h-6 w-full"
              value={currentBLId}
              onChange={e => handleBloomsChange(q, e.target.value)}
              disabled={isSaving}
            >
              <option value="">— Bloom's —</option>
              {bloomsLevels.map(b => (
                <option key={b.id} value={b.id}>{b.level_code} – {BLOOMS_NAMES[b.level_code] || b.level_name}</option>
              ))}
            </select>
          ) : (
            assignedBL
              ? <span className="inline-flex items-center font-bold text-[11px] px-2 py-0.5 rounded-full border"
                  style={{ background: (BLOOMS_COLORS[assignedBL] || '#888') + '22', color: BLOOMS_COLORS[assignedBL] || '#6b7280', borderColor: (BLOOMS_COLORS[assignedBL] || '#888') + '66' }}>
                  {assignedBL}
                </span>
              : <span className="text-gray-300 text-xs">—</span>
          )}
        </td>
        {/* Question text */}
        <td className="px-2 py-1.5 align-middle">
          <span className={`line-clamp-2 leading-snug text-[11px] ${isOr ? 'text-amber-700' : 'text-gray-600'}`}>
            {q.slot_question_text || q.question_text || <span className="text-gray-300 italic">no text</span>}
          </span>
        </td>
      </tr>
    )
  }

  // Shared table header
  const TableHead = () => (
    <thead>
      <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold text-[11px]">
        <th className="text-left px-2 py-1.5 w-20">Sub</th>
        <th className="text-center px-1 py-1.5 w-12">Marks</th>
        <th className="text-left px-2 py-1.5 w-28">CO</th>
        <th className="text-left px-2 py-1.5 w-36">Bloom's</th>
        <th className="text-left px-2 py-1.5">Question Text</th>
      </tr>
    </thead>
  )

  // ── CO target marks strip ────────────────────────────────────────────────
  // Compute target marks per CO (largest-remainder so they sum exactly)
  const coTargetMarks = useMemo(() => largestRemainder(coTargets, totalMarks), [coTargets, totalMarks])

  // Compute actual assigned marks per CO from current slot state (includes OR alts)
  const coActualMarks = useMemo(() => {
    const m = {}
    for (const sec of sections) {
      for (const q of sec.questions || []) {
        const co = getSlotCO(q)
        if (co) m[co] = (m[co] || 0) + (q.assigned_marks || 0)
      }
    }
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, localOverrides, assignMap])

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Slot Assignments</span>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <button
              onClick={() => { setShowImport(p => !p); setImportResult(null) }}
              className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded hover:bg-blue-100 transition-colors"
            >
              <Plus size={11} /> Import CSV
            </button>
          )}
          <button onClick={exportCsv}
            className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded hover:bg-green-100 transition-colors">
            <Download size={11} /> Export CSV
          </button>
        </div>
      </div>

      {/* ── CO Target Marks strip ── */}
      {Object.keys(coTargets).length > 0 && totalMarks > 0 && (
        <div className="border-b border-gray-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            CO Target Marks
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(coTargets).map(([co, pct], i) => {
              const tgtM  = coTargetMarks[co] ?? 0
              const actM  = coActualMarks[co] ?? 0
              const fill  = tgtM > 0 ? Math.min(100, Math.round(actM / tgtM * 100)) : 0
              const ok    = tgtM > 0 && Math.abs(actM - tgtM) <= 1
              const color = CO_COLORS[i % CO_COLORS.length]
              return (
                <div key={co} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 min-w-[90px]">
                  {/* color dot */}
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    {/* CO label + marks */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-gray-800">{co}</span>
                      <span className="text-[11px] font-mono text-gray-500">
                        <span className={`font-bold ${ok ? 'text-green-600' : actM > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                          {actM}m
                        </span>
                        <span className="text-gray-300 mx-0.5">/</span>
                        <span className="text-indigo-600 font-semibold">{tgtM}m</span>
                      </span>
                    </div>
                    {/* progress bar */}
                    <div className="h-1 rounded-full bg-gray-200 mt-0.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${fill}%`, backgroundColor: ok ? '#22c55e' : color }}
                      />
                    </div>
                    {/* target % label */}
                    <div className="text-[9px] text-gray-400 mt-0.5">{pct}% target</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Import CSV panel ── */}
      {showImport && (
        <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-800">Import CO & Bloom's from CSV</span>
            <button onClick={() => setShowImport(false)} className="text-blue-400 hover:text-blue-700">
              <X size={13} />
            </button>
          </div>

          {/* Step 1 */}
          <div className="bg-white border border-blue-200 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-blue-800">Step 1 — Download your paper's CSV</p>
            <p className="text-[11px] text-blue-600">This generates a CSV with the exact slot IDs for your paper, with any already-assigned CO &amp; Bloom's pre-filled.</p>
            <button
              className="flex items-center gap-1.5 text-[11px] bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 transition-colors font-medium"
              onClick={exportCsv}
            >
              <Download size={10} /> Download My Paper CSV
            </button>
          </div>

          {/* Step 2 */}
          <div className="bg-white border border-blue-200 rounded-lg px-3 py-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-blue-800">Step 2 — Fill CO &amp; Bloom's columns, then upload</p>
            <p className="text-[11px] text-blue-600">
              Open the downloaded CSV in Excel or Google Sheets. Fill in the <strong>CO</strong> column (e.g. <code className="bg-blue-50 px-1 rounded">CO1</code>) and <strong>BLOOM'S</strong> column (e.g. <code className="bg-blue-50 px-1 rounded">R</code>, <code className="bg-blue-50 px-1 rounded">U</code>, <code className="bg-blue-50 px-1 rounded">Ap</code>, <code className="bg-blue-50 px-1 rounded">An</code>, <code className="bg-blue-50 px-1 rounded">E</code>) for each slot, then save as CSV and upload below.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input ref={importFileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={handleImportFile} disabled={importing} />
              <span className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border font-medium transition-colors ${
                importing ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white border-blue-300 text-blue-700 hover:bg-blue-50'
              }`}>
                {importing ? <><RefreshCw size={11} className="animate-spin" /> Importing…</> : <><Upload size={11} /> Upload Filled CSV</>}
              </span>
            </label>
          </div>

          {/* Result / error */}
          {importResult && !importResult.error && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 text-[11px] text-green-700 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 size={12} /> Import successful — {importResult.slots_updated} slot(s) updated
              </div>
              {importResult.unmatched_csv_slot_ids?.length > 0 && (
                <div className="text-amber-600 flex items-start gap-1">
                  <AlertCircle size={11} className="mt-0.5 shrink-0" />
                  <span>Unmatched slot IDs (not found in this paper): <strong>{importResult.unmatched_csv_slot_ids.join(', ')}</strong></span>
                </div>
              )}
              {importResult.paper_slot_ids_without_co?.length > 0 && (
                <div className="text-amber-600 flex items-start gap-1">
                  <AlertCircle size={11} className="mt-0.5 shrink-0" />
                  <span>Slots still without CO: <strong>{importResult.paper_slot_ids_without_co.join(', ')}</strong></span>
                </div>
              )}
            </div>
          )}
          {importResult?.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-[11px] text-red-700 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold"><AlertCircle size={12} /> Upload failed</div>
              <div>{importResult.error}</div>
            </div>
          )}
        </div>
      )}

      {/* ── One card per section ── */}
      {sections.map((sec, secIdx) => {
        const qs       = sec.questions || []
        const blocks   = buildSectionBlocks(qs)
        const qNum     = secIdx + 1
        const qLabel   = `Q.${qNum}`
        const totalSec = qs.filter(q => !q.is_optional).reduce((a, q) => a + (q.assigned_marks || 0), 0)

        return (
          <div key={sec.id} className="border-b border-gray-200 last:border-b-0">

            {/* Section header — mirrors Q.1 / Q.2 labels from the sample CSV */}
            <div className="flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white">
              <span className="font-extrabold text-sm tracking-wide">{qLabel}</span>
              <span className="flex-1 text-xs font-medium opacity-90">{sec.section_name}</span>
              <span className="text-xs font-bold bg-white/20 rounded px-2 py-0.5">{totalSec} marks</span>
            </div>

            {/* Blocks: each block is one logical OR-group (or a solo row for free slots) */}
            <div className="divide-y divide-gray-100">
              {blocks.map((block, bi) => {
                const hasOr    = block.ors.length > 0
                const rowBg    = bi % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'

                return (
                  <div key={bi}>
                    {/* ── Mandatory sub-slot(s) ── */}
                    <table className="w-full text-xs border-collapse">
                      {bi === 0 && <TableHead />}
                      <tbody>
                        {block.mandatories.map((q, mi) => (
                          <SlotRow key={q.id} q={q} isOr={false} isFirst={mi === 0} rowBg={rowBg} />
                        ))}

                        {/* ── OR divider + OR alternative rows ── */}
                        {hasOr && (
                          <>
                            <tr>
                              <td colSpan={5} className="py-0">
                                <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 border-y border-amber-200">
                                  <div className="flex-1 h-px bg-amber-300" />
                                  <span className="text-[10px] font-extrabold text-amber-700 tracking-[0.2em] uppercase">OR</span>
                                  <div className="flex-1 h-px bg-amber-300" />
                                </div>
                              </td>
                            </tr>
                            {block.ors.map(peer => (
                              <SlotRow key={peer.id} q={peer} isOr={true} rowBg={rowBg} />
                            ))}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>

          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: Paper Editor with CO/Bloom's Wizard
// ─────────────────────────────────────────────────────────────────────────────

function PaperEditor({ paperId, onClose }) {
  const qc = useQueryClient()

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeStep, setActiveStep] = useState('targets')  // 'targets' | 'preview' | 'slots'
  const [coTargets, setCoTargets] = useState({})
  const [bloomsTargets, setBloomsTargets] = useState({
    R: 15, U: 20, Ap: 30, An: 20, E: 10, C: 5,
  })
  const [previewResult, setPreviewResult] = useState(null)
  const [autoAssignResult, setAutoAssignResult] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── Inline duplicate-check (slots step) ────────────────────────────────────
  const [dupChecking, setDupChecking] = useState(false)
  const [dupResult,   setDupResult]   = useState(null)
  const editorDupFileRef = useRef(null)

  const _runEditorDupCheck = async (formData) => {
    setDupChecking(true); setDupResult(null)
    try {
      const r = await papersApi.checkDuplicates(paperId, formData)
      setDupResult(r.data)
      if (r.data.total_rows === 0) toast('No question texts in slots yet.', { icon: 'ℹ️' })
      else if (r.data.duplicate_count === 0) toast.success('No duplicates found — all questions are unique!')
      else toast.error(`${r.data.duplicate_count} potential duplicate(s) found`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Duplicate check failed')
    } finally {
      setDupChecking(false)
      if (editorDupFileRef.current) editorDupFileRef.current.value = ''
    }
  }

  const handleEditorDupCheck = () => _runEditorDupCheck(null)

  const handleEditorDupFileUpload = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const fd = new FormData()
    fd.append('file', f)
    _runEditorDupCheck(fd)
  }

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data: paper, isLoading: paperLoading } = useQuery({
    queryKey: ['paper', paperId],
    queryFn: () => papersApi.get(paperId).then(r => r.data),
  })

  const subjectId = paper?.subject_id
  const configId  = paper?.configuration_id

  const { data: cos = [] } = useQuery({
    queryKey: ['cos', subjectId],
    queryFn: () => masterApi.cos(subjectId).then(r => r.data),
    enabled: !!subjectId,
    staleTime: 0,
  })

  const { data: bloomsLevels = [] } = useQuery({
    queryKey: ['blooms'],
    queryFn: () => masterApi.blooms().then(r => r.data),
    staleTime: Infinity,
  })

  // Fetch the exam config template to get stored co_targets / blooms_targets
  const { data: configTemplate } = useQuery({
    queryKey: ['paper-template', configId],
    queryFn: () => papersApi.template(configId).then(r => r.data),
    enabled: !!configId,
    staleTime: Infinity,   // template rarely changes
  })

  // Pre-fill Bloom's targets from template when it loads (only on first load)
  useEffect(() => {
    if (!configTemplate?.blooms_targets) return
    const tgt = configTemplate.blooms_targets
    if (Object.keys(tgt).length === 0) return
    setBloomsTargets(tgt)
  }, [configTemplate])

  // Units of the subject (from the uploaded syllabus): CO n takes the % weightage of Unit n
  const { data: syllabusUnits } = useQuery({
    queryKey: ['units-for-targets', subjectId],
    queryFn: () => masterApi.units(subjectId).then(r => r.data),
    enabled: !!subjectId,
    staleTime: 0,
  })

  // Initialise CO targets: prefer template co_targets, fall back to equal distribution.
  // NOTE: do NOT add an early-return on "all COs already have a target" here —
  // configTemplate often loads *after* cos, so the first run uses equal distribution
  // and the second run (when configTemplate arrives) must overwrite with template values.
  useEffect(() => {
    if (cos.length === 0) return

    const templateCO = configTemplate?.co_targets || {}
    // CO n <- Unit n weightage, when every CO has a matching unit
    const numOf = (code) => { const m = String(code || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : null }
    const unitByNo = {}
    ;(syllabusUnits || []).forEach(u => { const n = numOf(u.unit_code); if (n !== null) unitByNo[n] = Number(u.weight_percent) || 0 })
    const unitCO = {}
    cos.forEach(co => { const n = numOf(co.co_code); if (n !== null && unitByNo[n] !== undefined) unitCO[co.co_code] = unitByNo[n] })
    const hasAllFromUnits = cos.every(co => unitCO[co.co_code] !== undefined) &&
      Object.values(unitCO).reduce((a, v) => a + v, 0) > 0

    const hasAllFromTemplate = cos.every(co => templateCO[co.co_code] !== undefined)

    if (hasAllFromUnits) {
      setCoTargets(unitCO)
    } else if (hasAllFromTemplate) {
      // Template covers all subject COs — use template values directly
      // only the COs this subject has (the template may list extra ones, e.g. CO5)
      const only = {}
      cos.forEach(co => { only[co.co_code] = Number(templateCO[co.co_code]) || 0 })
      const sum = Object.values(only).reduce((a, v) => a + v, 0)
      if (sum > 0) {
        const scaled = {}
        let acc = 0
        cos.forEach((co, i) => {
          const v = i === cos.length - 1 ? 100 - acc : Math.round(only[co.co_code] / sum * 100)
          scaled[co.co_code] = v
          acc += v
        })
        setCoTargets(scaled)
      } else {
        setCoTargets(only)
      }
    } else {
      // Partial or no template: equal distribution fallback,
      // preferring any per-CO template value that does exist.
      const eq = Math.round(100 / cos.length)
      const init = {}
      cos.forEach((co, i) => {
        init[co.co_code] = templateCO[co.co_code] !== undefined
          ? templateCO[co.co_code]
          : i === cos.length - 1
            ? 100 - eq * (cos.length - 1)
            : eq
      })
      setCoTargets(init)
    }
  }, [cos, configTemplate, syllabusUnits])

  const { data: existingAnalysis = null } = useQuery({
    queryKey: ['paper-analysis', paperId],
    queryFn: () => papersApi.analysis(paperId).then(r => r.data).catch(() => null),
    retry: false,
    throwOnError: false,
  })

  // When the user lands on the slots step without having run auto-assign this
  // session (e.g. reopening an already-assigned paper), bootstrap autoAssignResult
  // from a fresh recalculate so the Summary Table and charts are populated.
  // Always pass live coTargets/bloomsTargets so summary_table is built correctly.
  useEffect(() => {
    if (activeStep !== 'slots') return
    if (autoAssignResult) return          // already have data
    if (!paperId) return
    // Wait until targets are loaded before bootstrapping
    if (Object.keys(coTargets).length === 0) return
    papersApi.recalculate(paperId, {
      co_targets: coTargets,
      blooms_targets: bloomsTargets,
    })
      .then(r => {
        if (r?.data) {
          setAutoAssignResult(prev => prev ?? {
            analysis: r.data.analysis,
            summary_table: r.data.summary_table,
            slots: [],
            gaps: [],
            saved: true,
          })
        }
      })
      .catch(() => {})
  }, [activeStep, paperId, coTargets, bloomsTargets]) // include targets so it re-runs when they load

  // ── Editable title / year — MUST be before any early return (Rules of Hooks) ──
  const [editingMeta, setEditingMeta] = useState(false)
  const [metaForm, setMetaForm] = useState({ title: '', academic_year: '' })

  const updateMetaMut = useMutation({
    mutationFn: (data) => papersApi.updateMeta(paperId, data),
    onSuccess: () => {
      toast.success('Paper details updated!')
      setEditingMeta(false)
      qc.invalidateQueries(['paper', paperId])
      qc.invalidateQueries(['papers'])
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Update failed'),
  })

  const handleStartMetaEdit = () => {
    setMetaForm({ title: paper?.title || '', academic_year: paper?.academic_year || '' })
    setEditingMeta(true)
  }

  // ── Computed values ─────────────────────────────────────────────────────────
  const totalMarks = useMemo(() => {
    if (!paper) return 0
    return (paper.sections || []).reduce((a, s) => a + (s.marks_allocated || 0), 0)
  }, [paper])

  const allSlots = useMemo(() => {
    if (!paper) return []
    return (paper.sections || []).flatMap(sec =>
      (sec.questions || []).map(q => ({
        slot_id: q.slot_id || String(q.id),
        marks: q.assigned_marks,
        is_or: q.is_optional,
        or_group: q.choice_group,
      }))
    )
  }, [paper])

  // ── CO target slider change ─────────────────────────────────────────────────
  const handleCOChange = useCallback((code, val) => {
    setCoTargets(prev => ({ ...prev, [code]: val }))
    setPreviewResult(null)
  }, [])

  const handleBloomsChange = useCallback((code, val) => {
    setBloomsTargets(prev => ({ ...prev, [code]: val }))
    setPreviewResult(null)
  }, [])

  // ── Preview (no save) ───────────────────────────────────────────────────────
  const handlePreview = async () => {
    if (!paperId || allSlots.length === 0) return
    setPreviewing(true)
    try {
      const r = await papersApi.autoAssign(paperId, {
        co_targets: coTargets,
        blooms_targets: bloomsTargets,
        save: false,
      })
      setPreviewResult(r.data)
      setAutoAssignResult(r.data)
      setActiveStep('preview')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  // ── Auto-assign & save ──────────────────────────────────────────────────────
  const handleAutoAssign = async () => {
    if (!paperId) return
    setSaving(true)
    try {
      const r = await papersApi.autoAssign(paperId, {
        co_targets: coTargets,
        blooms_targets: bloomsTargets,
        save: true,
      })
      setAutoAssignResult(r.data)
      setPreviewResult(r.data)
      qc.invalidateQueries(['paper', paperId])
      qc.invalidateQueries(['paper-analysis', paperId])
      toast.success(`CO & Bloom's auto-assigned to ${r.data.slots?.length} slots!`)
      setActiveStep('slots')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Auto-assign failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Submit paper ────────────────────────────────────────────────────────────
  const submitMut = useMutation({
    mutationFn: (action = 'submit') => papersApi.transition(paperId, { action, comments: 'Submitting after CO/Bloom assignment' }),
    onSuccess: (_, action) => {
      if (action === 'submit_to_exam') {
        toast.success('Paper submitted directly to Exam Cell!')
      } else {
        toast.success('Paper submitted for HOD review!')
      }
      qc.invalidateQueries(['papers'])
      onClose()
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Submit failed'),
  })

  // ── Early return while loading ───────────────────────────────────────────────
  if (paperLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <RefreshCw className="animate-spin mr-2" size={16} /> Loading paper…
      </div>
    )
  }

  // Prefer live existingAnalysis (refetched after each slot save) over the
  // stale snapshot stored in autoAssignResult. Fall back to autoAssignResult
  // only when no persisted analysis exists yet (brand-new paper).
  const activeAnalysis = existingAnalysis || autoAssignResult?.analysis || null
  const activeSlots = autoAssignResult?.slots || []
  const gaps = autoAssignResult?.gaps || []

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editingMeta ? (
            <div className="flex flex-col gap-2">
              <input
                className="input text-base font-bold"
                value={metaForm.title}
                onChange={e => setMetaForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Paper title"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <input
                  className="input text-sm w-36"
                  value={metaForm.academic_year}
                  onChange={e => setMetaForm(f => ({ ...f, academic_year: e.target.value }))}
                  placeholder="e.g. 2026-2027"
                />
                <button
                  className="btn-primary text-sm px-3 py-1"
                  disabled={updateMetaMut.isPending || !metaForm.title.trim()}
                  onClick={() => updateMetaMut.mutate(metaForm)}
                >
                  {updateMetaMut.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="btn-secondary text-sm px-3 py-1"
                  onClick={() => setEditingMeta(false)}
                >Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{paper?.title}</h3>
                <p className="text-sm text-gray-500">
                  {paper?.exam_type?.replace(/_/g, ' ')} · {paper?.academic_year} · {totalMarks} total marks
                </p>
              </div>
              {['draft', 'hod_returned', 'principal_returned'].includes(paper?.status) && (
                <button
                  className="text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded px-1.5 py-0.5 transition-colors mt-1 shrink-0"
                  title="Edit title & year"
                  onClick={handleStartMetaEdit}
                >✏️</button>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          {paper?.status === 'draft' && autoAssignResult?.saved && (
            <>
              <button
                className="btn-primary text-sm flex items-center gap-1"
                onClick={() => submitMut.mutate('submit')}
                disabled={submitMut.isPending}
              >
                <CheckCircle2 size={14} />
                {submitMut.isPending ? 'Submitting…' : 'Submit to HOD'}
              </button>
              <button
                className="text-sm flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
                onClick={() => submitMut.mutate('submit_to_exam')}
                disabled={submitMut.isPending}
                title="Bypass HOD/Principal and submit directly to Exam Moderation Cell"
              >
                <CheckCircle2 size={14} />
                Submit to Exam Cell
              </button>
            </>
          )}
          <button className="btn-secondary text-sm" onClick={onClose}>← Back</button>
        </div>
      </div>

      {/* ── Step tabs ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {[
          { id: 'targets', label: 'Set Targets', icon: Sliders },
          { id: 'preview', label: 'Preview', icon: Eye },
          { id: 'slots', label: 'Slot Assignments', icon: BarChart2 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveStep(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeStep === id ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <Icon size={13} /> {label}
            {id === 'slots' && activeSlots.length > 0 && (
              <span className="bg-green-100 text-green-700 rounded-full text-xs px-1.5">{activeSlots.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── STEP 1: Set Targets ── */}
      {activeStep === 'targets' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* CO sliders */}
          <div className="card">
            <COTargetPanel
              cos={cos}
              coTargets={coTargets}
              onChange={handleCOChange}
              totalMarks={totalMarks}
            />
          </div>

          {/* Bloom's sliders */}
          <div className="card">
            <BloomsTargetPanel
              bloomsTargets={bloomsTargets}
              onChange={handleBloomsChange}
              totalMarks={totalMarks}
            />
          </div>

          {/* Paper summary */}
          <div className="xl:col-span-2">
            <div className="card bg-blue-50 border-blue-200">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-sm font-semibold text-blue-900 mb-1">Paper Structure Summary</div>
                  <div className="flex gap-4 text-xs text-blue-700 flex-wrap">
                    <span>{paper?.sections?.length} sections</span>
                    <span>{allSlots.length} question slots</span>
                    <span>{totalMarks} total marks</span>
                    <span>{allSlots.filter(s => s.is_or).length} OR alternatives</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex items-center gap-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-50 transition-colors"
                    onClick={handlePreview}
                    disabled={previewing || Object.values(coTargets).every(v => v === 0)}
                  >
                    <Eye size={14} />
                    {previewing ? 'Previewing…' : 'Preview Distribution'}
                  </button>
                  <button
                    className="btn-primary flex items-center gap-1.5"
                    onClick={handleAutoAssign}
                    disabled={saving || Object.values(coTargets).every(v => v === 0)}
                  >
                    <Zap size={14} />
                    {saving ? 'Assigning…' : 'Auto-Assign & Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Preview distribution charts ── */}
      {activeStep === 'preview' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* CO Gantt */}
          <div className="card">
            <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <BarChart2 size={14} /> CO Distribution (Gantt)
            </h4>
            <COGanttChart
              actual={previewResult?.analysis?.co_distribution || {}}
              targets={coTargets}
              totalMarks={totalMarks}
            />
          </div>

          {/* Bloom's line chart */}
          <div className="card">
            <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <TrendingUp size={14} /> Bloom's Distribution — Line Chart
            </h4>
            <BloomsBellChartWidget data={previewResult?.analysis?.blooms_distribution || {}} />
          </div>

          {/* Summary Table — CO & Bloom's breakdown */}
          {autoAssignResult?.summary_table && (
            <div className="xl:col-span-2">
              <SummaryTable summaryData={autoAssignResult.summary_table} totalMarks={totalMarks} />
            </div>
          )}

          {/* Gaps report */}
          {gaps.length > 0 && (
            <div className="xl:col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm mb-2">
                <AlertCircle size={14} /> Distribution Gaps (tolerance ±1%)
              </div>
              <ul className="space-y-1">
                {gaps.map((g, i) => (
                  <li key={i} className="text-xs text-amber-700 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gaps.length === 0 && previewResult && (
            <div className="xl:col-span-2 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-600" />
              <span className="text-sm text-green-700 font-medium">Distribution matches targets within ±1% tolerance.</span>
            </div>
          )}

          <div className="xl:col-span-2 flex gap-2">
            <button className="btn-secondary" onClick={() => setActiveStep('targets')}>← Adjust Targets</button>
            <button
              className="btn-primary flex items-center gap-1.5"
              onClick={handleAutoAssign}
              disabled={saving}
            >
              <Zap size={14} /> {saving ? 'Saving…' : 'Confirm & Save Assignment'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Slot assignments table ── */}
      {activeStep === 'slots' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h4 className="font-semibold text-gray-700">Question Slot Assignments</h4>
                  {/* Target marks summary chips */}
                  {Object.keys(coTargets).length > 0 && totalMarks > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(coTargets).map(([co, pct], i) => {
                        const tgtM = Math.round(pct / 100 * totalMarks)
                        return (
                          <span key={co} className="inline-flex items-center gap-1 text-[10px] font-medium bg-indigo-50 border border-indigo-200 text-indigo-700 rounded px-1.5 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: CO_COLORS[i % CO_COLORS.length] }} />
                            {co}: {pct}% · {tgtM}m
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                    onClick={() => setActiveStep('targets')}
                  >
                    <Sliders size={12} /> Re-adjust targets
                  </button>
                  {['draft','hod_returned','principal_returned'].includes(paper?.status) && (
                    <button
                      className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3"
                      onClick={handleAutoAssign}
                      disabled={saving || Object.values(coTargets).every(v => v === 0)}
                    >
                      <Zap size={12} />
                      {saving ? 'Assigning…' : 'Auto-Assign'}
                    </button>
                  )}
                </div>
              </div>
              <AssignedSlotsTable
                sections={paper?.sections || []}
                autoAssignedSlots={activeSlots}
                cos={cos}
                bloomsLevels={bloomsLevels}
                paperId={paperId}
                coTargets={coTargets}
                totalMarks={totalMarks}
                canEdit={['draft','hod_returned','principal_returned'].includes(paper?.status)}
                onSlotUpdated={async () => {
                  // Recalculate analysis on backend, passing live targets so the
                  // CO Summary Table updates immediately after every manual slot edit.
                  try {
                    const r = await papersApi.recalculate(paperId, {
                      co_targets: coTargets,
                      blooms_targets: bloomsTargets,
                    })
                    if (r?.data) {
                      setAutoAssignResult(prev => ({
                        ...(prev || {}),
                        analysis: r.data.analysis ?? prev?.analysis,
                        summary_table: r.data.summary_table ?? prev?.summary_table,
                        saved: true,
                      }))
                    }
                  } catch (_) {}
                  qc.invalidateQueries(['paper', paperId])
                  qc.invalidateQueries(['paper-analysis', paperId])
                }}
              />

              {/* ── Duplicate Question Check ── */}
              <div className="border border-amber-200 rounded-xl overflow-hidden mt-4">
                <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={13} className="text-amber-500" />
                    <span className="text-xs font-semibold text-amber-800">Check Questions for Duplicates</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Check paper's own slots */}
                    <button
                      className="flex items-center gap-1.5 text-[11px] bg-amber-600 text-white px-2.5 py-1 rounded hover:bg-amber-700 transition-colors font-medium disabled:opacity-50"
                      onClick={handleEditorDupCheck}
                      disabled={dupChecking}
                    >
                      {dupChecking
                        ? <><RefreshCw size={10} className="animate-spin" /> Checking…</>
                        : <><ShieldAlert size={10} /> Check This Paper</>}
                    </button>
                    {/* Upload CSV/XLSX */}
                    <label className="flex items-center gap-1.5 text-[11px] bg-white border border-amber-300 text-amber-700 px-2.5 py-1 rounded hover:bg-amber-50 transition-colors font-medium cursor-pointer">
                      <input
                        ref={editorDupFileRef}
                        type="file"
                        accept=".csv,.xlsx,text/csv"
                        className="hidden"
                        onChange={handleEditorDupFileUpload}
                        disabled={dupChecking}
                      />
                      <Upload size={10} /> Upload CSV / XLSX
                    </label>
                  </div>
                </div>

                {dupResult && dupResult.total_rows === 0 && (
                  <div className="px-4 py-2 bg-white text-xs text-gray-400 italic">
                    No question texts found in slots yet. Assign questions to slots first.
                  </div>
                )}

                {dupResult && dupResult.rows.length > 0 && (
                  <div className="px-4 py-3 bg-white space-y-2">
                    {/* Summary badge */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        dupResult.duplicate_count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {dupResult.duplicate_count > 0
                          ? `${dupResult.duplicate_count} / ${dupResult.total_rows} potential duplicates`
                          : `No duplicates — all ${dupResult.total_rows} questions are unique`}
                      </span>
                    </div>

                    {/* Results table — duplicates first, then unique */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-left">
                            <th className="table-header py-1.5 w-6">#</th>
                            <th className="table-header py-1.5">Slot</th>
                            <th className="table-header py-1.5">Your Question</th>
                            <th className="table-header py-1.5 text-center w-8">CO</th>
                            <th className="table-header py-1.5 text-center w-10">Bloom's</th>
                            <th className="table-header py-1.5 text-center w-14">Match</th>
                            <th className="table-header py-1.5">Closest Existing Question</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...dupResult.rows].sort((a,b) => (b.duplicates.length>0)-(a.duplicates.length>0)).map(row => {
                            const hasDup = row.duplicates.length > 0
                            const best = row.duplicates[0]
                            const simPct = best ? Math.round(best.similarity * 100) : 0
                            return (
                              <tr key={row.row_num} className={`border-b border-gray-100 ${hasDup ? 'bg-amber-50' : ''}`}>
                                <td className="table-cell py-1 text-center text-gray-400">{row.row_num}</td>
                                <td className="table-cell py-1 whitespace-nowrap">
                                  <div className="font-mono font-bold text-[11px] text-gray-700">
                                    {row.is_optional && <span className="text-amber-500 mr-0.5">OR </span>}
                                    {row.slot_label}
                                  </div>
                                  <div className="text-[10px] text-gray-400 truncate max-w-[70px]">{row.section}</div>
                                </td>
                                <td className="table-cell py-1 max-w-xs">
                                  <span className={`line-clamp-2 leading-relaxed ${hasDup ? 'text-amber-900 font-medium' : 'text-gray-700'}`}>
                                    {row.question_text}
                                  </span>
                                </td>
                                <td className="table-cell py-1 text-center">
                                  {row.co_code
                                    ? <span className="inline-block rounded px-1 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700">{row.co_code}</span>
                                    : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="table-cell py-1 text-center">
                                  {row.blooms_code
                                    ? <span className="inline-block rounded px-1 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700">{row.blooms_code}</span>
                                    : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="table-cell py-1 text-center">
                                  {best
                                    ? <span className={`font-bold text-[11px] px-1.5 py-0.5 rounded-full ${simPct>=95?'bg-red-100 text-red-700':simPct>=85?'bg-orange-100 text-orange-700':'bg-amber-100 text-amber-700'}`}>{simPct}%</span>
                                    : <CheckCircle2 size={12} className="text-green-400 mx-auto" />}
                                </td>
                                <td className="table-cell py-1 max-w-xs text-gray-500">
                                  {best ? (
                                    <div>
                                      <div className="text-gray-700 leading-relaxed line-clamp-2">{best.question_text}</div>
                                      <div className="flex gap-1 mt-0.5 flex-wrap">
                                        {best.co_code && <span className="bg-purple-100 text-purple-700 rounded px-1 py-0.5 text-[10px]">{best.co_code}</span>}
                                        {best.blooms_code && <span className="bg-blue-100 text-blue-700 rounded px-1 py-0.5 text-[10px]">{best.blooms_code}</span>}
                                      </div>
                                    </div>
                                  ) : <span className="text-green-500 font-medium">✓ Unique</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="card">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">CO Distribution</h4>
                <COGanttChart
                  actual={activeAnalysis?.co_distribution || {}}
                  targets={coTargets}
                  totalMarks={totalMarks}
                />
              </div>
              <div className="card">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Bloom's Distribution</h4>
                <BloomsBellChartWidget data={activeAnalysis?.blooms_distribution || {}} />
              </div>
              {gaps.length === 0 && activeSlots.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-600" />
                  <span className="text-xs text-green-700">All targets met within ±1% tolerance</span>
                </div>
              )}
              {paper?.status === 'draft' && autoAssignResult?.saved && (
                <div className="space-y-2">
                  <button
                    className="btn-primary w-full flex items-center justify-center gap-1.5"
                    onClick={() => submitMut.mutate('submit')}
                    disabled={submitMut.isPending}
                  >
                    <CheckCircle2 size={14} />
                    {submitMut.isPending ? 'Submitting…' : 'Submit to HOD'}
                  </button>
                  <button
                    className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-indigo-700 transition-colors"
                    onClick={() => submitMut.mutate('submit_to_exam')}
                    disabled={submitMut.isPending}
                    title="Bypass HOD/Principal — submit directly to Exam Moderation Cell"
                  >
                    <CheckCircle2 size={14} />
                    Submit to Exam Cell
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Summary Table — shows after auto-assign OR after any manual slot edit that triggers recalculate */}
          {autoAssignResult?.summary_table && (
            <SummaryTable summaryData={autoAssignResult.summary_table} totalMarks={totalMarks} />
          )}

          {/* Live CO + Bloom's charts — always show when any analysis data exists */}
          {activeAnalysis && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* CO Distribution — horizontal bar chart */}
              <div className="card">
                <h4 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <BarChart2 size={14} className="text-blue-500" /> CO Distribution
                </h4>
                <COGanttChart
                  actual={activeAnalysis.co_distribution || {}}
                  targets={coTargets}
                  totalMarks={totalMarks}
                />
              </div>
              {/* Bloom's — proper recharts line/bell chart */}
              <div className="card">
                <h4 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <TrendingUp size={14} className="text-purple-500" /> Bloom's Distribution — Line Chart
                </h4>
                <BloomsBellChartWidget data={activeAnalysis.blooms_distribution || {}} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Paper from Template Form
// ─────────────────────────────────────────────────────────────────────────────

function CreateFromTemplateForm({ subjects, examConfigs, onCreated, onSubjectCreated }) {
  const qc = useQueryClient()
  const myDeptId = getDepartmentId()

  const [form, setForm] = useState({
    subject_id: '',
    configuration_id: '',
    title: '',
    academic_year: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
  })

  // ── Add Subject inline form ──
  const [showAddSubject, setShowAddSubject] = useState(false)
  const [subjectForm, setSubjectForm] = useState({
    subject_code: '',
    subject_name: '',
    semester: '',
  })

  const addSubjectMut = useMutation({
    mutationFn: (data) => masterApi.createSubject(data),
    onSuccess: (r) => {
      toast.success(`Subject "${r.data.subject_name}" added!`)
      // Auto-select the new subject and refresh the list
      setForm(p => ({ ...p, subject_id: String(r.data.id) }))
      setSubjectForm({ subject_code: '', subject_name: '', semester: '' })
      setShowAddSubject(false)
      qc.invalidateQueries(['subjects'])
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to add subject'),
  })

  const handleAddSubject = () => {
    if (!subjectForm.subject_code.trim() || !subjectForm.subject_name.trim()) return
    if (!myDeptId) {
      toast.error('Your account has no department assigned — ask the Owner to set your department first.')
      return
    }
    addSubjectMut.mutate({
      department_id: myDeptId,
      subject_code: subjectForm.subject_code.trim(),
      subject_name: subjectForm.subject_name.trim(),
      semester: subjectForm.semester ? parseInt(subjectForm.semester) : null,
    })
  }

  const createMut = useMutation({
    mutationFn: (data) => papersApi.fromTemplate(data),
    onSuccess: (r) => {
      toast.success(`Paper created! Now set CO & Bloom's targets.`)
      onCreated(r.data.paper_id)
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to create paper'),
  })

  const selectedConfig = examConfigs.find(c => c.id === parseInt(form.configuration_id))

  return (
    <div className="card max-w-2xl">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <Plus size={16} /> Create Paper from Template
      </h3>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Subject selector + inline add */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Subject *</label>
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                onClick={() => setShowAddSubject(p => !p)}
              >
                <Plus size={11} />
                {showAddSubject ? 'Cancel' : 'Add Subject'}
              </button>
            </div>
            <select className="input" value={form.subject_id}
              onChange={e => setForm(p => ({ ...p, subject_id: e.target.value }))}>
              <option value="">Select subject…</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.subject_code} — {s.subject_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Exam Template *</label>
            <select className="input" value={form.configuration_id}
              onChange={e => setForm(p => ({ ...p, configuration_id: e.target.value }))}>
              <option value="">Select template…</option>
              {examConfigs.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.total_marks}m)</option>
              ))}
            </select>
          </div>
        </div>

        {/* Inline Add Subject panel */}
        {showAddSubject && (
          <div className="border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3">
            <div className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
              <BookOpen size={13} /> New Subject
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Subject Code *</label>
                <input
                  className="input text-sm"
                  placeholder="e.g. CS301"
                  value={subjectForm.subject_code}
                  onChange={e => setSubjectForm(p => ({ ...p, subject_code: e.target.value }))}
                />
              </div>
              <div>
                <label className="label text-xs">Semester</label>
                <input
                  className="input text-sm"
                  type="number"
                  min="1" max="8"
                  placeholder="e.g. 5"
                  value={subjectForm.semester}
                  onChange={e => setSubjectForm(p => ({ ...p, semester: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="label text-xs">Subject Name *</label>
              <input
                className="input text-sm"
                placeholder="e.g. Data Structures & Algorithms"
                value={subjectForm.subject_name}
                onChange={e => setSubjectForm(p => ({ ...p, subject_name: e.target.value }))}
              />
            </div>
            {!myDeptId && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                Your account has no department assigned. Ask the Owner to set your department before adding subjects.
              </div>
            )}
            <button
              className="btn-primary text-sm w-full"
              disabled={!subjectForm.subject_code.trim() || !subjectForm.subject_name.trim() || !myDeptId || addSubjectMut.isPending}
              onClick={handleAddSubject}
            >
              {addSubjectMut.isPending ? 'Adding…' : 'Add Subject'}
            </button>
          </div>
        )}

        {selectedConfig && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
            <strong>{selectedConfig.name}</strong> · {selectedConfig.total_marks} marks · {selectedConfig.exam_type?.replace(/_/g, ' ')} · {selectedConfig.sections_config?.length} sections
          </div>
        )}

        <div>
          <label className="label">Paper Title *</label>
          <input className="input" value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="e.g. End-Semester Nov 2025 — Data Structures" />
        </div>
        <div>
          <label className="label">Academic Year</label>
          <input className="input" value={form.academic_year}
            onChange={e => setForm(p => ({ ...p, academic_year: e.target.value }))} />
        </div>

        <button
          className="btn-primary w-full"
          disabled={!form.subject_id || !form.configuration_id || !form.title || createMut.isPending}
          onClick={() => createMut.mutate({
            ...form,
            subject_id: parseInt(form.subject_id),
            configuration_id: parseInt(form.configuration_id),
          })}
        >
          {createMut.isPending ? 'Creating…' : 'Create Paper Draft →'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: My Papers Tab — full view/edit/delete per paper
// ─────────────────────────────────────────────────────────────────────────────

// ─── CO_COLORS for inline viewer ────────────────────────────────────────────
const CO_VIEW_COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16']

// Inline viewer: full paper view with summary, CO bar chart, Bloom's line chart, slot table
// Charts and tables come from the paper's own slots (OR alternatives included), so they can never be older than the slots.
function computeLiveAnalysis(paper, saved) {
  const slots = (paper?.sections || []).flatMap(s => s.questions || [])
  if (!slots.some(q => q.co_code || q.blooms_code)) return saved || null
  const total = slots.reduce((a, q) => a + (Number(q.assigned_marks) || 0), 0)
  const group = (key) => {
    const sums = {}
    slots.forEach(q => { const k = q[key]; if (k) sums[k] = (sums[k] || 0) + (Number(q.assigned_marks) || 0) })
    const res = {}
    Object.keys(sums).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(k => {
      res[k] = { marks: sums[k], percent: total ? Math.round(sums[k] / total * 1000) / 10 : 0 }
    })
    return res
  }
  const target = Number(paper.configuration_total_marks) || (paper.sections || []).reduce((a, sec) => a + (Number(sec.marks_allocated) || 0), 0)
  const errs = []
  if (target && Math.abs(total - target) > 0.5) {
    errs.push(`Total marks mismatch: slots add up to ${total} but the paper total is ${target}`)
  }
  const units = group('unit_code')
  return {
    ...(saved || {}),
    total_marks_calculated: total,
    co_distribution: group('co_code'),
    blooms_distribution: group('blooms_code'),
    unit_distribution: Object.keys(units).length ? units : (saved?.unit_distribution ?? null),
    validation_errors: errs,
  }
}

function InlinePaperViewer({ paper, analysis: savedAnalysis, history, readOnly = false }) {
  const analysis = useMemo(() => computeLiveAnalysis(paper, savedAnalysis), [paper, savedAnalysis])
  const { data: summaryRes } = useQuery({
    queryKey: ['paper-summary-table', paper?.id],
    queryFn: () => papersApi.summary(paper.id).then(r => r.data),
    enabled: readOnly && !!paper?.id,
    retry: false,
  })
  const [expandedSections, setExpandedSections] = useState({})
  const toggleSection = (id) => setExpandedSections(p => ({ ...p, [id]: !p[id] }))

  // ── Duplicate-check state ──────────────────────────────────────────────────
  const [showDupPanel, setShowDupPanel]   = useState(false)
  const [dupChecking, setDupChecking]     = useState(false)
  const [dupResult, setDupResult]         = useState(null)   // { rows, total_rows, duplicate_count }
  const dupFileRef = useRef(null)

  const _runDupCheck = async (formData) => {
    setDupChecking(true)
    setDupResult(null)
    try {
      const r = await papersApi.checkDuplicates(paper.id, formData)
      setDupResult(r.data)
      if (r.data.total_rows === 0) {
        toast('No question texts found yet. Assign questions to slots first.', { icon: 'ℹ️' })
      } else if (r.data.duplicate_count === 0) {
        toast.success('No duplicates found — all questions are unique!')
      } else {
        toast.error(`${r.data.duplicate_count} potential duplicate(s) found`)
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Duplicate check failed')
    } finally {
      setDupChecking(false)
      if (dupFileRef.current) dupFileRef.current.value = ''
    }
  }

  const handleCheckDuplicates = () => _runDupCheck(null)

  const handleDupFileUpload = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const fd = new FormData()
    fd.append('file', f)
    _runDupCheck(fd)
  }

  // ── Derived metrics from analysis ─────────────────────────────────────────
  const coEntries = Object.entries(analysis?.co_distribution || {})
  const bloomsEntries = Object.entries(analysis?.blooms_distribution || {})
  // Template total (from config) is the authoritative paper total marks
  const templateTotal = paper.configuration_total_marks
  // Actual assigned marks counted by the engine (mandatory slots only)
  const actualAssigned = analysis?.total_marks_calculated ?? 0
  const totalSlots = (paper.sections || []).reduce((s, sec) => s + (sec.questions?.length || 0), 0)
  const assignedCOSlots = (paper.sections || []).flatMap(s => s.questions || []).filter(q => q.co_code).length
  const assignedBloomsSlots = (paper.sections || []).flatMap(s => s.questions || []).filter(q => q.blooms_code).length

  // ── CO horizontal bar chart (SVG, no recharts needed) ─────────────────────
  const maxCOMarks = Math.max(...coEntries.map(([, d]) => d.marks ?? 0), 1)

  return (
    <div className="mt-3 space-y-5 pb-2">

      {/* ════════════════════════════════════════════════════════════════════
          TOP SUMMARY BAR
      ════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Template Total Marks */}
        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-3 flex flex-col gap-0.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-blue-400">Total Marks</div>
          <div className="text-2xl font-extrabold text-blue-700 leading-none">
            {templateTotal ?? actualAssigned}
          </div>
          <div className="text-[10px] text-blue-400 mt-0.5 flex items-center gap-1">
            {templateTotal && actualAssigned !== templateTotal
              ? <span className="text-amber-500">Assigned: {actualAssigned}m</span>
              : <span>{paper.exam_type?.replace(/_/g,' ')} · {paper.academic_year}</span>}
          </div>
        </div>
        {/* Sections */}
        <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-3 flex flex-col gap-0.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-purple-400">Sections</div>
          <div className="text-2xl font-extrabold text-purple-700 leading-none">{paper.sections?.length ?? 0}</div>
          <div className="text-[10px] text-purple-400 mt-0.5">{totalSlots} question slots</div>
        </div>
        {/* CO Coverage */}
        <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-3 flex flex-col gap-0.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-green-400">CO Assigned</div>
          <div className="text-2xl font-extrabold text-green-700 leading-none">{assignedCOSlots}<span className="text-base font-medium text-green-400">/{totalSlots}</span></div>
          <div className="text-[10px] text-green-400 mt-0.5">{coEntries.length} unique COs mapped</div>
        </div>
        {/* Bloom's Coverage */}
        <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white p-3 flex flex-col gap-0.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-orange-400">Bloom's Assigned</div>
          <div className="text-2xl font-extrabold text-orange-700 leading-none">{assignedBloomsSlots}<span className="text-base font-medium text-orange-400">/{totalSlots}</span></div>
          <div className="text-[10px] text-orange-400 mt-0.5">{bloomsEntries.length} Bloom's levels used</div>
        </div>
      </div>

      {/* Validation warnings */}
      {analysis?.validation_errors?.length > 0 && (
        <div className="space-y-1">
          {analysis.validation_errors.map((e, i) => (
            <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
              <AlertCircle size={12} /> {e}
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          CHARTS ROW  —  CO (left)  +  Bloom's (right)
      ════════════════════════════════════════════════════════════════════ */}
      {(coEntries.length > 0 || bloomsEntries.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* CO Distribution — horizontal bar chart */}
          {coEntries.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 size={14} className="text-blue-500" />
                <span className="text-sm font-bold text-gray-800">CO Distribution</span>
              </div>
              <div className="space-y-2">
                {coEntries.map(([code, d], i) => {
                  const pct = d.percent ?? 0
                  const marks = d.marks ?? 0
                  const color = CO_VIEW_COLORS[i % CO_VIEW_COLORS.length]
                  const barWidth = maxCOMarks > 0 ? Math.round((marks / maxCOMarks) * 100) : 0
                  return (
                    <div key={code}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="font-semibold text-gray-700" style={{ color }}>{code}</span>
                        <span className="text-gray-500">{marks}m &nbsp;·&nbsp; <span className="font-bold" style={{ color }}>{pct.toFixed(1)}%</span></span>
                      </div>
                      <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${barWidth}%`, background: color }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bloom's Distribution — line bell chart */}
          {bloomsEntries.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-purple-500" />
                <span className="text-sm font-bold text-gray-800">Bloom's Distribution</span>
              </div>
              {/* Bloom's level badges row */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {CHART_BLOOMS_ORDER.map(code => {
                  const d = analysis.blooms_distribution[code]
                  if (!d) return null
                  return (
                    <div
                      key={code}
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border"
                      style={{ background: CHART_BLOOMS_BG[code], color: CHART_BLOOMS_TEXT[code], borderColor: CHART_BLOOMS_COLORS[code] + '55' }}
                    >
                      <span>{code}</span>
                      <span className="opacity-70 font-normal">{d.percent?.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
              <BloomsBellChartWidget data={analysis.blooms_distribution} />
            </div>
          )}
        </div>
      )}

      {/* Reviewers: the same Summary Table the faculty see in Slot Assignments (read-only) */}
      {readOnly && summaryRes?.summary_table && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {summaryRes.targets_source && summaryRes.targets_source !== 'paper' && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-3 flex items-center gap-1.5">
              <AlertCircle size={12} />
              The faculty's own targets are not saved for this paper, so the Target columns show the {summaryRes.targets_source === 'template' ? 'template' : 'default (equal split)'} targets.
            </div>
          )}
          <SummaryTable summaryData={summaryRes.summary_table} totalMarks={summaryRes.summary_table.paper_total_marks} />
        </div>
      )}

      {/* Simple summary table (used when the full one is not available) */}
      {(!readOnly || !summaryRes?.summary_table) && analysis && (analysis.co_distribution || analysis.blooms_distribution) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-bold text-gray-800 mb-3">Summary Table</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[['CO-wise', 'CO', analysis.co_distribution], ["Bloom's-wise", "Bloom's", analysis.blooms_distribution], ['Unit-wise', 'Unit', analysis.unit_distribution]]
              .filter(([, , d]) => d && Object.keys(d).length > 0)
              .map(([title, head, d]) => {
                let rows = Object.entries(d)
                if (head === "Bloom's") rows = [...rows].sort((a, b) => CHART_BLOOMS_ORDER.indexOf(a[0]) - CHART_BLOOMS_ORDER.indexOf(b[0]))
                const sumM = rows.reduce((a, [, v]) => a + (Number(v.marks) || 0), 0)
                const sumP = rows.reduce((a, [, v]) => a + (Number(v.percent) || 0), 0)
                return (
                  <div key={title}>
                    <div className="text-xs font-semibold text-gray-500 mb-1">{title}</div>
                    <table className="w-full text-xs border border-gray-200">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="table-header py-1.5">{head}</th>
                          <th className="table-header py-1.5 text-right">Marks</th>
                          <th className="table-header py-1.5 text-right">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(([k, v]) => (
                          <tr key={k} className="border-t border-gray-100">
                            <td className="table-cell py-1 font-semibold">{k}</td>
                            <td className="table-cell py-1 text-right">{v.marks}</td>
                            <td className="table-cell py-1 text-right">{Number(v.percent ?? 0).toFixed(1)}%</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-200 bg-gray-50 font-bold">
                          <td className="table-cell py-1">Total</td>
                          <td className="table-cell py-1 text-right">{sumM}</td>
                          <td className="table-cell py-1 text-right">{sumP.toFixed(1)}%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* No analysis yet */}
      {!analysis && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-400">
          No analysis yet — assign CO &amp; Bloom's and save to see charts.
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          SLOT TABLE  —  per section, collapsible
      ════════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
          <FileText size={14} className="text-gray-400" /> Question Slots
        </div>
        <div className="space-y-2">
          {(paper.sections || []).map(sec => {
            const isOpen = expandedSections[sec.id] !== false
            const coAssigned = (sec.questions || []).filter(q => q.co_code).length
            const blAssigned = (sec.questions || []).filter(q => q.blooms_code).length
            return (
              <div key={sec.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  onClick={() => toggleSection(sec.id)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="font-bold text-sm text-gray-800">{sec.section_name}</span>
                    <span className="text-xs text-gray-400">{sec.questions?.length} slots · <span className="font-semibold text-blue-600">{sec.marks_allocated}m</span></span>
                    <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">{coAssigned}/{sec.questions?.length} CO</span>
                    <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">{blAssigned}/{sec.questions?.length} BL</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          {['Slot', 'Marks', 'CO', "Bloom's", 'Question Text'].map(h => (
                            <th key={h} className="table-header py-2 text-[11px] font-bold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(sec.questions || []).map((pq, qi) => {
                          const co = pq.co_code
                          const bl = pq.blooms_code
                          const qtxt = pq.slot_question_text || pq.question_text
                          return (
                            <tr key={pq.id} className={`border-b border-gray-100 ${pq.is_optional ? 'bg-amber-50/60' : qi % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                              {/* Slot */}
                              <td className="table-cell py-2 font-mono font-bold text-gray-700 whitespace-nowrap">
                                {pq.is_optional && <span className="text-amber-500 font-bold mr-1 text-[10px]">OR</span>}
                                {pq.slot_label || pq.slot_id || `#${pq.id}`}
                              </td>
                              {/* Marks */}
                              <td className="table-cell py-2 text-center">
                                <span className="font-extrabold text-blue-700 text-sm">{pq.assigned_marks}</span>
                                <span className="text-gray-400 ml-0.5">m</span>
                              </td>
                              {/* CO */}
                              <td className="table-cell py-2">
                                {co ? (
                                  <span
                                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold border"
                                    style={{ background: '#f3e8ff', color: '#7c3aed', borderColor: '#c4b5fd' }}
                                  >{co}</span>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>
                              {/* Bloom's */}
                              <td className="table-cell py-2">
                                {bl ? (
                                  <span
                                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold border"
                                    style={{
                                      background: CHART_BLOOMS_BG[bl] ?? '#f0fdf4',
                                      color: CHART_BLOOMS_TEXT[bl] ?? '#15803d',
                                      borderColor: (CHART_BLOOMS_COLORS[bl] ?? '#22c55e') + '88',
                                    }}
                                  >
                                    {bl}
                                    <span className="ml-1 font-normal opacity-70 text-[10px]">{CHART_BLOOMS_NAMES[bl] ?? ''}</span>
                                  </span>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>
                              {/* Question Text */}
                              <td className="table-cell py-2 text-gray-600 max-w-sm">
                                {qtxt
                                  ? <span className="line-clamp-2 leading-relaxed">{qtxt}</span>
                                  : <span className="text-gray-300 italic text-[11px]">not set</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
          {(!paper.sections || paper.sections.length === 0) && (
            <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
              No sections yet.
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          DUPLICATE QUESTION CHECK
      ════════════════════════════════════════════════════════════════════ */}
      <div className={`border border-gray-200 rounded-xl overflow-hidden ${readOnly ? 'hidden' : ''}`}>
        {/* Header toggle */}
        <button
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
          onClick={() => { setShowDupPanel(p => !p); setDupResult(null) }}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} className="text-amber-500" />
            <span className="font-semibold text-sm text-gray-800">Check for Duplicate Questions</span>
            <span className="text-[11px] text-gray-400">Scan this paper's questions against the subject question bank</span>
          </div>
          {showDupPanel ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        {showDupPanel && (
          <div className="px-4 py-3 space-y-3 bg-white">
            {/* Action row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Button A: scan paper's own slots */}
              <button
                className="flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors font-medium disabled:opacity-50"
                onClick={handleCheckDuplicates}
                disabled={dupChecking}
              >
                {dupChecking
                  ? <><RefreshCw size={11} className="animate-spin" /> Checking…</>
                  : <><ShieldAlert size={11} /> Check This Paper</>}
              </button>

              {/* Divider */}
              <span className="text-gray-300 text-xs">or</span>

              {/* Button B: upload a CSV / XLSX file */}
              <label className="flex items-center gap-1.5 text-xs bg-purple-50 border border-purple-200 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors font-medium cursor-pointer">
                <input
                  ref={dupFileRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv"
                  className="hidden"
                  onChange={handleDupFileUpload}
                  disabled={dupChecking}
                />
                <Upload size={11} /> Upload CSV / XLSX
              </label>

              <span className="text-[11px] text-gray-400">
                Check this paper's slots, or upload a CSV with a <code className="bg-gray-100 px-1 rounded text-[10px]">question_text</code> column
              </span>

              {dupResult && (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  dupResult.duplicate_count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}>
                  {dupResult.duplicate_count > 0
                    ? `${dupResult.duplicate_count} / ${dupResult.total_rows} potential duplicates`
                    : `No duplicates — all ${dupResult.total_rows} questions are unique`}
                </span>
              )}
            </div>

            {/* Empty-slot notice */}
            {dupResult && dupResult.total_rows === 0 && (
              <div className="text-xs text-gray-400 italic bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                No question texts found in this paper's slots. Assign question text to slots first, then re-run.
              </div>
            )}

            {/* Results table */}
            {dupResult && dupResult.rows.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="table-header py-2 w-8">#</th>
                      <th className="table-header py-2 text-left">Slot</th>
                      <th className="table-header py-2 text-left">Your Question</th>
                      <th className="table-header py-2 text-center w-8">CO</th>
                      <th className="table-header py-2 text-center w-10">Bloom's</th>
                      <th className="table-header py-2 text-center w-16">Match</th>
                      <th className="table-header py-2 text-left">Closest Existing Question</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dupResult.rows.map(row => {
                      const hasDup = row.duplicates.length > 0
                      const best = row.duplicates[0]
                      const simPct = best ? Math.round(best.similarity * 100) : 0
                      return (
                        <tr
                          key={row.row_num}
                          className={`border-b border-gray-100 ${hasDup ? 'bg-amber-50' : 'bg-white'}`}
                        >
                          {/* # */}
                          <td className="table-cell py-2 text-center text-gray-400">{row.row_num}</td>
                          {/* Slot label + section */}
                          <td className="table-cell py-2 whitespace-nowrap">
                            <div className="font-mono font-bold text-gray-700 text-[11px]">
                              {row.is_optional && <span className="text-amber-500 mr-0.5">OR </span>}
                              {row.slot_label}
                            </div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[80px]">{row.section}</div>
                          </td>
                          {/* Your question text */}
                          <td className="table-cell py-2 max-w-xs">
                            <span className={`leading-relaxed line-clamp-2 ${hasDup ? 'text-amber-900 font-medium' : 'text-gray-700'}`}>
                              {row.question_text}
                            </span>
                          </td>
                          {/* Paper slot CO */}
                          <td className="table-cell py-2 text-center">
                            {row.co_code
                              ? <span className="inline-block rounded px-1 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700">{row.co_code}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          {/* Paper slot Bloom's */}
                          <td className="table-cell py-2 text-center">
                            {row.blooms_code
                              ? <span className="inline-block rounded px-1 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700">{row.blooms_code}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          {/* Similarity badge */}
                          <td className="table-cell py-2 text-center">
                            {hasDup ? (
                              <span className={`font-bold text-xs px-1.5 py-0.5 rounded-full ${
                                simPct >= 95 ? 'bg-red-100 text-red-700'
                                : simPct >= 85 ? 'bg-orange-100 text-orange-700'
                                : 'bg-amber-100 text-amber-700'
                              }`}>
                                {simPct}%
                              </span>
                            ) : (
                              <CheckCircle2 size={13} className="text-green-400 mx-auto" />
                            )}
                          </td>
                          {/* Closest matching question from bank */}
                          <td className="table-cell py-2 max-w-xs text-gray-500">
                            {best ? (
                              <div>
                                <div className="leading-relaxed text-gray-700 line-clamp-2">{best.question_text}</div>
                                <div className="flex gap-1 mt-0.5 flex-wrap">
                                  {best.co_code && <span className="bg-purple-100 text-purple-700 rounded px-1 py-0.5 text-[10px]">{best.co_code}</span>}
                                  {best.blooms_code && <span className="bg-blue-100 text-blue-700 rounded px-1 py-0.5 text-[10px]">{best.blooms_code}</span>}
                                </div>
                              </div>
                            ) : <span className="text-green-500 font-medium">✓ Unique</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          WORKFLOW HISTORY
      ════════════════════════════════════════════════════════════════════ */}
      {history?.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Workflow History</div>
          <div className="space-y-1.5">
            {history.map(h => (
              <div key={h.id} className="flex items-start gap-3 text-xs">
                <span className="text-gray-400 shrink-0 tabular-nums">{new Date(h.created_at).toLocaleString()}</span>
                <span className="font-semibold text-gray-700">{h.from_status || 'Created'} → {h.to_status}</span>
                {h.comments && <span className="text-gray-400 italic">— {h.comments}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Map paper status to a readable label for the summary badge
const PAPER_STATUS_SUMMARY = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-600' },
  submitted: { label: 'Under Review', cls: 'bg-yellow-100 text-yellow-700' },
  hod_review: { label: 'Under Review (HOD)', cls: 'bg-yellow-100 text-yellow-700' },
  hod_approved: { label: 'HOD Approved', cls: 'bg-green-100 text-green-700' },
  hod_returned: { label: 'Returned by HOD', cls: 'bg-red-100 text-red-700' },
  principal_review: { label: 'Under Review (Principal)', cls: 'bg-yellow-100 text-yellow-700' },
  principal_approved: { label: 'Principal Approved', cls: 'bg-green-100 text-green-700' },
  principal_returned: { label: 'Returned by Principal', cls: 'bg-red-100 text-red-700' },
  exam_cell_review: { label: 'Exam Cell Review', cls: 'bg-indigo-100 text-indigo-700' },
  finalized: { label: 'Finalized', cls: 'bg-emerald-100 text-emerald-700' },
  returned: { label: 'Returned', cls: 'bg-red-100 text-red-700' },
}

function MyPapersTab({ papers, subjects, onSetEditingPaper, onNewPaper, onRefresh, submitMut }) {
  const qc = useQueryClient()

  // Expanded paper viewer
  const [viewingId, setViewingId] = useState(null)
  // Delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  // Search
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [semesterFilter, setSemesterFilter] = useState('')
  const [programFilter, setProgramFilter] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const [selectedIds, setSelectedIds] = useState([])

  // Subject lookup: id → subject
  const subjectMap = useMemo(() => Object.fromEntries((subjects || []).map(s => [s.id, s])), [subjects])

  // Get display label for a paper: subject_code_subject_name
  const paperLabel = (p) => {
    const s = subjectMap[p.subject_id]
    return s ? `${s.subject_code}_${s.subject_name}` : p.title
  }

  // Filtered papers
  const filteredPapers = useMemo(() => {
    let list = papers
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        paperLabel(p).toLowerCase().includes(q) ||
        p.title?.toLowerCase().includes(q) ||
        p.exam_type?.toLowerCase().includes(q) ||
        p.academic_year?.includes(q)
      )
    }
    if (statusFilter) {
      list = list.filter(p => p.status === statusFilter)
    }
    if (semesterFilter) {
      list = list.filter(p => String(subjectMap[p.subject_id]?.semester ?? '') === semesterFilter)
    }
    if (programFilter) {
      list = list.filter(p => (subjectMap[p.subject_id]?.program || '') === programFilter)
    }
    if (!sortKey) return list
    const keyVal = (p) => {
      const sub = subjectMap[p.subject_id]
      if (sortKey === 'paper') return paperLabel(p).toLowerCase()
      if (sortKey === 'program') return (sub?.program || '').toLowerCase()
      if (sortKey === 'semester') return sub?.semester ?? 999
      if (sortKey === 'exam_type') return p.exam_type || ''
      if (sortKey === 'status') return p.status || ''
      return p.academic_year || ''
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const x = keyVal(a), y = keyVal(b)
      const c = (typeof x === 'number' && typeof y === 'number')
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true })
      return c * dir
    })
  }, [papers, search, statusFilter, semesterFilter, programFilter, sortKey, sortDir, subjectMap])

  // Fetch paper detail for inline viewer
  const { data: viewPaper, isLoading: viewPaperLoading } = useQuery({
    queryKey: ['paper', viewingId],
    queryFn: () => papersApi.get(viewingId).then(r => r.data),
    enabled: !!viewingId,
    retry: false,
  })
  const { data: viewAnalysis = null, isLoading: viewAnalysisLoading } = useQuery({
    queryKey: ['analysis', viewingId],
    queryFn: () => papersApi.analysis(viewingId).then(r => r.data).catch(e => {
      if (e?.response?.status === 404) return null
      throw e
    }),
    enabled: !!viewingId,
    retry: false,
    throwOnError: false,
  })
  const { data: viewHistory = [] } = useQuery({
    queryKey: ['history', viewingId],
    queryFn: () => papersApi.history(viewingId).then(r => r.data),
    enabled: !!viewingId,
    retry: false,
  })

  const deleteMut = useMutation({
    mutationFn: (id) => papersApi.deletePaper(id),
    onSuccess: () => {
      toast.success('Paper deleted.')
      setDeleteConfirmId(null)
      onRefresh()
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Delete failed'),
  })

  const directSubmitMut = useMutation({
    mutationFn: ({ id, action }) => papersApi.transition(id, { action, comments: 'Submitting for review' }),
    onSuccess: (_, vars) => {
      const msg = vars.action === 'submit_to_exam'
        ? 'Paper submitted directly to Exam Cell!'
        : 'Paper submitted for HOD review!'
      toast.success(msg)
      onRefresh()
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to submit'),
  })

  const canEdit = (p) => ['draft', 'hod_returned', 'principal_returned'].includes(p.status)
  const canSubmit = (p) => ['draft', 'hod_returned', 'principal_returned'].includes(p.status)

  const handleViewClick = (id) => {
    setViewingId(prev => prev === id ? null : id)
    setDeleteConfirmId(null)
  }

  const uniqueStatuses = [...new Set(papers.map(p => p.status))]
  const uniquePrograms = [...new Set(papers.map(p => subjectMap[p.subject_id]?.program).filter(Boolean))]
  const uniqueSemesters = [...new Set(papers.map(p => subjectMap[p.subject_id]?.semester).filter(v => v !== null && v !== undefined))].sort((a, b) => a - b)

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const allShownSelected = filteredPapers.length > 0 && filteredPapers.every(p => selectedIds.includes(p.id))
  const toggleAll = () => setSelectedIds(allShownSelected
    ? selectedIds.filter(id => !filteredPapers.some(p => p.id === id))
    : [...new Set([...selectedIds, ...filteredPapers.map(p => p.id)])])
  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-semibold">My Papers <span className="text-gray-400 text-sm font-normal ml-1">({papers.length})</span></h3>
        <button className="btn-primary text-sm" onClick={onNewPaper}>+ New Paper</button>
      </div>

      {/* Search & Filter row */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="input pl-8 text-sm"
            placeholder="Search by subject, type, year…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <select
          className="input text-sm w-auto"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          {uniqueStatuses.map(s => (
            <option key={s} value={s}>{PAPER_STATUS_SUMMARY[s]?.label || s}</option>
          ))}
        </select>
        <select className="input text-sm w-auto" value={semesterFilter} onChange={e => setSemesterFilter(e.target.value)}>
          <option value="">All Semesters</option>
          {uniqueSemesters.map(n => <option key={n} value={String(n)}>Semester {n}</option>)}
        </select>
        <select className="input text-sm w-auto" value={programFilter} onChange={e => setProgramFilter(e.target.value)}>
          <option value="">All Programs</option>
          {uniquePrograms.map(pr => <option key={pr} value={pr}>{pr}</option>)}
        </select>
      </div>

      {selectedIds.length > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
          <span className="font-medium">{selectedIds.length} selected</span>
          <button className="text-xs underline" onClick={() => setSelectedIds([])}>Clear selection</button>
        </div>
      )}

      {/* Delete confirmation banner */}
      {deleteConfirmId && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="text-sm text-red-800 font-medium flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            Delete this paper? This cannot be undone.
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 transition-colors"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleteConfirmId)}
            >
              {deleteMut.isPending ? 'Deleting…' : 'Yes, Delete'}
            </button>
            <button
              className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200 transition-colors"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header w-8">
                <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title="Select all shown" />
              </th>
              {[['Paper', 'paper'], ['Program', 'program'], ['Sem', 'semester'], ['Exam Type', 'exam_type'], ['Status', 'status'], ['Year', 'year']].map(([label, key]) => (
                <th key={key} className="table-header cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort(key)}>
                  {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPapers.map(p => {
              const statusInfo = PAPER_STATUS_SUMMARY[p.status] || { label: p.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <React.Fragment key={p.id}>
                  {/* Main row */}
                  <tr className={`hover:bg-gray-50 ${viewingId === p.id ? 'bg-blue-50' : selectedIds.includes(p.id) ? 'bg-amber-50' : ''}`}>
                    <td className="table-cell w-8">
                      <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggleOne(p.id)} />
                    </td>
                    <td className="table-cell font-medium max-w-xs">
                      {/* Show subject_code_subject_name as primary label */}
                      <div className="font-semibold text-gray-800 truncate">{paperLabel(p)}</div>
                      {/* Show summary status pill inline */}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="table-cell text-xs">{subjectMap[p.subject_id]?.program || '—'}</td>
                    <td className="table-cell text-center whitespace-nowrap">{subjectMap[p.subject_id]?.semester ?? '—'}</td>
                    <td className="table-cell capitalize whitespace-nowrap">{p.exam_type?.replace(/_/g, ' ')}</td>
                    <td className="table-cell"><StatusBadge status={p.status} /></td>
                    <td className="table-cell whitespace-nowrap">{p.academic_year}</td>
                    <td className="table-cell">
                      <div className="flex gap-2 flex-wrap items-center">
                        {/* View */}
                        <button
                          className={`text-xs px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${viewingId === p.id ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                          onClick={() => handleViewClick(p.id)}
                        >
                          <Eye size={11} /> {viewingId === p.id ? 'Close' : 'View'}
                        </button>

                        {/* Edit */}
                        {canEdit(p) && (
                          <button
                            className="text-xs bg-purple-100 text-purple-700 rounded px-2 py-0.5 hover:bg-purple-200 transition-colors flex items-center gap-1"
                            onClick={() => { setViewingId(null); onSetEditingPaper(p.id) }}
                          >
                            <Pencil size={10} /> Edit
                          </button>
                        )}

                        {/* Download XLSX — available for any submitted paper */}
                        {p.status !== 'draft' && (
                          <button
                            className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded hover:bg-green-100 transition-colors flex items-center gap-1 border border-green-200"
                            title="Download paper as Excel (.xlsx)"
                            onClick={async () => {
                              try {
                                const r = await papersApi.export(p.id, 'xlsx')
                                const url = URL.createObjectURL(new Blob([r.data]))
                                const a = document.createElement('a')
                                a.href = url
                                a.download = `paper_${p.id}.xlsx`
                                a.click()
                                URL.revokeObjectURL(url)
                              } catch (e) {
                                toast.error(e.response?.data?.detail || 'Download failed')
                              }
                            }}
                          >
                            <Download size={10} /> XLSX
                          </button>
                        )}

                        {/* Submit to HOD */}
                        {canSubmit(p) && (
                          <button
                            className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded hover:bg-yellow-200 transition-colors"
                            onClick={() => directSubmitMut.mutate({ id: p.id, action: 'submit' })}
                            disabled={directSubmitMut.isPending}
                          >→ HOD</button>
                        )}

                        {/* Submit direct to Exam Cell */}
                        {canSubmit(p) && (
                          <button
                            className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded hover:bg-indigo-200 transition-colors"
                            onClick={() => directSubmitMut.mutate({ id: p.id, action: 'submit_to_exam' })}
                            disabled={directSubmitMut.isPending}
                            title="Submit directly to Exam Moderation Cell"
                          >→ Exam Cell</button>
                        )}

                        {/* Delete (only for editable statuses) */}
                        {canEdit(p) && (
                          <button
                            className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded hover:bg-red-100 transition-colors flex items-center gap-1"
                            onClick={() => { setDeleteConfirmId(p.id); setViewingId(null) }}
                          >
                            <Trash2 size={10} /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Inline viewer row */}
                  {viewingId === p.id && (
                    <tr>
                      <td colSpan={8} className="px-4 pb-4 bg-blue-50 border-b border-blue-100">
                        {viewPaperLoading || viewAnalysisLoading ? (
                          <div className="py-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
                            <RefreshCw size={14} className="animate-spin" /> Loading paper…
                          </div>
                        ) : viewPaper ? (
                          <InlinePaperViewer
                            paper={viewPaper}
                            analysis={viewAnalysis}
                            history={viewHistory}
                          />
                        ) : (
                          <div className="py-8 text-center text-red-400 text-sm">
                            Could not load paper.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {filteredPapers.length === 0 && (
              <tr><td colSpan={8} className="table-cell text-center text-gray-400 py-8">
                {papers.length === 0 ? 'No papers yet — create one from a template' : 'No papers match your search'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: Add Subject with COs Panel
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CO_COUNT = 5

function buildDefaultCOs(subjectCode) {
  return Array.from({ length: DEFAULT_CO_COUNT }, (_, i) => ({
    co_code: `CO${i + 1}`,
    description: `${subjectCode || 'Subject'} Course Outcome ${i + 1}`,
    po_mapping: '',
  }))
}

function AddSubjectPanel({ onClose, onSubjectAdded }) {
  const qc = useQueryClient()
  const myDeptId = getDepartmentId()

  const [subjectForm, setSubjectForm] = useState({
    subject_code: '',
    subject_name: '',
    semester: '',
  })
  const [cos, setCos] = useState(buildDefaultCOs(''))

  // Keep CO descriptions in sync when subject_code changes
  const syncCOsWithCode = (code) => {
    setCos(prev => prev.map((co, i) => ({
      ...co,
      description: co.description === `${subjectForm.subject_code || 'Subject'} Course Outcome ${i + 1}`
        ? `${code || 'Subject'} Course Outcome ${i + 1}`
        : co.description,
    })))
  }

  const addSubjectMut = useMutation({
    mutationFn: (data) => masterApi.createSubject(data),
    onSuccess: (r) => {
      qc.invalidateQueries(['subjects'])
      // After subject created, create all COs
      const validCOs = cos.filter(c => c.co_code.trim() && c.description.trim())
      if (validCOs.length === 0) {
        toast.success(`Subject "${r.data.subject_name}" added!`)
        onSubjectAdded(r.data)
        return
      }
      createCOsMut.mutate({ subjectId: r.data.id, coList: validCOs, subjectName: r.data.subject_name })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to add subject'),
  })

  const createCOsMut = useMutation({
    mutationFn: async ({ subjectId, coList }) => {
      for (const co of coList) {
        await masterApi.createCO({ subject_id: subjectId, co_code: co.co_code, description: co.description, po_mapping: co.po_mapping || null })
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries(['cos'])
      toast.success(`Subject "${vars.subjectName}" added with ${vars.coList.length} COs!`)
      onSubjectAdded()
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Some COs failed to save'),
  })

  const handleAddCORow = () => setCos(prev => [...prev, { co_code: `CO${prev.length + 1}`, description: '', po_mapping: '' }])
  const handleRemoveCO = (idx) => setCos(prev => prev.filter((_, i) => i !== idx))
  const handleCOChange = (idx, field, value) => setCos(prev => prev.map((co, i) => i === idx ? { ...co, [field]: value } : co))

  const handleSubmit = () => {
    if (!subjectForm.subject_code.trim() || !subjectForm.subject_name.trim()) return
    if (!myDeptId) {
      toast.error('Your account has no department assigned — ask the Owner to set your department first.')
      return
    }
    addSubjectMut.mutate({
      department_id: myDeptId,
      subject_code: subjectForm.subject_code.trim(),
      subject_name: subjectForm.subject_name.trim(),
      semester: subjectForm.semester ? parseInt(subjectForm.semester) : null,
    })
  }

  const isPending = addSubjectMut.isPending || createCOsMut.isPending

  return (
    <div className="border border-blue-200 rounded-lg bg-blue-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-blue-800 flex items-center gap-1.5">
          <BookOpen size={14} /> Add New Subject
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕ Cancel</button>
      </div>

      {/* Subject fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label text-xs">Subject Code *</label>
          <input
            className="input text-sm"
            placeholder="e.g. CS301"
            value={subjectForm.subject_code}
            onChange={e => {
              const v = e.target.value
              syncCOsWithCode(v)
              setSubjectForm(p => ({ ...p, subject_code: v }))
            }}
          />
        </div>
        <div>
          <label className="label text-xs">Semester</label>
          <input
            className="input text-sm"
            type="number" min="1" max="8"
            placeholder="e.g. 5"
            value={subjectForm.semester}
            onChange={e => setSubjectForm(p => ({ ...p, semester: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <label className="label text-xs">Subject Name *</label>
        <input
          className="input text-sm"
          placeholder="e.g. Data Structures & Algorithms"
          value={subjectForm.subject_name}
          onChange={e => setSubjectForm(p => ({ ...p, subject_name: e.target.value }))}
        />
      </div>

      {!myDeptId && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          Your account has no department assigned. Ask the Owner to set your department before adding subjects.
        </div>
      )}

      {/* COs section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-gray-700">Course Outcomes (COs)</div>
          <button
            type="button"
            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
            onClick={handleAddCORow}
          >
            <Plus size={11} /> Add CO
          </button>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {cos.map((co, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              <input
                className="input text-xs w-16 shrink-0"
                placeholder="CO1"
                value={co.co_code}
                onChange={e => handleCOChange(idx, 'co_code', e.target.value)}
              />
              <input
                className="input text-xs flex-1"
                placeholder="CO description"
                value={co.description}
                onChange={e => handleCOChange(idx, 'description', e.target.value)}
              />
              <button
                type="button"
                className="text-red-400 hover:text-red-600 mt-1 shrink-0"
                onClick={() => handleRemoveCO(idx)}
                title="Remove CO"
              >✕</button>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {cos.length} CO{cos.length !== 1 ? 's' : ''} · By default 5 COs are pre-filled. You can edit or remove them.
        </div>
      </div>

      <button
        className="btn-primary text-sm w-full"
        disabled={!subjectForm.subject_code.trim() || !subjectForm.subject_name.trim() || !myDeptId || isPending}
        onClick={handleSubmit}
      >
        {isPending ? 'Saving…' : `Save Subject + ${cos.filter(c => c.co_code.trim()).length} COs`}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: My Subjects Panel (right side of Overview) — with edit/delete
// ─────────────────────────────────────────────────────────────────────────────

function MySubjectsPanel({ subjects, onSubjectAdded }) {
  const qc = useQueryClient()
  const myDeptId = getDepartmentId()
  const [showAddForm, setShowAddForm] = useState(false)
  const [showSyllabus, setShowSyllabus] = useState(false)
  const [expandedSubjectId, setExpandedSubjectId] = useState(null)
  const [editingSubject, setEditingSubject] = useState(null)   // { id, subject_code, subject_name, semester }
  const [editingCO, setEditingCO] = useState(null)             // { id, co_code, description, po_mapping }

  // Fetch COs for the expanded subject
  const { data: subjectCOs = [], refetch: refetchCOs } = useQuery({
    queryKey: ['cos-panel', expandedSubjectId],
    queryFn: () => masterApi.cos(expandedSubjectId).then(r => r.data),
    enabled: !!expandedSubjectId,
  })

  // Fetch COs for all subjects to show CO counts
  const subjectIds = subjects.map(s => s.id)
  const { data: allCOs = [] } = useQuery({
    queryKey: ['cos-overview', ...subjectIds],
    queryFn: async () => {
      if (!subjects.length) return []
      const results = await Promise.all(
        subjects.map(s => masterApi.cos(s.id).then(r => r.data))
      )
      return results.flat()
    },
    enabled: subjects.length > 0,
  })

  const coCountBySubject = useMemo(() => {
    const map = {}
    allCOs.forEach(co => {
      map[co.subject_id] = (map[co.subject_id] || 0) + 1
    })
    return map
  }, [allCOs])

  const updateSubjectMut = useMutation({
    mutationFn: ({ id, data }) => masterApi.updateSubject(id, data),
    onSuccess: () => {
      toast.success('Subject updated!')
      setEditingSubject(null)
      qc.invalidateQueries(['subjects', myDeptId])
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to update'),
  })

  const deleteSubjectMut = useMutation({
    mutationFn: (id) => masterApi.deleteSubject(id),
    onSuccess: () => {
      toast.success('Subject removed.')
      setExpandedSubjectId(null)
      qc.invalidateQueries(['subjects', myDeptId])
      qc.invalidateQueries({ queryKey: ['cos-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to delete'),
  })

  const updateCOMut = useMutation({
    mutationFn: ({ id, data }) => masterApi.updateCO(id, data),
    onSuccess: () => {
      toast.success('CO updated!')
      setEditingCO(null)
      refetchCOs()
      qc.invalidateQueries({ queryKey: ['cos-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to update CO'),
  })

  const deleteCOMut = useMutation({
    mutationFn: (id) => masterApi.deleteCO(id),
    onSuccess: () => {
      toast.success('CO deleted.')
      refetchCOs()
      qc.invalidateQueries({ queryKey: ['cos-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to delete CO'),
  })

  const addCOMut = useMutation({
    mutationFn: (data) => masterApi.createCO(data),
    onSuccess: () => {
      toast.success('CO added!')
      refetchCOs()
      qc.invalidateQueries({ queryKey: ['cos-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to add CO'),
  })

  const [newCOForm, setNewCOForm] = useState({ co_code: '', description: '', po_mapping: '' })
  const [showAddCOForm, setShowAddCOForm] = useState(false)

  return (
    <div className="card h-fit">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <BookOpen size={15} className="text-blue-500" />
          My Subjects
          <span className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full font-medium">
            {subjects.length}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="text-xs bg-white border border-blue-300 text-blue-700 px-2.5 py-1 rounded flex items-center gap-1 hover:bg-blue-50 transition-colors"
            onClick={() => { setShowSyllabus(p => !p); setShowAddForm(false) }}
          >
            {showSyllabus ? 'Cancel' : 'Upload Syllabus (PDF)'}
          </button>
          <button
            className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded flex items-center gap-1 hover:bg-blue-700 transition-colors"
            onClick={() => { setShowAddForm(p => !p); setShowSyllabus(false) }}
          >
            <Plus size={11} />
            {showAddForm ? 'Cancel' : 'Add Subject'}
          </button>
        </div>
      </div>

      {showSyllabus && (
        <div className="mb-4">
          <SyllabusUploadPanel
            departmentId={myDeptId}
            subjects={subjects}
            onClose={() => setShowSyllabus(false)}
            onSaved={() => {
              setShowSyllabus(false)
              onSubjectAdded?.()
              qc.invalidateQueries({ queryKey: ['cos-overview'] })
            }}
          />
        </div>
      )}

      {showAddForm && (
        <div className="mb-4">
          <AddSubjectPanel
            onClose={() => setShowAddForm(false)}
            onSubjectAdded={() => {
              setShowAddForm(false)
              onSubjectAdded?.()
              qc.invalidateQueries({ queryKey: ['cos-overview'] })
            }}
          />
        </div>
      )}

      {subjects.length === 0 && !showAddForm ? (
        <div className="text-center py-6 text-gray-400 text-sm">
          No subjects yet.<br />
          <button className="text-blue-600 hover:underline mt-1 text-xs" onClick={() => setShowAddForm(true)}>
            + Add your first subject
          </button>
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {subjects.map(s => {
            const isExpanded = expandedSubjectId === s.id
            const isEditingThis = editingSubject?.id === s.id
            return (
              <div key={s.id} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* Subject header row */}
                {isEditingThis ? (
                  <div className="bg-blue-50 border border-blue-200 p-3 space-y-2">
                    <div className="text-xs font-semibold text-blue-700 mb-1">Edit Subject</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label text-xs">Code *</label>
                        <input className="input text-xs" value={editingSubject.subject_code}
                          onChange={e => setEditingSubject(p => ({ ...p, subject_code: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label text-xs">Semester</label>
                        <input className="input text-xs" type="number" min="1" max="8"
                          value={editingSubject.semester || ''}
                          onChange={e => setEditingSubject(p => ({ ...p, semester: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="label text-xs">Name *</label>
                      <input className="input text-xs" value={editingSubject.subject_name}
                        onChange={e => setEditingSubject(p => ({ ...p, subject_name: e.target.value }))} />
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs flex-1"
                        disabled={!editingSubject.subject_code.trim() || !editingSubject.subject_name.trim() || updateSubjectMut.isPending}
                        onClick={() => updateSubjectMut.mutate({ id: s.id, data: {
                          subject_code: editingSubject.subject_code.trim(),
                          subject_name: editingSubject.subject_name.trim(),
                          semester: editingSubject.semester ? parseInt(editingSubject.semester) : null,
                        }})}>
                        {updateSubjectMut.isPending ? 'Saving…' : 'Save'}
                      </button>
                      <button className="btn-secondary text-xs" onClick={() => setEditingSubject(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100">
                    <button className="flex-1 text-left" onClick={() => {
                      setExpandedSubjectId(isExpanded ? null : s.id)
                      setShowAddCOForm(false)
                      setEditingCO(null)
                    }}>
                      <div className="text-sm font-medium text-gray-800">{s.subject_name}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                        <span className="font-mono bg-gray-200 px-1 rounded text-gray-600">{s.subject_code}</span>
                        {s.semester && <span>Sem {s.semester}</span>}
                        <span className="text-[10px] bg-purple-100 text-purple-700 px-1 rounded-full">
                          {coCountBySubject[s.id] ?? 0} COs
                        </span>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button className="p-1 text-gray-400 hover:text-blue-600 rounded"
                        title="Edit subject"
                        onClick={() => setEditingSubject({ id: s.id, subject_code: s.subject_code, subject_name: s.subject_name, semester: s.semester || '' })}>
                        <Pencil size={12} />
                      </button>
                      <button className="p-1 text-gray-400 hover:text-red-600 rounded"
                        title="Delete subject"
                        disabled={deleteSubjectMut.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete subject "${s.subject_name}"? This cannot be undone.`)) {
                            deleteSubjectMut.mutate(s.id)
                          }
                        }}>
                        <Trash2 size={12} />
                      </button>
                      <span className="text-gray-400 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>
                )}

                {/* Expanded COs panel */}
                {isExpanded && !isEditingThis && (
                  <div className="border-t border-gray-200 p-3 bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-600">Course Outcomes</span>
                      <button className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                        onClick={() => setShowAddCOForm(p => !p)}>
                        <Plus size={10} /> {showAddCOForm ? 'Cancel' : 'Add CO'}
                      </button>
                    </div>

                    {/* Add CO form */}
                    {showAddCOForm && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2 space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="label text-xs">CO Code *</label>
                            <input className="input text-xs" placeholder="CO1"
                              value={newCOForm.co_code}
                              onChange={e => setNewCOForm(p => ({ ...p, co_code: e.target.value }))} />
                          </div>
                          <div>
                            <label className="label text-xs">PO Mapping</label>
                            <input className="input text-xs" placeholder="PO1,PO2"
                              value={newCOForm.po_mapping}
                              onChange={e => setNewCOForm(p => ({ ...p, po_mapping: e.target.value }))} />
                          </div>
                        </div>
                        <div>
                          <label className="label text-xs">Description *</label>
                          <input className="input text-xs" placeholder="Apply sorting algorithms…"
                            value={newCOForm.description}
                            onChange={e => setNewCOForm(p => ({ ...p, description: e.target.value }))} />
                        </div>
                        <button className="btn-primary text-xs w-full"
                          disabled={!newCOForm.co_code.trim() || !newCOForm.description.trim() || addCOMut.isPending}
                          onClick={() => {
                            addCOMut.mutate({
                              subject_id: s.id,
                              co_code: newCOForm.co_code.trim(),
                              description: newCOForm.description.trim(),
                              po_mapping: newCOForm.po_mapping || null,
                            })
                            setNewCOForm({ co_code: '', description: '', po_mapping: '' })
                            setShowAddCOForm(false)
                          }}>
                          {addCOMut.isPending ? 'Adding…' : 'Add CO'}
                        </button>
                      </div>
                    )}

                    {/* CO list */}
                    {subjectCOs.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No COs yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {subjectCOs.map(co => (
                          <div key={co.id}>
                            {editingCO?.id === co.id ? (
                              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 space-y-1.5">
                                <div className="grid grid-cols-2 gap-1.5">
                                  <div>
                                    <label className="label text-xs">CO Code *</label>
                                    <input className="input text-xs" value={editingCO.co_code}
                                      onChange={e => setEditingCO(p => ({ ...p, co_code: e.target.value }))} />
                                  </div>
                                  <div>
                                    <label className="label text-xs">PO Mapping</label>
                                    <input className="input text-xs" value={editingCO.po_mapping || ''}
                                      onChange={e => setEditingCO(p => ({ ...p, po_mapping: e.target.value }))} />
                                  </div>
                                </div>
                                <div>
                                  <label className="label text-xs">Description *</label>
                                  <input className="input text-xs" value={editingCO.description}
                                    onChange={e => setEditingCO(p => ({ ...p, description: e.target.value }))} />
                                </div>
                                <div className="flex gap-1.5">
                                  <button className="btn-primary text-xs flex-1"
                                    disabled={!editingCO.co_code.trim() || !editingCO.description.trim() || updateCOMut.isPending}
                                    onClick={() => updateCOMut.mutate({ id: co.id, data: {
                                      co_code: editingCO.co_code.trim(),
                                      description: editingCO.description.trim(),
                                      po_mapping: editingCO.po_mapping || null,
                                    }})}>
                                    {updateCOMut.isPending ? 'Saving…' : 'Save'}
                                  </button>
                                  <button className="btn-secondary text-xs" onClick={() => setEditingCO(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-2 py-1 border-b border-gray-100 last:border-0">
                                <div className="min-w-0 flex-1">
                                  <span className="font-mono text-xs font-bold text-purple-600">{co.co_code}</span>
                                  <span className="text-xs text-gray-600 ml-1.5 truncate block">{co.description}</span>
                                  {co.po_mapping && <span className="text-[10px] text-gray-400">{co.po_mapping}</span>}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <button className="p-0.5 text-gray-400 hover:text-blue-600"
                                    onClick={() => setEditingCO({ id: co.id, co_code: co.co_code, description: co.description, po_mapping: co.po_mapping || '' })}>
                                    <Pencil size={11} />
                                  </button>
                                  <button className="p-0.5 text-gray-400 hover:text-red-600"
                                    disabled={deleteCOMut.isPending}
                                    onClick={() => {
                                      if (window.confirm(`Delete CO "${co.co_code}"?`)) deleteCOMut.mutate(co.id)
                                    }}>
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: Faculty Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export default function FacultyDashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const [editingPaperId, setEditingPaperId] = useState(null)

  const { data: summary } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.summary().then(r => r.data),
  })
  const { data: papers = [] } = useQuery({
    queryKey: ['papers'],
    queryFn: () => papersApi.list().then(r => r.data),
  })
  const myDeptId = getDepartmentId()
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects', myDeptId],
    queryFn: () => masterApi.subjects(myDeptId || undefined).then(r => r.data),
  })
  const { data: examConfigs = [] } = useQuery({
    queryKey: ['exam-configs'],
    queryFn: () => masterApi.examConfigs().then(r => r.data),
  })

  const submitMut = useMutation({
    mutationFn: (id) => papersApi.transition(id, { action: 'submit', comments: 'Submitting for review' }),
    onSuccess: () => { qc.invalidateQueries(['papers']); toast.success('Paper submitted for HOD review') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to submit'),
  })

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'subjects', label: 'My Subjects' },
    { id: 'my_papers', label: 'My Papers' },
    { id: 'create', label: '+ New Paper' },
  ]

  // Full-screen editor
  if (editingPaperId) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto">
          <PaperEditor
            paperId={editingPaperId}
            onClose={() => { setEditingPaperId(null); setActiveTab('my_papers') }}
          />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Faculty Dashboard</h2>

        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div>
            {/* Stat cards */}
            <div>
              {summary && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <StatCard title="My Papers" value={summary.my_papers} icon={FileText} color="blue" />
                  <StatCard title="Drafts" value={summary.drafts} icon={Plus} color="orange" />
                  <StatCard title="In Review" value={summary.in_review} icon={RefreshCw} color="purple" />
                  <StatCard title="Returned" value={summary.returned} icon={FileText} color="red" />
                  <StatCard title="Finalized" value={summary.finalized} icon={FileText} color="green" />
                  <StatCard title="Question Bank" value={summary.question_bank_size} icon={BookOpen} color="teal" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* My Subjects */}
        {activeTab === 'subjects' && (
          <div className="max-w-4xl">
            <MySubjectsPanel
              subjects={subjects}
              onSubjectAdded={() => qc.invalidateQueries(['subjects', myDeptId])}
            />
          </div>
        )}

        {/* My Papers */}
        {activeTab === 'my_papers' && (
          <MyPapersTab
            papers={papers}
            subjects={subjects}
            onSetEditingPaper={setEditingPaperId}
            onNewPaper={() => setActiveTab('create')}
            onRefresh={() => { qc.invalidateQueries(['papers']); qc.invalidateQueries(['dashboard']) }}
            submitMut={submitMut}
          />
        )}

        {/* Create from Template */}
        {activeTab === 'create' && (
          <CreateFromTemplateForm
            subjects={subjects}
            examConfigs={examConfigs}
            onCreated={(paperId) => {
              qc.invalidateQueries(['papers', 'dashboard'])
              setEditingPaperId(paperId)
            }}
          />
        )}
      </div>
    </Layout>
  )
}

export { InlinePaperViewer }
