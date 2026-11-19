import api from './client'

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: (refreshToken) => api.post('/auth/logout', { refresh_token: refreshToken }),
}

export const usersApi = {
  me: () => api.get('/users/me'),
  list: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.patch(`/users/${id}`, data),
  deactivate: (id) => api.delete(`/users/${id}`),
  deletePermanent: (id) => api.delete(`/users/${id}/permanent`),
  bulkAction: (action, user_ids, confirm) =>
    api.post('/users/bulk/action', confirm === undefined ? { action, user_ids } : { action, user_ids, confirm }),
  footprint: (id) => api.get(`/users/${id}/footprint`),
  bulkTemplate: () => api.get('/users/bulk/template', { responseType: 'blob' }),
  bulkUpload: (formData) => api.post('/users/bulk/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
}

export const masterApi = {
  colleges: () => api.get('/master/colleges'),
  createCollege: (data) => api.post('/master/colleges', data),
  updateCollege: (id, data) => api.patch(`/master/colleges/${id}`, data),
  deleteCollege: (id) => api.delete(`/master/colleges/${id}`),
  departments: () => api.get('/master/departments'),
  createDepartment: (data) => api.post('/master/departments', data),
  deleteDepartment: (id) => api.delete(`/master/departments/${id}`),
  subjects: (departmentId) => api.get('/master/subjects', { params: { department_id: departmentId } }),
  createSubject: (data) => api.post('/master/subjects', data),
  updateSubject: (id, data) => api.patch(`/master/subjects/${id}`, data),
  deleteSubject: (id) => api.delete(`/master/subjects/${id}`),
  units: (subjectId) => api.get('/master/units', { params: { subject_id: subjectId } }),
  createUnit: (data) => api.post('/master/units', data),
  cos: (subjectId) => api.get('/master/cos', { params: { subject_id: subjectId } }),
  createCO: (data) => api.post('/master/cos', data),
  updateCO: (id, data) => api.patch(`/master/cos/${id}`, data),
  deleteCO: (id) => api.delete(`/master/cos/${id}`),
  blooms: () => api.get('/master/blooms'),
  examConfigs: (params) => api.get('/master/exam-configs', { params }),
  examConfig: (id) => api.get(`/master/exam-configs/${id}`),
  createExamConfig: (data) => api.post('/master/exam-configs', data),
  updateExamConfigTargets: (id, data) => api.patch(`/master/exam-configs/${id}/targets`, data),
}

export const questionsApi = {
  list: (params) => api.get('/questions', { params }),
  get: (id) => api.get(`/questions/${id}`),
  create: (data) => api.post('/questions', data),
  update: (id, data) => api.patch(`/questions/${id}`, data),
  delete: (id) => api.delete(`/questions/${id}`),
}

export const papersApi = {
  list: (params) => api.get('/papers', { params }),
  directory: (params) => api.get('/papers/directory', { params }),
  get: (id) => api.get(`/papers/${id}`),
  analysis: (id) => api.get(`/papers/${id}/analysis`),
  summary: (id) => api.get(`/papers/${id}/summary`),
  history: (id) => api.get(`/papers/${id}/history`),
  generate: (data) => api.post('/papers/generate', data),
  fromTemplate: (data) => api.post('/papers/from-template', data),
  template: (configId) => api.get(`/papers/template/${configId}`),
  update: (id, data) => api.patch(`/papers/${id}`, data),
  delete: (id) => api.delete(`/papers/${id}`),
  updateMeta: (id, data) => api.patch(`/papers/${id}`, data),
  deletePaper: (id) => api.delete(`/papers/${id}`),
  updateSlot: (paperId, slotId, data) => api.put(`/papers/${paperId}/slots/${slotId}`, data),
  assignCoBlooms: (paperId, data) => api.put(`/papers/${paperId}/assign-co-blooms`, data),
  autoAssign: (paperId, data) => api.post(`/papers/${paperId}/auto-assign`, data),
  previewDistribution: (data) => api.post('/papers/preview-distribution', data),
  recalculate: (paperId, data) => api.post(`/papers/${paperId}/recalculate`, data || {}),
  transition: (id, data) => api.post(`/papers/${id}/transition`, data),
  export: (id, fmt) => api.get(`/papers/${id}/export/${fmt}`, { responseType: 'blob' }),
  checkDuplicates: (paperId, formData) =>
    formData
      ? api.post(`/papers/${paperId}/check-duplicates`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      : api.post(`/papers/${paperId}/check-duplicates`),
  // Slot-template CSV endpoints
  slotTemplates: () => api.get('/papers/slot-templates'),
  downloadSlotTemplate: (templateId) =>
    api.get(`/papers/slot-templates/${templateId}/download`, { responseType: 'blob' }),
  importSlotsCsv: (paperId, formData) =>
    api.post(`/papers/${paperId}/import-slots-csv`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
}

export const syllabusApi = {
  parse: (formData) => api.post('/syllabus/parse', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  save: (data) => api.post('/syllabus/import', data),
}

export const importsApi = {
  upload: (formData) => api.post('/imports/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  confirmMapping: (data) => api.post('/imports/confirm-mapping', data),
  validate: (id, subjectId) => api.post(`/imports/${id}/validate`, null, { params: { subject_id: subjectId } }),
  runImport: (id, subjectId) => api.post(`/imports/${id}/import`, null, { params: { subject_id: subjectId } }),
  list: () => api.get('/imports'),
  template: (category) => api.get(`/imports/templates/${category}`, { responseType: 'blob' }),
}

export const dashboardApi = {
  summary: () => api.get('/dashboard/summary'),
}

export const auditApi = {
  list: (params) => api.get('/audit', { params }),
}
