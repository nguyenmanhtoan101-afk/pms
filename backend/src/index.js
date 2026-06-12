require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/steps', require('./routes/steps'));
app.use('/api/portfolio', require('./routes/portfolio'));
app.use('/api/export', require('./routes/export'));
app.use('/api', require('./routes/misc'));

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'connected' }); }
  catch (e) { res.status(503).json({ ok: false, db: e.message }); }
});

// Frontend tĩnh
const FE = path.join(__dirname, '../../frontend');
app.use(express.static(FE));
app.get('/', (req, res) => res.sendFile(path.join(FE, 'index.html')));

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Lỗi hệ thống' });
});

const PORT = +(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`PMS Lào Cai chạy tại http://localhost:${PORT}`));
