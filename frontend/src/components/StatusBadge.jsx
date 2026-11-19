import React from 'react'
import clsx from 'clsx'

const STATUS_STYLES = {
  draft:              'bg-gray-100 text-gray-700',
  submitted:          'bg-blue-100 text-blue-700',
  hod_review:         'bg-yellow-100 text-yellow-700',
  hod_approved:       'bg-green-100 text-green-700',
  hod_returned:       'bg-orange-100 text-orange-700',
  principal_review:   'bg-purple-100 text-purple-700',
  principal_approved: 'bg-emerald-100 text-emerald-700',
  principal_returned: 'bg-red-100 text-red-700',
  exam_cell_review:   'bg-indigo-100 text-indigo-700',
  finalized:          'bg-teal-100 text-teal-700',
  returned:           'bg-red-100 text-red-700',
}

const STATUS_LABELS = {
  draft:              'Draft',
  submitted:          'Submitted',
  hod_review:         'HOD Review',
  hod_approved:       'HOD Approved',
  hod_returned:       'HOD Returned',
  principal_review:   'Principal Review',
  principal_approved: 'Principal Approved',
  principal_returned: 'Principal Returned',
  exam_cell_review:   'Exam Cell Review',
  finalized:          'Finalized',
  returned:           'Returned',
}

export default function StatusBadge({ status }) {
  return (
    <span className={clsx('badge', STATUS_STYLES[status] || 'bg-gray-100 text-gray-600')}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}
