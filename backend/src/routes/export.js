const router = require('express').Router();
const ExcelJS = require('exceljs');
const pool = require('../db');
const { auth, projectScopeSQL, canAccessProject } = require('../middleware/auth');
const { normStep, calcStats, calcKpi } = require('../services/kpi');
const { getStatus, today } = require('../services/timeline');

const C = { navy: 'FF1A2E55', gold: 'FFC9A227', done: 'FF1E7E4E', late: 'FFB23A48', soon: 'FFC9A227', plan: 'FF2A3242', grp: 'FFD6DCE8', req: 'FFE8EFFD', white: 'FFFFFFFF' };
const ST_LB = { done: 'Hoàn thành', late: 'Quá hạn', soon: 'Sắp đến hạn', plan: 'Trong hạn', skip: 'Bỏ qua', wait: 'Chờ xác nhận' };
const TYPE_LB = { thue: 'Thuê dịch vụ CNTT', hethong: 'Đầu tư hệ thống', muasam: 'Mua sắm', ctx: 'Chi thường xuyên (Đ32)' };

function head(ws, title, sub, nCols) {
  ws.mergeCells(1, 1, 1, nCols);
  const t = ws.getCell(1, 1);
  t.value = title; t.font = { name: 'Arial', size: 13, bold: true, color: { argb: C.white } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, nCols);
  const s = ws.getCell(2, 1);
  s.value = sub; s.font = { name: 'Arial', size: 9, italic: true, color: { argb: C.gold } };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
  s.alignment = { horizontal: 'center' };
}
function hdrRow(ws, rowIdx, labels) {
  const r = ws.getRow(rowIdx);
  labels.forEach((lb, i) => {
    const c = r.getCell(i + 1);
    c.value = lb; c.font = { name: 'Arial', size: 9, bold: true, color: { argb: C.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  r.height = 30;
}
function send(res, wb, name) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
  return wb.xlsx.write(res).then(() => res.end());
}

// GET /api/export/checklist/:project_id.xlsx — đúng form: công thức =E_prev+D_this, màu trạng thái
router.get('/checklist/:id', auth, async (req, res) => {
  const acc = await canAccessProject(pool, req.user, req.params.id);
  if (!acc.ok) return res.status(acc.code).json({ error: 'Không có quyền' });
  const [{ rows: [p] }, { rows: stRows }] = await Promise.all([
    pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]),
    pool.query('SELECT * FROM steps WHERE project_id=$1 ORDER BY seq', [req.params.id]),
  ]);
  const steps = stRows.map(normStep);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Checklist', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [
    { width: 8 }, { width: 15 }, { width: 56 }, { width: 9 }, { width: 14 },
    { width: 28 }, { width: 13 }, { width: 26 }, { width: 16 }, { width: 24 }];
  head(ws, 'CHECKLIST TIẾN ĐỘ — ' + p.name.toUpperCase(),
    `Chủ đầu tư: ${p.cdt} · ${TYPE_LB[p.type]} · NĐ 45/2026/NĐ-CP · Xuất ngày ${today()}`, 10);
  hdrRow(ws, 4, ['STT', 'Loại', 'Nội dung công việc', 'Số ngày', 'Dự kiến\n(tự tính)', 'Văn bản', 'Thực tế', 'Đơn vị', 'Trạng thái', 'Ghi chú']);

  let r = 5, prevDueRow = null;
  for (const s of steps) {
    const row = ws.getRow(r);
    if (s.is_group) {
      row.getCell(1).value = s.stt;
      ws.mergeCells(r, 3, r, 10);
      const c = row.getCell(3);
      c.value = s.name; c.font = { name: 'Arial', size: 10, bold: true, color: { argb: C.navy } };
      [1, 2, 3].forEach(i => row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.grp } });
      row.getCell(2).value = 'Nhóm';
      r++; continue;
    }
    const k = getStatus(s);
    row.getCell(1).value = s.stt;
    row.getCell(2).value = s.skip ? 'Bỏ qua' : (s.is_required ? 'Bắt buộc NĐ45' : 'Tùy biến');
    if (s.is_required && !s.skip)
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.req } };
    row.getCell(3).value = s.name;
    row.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    if (s.days) row.getCell(4).value = s.days;
    // Cột E: công thức nếu có days + bước trước có ngày; nếu không thì giá trị
    if (s.due_computed) {
      const cE = row.getCell(5);
      if (s.days && prevDueRow && !s.due_override) cE.value = { formula: `E${prevDueRow}+D${r}` };
      else cE.value = new Date(s.due_computed);
      cE.numFmt = 'DD/MM/YYYY';
      prevDueRow = r;
    }
    row.getCell(6).value = s.doc_ref || '';
    if (s.actual_date) { row.getCell(7).value = new Date(s.actual_date); row.getCell(7).numFmt = 'DD/MM/YYYY'; }
    row.getCell(8).value = s.unit || '';
    const cI = row.getCell(9);
    cI.value = ST_LB[k];
    const clr = { done: C.done, late: C.late, soon: C.soon, plan: C.plan }[k];
    if (clr) {
      cI.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: clr } };
      cI.font = { name: 'Arial', size: 9, bold: true, color: { argb: C.white } };
      cI.alignment = { horizontal: 'center' };
    }
    row.getCell(10).value = s.skip ? ('Bỏ qua: ' + (s.skip_reason || '')) : (s.note || '');
    r++;
  }
  // Tổng kết COUNTIF
  const last = r;
  ws.mergeCells(last, 1, last, 3);
  ws.getCell(last, 1).value = 'TỔNG KẾT';
  [[4, `COUNTA(I5:I${last - 1})-COUNTIF(I5:I${last - 1},"Nhóm")`],
   [5, `COUNTIF(I5:I${last - 1},"Hoàn thành")`], [6, `COUNTIF(I5:I${last - 1},"Quá hạn")`],
   [7, `COUNTIF(I5:I${last - 1},"Sắp đến hạn")`], [8, `COUNTIF(I5:I${last - 1},"Trong hạn")`]]
    .forEach(([col, f]) => { ws.getCell(last, col).value = { formula: f }; });
  ws.getRow(last).eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
    c.font = { name: 'Arial', size: 9, bold: true, color: { argb: C.gold } };
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: last - 1, column: 10 } };
  await send(res, wb, `Checklist_${p.name.slice(0, 35)}.xlsx`);
});

