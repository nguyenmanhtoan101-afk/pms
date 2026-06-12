const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { auth, requireRole, canAccessProject, canEditProject } = require('../middleware/auth');
const { today } = require('../services/timeline');

// ── UPLOAD VĂN BẢN ──
const UP_DIR = path.join(__dirname, '../../uploads');
fs.mkdirSync(UP_DIR, { recursive: true });
const ALLOWED = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
const storage = multer.diskStorage({
  destination: UP_DIR,
  filename: (req, f, cb) => {
    const safe = Buffer.from(f.originalname, 'latin1').toString('utf8')
      .replace(/[^\wÀ-ỹ.\-\s]/g, '').replace(/\s+/g, '_').slice(0, 120);
    cb(null, Date.now() + '_' + safe);
  },
});
const upload = multer({
  storage, limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, ALLOWED.includes(path.extname(f.originalname).toLowerCase())),
});

router.post('/projects/:id/documents', auth, upload.single('file'), async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok || !canEditProject(req.user, acc.p))
    return res.status(403).json({ error: 'Không có quyền tải văn bản lên dự án này' });
  if (!req.file) return res.status(400).json({ error: 'Tệp không hợp lệ (chấp nhận pdf/doc/docx/jpg/png ≤10MB)' });
  const orig = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const { rows: [d] } = await pool.query(
    `INSERT INTO documents (project_id,step_id,file_name,file_path,file_size,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, req.body.step_id || null, orig, req.file.filename, req.file.size, req.user.id]);
  await pool.query(`INSERT INTO activity_log (project_id,action,actor_id,detail)
    VALUES ($1,'doc_upload',$2,$3)`, [req.params.id, req.user.id, JSON.stringify({ file: orig })]);
  res.status(201).json({
    id: d.id, name: d.file_name, size: Math.round(d.file_size / 1024),
    date: today(), by: req.user.unit_name || req.user.username,
  });
});

router.get('/projects/:id/documents', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok) return res.status(acc.code).json({ error: 'Không có quyền' });
  const { rows } = await pool.query(
    `SELECT d.id, d.file_name, d.file_size, d.uploaded_at, u.unit_name AS by_name
     FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by
     WHERE d.project_id=$1 ORDER BY d.uploaded_at DESC`, [req.params.id]);
  res.json(rows);
});

router.get('/documents/:id/download', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Không tìm thấy tệp' });
  const acc = await canAccessProject(pool, req.user, rows[0].project_id);
  if (!acc.ok) return res.status(403).json({ error: 'Không có quyền' });
  res.download(path.join(UP_DIR, rows[0].file_path), rows[0].file_name);
});

// ── ĐÔN ĐỐC (Điều 36) ──
router.post('/urge', auth, requireRole('so'), async (req, res) => {
  const { project_ids = [], subject, body } = req.body || {};
  if (!project_ids.length) return res.status(400).json({ error: 'Chọn ít nhất một dự án' });
  const td = today();
  await pool.query('UPDATE projects SET urged_date=$1 WHERE id=ANY($2)', [td, project_ids.map(Number)]);
  const { rows: [u] } = await pool.query(
    'INSERT INTO urge_log (date,subject,body,n_units,sent_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [td, subject || null, body || null, project_ids.length, req.user.id]);
  for (const pid of project_ids)
    await pool.query(`INSERT INTO activity_log (project_id,action,actor_id,detail)
      VALUES ($1,'urge',$2,$3)`, [pid, req.user.id, JSON.stringify({ subject })]);
  res.status(201).json({ id: u.id, date: td, n: project_ids.length, subject });
});

router.get('/urge', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ul.*, u.unit_name AS by_name FROM urge_log ul LEFT JOIN users u ON u.id=ul.sent_by
     ORDER BY ul.created_at DESC LIMIT 100`);
  res.json(rows.map(r => ({ date: r.date.toISOString().slice(0, 10), n: r.n_units, subject: r.subject, by: r.by_name })));
});

// ── ADMIN ──
router.get('/templates', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT type,name,legal_ref,steps_json FROM workflow_templates ORDER BY id');
  res.json(rows);
});
router.put('/templates/:type', auth, requireRole('so'), async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE workflow_templates SET steps_json=$1, updated_at=NOW() WHERE type=$2 RETURNING type',
    [JSON.stringify(req.body.steps), req.params.type]);
  if (!rows.length) return res.status(404).json({ error: 'Template không tồn tại' });
  res.json({ ok: true });
});

router.get('/users', auth, requireRole('so'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id,username,full_name,role,unit_name,unit_type,is_active,created_at FROM users ORDER BY id');
  res.json(rows);
});
router.post('/users', auth, requireRole('so'), async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { username, password, full_name, role, unit_name } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Thiếu thông tin tài khoản' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (username,password,full_name,role,unit_name,unit_type)
       VALUES ($1,$2,$3,$4,$5,$4) RETURNING id,username,role,unit_name`,
      [username, hash, full_name || null, role, unit_name || null]);
    res.status(201).json(u);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Tài khoản đã tồn tại' });
    throw e;
  }
});

router.get('/activity', auth, requireRole('so', 'leader'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, u.unit_name AS actor, p.name AS project
     FROM activity_log a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN projects p ON p.id=a.project_id
     ORDER BY a.created_at DESC LIMIT ${Math.min(+req.query.limit || 100, 500)}`);
  res.json(rows);
});

module.exports = router;
