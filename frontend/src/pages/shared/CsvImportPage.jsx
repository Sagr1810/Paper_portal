import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Layout from '../../components/Layout'
import { importsApi, masterApi, papersApi } from '../../api/endpoints'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import { Upload, Download, CheckCircle, AlertTriangle, AlertCircle, ArrowRight } from 'lucide-react'

// Detect if a File is a paper slot-assignment CSV (Que,Mark,...,CO,BLOOM'S format)
// rather than a question-bank CSV. We read only the first line.
function isPaperSlotCsv(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const firstLine = (e.target.result || '').split('\n')[0].toLowerCase()
      // Paper slot CSVs always start with "que" and contain "bloom" in the header
      resolve(firstLine.startsWith('que') && firstLine.includes('bloom'))
    }
    reader.onerror = () => resolve(false)
    // Only read the first 256 bytes — just the header row
    reader.readAsText(file.slice(0, 256))
  })
}

const CATEGORIES = ['questions', 'units', 'co', 'blooms', 'exam_config', 'sample_papers']

export default function CsvImportPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [category, setCategory] = useState('questions')
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [file, setFile] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [mapping, setMapping] = useState({})
  const [importId, setImportId] = useState(null)
  const [step, setStep] = useState('upload') // upload | mapping | validate | done
  const [slotCsvWarning, setSlotCsvWarning] = useState(false)

  const { data: slotTemplates = [] } = useQuery({
    queryKey: ['slot-templates'],
    queryFn: () => papersApi.slotTemplates().then(r => r.data),
    staleTime: Infinity,
  })

  const downloadSlotTemplate = async (tpl) => {
    try {
      const res = await papersApi.downloadSlotTemplate(tpl.id)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url; a.download = tpl.filename; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Failed to download mark-scheme template') }
  }

  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: () => masterApi.subjects().then(r => r.data) })
  const { data: imports = [] } = useQuery({ queryKey: ['imports'], queryFn: () => importsApi.list().then(r => r.data) })

  const uploadMut = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('category', category)
      return importsApi.upload(fd)
    },
    onSuccess: (res) => {
      const data = res.data
      setImportId(data.import_id)
      setMapping(data.suggested_mapping || {})
      setImportResult({ preview: data.preview, csvColumns: data.csv_columns, rowsTotal: data.rows_total })
      setStep('mapping')
      toast.success('File uploaded. Confirm column mapping.')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Upload failed'),
  })

  const confirmMut = useMutation({
    mutationFn: () => importsApi.confirmMapping({ import_id: importId, mapping }),
    onSuccess: () => { setStep('validate'); toast.success('Mapping saved') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed'),
  })

  const validateMut = useMutation({
    mutationFn: () => importsApi.validate(importId, selectedSubjectId || undefined),
    onSuccess: (res) => {
      const d = res.data
      if (d.valid) toast.success(`Validation passed (${d.error_count} errors)`)
      else toast.error(`${d.error_count} validation errors found`)
      setImportResult(p => ({ ...p, validationResult: d }))
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed'),
  })

  const importMut = useMutation({
    mutationFn: () => importsApi.runImport(importId, selectedSubjectId || undefined),
    onSuccess: (res) => {
      const d = res.data
      toast.success(`Imported ${d.rows_imported} rows, skipped ${d.rows_skipped}`)
      qc.invalidateQueries(['imports', 'questions'])
      setStep('done')
      setImportResult(p => ({ ...p, importFinal: d }))
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Import failed'),
  })

  const downloadTemplate = async (cat) => {
    try {
      const res = await importsApi.template(cat)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = `template_${cat}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Failed to download template') }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">CSV Import</h2>

        {/* Data Import Templates */}
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Download Import Templates</h3>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(cat => (
              <button key={cat} className="btn-secondary text-xs flex items-center gap-1" onClick={() => downloadTemplate(cat)}>
                <Download size={12} /> {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Mark-Scheme Slot Templates */}
        <div className="card mb-6">
          <h3 className="font-semibold mb-1">Mark-Scheme Slot Templates</h3>
          <p className="text-sm text-gray-500 mb-3">
            Download a blank mark-scheme CSV that matches the slot structure of a standard exam.
            Fill in the <strong>CO</strong> and <strong>BLOOM'S</strong> columns, then import it
            from the <em>Slot Assignments</em> panel inside the Paper Editor.
          </p>
          <div className="flex flex-wrap gap-2">
            {slotTemplates.length === 0 && (
              <span className="text-xs text-gray-400 italic">Loading…</span>
            )}
            {slotTemplates.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => downloadSlotTemplate(tpl)}
                className="btn-secondary text-xs flex items-center gap-1"
              >
                <Download size={12} /> {tpl.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Format: <code className="bg-gray-100 px-1 py-0.5 rounded">Que, Mark, Q.N, sub-label, OR, MARKS, CO, BLOOM'S</code>
          </p>
        </div>

        {/* Upload form */}
        {step === 'upload' && (
          <div className="card mb-6">
            <h3 className="font-semibold mb-4">Upload CSV</h3>
            <div className="space-y-4">
              <div>
                <label className="label">Category</label>
                <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {['questions', 'units', 'co', 'sample_papers'].includes(category) && (
                <div>
                  <label className="label">Subject (required for questions/units/CO)</label>
                  <select className="input" value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}>
                    <option value="">Select subject…</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.subject_code} — {s.subject_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">CSV File</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-brand transition-colors">
                  <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                  <input type="file" accept=".csv" className="hidden" id="csvFile"
                    onChange={async (e) => {
                      const f = e.target.files[0]
                      if (!f) return
                      setSlotCsvWarning(false)
                      const isSlot = await isPaperSlotCsv(f)
                      if (isSlot) {
                        setSlotCsvWarning(true)
                        setFile(null)
                        e.target.value = ''
                        return
                      }
                      setFile(f)
                    }} />
                  <label htmlFor="csvFile" className="cursor-pointer text-brand hover:underline text-sm">
                    {file ? file.name : 'Click to select CSV file'}
                  </label>
                </div>
              </div>

              {/* Wrong-file warning — shown when a paper slot CSV is detected */}
              {slotCsvWarning && (
                <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-amber-800">
                    <AlertCircle size={16} className="shrink-0" />
                    Wrong place — this is a Paper Slot CSV, not a question-bank CSV
                  </div>
                  <p className="text-sm text-amber-700">
                    The file you selected (<strong>Que / Mark / CO / BLOOM'S</strong> format) is used to assign CO &amp; Bloom's to your paper's question slots.
                    It cannot be imported here.
                  </p>
                  <div className="bg-white border border-amber-200 rounded-lg p-3 text-sm text-amber-900 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5"><ArrowRight size={13} /> How to upload it correctly:</p>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>Go to <strong>My Papers</strong> and open your paper.</li>
                      <li>Click the <strong>View</strong> button, then open the paper editor (Edit).</li>
                      <li>In the paper editor, go to the <strong>Slot Assignments</strong> step.</li>
                      <li>Click <strong>Import CSV</strong> (the upload icon in the slot table header).</li>
                      <li>Upload your filled CSV there — it will apply CO &amp; Bloom's directly to your paper's slots.</li>
                    </ol>
                  </div>
                </div>
              )}

              <button className="btn-primary" disabled={!file || uploadMut.isPending} onClick={() => uploadMut.mutate()}>
                {uploadMut.isPending ? 'Uploading…' : 'Upload & Analyze'}
              </button>
            </div>
          </div>
        )}

        {/* Column Mapping */}
        {step === 'mapping' && importResult && (
          <div className="card mb-6">
            <h3 className="font-semibold mb-4">Column Mapping</h3>
            <p className="text-sm text-gray-500 mb-3">{importResult.rowsTotal} rows detected. Confirm or adjust column mapping.</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {importResult.csvColumns?.map(col => (
                <div key={col} className="flex items-center gap-2">
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">{col}</span>
                  <span className="text-gray-400">→</span>
                  <input className="input text-xs flex-1" value={mapping[col] || ''} placeholder="system_field"
                    onChange={e => setMapping(p => ({ ...p, [col]: e.target.value }))} />
                </div>
              ))}
            </div>
            {/* Preview */}
            {importResult.preview?.length > 0 && (
              <div className="overflow-x-auto mb-4">
                <p className="text-xs font-semibold text-gray-500 mb-1">Preview (first 10 rows):</p>
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr>{Object.keys(importResult.preview[0]).map(k => <th key={k} className="border border-gray-200 px-2 py-1 bg-gray-50">{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {importResult.preview.map((row, i) => (
                      <tr key={i}>{Object.values(row).map((v, j) => <td key={j} className="border border-gray-200 px-2 py-1">{String(v ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}>
                Confirm Mapping
              </button>
              <button className="btn-secondary" onClick={() => setStep('upload')}>Back</button>
            </div>
          </div>
        )}

        {/* Validate & Import */}
        {step === 'validate' && (
          <div className="card mb-6">
            <h3 className="font-semibold mb-4">Validate & Import</h3>
            <div className="flex gap-2 mb-4">
              <button className="btn-secondary" onClick={() => validateMut.mutate()} disabled={validateMut.isPending}>
                {validateMut.isPending ? 'Validating…' : 'Validate'}
              </button>
              <button className="btn-primary" onClick={() => importMut.mutate()} disabled={importMut.isPending}>
                {importMut.isPending ? 'Importing…' : 'Run Import'}
              </button>
            </div>
            {importResult?.validationResult && (
              <div className={`rounded-lg p-3 ${importResult.validationResult.valid ? 'bg-green-50' : 'bg-red-50'}`}>
                {importResult.validationResult.valid
                  ? <p className="text-green-700 text-sm flex items-center gap-2"><CheckCircle size={16} /> Validation passed</p>
                  : <div>
                    <p className="text-red-700 text-sm flex items-center gap-2 mb-2"><AlertTriangle size={16} /> {importResult.validationResult.error_count} errors</p>
                    {importResult.validationResult.errors?.map((err, i) => (
                      <p key={i} className="text-xs text-red-600">Row {err.row}: [{err.field}] {err.error}</p>
                    ))}
                  </div>
                }
              </div>
            )}
          </div>
        )}

        {step === 'done' && importResult?.importFinal && (
          <div className="card mb-6 bg-green-50">
            <h3 className="font-semibold text-green-800 mb-2">Import Complete</h3>
            <p className="text-sm text-green-700">Imported: {importResult.importFinal.rows_imported} rows</p>
            <p className="text-sm text-green-700">Skipped: {importResult.importFinal.rows_skipped} rows</p>
            <button className="btn-primary mt-3" onClick={() => { setStep('upload'); setFile(null); setImportResult(null); setImportId(null) }}>
              Import Another
            </button>
          </div>
        )}

        {/* Import History */}
        <div className="card">
          <h3 className="font-semibold mb-4">Import History</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>{['File', 'Category', 'Status', 'Rows', 'Imported', 'Date'].map(h => <th key={h} className="table-header">{h}</th>)}</tr>
              </thead>
              <tbody>
                {imports.map(imp => (
                  <tr key={imp.id} className="hover:bg-gray-50">
                    <td className="table-cell text-xs truncate max-w-32">{imp.original_filename}</td>
                    <td className="table-cell"><span className="badge bg-blue-100 text-blue-700">{imp.category}</span></td>
                    <td className="table-cell"><span className={`badge ${imp.status === 'imported' ? 'bg-green-100 text-green-700' : imp.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100'}`}>{imp.status}</span></td>
                    <td className="table-cell">{imp.rows_total}</td>
                    <td className="table-cell">{imp.rows_imported}</td>
                    <td className="table-cell text-xs text-gray-400">{new Date(imp.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {imports.length === 0 && <tr><td colSpan={6} className="table-cell text-center text-gray-400">No imports yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}