// GET /api/export/list.xlsx
router.get('/list', auth, async (req, res) => {
  const scope = projectScopeSQL(req.user);
  const sql = `SELECT * FROM projects p WHERE ${scope.sql.replace('$SCOPE', '$1')} ORDER BY id`;
  const { rows: projs } = await pool.query(scope.params.length ? sql : sql.replace('$1', ''), scope.params);
  const ids = projs.map(p => p.id);
  const { rows: steps } = await pool.query('SELECT * FROM steps WHERE project_id=ANY($1) ORDER BY project_id,seq', [ids]);
  const { rows: bls } = await pool.query('SELECT project_id, COUNT(*)::int n FROM baselines WHERE project_id=ANY($1) GROUP BY project_id', [ids]);
  const S = steps.reduce((m, x) => ((m[x.project_id] = m[x.project_id] || []).push(normStep(x)), m), {});
  const B = bls.reduce((m, x) => (m[x.project_id] = x.n, m), {});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Danh mục', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [{ width: 52 }, { width: 26 }, { width: 22 }, { width: 20 }, { width: 8 }, { width: 16 }, { width: 11 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 9 }];
  head(ws, 'DANH MỤC DỰ ÁN CNTT TỈNH LÀO CAI', 'Tình hình triển khai đến ' + today() + ' · NĐ 45/2026/NĐ-CP', 12);
  hdrRow(ws, 4, ['Tên dự án', 'Chủ đầu tư', 'Nhà thầu', 'Loại hình', 'Nhóm', 'Giai đoạn', 'Tiến độ %', 'Dự toán (tr.đ)', 'Trạng thái', 'Ngày chậm', 'Điểm KPI', 'Loại']);
  let r = 5;
  for (const p of projs) {
    const st = calcStats(S[p.id] || []);
    const k = calcKpi(p, S[p.id] || [], B[p.id] || 0);
    const row = ws.getRow(r++);
    row.values = [p.name, p.cdt, p.contractor || '', TYPE_LB[p.type], p.grp,
      st.phase === '✓' ? 'Hoàn thành' : st.phase, st.pct, +p.budget, ST_LB[st.health], st.maxLate || 0, k.score, k.grade];
    const clr = { done: C.done, late: C.late, soon: C.soon, plan: C.plan }[st.health];
    if (clr) { const c = row.getCell(9); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: clr } }; c.font = { bold: true, color: { argb: C.white }, size: 9 }; }
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: r - 1, column: 12 } };
  await send(res, wb, `Danh_muc_CNTT_LaoCai_${today()}.xlsx`);
});

module.exports = router;
