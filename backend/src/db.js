const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'pms',
  password: process.env.PGPASSWORD || 'pms2026',
  database: process.env.PGDATABASE || 'pms_laocai',
});
pool.on('error', (err) => console.error('[PG POOL]', err.message));
module.exports = pool;
