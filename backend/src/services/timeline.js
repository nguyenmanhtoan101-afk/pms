// ════ TIMELINE ENGINE — giữ đúng logic client (kiểu công thức Excel) ════
function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + (n || 0));
  return t.toISOString().slice(0, 10);
}
function diffDays(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
function today() { return new Date().toISOString().slice(0, 10); }

// due[i] = ov[i] ?? (due[i-1] + days[i]) — chuỗi gồm CẢ bước skip (khớp client)
function computeDue(steps, startDate) {
  let cur = startDate;
  for (const s of steps) {
    s.due_computed = s.due_override || addDays(cur, s.days || 0);
    cur = s.due_computed;
  }
  return steps;
}

// Trạng thái bước — đúng thứ tự ưu tiên client
function getStatus(s, td) {
  td = td || today();
  if (s.skip) return 'skip';
  if (s.pend_data) return 'wait';
  if (s.actual_date) return 'done';
  if (s.due_computed < td) return 'late';
  if (diffDays(td, s.due_computed) <= 10) return 'soon';
  return 'plan';
}

// Tính lại due cho 1 dự án trong DB, trả về map {step_id: due}
async function recompute(client, projectId) {
  const { rows: proj } = await client.query('SELECT start_date FROM projects WHERE id=$1', [projectId]);
  if (!proj.length) throw new Error('project not found');
  const start = proj[0].start_date.toISOString().slice(0, 10);
  const { rows: steps } = await client.query(
    'SELECT id, days, due_override FROM steps WHERE project_id=$1 ORDER BY seq', [projectId]);
  let cur = start;
  const dues = {};
  for (const s of steps) {
    const ov = s.due_override ? s.due_override.toISOString().slice(0, 10) : null;
    const due = ov || addDays(cur, s.days || 0);
    dues[s.id] = due;
    cur = due;
  }
  // batch update
  const ids = Object.keys(dues);
  if (ids.length) {
    const values = ids.map((id, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::date)`).join(',');
    const params = ids.flatMap(id => [id, dues[id]]);
    await client.query(
      `UPDATE steps SET due_computed = v.due, updated_at = NOW()
       FROM (VALUES ${values}) AS v(id, due) WHERE steps.id = v.id`, params);
  }
  return dues;
}

module.exports = { addDays, diffDays, today, computeDue, getStatus, recompute };
