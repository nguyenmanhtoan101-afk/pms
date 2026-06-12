// ════ Chuyển dữ liệu DB → đúng shape mà frontend HTML đang dùng ════
// Frontend dùng: {id,ph,stt,grp,req,name,days,unit,ow,doc,actual,note,skip,skipReason,ov,pend,prod,due}
function d2s(d) { return d ? (typeof d === 'string' ? d : d.toISOString().slice(0, 10)) : undefined; }

function stepToClient(r) {
  const o = {
    id: String(r.id), ph: r.phase, stt: r.stt,
    grp: r.is_group ? 1 : 0, req: !!r.is_required,
    name: r.name, days: r.days || 0,
    unit: r.unit || '', ow: r.owner || 'so', doc: r.doc_ref || '',
    due: d2s(r.due_computed),
  };
  const a = d2s(r.actual_date); if (a) o.actual = a;
  const ov = d2s(r.due_override); if (ov) o.ov = ov;
  if (r.note) o.note = r.note;
  if (r.skip) { o.skip = true; o.skipReason = r.skip_reason || ''; }
  if (r.pend_data) o.pend = r.pend_data;
  if (r.product) o.prod = r.product;
  return o;
}

function projectToClient(p, steps, baselines, docs) {
  return {
    id: String(p.id), name: p.name, cdt: p.cdt, contractor: p.contractor || '',
    type: p.type, fund: p.fund, grp: p.grp, legal: p.legal,
    budget: +p.budget, disb: +p.disb, disbPlan: +p.disb_plan,
    start: d2s(p.start_date), urged: d2s(p.urged_date) || null,
    baselines: (baselines || []).map(b => ({
      v: b.version, date: d2s(b.date), reason: b.reason, slip: b.slip_days, auth: b.auth,
    })),
    docsExtra: (docs || []).map(dd => ({
      id: dd.id, name: dd.file_name, size: Math.round((dd.file_size || 0) / 1024),
      date: d2s(dd.uploaded_at), by: dd.by_name || '',
    })),
    steps: (steps || []).map(stepToClient),
  };
}
module.exports = { stepToClient, projectToClient, d2s };
