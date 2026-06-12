// ════ SEED: tài khoản + 4 template + 16 dự án (2 thật + 14 demo) ════
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { recompute } = require('../services/timeline');
const DATA = require('./seed-data.json');

async function main() {
  const client = await pool.connect();
  try {
    console.log('— Seed users…');
    const users = [
      ['lanhdao.laocai', 'Laocai@2026', 'Văn phòng UBND tỉnh', 'leader', 'Văn phòng UBND tỉnh'],
      ['skhcn.laocai', 'Skhcn@2026', 'Phòng Bưu chính – Chuyển đổi số', 'so', 'Sở Khoa học và Công nghệ'],
      ['soyte.laocai', 'Soyte@2026', 'Sở Y tế tỉnh Lào Cai', 'cdt', 'Sở Y tế'],
      ['foxai.nt', 'Foxai@2026', 'FOXAI', 'nt', 'FOXAI'],
    ];
    const uid = {};
    for (const [un, pw, fn, role, unit] of users) {
      const hash = await bcrypt.hash(pw, 10);
      const { rows: [u] } = await client.query(
        `INSERT INTO users (username,password,full_name,role,unit_name,unit_type)
         VALUES ($1,$2,$3,$4,$5,$4)
         ON CONFLICT (username) DO UPDATE SET password=EXCLUDED.password
         RETURNING id, unit_name, role`, [un, hash, fn, role, unit]);
      uid[u.role + ':' + u.unit_name] = u.id;
    }

    console.log('— Seed templates…');
    for (const t of DATA.templates) {
      await client.query(
        `INSERT INTO workflow_templates (type,name,legal_ref,steps_json) VALUES ($1,$2,$3,$4)
         ON CONFLICT (type) DO UPDATE SET name=$2, legal_ref=$3, steps_json=$4, updated_at=NOW()`,
        [t.type, t.name, t.legal_ref, JSON.stringify(t.steps)]);
    }

    const seedDemo = process.env.SEED_DEMO !== '0';
    const projects = seedDemo ? DATA.projects : DATA.projects.slice(0, 2);
    console.log(`— Seed ${projects.length} dự án (SEED_DEMO=${seedDemo ? '1' : '0'})…`);

    for (const p of projects) {
      const { rows: dup } = await client.query('SELECT id FROM projects WHERE name=$1', [p.name]);
      if (dup.length) { console.log('  (bỏ qua, đã có) ' + p.name.slice(0, 40)); continue; }
      const cdtUid = p.cdt === 'Sở Y tế' ? uid['cdt:Sở Y tế'] : null;
      const ntUid = (p.contractor || '').includes('FOXAI') ? uid['nt:FOXAI'] : null;
      const { rows: [pr] } = await client.query(
        `INSERT INTO projects (name,cdt,cdt_user_id,contractor,contractor_user_id,type,fund,grp,legal,budget,disb,disb_plan,start_date,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [p.name, p.cdt, cdtUid, p.contractor, ntUid, p.type, p.fund, p.grp, p.legal,
         p.budget, p.disb, p.disb_plan, p.start, uid['so:Sở Khoa học và Công nghệ']]);
      for (const s of p.steps) {
        await client.query(
          `INSERT INTO steps (project_id,seq,phase,stt,is_group,is_required,name,days,due_override,actual_date,doc_ref,unit,owner,note,skip,skip_reason,product)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [pr.id, s.seq, s.phase, s.stt, s.is_group, s.is_required, s.name, s.days,
           s.due_override, s.actual_date, s.doc_ref, s.unit, s.owner, s.note, s.skip, s.skip_reason, s.product]);
      }
      for (const b of p.baselines) {
        await client.query(
          `INSERT INTO baselines (project_id,version,date,reason,slip_days,auth)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [pr.id, b.version, b.date, b.reason, b.slip_days, b.auth]);
      }
      await recompute(client, pr.id);
      console.log('  ✓ ' + p.name.slice(0, 55));
    }
    console.log('SEED HOÀN TẤT.');
  } finally { client.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
