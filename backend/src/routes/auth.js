const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { sign, auth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu' });
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 AND is_active', [username]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password)))
    return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng' });
  const u = rows[0];
  res.json({
    token: sign(u),
    user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, unit_name: u.unit_name, unit_type: u.unit_type },
  });
});

router.get('/me', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT id,username,full_name,role,unit_name,unit_type FROM users WHERE id=$1', [req.user.id]);
  res.json(rows[0] || null);
});

module.exports = router;
