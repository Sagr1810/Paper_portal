import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  Cell, PieChart, Pie,
  AreaChart, Area, LineChart, Line, CartesianGrid, ReferenceLine,
  RadarChart as RechartsRadar, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts'

// ─────────────────────────────────────────────────────────────────────────────
// Shared Bloom's constants — exported so PaperDetail can colour per-question badges
// ─────────────────────────────────────────────────────────────────────────────
export const BLOOMS_ORDER = ['R', 'U', 'Ap', 'An', 'E', 'C']
export const BLOOMS_NAMES = {
  R: 'Remember', U: 'Understand', Ap: 'Apply', An: 'Analyze', E: 'Evaluate', C: 'Create',
}
export const BLOOMS_COLORS = {
  R: '#3b82f6', U: '#22c55e', Ap: '#f59e0b', An: '#ef4444', E: '#8b5cf6', C: '#06b6d4',
}
export const BLOOMS_BG = {
  R: '#dbeafe', U: '#dcfce7', Ap: '#fef9c3', An: '#fee2e2', E: '#ede9fe', C: '#cffafe',
}
export const BLOOMS_TEXT = {
  R: '#1d4ed8', U: '#15803d', Ap: '#b45309', An: '#b91c1c', E: '#6d28d9', C: '#0e7490',
}

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

