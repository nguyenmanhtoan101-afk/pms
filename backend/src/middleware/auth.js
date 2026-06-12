const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'pms-laocai-dev-secret-change-in-prod';

function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, unit_name: user.unit_name, username: user.username },
    SECRET, { expiresIn: '12h' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Không có quyền' });
    next();
  };
}

// Phạm vi dữ liệu theo vai trò: leader/so → tất cả; cdt → dự án của đơn vị; nt → gói tham gia
function projectScopeSQL(user, alias = 'p') {
  if (user.role === 'leader' || user.role === 'so') return { sql: 'TRUE', params: [] };
  if (user.role === 'cdt') return { sql: `${alias}.cdt_user_id = $SCOPE`, params: [user.id] };
  return { sql: `${alias}.contractor_user_id = $SCOPE`, params: [user.id] };
}

async function canAccessProject(pool, user, projectId) {
  const { rows } = await pool.query('SELECT cdt_user_id, contractor_user_id FROM projects WHERE id=$1', [projectId]);
  if (!rows.length) return { ok: false, code: 404 };
  const p = rows[0];
  if (user.role === 'leader' || user.role === 'so') return { ok: true, p };
  if (user.role === 'cdt') return { ok: p.cdt_user_id === user.id, p, code: 403 };
  return { ok: p.contractor_user_id === user.id, p, code: 403 };
}

// Quyền ghi: so luôn được; cdt với dự án của mình; leader & nt: không (nt có luồng submit riêng)
function canEditProject(user, p) {
  if (user.role === 'so') return true;
  if (user.role === 'cdt') return p.cdt_user_id === user.id;
  return false;
}

module.exports = { sign, auth, requireRole, projectScopeSQL, canAccessProject, canEditProject, SECRET };
