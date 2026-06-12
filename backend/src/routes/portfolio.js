const router = require('express').Router();
const pool = require('../db');
const { auth, projectScopeSQL } = require('../middleware/auth');
const { normStep, calcStats, calcKpi } = require('../services/kpi');
const { getStatus, diffDays, today, addDays } = require('../services/timeline');

async function scopedProjects(user) {
  const scope = projectScopeSQL(user);
  const sql = `SELECT * FROM projects p WHERE ${scope.sql.replace('$SCOPE', '$1')}`;
  const { rows: projs } = await pool.query(scope.params.length ? sql : sql.replace('$1', ''), scope.params);
  if (!projs.length) return [];
  const ids = projs.map(p => p.id);
  const [{ rows: steps }, { rows: bls }] = await Promise.all([
    pool.query('SELECT * FROM steps WHERE project_id=ANY($1) ORDER BY project_id, seq', [ids]),
    pool.query('SELECT project_id, COUNT(*)::int AS n FROM baselines WHERE project_id=ANY($1) GROUP BY project_id', [ids]),
  ]);
  const S = steps.reduce((m, r) => ((m[r.project_id] = m[r.project_id] || []).push(normStep(r)), m), {});
  const B = bls.reduce((m, r) => (m[r.project_id] = r.n, m), {});
  return projs.map(p => ({ p, steps: S[p.id] || [], nBl: B[p.id] || 0 }));
}

// GET /api/portfolio/stats
router.get('/stats', auth, async (req, res) => {
  const list = await scopedProjects(req.user);
  const H = { done: 0, plan: 0, soon: 0, late: 0 };
  let bud = 0, disb = 0;
  const items = list.map(({ p, steps, nBl }) => {
    const s = calcStats(steps);
    H[s.health]++;
    bud += +p.budget; disb += +p.budget * (+p.disb || 0) / 100;
    return { id: String(p.id), name: p.name, cdt: p.cdt, health: s.health, maxLate: s.maxLate, phase: s.phase, pct: s.pct };
  });
  res.json({ total: list.length, ...H, budget: bud, disbursed: Math.round(disb), items });
});

// GET /api/portfolio/kpi — xếp hạng theo CĐT & nhà thầu
router.get('/kpi', auth, async (req, res) => {
  const list = await scopedProjects(req.user);
  const rows = list.map(({ p, steps, nBl }) => ({
    id: String(p.id), name: p.name, cdt: p.cdt, contractor: p.contractor || '',
    disb: +p.disb, ...calcKpi(p, steps, nBl),
  }));
  const agg = (key) => {
    const m = {};
    rows.forEach(r => { const g = r[key]; if (!g) return; (m[g] = m[g] || []).push(r.score); });
    return Object.entries(m).map(([g, scores]) => ({
      name: g, n: scores.length, avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    })).sort((a, b) => b.avg - a.avg);
  };
  res.json({ projects: rows.sort((a, b) => b.score - a.score), byCdt: agg('cdt'), byContractor: agg('contractor') });
});

// GET /api/portfolio/alerts — bước late/soon + cờ SLA NĐ45
router.get('/alerts', auth, async (req, res) => {
  const td = today();
  const list = await scopedProjects(req.user);
  const items = [];
  for (const { p, steps } of list) {
    for (const s of steps) {
      if (s.is_group || s.skip) continue;
      const k = getStatus(s, td);
      if (k !== 'late' && k !== 'soon') continue;
      // SLA pháp định: bước thẩm định >20 ngày làm việc hoặc phê duyệt >3 ngày → cờ vi phạm
      let sla = null;
      const nm = s.name.toLowerCase();
      if (k === 'late') {
        const lateDays = diffDays(s.due_computed, td);
        if (nm.includes('thẩm định') && lateDays > 0) sla = 'Quá thời hạn thẩm định (≤20 ngày làm việc — Điều 34)';
        else if (nm.includes('phê duyệt') && lateDays > 3) sla = 'Quá thời hạn phê duyệt (≤3 ngày làm việc — Điều 34)';
      }
      items.push({
        project_id: String(p.id), project: p.name, cdt: p.cdt,
        step_id: String(s.id), stt: s.stt, step: s.name, unit: s.unit,
        due: s.due_computed, status: k,
        lateDays: k === 'late' ? diffDays(s.due_computed, td) : 0, sla,
      });
    }
  }
  items.sort((a, b) => b.lateDays - a.lateDays);
  res.json(items);
});

// GET /api/portfolio/bc35 — nghĩa vụ báo cáo Điều 35
router.get('/bc35', auth, async (req, res) => {
  const td = today();
  const list = await scopedProjects(req.user);
  const done = [];
  for (const { p, steps } of list) {
    const s = calcStats(steps);
    if (s.health !== 'done') continue;
    const last = steps.filter(x => x.actual_date).map(x => x.actual_date).sort().pop();
    const d1 = addDays(last, 20), d2 = addDays(d1, 30);
    done.push({
      project_id: String(p.id), project: p.name, cdt: p.cdt,
      completed: last, cdt_deadline: d1, so_deadline: d2,
      status: d1 < td ? 'late' : (diffDays(td, d1) <= 10 ? 'soon' : 'plan'),
    });
  }
  res.json({ completed: done, annual: { period: 'Tháng 01 hằng năm', next: '2027-01' } });
});

module.exports = router;