// ─────────────────────────────────────────────────────────────────────────────
// Unit / generic bar chart
// ─────────────────────────────────────────────────────────────────────────────
export function DistributionBarChart({ data, title }) {
  const items = Object.entries(data || {}).map(([code, d]) => ({
    name: code,
    marks: d.marks,
    percent: d.percent,
  }))
  return (
    <div>
      {title && <h4 className="text-sm font-semibold text-gray-700 mb-2">{title}</h4>}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={items} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v, n) => [n === 'percent' ? `${v}%` : `${v} marks`, n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="percent" name="%" fill="#3b82f6" radius={[4, 4, 0, 0]}>
            {items.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bloom's Bell Line Chart
// Shows actual marks % per Bloom's level as a smooth line, overlaid with a
// reference "ideal bell" curve (normal distribution over the 6 levels).
// ─────────────────────────────────────────────────────────────────────────────
export function BloomsBellChart({ data }) {
  // data = { R: {marks, percent}, U: {marks, percent}, ... }
  const items = BLOOMS_ORDER.map((code, i) => {
    const actual = data?.[code]?.percent ?? 0
    const marks  = data?.[code]?.marks ?? 0
    // Ideal normal bell: peak at index 2 (Apply), σ ≈ 1.5
    const mu = 2, sigma = 1.5
    const bell = Math.exp(-0.5 * Math.pow((i - mu) / sigma, 2))
    return { code, name: BLOOMS_NAMES[code], actual: +actual.toFixed(1), marks, bell }
  })

  // Normalise bell to match actual max so scales are comparable
  const maxActual = Math.max(...items.map(d => d.actual), 1)
  const maxBell   = Math.max(...items.map(d => d.bell), 0.001)
  const scale     = maxActual / maxBell
  const data2 = items.map(d => ({ ...d, bell: +(d.bell * scale).toFixed(1) }))

  const CustomDot = (props) => {
    const { cx, cy, payload } = props
    const color = BLOOMS_COLORS[payload.code] || '#3b82f6'
    return <circle cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={2} />
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const item = data2.find(d => d.name === label)
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-2 shadow text-xs">
        <p className="font-semibold text-gray-800 mb-1">{label} ({item?.code})</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color }}>
            {p.name === 'bell' ? 'Ideal curve' : 'Actual'}: {p.value}%
            {p.name === 'actual' && item?.marks > 0 ? ` (${item.marks}m)` : ''}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data2} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 'auto']} />
          <Tooltip content={<CustomTooltip />} />
          {/* Ideal bell reference curve */}
          <Line
            type="monotone"
            dataKey="bell"
            name="bell"
            stroke="#d1d5db"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={false}
          />
          {/* Actual distribution */}
          <Line
            type="monotone"
            dataKey="actual"
            name="actual"
            stroke="#3b82f6"
            strokeWidth={2.5}
            dot={<CustomDot />}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-1 justify-center text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="#3b82f6" strokeWidth="2.5" /></svg>
          Actual
        </div>
        <div className="flex items-center gap-1">
          <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="#d1d5db" strokeWidth="2" strokeDasharray="4 3" /></svg>
          Ideal bell
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BloomsSummaryLineChart — Bell Curve Area Chart
// Renders a smooth bell-curve-shaped area chart for Bloom's taxonomy.
// Three overlaid layers: ideal Gaussian bell (ghost), target %, actual %.
// bloomsRows = [{ level_code, targetPct, actualPct, marks, deviation, status }]
// T = total marks denominator
// ─────────────────────────────────────────────────────────────────────────────
export function BloomsSummaryLineChart({ bloomsRows = [], T = 0 }) {
  if (!bloomsRows.length) return null

  const rowMap = Object.fromEntries(bloomsRows.map(r => [r.level_code, r]))

  // Build data in canonical order with ideal Gaussian bell
  const rawData = BLOOMS_ORDER.map((code, i) => {
    const row = rowMap[code] || {}
    // Gaussian bell: peak at index 2 (Apply = index 2), σ = 1.4
    const bell = Math.exp(-0.5 * Math.pow((i - 2) / 1.4, 2))
    return {
      code,
      name: BLOOMS_NAMES[code] || code,
      target:    +(row.targetPct  ?? 0),
      actual:    +(row.actualPct  ?? 0),
      marks:     row.marks       ?? 0,
      deviation: row.deviation   ?? 0,
      status:    row.status      ?? 'ok',
      _bell: bell,
    }
  })

  // Scale ideal bell to match the peak of whichever series is highest
  const maxSeries = Math.max(...rawData.map(d => Math.max(d.target, d.actual)), 1)
  const maxBell   = Math.max(...rawData.map(d => d._bell), 0.001)
  const bellScale = maxSeries / maxBell

  const chartData = rawData.map(d => ({
    ...d,
    bell: +(d._bell * bellScale).toFixed(2),
  }))

  const okCount = bloomsRows.filter(r => r.status === 'ok').length

  // ── Custom X-axis tick with level colour ─────────────────────────────────
  const ColoredTick = (props) => {
    const { x, y, payload } = props
    const item = chartData.find(d => d.name === payload.value)
    const color = item ? BLOOMS_COLORS[item.code] : '#6b7280'
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0} y={0} dy={14}
          textAnchor="middle"
          fill={color}
          fontSize={11}
          fontWeight="600"
        >
          {payload.value}
        </text>
        {/* Small coloured dot below the label */}
        <circle cx={0} cy={22} r={3.5} fill={color} />
      </g>
    )
  }

  // ── Custom dot for actual line — coloured + gap indicator ─────────────────
  const ActualDot = (props) => {
    const { cx, cy, payload } = props
    const color = BLOOMS_COLORS[payload.code] || '#6366f1'
    const isGap = payload.status !== 'ok'
    return (
      <g>
        {isGap && (
          <circle cx={cx} cy={cy} r={11} fill="#fef3c7" stroke="#f59e0b" strokeWidth={1.5} opacity={0.6} />
        )}
        <circle
          cx={cx} cy={cy} r={6}
          fill={color}
          stroke="#fff"
          strokeWidth={2.5}
        />
        {/* Value label above dot */}
        <text
          x={cx} y={cy - 12}
          textAnchor="middle"
          fontSize={9}
          fontWeight="700"
          fill={color}
        >
          {payload.actual}%
        </text>
      </g>
    )
  }

  // ── Target dot — hollow diamond ───────────────────────────────────────────
  const TargetDot = (props) => {
    const { cx, cy, payload } = props
    const color = BLOOMS_COLORS[payload.code] || '#94a3b8'
    const s = 5
    const pts = `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`
    return <polygon points={pts} fill="white" stroke={color} strokeWidth={2} />
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const item = chartData.find(d => d.name === label)
    if (!item) return null
    const color = BLOOMS_COLORS[item.code] || '#6366f1'
    return (
      <div style={{
        background: '#fff',
        border: `2px solid ${color}`,
        borderRadius: 10,
        padding: '10px 14px',
        fontSize: 12,
        minWidth: 170,
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color }} />
          <span style={{ fontWeight: 700, color: '#1f2328' }}>{item.name}</span>
          <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 10 }}>{item.code}</span>
        </div>
        {[
          { label: 'Ideal bell', val: `${item.bell}%`, col: '#d1d5db' },
          { label: 'Target',     val: `${item.target}%`, col: '#94a3b8' },
          { label: 'Actual',     val: `${item.actual}%`, col: color, bold: true },
          { label: 'Marks',      val: `${item.marks} / ${T}`, col: '#7c3aed' },
          { label: 'Deviation',  val: `±${item.deviation}%`, col: item.deviation > 0.5 ? '#d97706' : '#16a34a', bold: true },
        ].map(({ label, val, col, bold }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
            <span style={{ color: '#6b7280' }}>{label}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: bold ? 700 : 500, color: col }}>{val}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-4 border border-purple-100 rounded-xl p-4 bg-white">
      {/* Chart header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h6 className="text-sm font-bold text-gray-800">Bloom's Taxonomy — Bell Curve</h6>
          <p className="text-xs text-gray-400 mt-0.5">
            Smooth area curve · Lower-order → Higher-order cognitive levels
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${
          okCount === bloomsRows.length
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {okCount}/{bloomsRows.length} within ±0.5%
        </span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 28, right: 24, bottom: 28, left: -10 }}>
          <defs>
            {/* Actual fill — gradient per level, blended into a single purple-ish gradient */}
            <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#6366f1" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.04} />
            </linearGradient>
            {/* Target fill */}
            <linearGradient id="targetGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#94a3b8" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.02} />
            </linearGradient>
            {/* Ideal bell fill */}
            <linearGradient id="bellGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#e0e7ff" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#e0e7ff" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />

          <XAxis
            dataKey="name"
            tick={<ColoredTick />}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            height={40}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            unit="%"
            domain={[0, dataMax => Math.ceil((dataMax + 4) / 5) * 5]}
            tickLine={false}
            axisLine={false}
            width={36}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#e0e7ff', strokeWidth: 2 }} />

          {/* Layer 1: Ideal Gaussian bell — background ghost */}
          <Area
            type="natural"
            dataKey="bell"
            stroke="#c7d2fe"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            fill="url(#bellGrad)"
            dot={false}
            activeDot={false}
            legendType="none"
            isAnimationActive={true}
          />

          {/* Layer 2: Target % — dashed line with no fill, diamond dots */}
          <Area
            type="natural"
            dataKey="target"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="6 3"
            fill="url(#targetGrad)"
            dot={<TargetDot />}
            activeDot={false}
            legendType="none"
            isAnimationActive={true}
          />

          {/* Layer 3: Actual % — solid smooth bell with filled area, coloured dots */}
          <Area
            type="natural"
            dataKey="actual"
            stroke="#6366f1"
            strokeWidth={3}
            fill="url(#actualGrad)"
            dot={<ActualDot />}
            activeDot={false}
            legendType="none"
            isAnimationActive={true}
            animationDuration={800}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-5 justify-center mt-1 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <svg width="22" height="10">
            <defs>
              <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <rect x="0" y="4" width="22" height="6" fill="url(#lg1)" rx="2" />
            <line x1="0" y1="4" x2="22" y2="4" stroke="#6366f1" strokeWidth="2.5" />
          </svg>
          Actual %
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="22" height="10">
            <line x1="0" y1="5" x2="22" y2="5" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 3" />
            <polygon points="11,1 14,5 11,9 8,5" fill="white" stroke="#94a3b8" strokeWidth="1.5" />
          </svg>
          Target %
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="22" height="10">
            <line x1="0" y1="5" x2="22" y2="5" stroke="#c7d2fe" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Ideal bell
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14">
            <circle cx="7" cy="7" r="5" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.5" />
          </svg>
          <span className="text-amber-600">&gt;0.5% gap</span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BloomsTargetBellChart — live editable bell curve for the Set Targets step.
