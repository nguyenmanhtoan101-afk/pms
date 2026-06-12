// ════ KPI & THỐNG KÊ — giữ đúng công thức client ════
const { getStatus, diffDays, today } = require('./timeline');

function d2s(d) { return d ? (typeof d === 'string' ? d : d.toISOString().slice(0, 10)) : null; }

// Chuẩn hóa step DB → object dùng chung
function normStep(r) {
  return {
    id: r.id, seq: r.seq, phase: r.phase, stt: r.stt,
    is_group: r.is_group, is_required: r.is_required, name: r.name,
    days: r.days, due_computed: d2s(r.due_computed), due_override: d2s(r.due_override),
    actual_date: d2s(r.actual_date), doc_ref: r.doc_ref, unit: r.unit,
    owner: r.owner, note: r.note, skip: r.skip, skip_reason: r.skip_reason,
    pend_data: r.pend_data, product: r.product,
  };
}

// pStats — y hệt client
function calcStats(steps, td) {
  td = td || today();
  const real = steps.filter(s => !s.is_group && !s.skip);
  const c = { done: 0, late: 0, soon: 0, plan: 0, wait: 0 };
  let maxLate = 0;
  for (const s of real) {
    const k = getStatus(s, td);
    if (c[k] !== undefined) c[k]++;
    if (k === 'late') maxLate = Math.max(maxLate, diffDays(s.due_computed, td));
  }
  const pct = real.length ? Math.round(c.done / real.length * 100) : 0;
  const health = c.late ? 'late' : (c.done === real.length ? 'done' : (c.soon ? 'soon' : 'plan'));
  const firstPend = steps.find(s => !s.is_group && !s.skip && !s.actual_date);
  return {
    total: real.length, ...c, pct, health, maxLate,
    phase: firstPend ? firstPend.phase : '✓',
    curStep: firstPend ? { id: firstPend.id, stt: firstPend.stt, name: firstPend.name, unit: firstPend.unit } : null,
  };
}

// KPI 100 điểm: đúng hạn 40 · độ trễ 25 · điều chỉnh 15 · giải ngân 20
function calcKpi(project, steps, nBaselines, td) {
  td = td || today();
  const real = steps.filter(s => !s.is_group && !s.skip);
  const done = real.filter(s => s.actual_date);
  const lateNow = real.filter(s => getStatus(s, td) === 'late');
  const onTime = done.filter(s => s.actual_date <= s.due_computed).length;
  const r1 = (done.length + lateNow.length) ? onTime / (done.length + lateNow.length) : 1;
  const delays = [
    ...done.filter(s => s.actual_date > s.due_computed).map(s => diffDays(s.due_computed, s.actual_date)),
    ...lateNow.map(s => diffDays(s.due_computed, td)),
  ];
  const avgDelay = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;
  const r2 = Math.max(0, 1 - avgDelay / 30);
  const r3 = Math.max(0, 1 - 0.25 * nBaselines);
  const r4 = +project.disb_plan ? Math.min(1, (+project.disb || 0) / +project.disb_plan) : 1;
  const score = Math.round(40 * r1 + 25 * r2 + 15 * r3 + 20 * r4);
  return {
    score,
    grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D',
    onTimeRate: Math.round(r1 * 100),
    avgDelay: Math.round(avgDelay),
    adj: nBaselines,
  };
}

module.exports = { normStep, calcStats, calcKpi };
