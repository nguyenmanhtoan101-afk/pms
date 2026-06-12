const router = require('express').Router();
const pool = require('../db');
const { auth, projectScopeSQL, canAccessProject, canEditProject } = require('../middleware/auth');
const { recompute, today } = require('../services/timeline');
const { normStep, calcStats, calcKpi } = require('../services/kpi');
const { projectToClient, stepToClient } = require('../services/serialize');

async function loadFull(projectIds) {
  if (!projectIds.length) return [];
  const [{ rows: projs }, { rows: steps }, { rows: bls }, { rows: docs }] = await Promise.all([
    pool.query('SELECT * FROM projects WHERE id = ANY($1) ORDER BY created_at DESC, id', [projectIds]),
    pool.query('SELECT * FROM steps WHERE project_id = ANY($1) ORDER BY project_id, seq', [projectIds]),
    pool.query('SELECT * FROM baselines WHERE project_id = ANY($1) ORDER BY version', [projectIds]),
    pool.query(`SELECT d.*, u.unit_name AS by_name FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by
                WHERE d.project_id = ANY($1) ORDER BY d.uploaded_at DESC`, [projectIds]),
  ]);
  const by = (arr) => arr.reduce((m, r) => ((m[r.project_id] = m[r.project_id] || []).push(r), m), {});
  const S = by(steps), B = by(bls), D = by(docs);
  return projs.map(p => projectToClient(p, S[p.id] || [], B[p.id] || [], D[p.id] || []));
}

// GET /api/projects — toàn bộ dự án trong phạm vi, đúng shape frontend
router.get('/', auth, async (req, res) => {
  const scope = projectScopeSQL(req.user);
  const sql = `SELECT id FROM projects p WHERE ${scope.sql.replace('$SCOPE', '$1')}`;
  const { rows } = await pool.query(scope.params.length ? sql : sql.replace('$1', ''), scope.params);
  res.json(await loadFull(rows.map(r => r.id)));
});

// GET /api/projects/:id
router.get('/:id', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok) return res.status(acc.code).json({ error: 'Không có quyền truy cập dự án' });
  const [p] = await loadFull([+req.params.id]);
  res.json(p);
});

// GET /api/projects/:id/stats  &  /kpi
router.get('/:id/stats', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok) return res.status(acc.code).json({ error: 'Không có quyền' });
  const { rows } = await pool.query('SELECT * FROM steps WHERE project_id=$1 ORDER BY seq', [req.params.id]);
  res.json(calcStats(rows.map(normStep)));
});
router.get('/:id/kpi', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok) return res.status(acc.code).json({ error: 'Không có quyền' });
  const [{ rows: pr }, { rows: st }, { rows: bl }] = await Promise.all([
    pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]),
    pool.query('SELECT * FROM steps WHERE project_id=$1 ORDER BY seq', [req.params.id]),
    pool.query('SELECT COUNT(*)::int AS n FROM baselines WHERE project_id=$1', [req.params.id]),
  ]);
  res.json(calcKpi(pr[0], st.map(normStep), bl[0].n));
});

// POST /api/projects — tạo từ template (so | cdt)
router.post('/', auth, async (req, res) => {
  if (!['so', 'cdt'].includes(req.user.role)) return res.status(403).json({ error: 'Không có quyền tạo dự án' });
  const { name, cdt, type, fund, grp, budget, start } = req.body || {};
  if (!name || !type || !start) return res.status(400).json({ error: 'Thiếu tên, loại hình hoặc ngày bắt đầu' });
  const { rows: tpl } = await pool.query('SELECT steps_json FROM workflow_templates WHERE type=$1', [type]);
  if (!tpl.length) return res.status(400).json({ error: 'Loại hình không hợp lệ' });

  const cdtName = req.user.role === 'cdt' ? req.user.unit_name : (cdt || req.user.unit_name);
  const { rows: cu } = await pool.query("SELECT id FROM users WHERE unit_name=$1 AND role='cdt'", [cdtName]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [p] } = await client.query(
      `INSERT INTO projects (name,cdt,cdt_user_id,type,fund,grp,legal,budget,start_date,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, cdtName, cu[0]?.id || null, type, fund || (type === 'hethong' ? 'dtc' : 'ctx'),
       grp || 'C', 'NĐ 45/2026/NĐ-CP', budget || 0, start, req.user.id]);
    // sinh checklist từ template: [ph, stt, grp, name, days, unit, ow, doc]
    let seq = 0;
    for (const r of tpl[0].steps_json) {
      await client.query(
        `INSERT INTO steps (project_id,seq,phase,stt,is_group,is_required,name,days,unit,owner,doc_ref)
         VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10)`,
        [p.id, seq++, r[0], r[1], !!r[2], r[3], r[4] || 0, r[5] || null, r[6] || 'so', r[7] || null]);
    }
    await recompute(client, p.id);
    await client.query(
      `INSERT INTO activity_log (project_id,action,actor_id,detail) VALUES ($1,'project_create',$2,$3)`,
      [p.id, req.user.id, JSON.stringify({ name, type })]);
    await client.query('COMMIT');
    const [full] = await loadFull([p.id]);
    res.status(201).json(full);
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
});

// PUT /api/projects/:id — sửa thông tin chung (disb, budget...)
router.put('/:id', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok || !canEditProject(req.user, acc.p)) return res.status(403).json({ error: 'Không có quyền' });
  const allowed = ['name', 'budget', 'disb', 'disb_plan', 'contractor', 'grp'];
  const sets = [], params = [];
  for (const k of allowed) if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật' });
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE projects SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`, params);
  await pool.query(`INSERT INTO activity_log (project_id,action,actor_id,detail) VALUES ($1,'project_update',$2,$3)`,
    [req.params.id, req.user.id, JSON.stringify(req.body)]);
  res.json({ ok: true, disb: +rows[0].disb });
});

