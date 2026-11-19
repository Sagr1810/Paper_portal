import React, { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Upload, FileText } from 'lucide-react'
import { syllabusApi, masterApi } from '../api/endpoints'

const MAX_BYTES = 10 * 1024 * 1024

// Upload syllabus PDF -> subject code, name and each unit's % are filled in -> faculty checks -> Save.
export default function SyllabusUploadPanel({ onClose, onSaved, departmentId, subjects = [] }) {
  const qc = useQueryClient()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [draft, setDraft] = useState(null)

  const parseMut = useMutation({
    mutationFn: (f) => {
      const fd = new FormData()
      fd.append('file', f)
      return syllabusApi.parse(fd)
    },
    onSuccess: ({ data }) =>
      setDraft({
        subject_code: data.subject.subject_code || '',
        subject_name: data.subject.subject_name || '',
        semester: data.subject.semester ?? '',
        program: data.subject.program || '',
        units: data.units.map((u) => ({ ...u, weight_percent: u.weight_percent ?? 0 })),
        warnings: data.warnings || [],
        cos: (data.cos || []).map((c) => ({ co_code: c.co_code || '', description: c.description || '', po_mapping: c.po_mapping || '' })),
      }),
    onError: (e) => toast.error(e.response?.data?.detail || 'Could not read this PDF'),
  })

  const saveMut = useMutation({
    mutationFn: async (d) => {
      const r = await syllabusApi.save({
        subject_code: d.subject_code.trim(),
        subject_name: d.subject_name.trim(),
        semester: d.semester ? parseInt(d.semester, 10) : null,
        program: d.program?.trim() || null,
        units: d.units.map((u) => ({
          unit_code: u.unit_code.trim(),
          unit_name: u.unit_name.trim(),
          weight_percent: Number(u.weight_percent) || 0,
        })),
        cos: (d.cos || [])
          .filter((c) => c.co_code.trim() && c.description.trim())
          .map((c) => ({ co_code: c.co_code.trim(), description: c.description.trim(), po_mapping: c.po_mapping?.trim() || null })),
      })
      return { subject: r.data.subject, created: r.data.created, restored: r.data.restored, added: r.data.added, skipped: r.data.updated, cosAdded: r.data.cos_added || 0, cosUpdated: r.data.cos_updated || 0 }
    },
    onSuccess: ({ subject, created, restored, added, skipped, cosAdded, cosUpdated }) => {
      const status = created ? 'created' : restored ? 'restored' : 'updated'
      toast.success(`${subject.subject_code} ${subject.subject_name} ${status}: ${added + skipped} unit(s), ${cosAdded + cosUpdated} CO(s)`)
      qc.invalidateQueries()
      onSaved?.()
    },
    onError: (e) => {
      const detail = e.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Could not save. Please check the fields.')
    },
  })

  const pick = (f) => {
    if (!f) return
    if (!/\.pdf$/i.test(f.name)) return toast.error('Please choose a PDF file')
    if (f.size > MAX_BYTES) return toast.error('The PDF is larger than 10 MB')
    setFile(f)
  }
  const setUnit = (i, patch) =>
    setDraft((d) => ({ ...d, units: d.units.map((u, k) => (k === i ? { ...u, ...patch } : u)) }))
  const setCO = (i, patch) =>
    setDraft((d) => ({ ...d, cos: d.cos.map((c, k) => (k === i ? { ...c, ...patch } : c)) }))
  const total = draft ? Math.round(draft.units.reduce((s, u) => s + (Number(u.weight_percent) || 0), 0) * 100) / 100 : 0
  const totalOk = Math.abs(total - 100) <= 0.5
  const canSave =
    draft && departmentId && draft.subject_code.trim() && draft.subject_name.trim() &&
    draft.units.every((u) => u.unit_code.trim() && u.unit_name.trim()) && !saveMut.isPending

  return (
    <div className="border border-blue-200 rounded-lg bg-blue-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-blue-800 flex items-center gap-1.5">
          <FileText size={14} /> Upload Syllabus (PDF)
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕ Cancel</button>
      </div>

      {!draft && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            Upload the syllabus PDF. The subject code, subject name and each unit's % weightage are filled in
            for you. You can check and edit them before saving.
          </p>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden"
            onChange={(e) => pick(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> {file ? 'Choose a different PDF' : 'Choose PDF'}
            </button>
            {file && <span className="text-xs text-gray-700">{file.name}</span>}
          </div>
          <button className="btn-primary text-sm" disabled={!file || parseMut.isPending}
            onClick={() => parseMut.mutate(file)}>
            {parseMut.isPending ? 'Reading PDF…' : 'Read PDF'}
          </button>
        </div>
      )}

      {draft && (
        <div className="space-y-3">
          {draft.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{w}</p>
          ))}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label text-xs">Subject Code *</label>
              <input className="input text-sm" value={draft.subject_code}
                onChange={(e) => setDraft({ ...draft, subject_code: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="label text-xs">Subject Name *</label>
              <input className="input text-sm" value={draft.subject_name}
                onChange={(e) => setDraft({ ...draft, subject_name: e.target.value })} />
            </div>
            <div>
              <label className="label text-xs">Semester</label>
              <input className="input text-sm" type="number" min="1" max="12" value={draft.semester}
                onChange={(e) => setDraft({ ...draft, semester: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="label text-xs">Program</label>
              <input className="input text-sm" value={draft.program}
                onChange={(e) => setDraft({ ...draft, program: e.target.value })} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">Units and % weightage</div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${totalOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              Total {total}% {totalOk ? '' : '(should be 100%)'}
            </span>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {draft.units.map((u, i) => (
              <div key={i} className="flex gap-2 items-center bg-white border border-gray-200 rounded p-1.5">
                <input className="input text-xs w-14 shrink-0" value={u.unit_code}
                  onChange={(e) => setUnit(i, { unit_code: e.target.value })} />
                <input className="input text-xs flex-1" value={u.unit_name}
                  onChange={(e) => setUnit(i, { unit_name: e.target.value })} />
                <input className="input text-xs w-16 text-right" type="number" min="0" max="100" step="0.5"
                  value={u.weight_percent} onChange={(e) => setUnit(i, { weight_percent: e.target.value })} />
                <span className="text-xs text-gray-500">%</span>
                <button type="button" className="text-red-400 hover:text-red-600 shrink-0" title="Remove unit"
                  onClick={() => setDraft({ ...draft, units: draft.units.filter((_, k) => k !== i) })}>✕</button>
              </div>
            ))}
            {draft.units.length === 0 && <p className="text-xs text-gray-400">No units found.</p>}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">Course Outcomes (read from the PDF)</div>
            <button type="button" className="text-xs text-blue-700 hover:underline"
              onClick={() => setDraft({ ...draft, cos: [...draft.cos, { co_code: `CO${draft.cos.length + 1}`, description: '', po_mapping: '' }] })}>
              + Add CO
            </button>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {draft.cos.map((c, i) => (
              <div key={i} className="flex gap-2 items-start bg-white border border-gray-200 rounded p-1.5">
                <input className="input text-xs w-14 shrink-0" value={c.co_code}
                  onChange={(e) => setCO(i, { co_code: e.target.value })} />
                <textarea className="input text-xs flex-1" rows={2} value={c.description}
                  onChange={(e) => setCO(i, { description: e.target.value })} />
                <input className="input text-xs w-24 shrink-0" placeholder="PO map" value={c.po_mapping}
                  onChange={(e) => setCO(i, { po_mapping: e.target.value })} />
                <button type="button" className="text-red-400 hover:text-red-600 shrink-0" title="Remove CO"
                  onClick={() => setDraft({ ...draft, cos: draft.cos.filter((_, k) => k !== i) })}>✕</button>
              </div>
            ))}
            {draft.cos.length === 0 && <p className="text-xs text-gray-400">No COs found. Use + Add CO.</p>}
          </div>

          {!departmentId && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Your account has no department assigned. Ask the Owner to set it first.
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn-primary text-sm flex-1" disabled={!canSave}
              onClick={() => saveMut.mutate(draft)}>
              {saveMut.isPending ? 'Saving…' : 'Save subject, units and COs'}
            </button>
            <button className="btn-secondary text-sm" onClick={() => { setDraft(null); setFile(null) }}>
              Upload another
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