// bloomsTargets = { R: 10, U: 25, Ap: 30, An: 20, E: 10, C: 5 }
// onChange(code, newValue) — called when user drags the chart bar handles
// ─────────────────────────────────────────────────────────────────────────────
export function BloomsTargetBellChart({ bloomsTargets = {}, onChange }) {
  const total = BLOOMS_ORDER.reduce((a, k) => a + (bloomsTargets[k] || 0), 0)
  const isOk  = Math.abs(100 - total) < 1

  // Build chart data — target value from state, ideal bell for reference
  const chartData = BLOOMS_ORDER.map((code, i) => {
    const val  = bloomsTargets[code] || 0
    const bell = Math.exp(-0.5 * Math.pow((i - 2) / 1.4, 2))
    return { code, name: BLOOMS_NAMES[code], value: val, _bell: bell }
  })

  // Scale ideal bell to max target value
  const maxVal  = Math.max(...chartData.map(d => d.value), 1)
  const maxBell = Math.max(...chartData.map(d => d._bell), 0.001)
  const data = chartData.map(d => ({
    ...d,
    bell: +(d._bell * maxVal / maxBell).toFixed(1),
  }))

  // Custom coloured dot with the % label above it
  const ValueDot = (props) => {
    const { cx, cy, payload } = props
    const color = BLOOMS_COLORS[payload.code] || '#6366f1'
    return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill={color} stroke="#fff" strokeWidth={2.5} />
        <text x={cx} y={cy - 13} textAnchor="middle" fontSize={10} fontWeight="700" fill={color}>
          {payload.value}%
        </text>
      </g>
    )
  }

  // Coloured X-axis tick
  const ColoredTick = ({ x, y, payload }) => {
    const item = data.find(d => d.name === payload.value)
    const color = item ? BLOOMS_COLORS[item.code] : '#6b7280'
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={14} textAnchor="middle" fill={color} fontSize={11} fontWeight="600">
          {payload.value}
        </text>
        <circle cx={0} cy={22} r={3.5} fill={color} />
      </g>
    )
  }

  // Tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const item = data.find(d => d.name === label)
    if (!item) return null
    const color = BLOOMS_COLORS[item.code] || '#6366f1'
    return (
      <div style={{
        background: '#fff', border: `2px solid ${color}`, borderRadius: 8,
        padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
      }}>
        <div style={{ fontWeight: 700, color, marginBottom: 4 }}>{item.name} ({item.code})</div>
        <div style={{ color: '#6b7280' }}>
          Target: <span style={{ fontWeight: 700, color, fontFamily: 'monospace' }}>{item.value}%</span>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-700">Live Bell Curve Preview</span>
        <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${
          isOk ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {total.toFixed(0)}% / 100%
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 24, right: 16, bottom: 28, left: -16 }}>
          <defs>
            <linearGradient id="tgtGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="tgtBellGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#c7d2fe" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#c7d2fe" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="name" tick={<ColoredTick />} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} height={38} />
          <YAxis
            tick={{ fontSize: 9, fill: '#9ca3af' }} unit="%" tickLine={false} axisLine={false}
            domain={[0, dataMax => Math.ceil((dataMax + 5) / 5) * 5]} width={30}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#e0e7ff', strokeWidth: 1.5 }} />

          {/* Ideal Gaussian bell — ghost reference */}
          <Area
            type="natural" dataKey="bell"
            stroke="#c7d2fe" strokeWidth={1.5} strokeDasharray="5 4"
            fill="url(#tgtBellGrad)" dot={false} activeDot={false}
            legendType="none" isAnimationActive={false}
          />

          {/* Target distribution — live smooth bell */}
          <Area
            type="natural" dataKey="value"
            stroke="#6366f1" strokeWidth={2.5}
            fill="url(#tgtGrad)"
            dot={<ValueDot />} activeDot={false}
            legendType="none" isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Inline ± nudge buttons per level */}
      {onChange && (
        <div className="grid grid-cols-6 gap-px bg-gray-100 border-t border-gray-100">
          {BLOOMS_ORDER.map(code => {
            const val   = bloomsTargets[code] || 0
            const color = BLOOMS_COLORS[code]
            return (
              <div key={code} className="bg-white flex flex-col items-center py-2 gap-1">
                <span
                  className="text-xs font-bold"
                  style={{ color }}
                >{code}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    className="w-5 h-5 rounded text-xs font-bold flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
                    onClick={() => onChange(code, Math.max(0, val - 5))}
                  >−</button>
                  <span
                    className="text-xs font-mono font-bold w-8 text-center"
                    style={{ color }}
                  >{val}%</span>
                  <button
                    className="w-5 h-5 rounded text-xs font-bold flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
                    onClick={() => onChange(code, Math.min(100, val + 5))}
                  >+</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Radar (kept for backward compat, aliased)
// ─────────────────────────────────────────────────────────────────────────────
export function BloomsRadarChart({ data }) {
  const items = Object.entries(data || {}).map(([code, d]) => ({
    subject: code,
    percent: d.percent,
  }))
  return (
    <ResponsiveContainer width="100%" height={250}>
      <RechartsRadar outerRadius={80} data={items}>
        <PolarGrid />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
        <Radar name="Bloom's %" dataKey="percent" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
      </RechartsRadar>
    </ResponsiveContainer>
  )
}

export { BloomsRadarChart as BloomsBarChart }

// ─────────────────────────────────────────────────────────────────────────────
// CO Pie
// ─────────────────────────────────────────────────────────────────────────────
export function CoPieChart({ data }) {
  const items = Object.entries(data || {}).map(([code, d]) => ({
    name: code,
    value: d.percent,
  }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={items}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, value }) => `${name} ${value}%`}
        >
          {items.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => `${v}%`} />
      </PieChart>
    </ResponsiveContainer>
  )
}