// DELETE — chỉ Sở
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'so') return res.status(403).json({ error: 'Chỉ Sở KHCN được xóa dự án' });
  await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/projects/:id/steps — thêm bước tùy biến
router.post('/:id/steps', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok || !canEditProject(req.user, acc.p)) return res.status(403).json({ error: 'Không có quyền' });
  const { ph, stt, name, days, unit, ow, doc, note } = req.body || {};
  if (!name || !ph) return res.status(400).json({ error: 'Thiếu tên bước hoặc giai đoạn' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // chèn sau bước cuối của phase: dịch seq các bước sau
    const { rows: mx } = await client.query(
      'SELECT COALESCE(MAX(seq),-1) AS m FROM steps WHERE project_id=$1 AND phase=$2', [req.params.id, ph]);
    const insSeq = mx[0].m + 1;
    await client.query('UPDATE steps SET seq = seq + 1 WHERE project_id=$1 AND seq >= $2', [req.params.id, insSeq]);
    const { rows: [s] } = await client.query(
      `INSERT INTO steps (project_id,seq,phase,stt,is_group,is_required,name,days,unit,owner,doc_ref,note)
       VALUES ($1,$2,$3,$4,false,false,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, insSeq, ph, stt || ph + '.x', name, days || 0, unit || null, ow || 'so', doc || null, note || null]);
    const dues = await recompute(client, req.params.id);
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
      VALUES ($1,$2,'step_add_custom',$3,$4)`, [req.params.id, s.id, req.user.id, JSON.stringify({ name })]);
    await client.query('COMMIT');
    const { rows: all } = await pool.query('SELECT * FROM steps WHERE project_id=$1 ORDER BY seq', [req.params.id]);
    res.status(201).json({ step: stepToClient({ ...s, due_computed: dues[s.id] }), steps: all.map(stepToClient) });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
});

// POST /api/projects/:id/baselines — điều chỉnh kế hoạch
router.post('/:id/baselines', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok || !canEditProject(req.user, acc.p)) return res.status(403).json({ error: 'Không có quyền' });
  const { step_id, new_date, reason, auth: authBy } = req.body || {};
  if (!step_id || !new_date || !reason) return res.status(400).json({ error: 'Thiếu mốc mới hoặc lý do điều chỉnh' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: st } = await client.query(
      'SELECT due_computed FROM steps WHERE id=$1 AND project_id=$2', [step_id, req.params.id]);
    if (!st.length) throw Object.assign(new Error('Bước không tồn tại'), { status: 404 });
    const oldDue = st[0].due_computed.toISOString().slice(0, 10);
    const slip = Math.max(0, Math.round((Date.parse(new_date) - Date.parse(oldDue)) / 864e5));
    await client.query('UPDATE steps SET due_override=$1, updated_at=NOW() WHERE id=$2', [new_date, step_id]);
    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM baselines WHERE project_id=$1', [req.params.id]);
    const version = cnt[0].n + 2;
    const { rows: [b] } = await client.query(
      `INSERT INTO baselines (project_id,version,date,reason,slip_days,auth,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, version, today(), reason, slip, authBy || null, req.user.id]);
    const dues = await recompute(client, req.params.id);
    await client.query(`INSERT INTO activity_log (project_id,step_id,action,actor_id,detail)
      VALUES ($1,$2,'rebase',$3,$4)`,
      [req.params.id, step_id, req.user.id, JSON.stringify({ version, slip, reason })]);
    await client.query('COMMIT');
    res.status(201).json({
      baseline: { v: b.version, date: b.date.toISOString().slice(0, 10), reason: b.reason, slip: b.slip_days, auth: b.auth },
      dues,
    });
  } catch (e) { await client.query('ROLLBACK'); if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
  finally { client.release(); }
});

module.exports = router;
module.exports.loadFull = loadFull;
