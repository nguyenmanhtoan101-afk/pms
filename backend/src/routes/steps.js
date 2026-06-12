const router = require('express').Router();
const pool = require('../db');
const { auth, canAccessProject, canEditProject } = require('../middleware/auth');
const { recompute } = require('../services/timeline');
const { stepToClient } = require('../services/serialize');

async function getStep(id) {
  const { rows } = await pool.query('SELECT * FROM steps WHERE id=$1', [id]);
  return rows[0] || null;
}
async function guard(req, res, needEdit = true) {
  const s = await getStep(req.params.id);
  if (!s) { res.status(404).json({ error: 'Bước không tồn tại' }); return null; }
  const acc = await canAccessProject(pool, req.user, s.project_id);
  if (!acc.ok) { res.status(acc.code).json({ error: 'Không có quyền' }); return null; }
  if (needEdit && !canEditProject(req.user, acc.p)) { res.status(403).json({ error: 'Không có quyền chỉnh sửa' }); return null; }
  return { s, p: acc.p };
}
async function withRecompute(projectId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    const dues = await recompute(client, projectId);
    await client.query('COMMIT');
    return { result, dues };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
async function freshStep(id, dues) {
  const s = await getStep(id);
  return stepToClient({ ...s, due_computed: dues[id] || s.due_computed });
}

// PUT /api/steps/:id — sửa days/doc/unit/note (và bước tùy biến: tên, stt, ph, ow)
router.put('/:id', auth, async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const sets = [], params = [];
  const map = { days: 'days', doc: 'doc_ref', unit: 'unit', note: 'note' };
  if (!g.s.is_required) Object.assign(map, { name: 'name', stt: 'stt', ph: 'phase', ow: 'owner' });
  for (const [k, col] of Object.entries(map))
    if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${col}=$${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường hợp lệ' });
  params.push(req.params.id);
  const { dues } = await withRecompute(g.s.project_id, async (client) => {
    await client.query(`UPDATE steps SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
      VALUES ($1,$2,'step_edit',$3,$4)`, [g.s.project_id, req.params.id, req.user.id, JSON.stringify(req.body)]);
  });
  res.json({ step: await freshStep(req.params.id, dues), dues });
});

// POST /complete — ghi nhận hoàn thành
router.post('/:id/complete', auth, async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const { actual_date, doc_ref, unit, note } = req.body || {};
  if (!actual_date) return res.status(400).json({ error: 'Thiếu ngày hoàn thành' });
  const { dues } = await withRecompute(g.s.project_id, async (client) => {
    await client.query(
      `UPDATE steps SET actual_date=$1, doc_ref=COALESCE($2,doc_ref), unit=COALESCE($3,unit),
       note=COALESCE($4,note), pend_data=NULL, updated_at=NOW() WHERE id=$5`,
      [actual_date, doc_ref || null, unit || null, note || null, req.params.id]);
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
      VALUES ($1,$2,'step_done',$3,$4)`,
      [g.s.project_id, req.params.id, req.user.id, JSON.stringify({ actual_date, doc_ref })]);
  });
  res.json({ step: await freshStep(req.params.id, dues), dues });
});

// POST /submit — nhà thầu gửi cập nhật (chỉ bước owner nt/tv của dự án mình tham gia)
router.post('/:id/submit', auth, async (req, res) => {
  if (req.user.role !== 'nt') return res.status(403).json({ error: 'Chỉ nhà thầu được gửi cập nhật' });
  const s = await getStep(req.params.id);
  if (!s) return res.status(404).json({ error: 'Bước không tồn tại' });
  const acc = await canAccessProject(pool, req.user, s.project_id);
  if (!acc.ok) return res.status(403).json({ error: 'Không tham gia dự án này' });
  if (!['nt', 'tv'].includes(s.owner)) return res.status(403).json({ error: 'Bước này không thuộc phần việc nhà thầu' });
  if (s.actual_date) return res.status(400).json({ error: 'Bước đã hoàn thành' });
  const pend = { date: req.body.date, note: req.body.note || '', pct: +req.body.pct || 100 };
  await pool.query('UPDATE steps SET pend_data=$1, updated_at=NOW() WHERE id=$2', [JSON.stringify(pend), req.params.id]);
  await pool.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
    VALUES ($1,$2,'step_submit',$3,$4)`, [s.project_id, req.params.id, req.user.id, JSON.stringify(pend)]);
  res.json({ step: stepToClient({ ...s, pend_data: pend }) });
});

// POST /confirm — CĐT/Sở xác nhận hoặc trả lại
router.post('/:id/confirm', auth, async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  if (!g.s.pend_data) return res.status(400).json({ error: 'Không có cập nhật chờ xác nhận' });
  const ok = !!req.body.ok;
  const { dues } = await withRecompute(g.s.project_id, async (client) => {
    if (ok) {
      await client.query(
        `UPDATE steps SET actual_date=$1, note=COALESCE($2,note), pend_data=NULL, updated_at=NOW() WHERE id=$3`,
        [g.s.pend_data.date || new Date().toISOString().slice(0, 10), g.s.pend_data.note || null, req.params.id]);
    } else {
      await client.query('UPDATE steps SET pend_data=NULL, updated_at=NOW() WHERE id=$1', [req.params.id]);
    }
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
      VALUES ($1,$2,$3,$4,$5)`,
      [g.s.project_id, req.params.id, ok ? 'step_confirm' : 'step_reject', req.user.id, JSON.stringify(g.s.pend_data)]);
  });
  res.json({ step: await freshStep(req.params.id, dues), dues });
});

// POST /skip — bỏ qua bước bắt buộc (cần lý do)
router.post('/:id/skip', auth, async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Cần lý do / căn cứ pháp lý để bỏ qua bước bắt buộc' });
  const { dues } = await withRecompute(g.s.project_id, async (client) => {
    await client.query('UPDATE steps SET skip=true, skip_reason=$1, updated_at=NOW() WHERE id=$2', [reason, req.params.id]);
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
      VALUES ($1,$2,'step_skip',$3,$4)`, [g.s.project_id, req.params.id, req.user.id, JSON.stringify({ reason })]);
  });
  res.json({ step: await freshStep(req.params.id, dues), dues });
});

// POST /restore — khôi phục bước đã bỏ qua
router.post('/:id/restore', auth, async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const { dues } = await withRecompute(g.s.project_id, async (client) => {
    await client.query("UPDATE steps SET skip=false, skip_reason='', updated_at=NOW() WHERE id=$1", [req.params.id]);
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id)
      VALUES ($1,$2,'step_restore',$3)`, [g.s.project_id, req.params.id, req.user.id]);
  });
  res.json({ step: await freshStep(req.params.id, dues), dues });
});

// DELETE — chỉ bước tùy biến
router.delete('/:id', auth, async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  if (g.s.is_required) return res.status(400).json({ error: 'Không thể xóa bước bắt buộc theo NĐ 45' });
  const { dues } = await withRecompute(g.s.project_id, async (client) => {
    await client.query('DELETE FROM steps WHERE id=$1', [req.params.id]);
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
      VALUES ($1,$2,'step_delete_custom',$3,$4)`,
      [g.s.project_id, req.params.id, req.user.id, JSON.stringify({ name: g.s.name })]);
  });
  const { rows: all } = await pool.query('SELECT * FROM steps WHERE project_id=$1 ORDER BY seq', [g.s.project_id]);
  res.json({ ok: true, dues, steps: all.map(stepToClient) });
});

module.exports = router;
