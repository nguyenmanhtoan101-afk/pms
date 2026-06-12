/* ════════════════════════════════════════════════════════════
   API LAYER — kết nối frontend với backend PostgreSQL
   Ghi đè các hàm in-memory bằng gọi API thật.
   Nguyên tắc: giữ nguyên UI; mọi thao tác ghi → API → cập nhật
   local state từ response (step + dues) → re-render.
   ════════════════════════════════════════════════════════════ */
(function () {
  const API = '/api';
  let TOKEN = localStorage.getItem('pms_token') || null;
  let USER = JSON.parse(localStorage.getItem('pms_user') || 'null');

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) { doLogout(); throw new Error('Phiên đăng nhập hết hạn'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Lỗi hệ thống (' + res.status + ')');
    return data;
  }
  window.__api = api;

  // ── Cập nhật local state từ response {step, dues} ──
  function applyStep(stepData) {
    if (!CURP || !stepData) return;
    const i = CURP.steps.findIndex(s => s.id === stepData.id);
    if (i >= 0) CURP.steps[i] = stepData;
    if (typeof CUR_STEP !== 'undefined' && CUR_STEP && CUR_STEP.id === stepData.id) CUR_STEP = CURP.steps[i];
  }
  function applyDues(dues) {
    if (!CURP || !dues) return;
    CURP.steps.forEach(s => { if (dues[s.id]) s.due = dues[s.id]; });
  }
  function replaceSteps(steps) {
    if (!CURP || !steps) return;
    CURP.steps.length = 0;
    CURP.steps.push(...steps);
  }

  // ── Tải toàn bộ dữ liệu vào PROJECTS (giữ nguyên array reference) ──
  async function loadData() {
    const list = await api('/projects');
    PROJECTS.length = 0;
    PROJECTS.push(...list);
  }
  window.loadData = loadData;

  // ════ ĐĂNG NHẬP / ĐĂNG XUẤT ════
  window.doLogin = async function (role) {
    const u = document.getElementById('u-' + role).value.trim();
    const p = document.getElementById('p-' + role).value;
    const err = document.getElementById('e-' + role);
    try {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      TOKEN = r.token; USER = r.user;
      localStorage.setItem('pms_token', TOKEN);
      localStorage.setItem('pms_user', JSON.stringify(USER));
      err.style.display = 'none';
      // Cập nhật ROLES theo tài khoản thật
      if (USER.role === 'cdt') ROLES.cdt.cdtName = USER.unit_name;
      if (USER.role === 'nt') ROLES.nt.ntName = USER.unit_name;
      ROLES[USER.role].user = USER.full_name || USER.unit_name || USER.username;
      await loadData();
      loginAs(USER.role);
    } catch (e) {
      err.textContent = e.message;
      err.style.display = 'block';
      document.getElementById('p-' + role).value = '';
      document.getElementById('p-' + role).focus();
    }
  };

  function doLogout() {
    TOKEN = null; USER = null;
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_user');
  }
  const _origLogout = window.logout;
  window.logout = function () { doLogout(); _origLogout(); };

  // ════ THAO TÁC BƯỚC ════
  window.saveUpdate = async function () {
    try {
      const r = await api('/steps/' + CUR_STEP.id + '/complete', {
        method: 'POST',
        body: JSON.stringify({
          actual_date: document.getElementById('mu-date').value,
          doc_ref: document.getElementById('mu-doc').value || null,
          unit: document.getElementById('mu-unit').value || null,
          note: document.getElementById('mu-note').value || null,
        }),
      });
      applyStep(r.step); applyDues(r.dues);
      closeM('m-update');
      toast('Đã ghi nhận hoàn thành — văn bản lưu vào hồ sơ dự án');
      RENDER[PJ](); renderMenu();
    } catch (e) { toast(e.message, 'err'); }
  };

  window.applyDays = async function () {
    try {
      const days = +document.getElementById('ms-days').value || 0;
      const r = await api('/steps/' + CUR_STEP.id, { method: 'PUT', body: JSON.stringify({ days }) });
      applyStep(r.step); applyDues(r.dues);
      toast('Đã tính lại toàn bộ chuỗi ngày dự kiến phía sau');
      closeM('m-step'); RENDER[PJ]();
    } catch (e) { toast(e.message, 'err'); }
  };

  window.submitUpdate = async function () {
    try {
      const r = await api('/steps/' + CUR_STEP.id + '/submit', {
        method: 'POST',
        body: JSON.stringify({
          date: document.getElementById('msb-date').value,
          note: document.getElementById('msb-note').value,
          pct: +document.getElementById('msb-pct').value,
        }),
      });
      applyStep(r.step);
      closeM('m-submit');
      toast('Đã gửi — chờ chủ đầu tư xác nhận');
      RENDER[PJ]();
    } catch (e) { toast(e.message, 'err'); }
  };

  window.confirmPend = async function (ok) {
    try {
      const r = await api('/steps/' + CUR_STEP.id + '/confirm', { method: 'POST', body: JSON.stringify({ ok }) });
      applyStep(r.step); applyDues(r.dues);
      toast(ok ? 'Đã xác nhận — bước ghi nhận hoàn thành' : 'Đã trả lại nhà thầu kèm yêu cầu bổ sung', ok ? 'ok' : 'err');
      closeM('m-step'); RENDER[PJ](); renderMenu();
    } catch (e) { toast(e.message, 'err'); }
  };

  window.confirmSkip = async function () {
    const reason = document.getElementById('msk-reason').value.trim();
    if (!reason) { toast('Vui lòng nhập lý do / căn cứ pháp lý', 'err'); return; }
    try {
      const r = await api('/steps/' + SKIP_ID + '/skip', { method: 'POST', body: JSON.stringify({ reason }) });
      applyStep(r.step); applyDues(r.dues);
      closeM('m-skip');
      toast('Đã đánh dấu bỏ qua — lưu lý do kèm hồ sơ dự án');
      rCkTb();
    } catch (e) { toast(e.message, 'err'); }
  };

  window.restoreStep = async function (id) {
    try {
      const r = await api('/steps/' + id + '/restore', { method: 'POST' });
      applyStep(r.step); applyDues(r.dues);
      toast('Đã khôi phục bước vào checklist');
      rCkTb();
    } catch (e) { toast(e.message, 'err'); }
  };

  // ════ ĐIỀU CHỈNH KẾ HOẠCH ════
  window.saveRebase = async function () {
    const nd = document.getElementById('mr-date').value;
    const rs = document.getElementById('mr-reason').value.trim();
    if (!rs) { toast('Vui lòng nhập lý do điều chỉnh', 'err'); return; }
    try {
      const r = await api('/projects/' + CURP.id + '/baselines', {
        method: 'POST',
        body: JSON.stringify({
          step_id: CUR_STEP.id, new_date: nd, reason: rs,
          auth: document.getElementById('mr-auth').value,
        }),
      });
      CUR_STEP.ov = nd;
      CURP.baselines.push(r.baseline);
      applyDues(r.dues);
      closeM('m-rebase');
      toast('Đã lập kế hoạch v' + (CURP.baselines.length + 1) + ' — chuỗi tự tính lại (trượt ' + r.baseline.slip + ' ngày, đã lưu lịch sử)');
      RENDER[PJ](); renderMenu();
    } catch (e) { toast(e.message, 'err'); }
  };

  // ════ TẠO DỰ ÁN ════
  window.createProject = async function () {
    const name = document.getElementById('np-name').value.trim();
    if (!name) { toast('Vui lòng nhập tên dự án', 'err'); return; }
    try {
      const type = document.getElementById('np-type').value;
      const p = await api('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name, type,
          cdt: document.getElementById('np-cdt').value,
          start: document.getElementById('np-start').value,
          budget: +document.getElementById('np-budget').value || 0,
        }),
      });
      PROJECTS.unshift(p);
      closeM('m-newproj');
      toast('Đã tạo dự án — checklist ' + p.steps.filter(s => !s.grp).length + ' bước sinh tự động');
      openProj(p.id, 'pj-checklist');
    } catch (e) { toast(e.message, 'err'); }
  };

  // ════ BƯỚC TÙY BIẾN ════
  window.saveCustomStep = async function () {
    const name = document.getElementById('mas-name').value.trim();
    if (!name) { toast('Vui lòng nhập tên bước', 'err'); return; }
    const body = {
      ph: document.getElementById('mas-ph').value,
      stt: document.getElementById('mas-stt').value,
      name,
      days: +document.getElementById('mas-days').value || 0,
      unit: document.getElementById('mas-unit').value,
      ow: document.getElementById('mas-ow').value,
      doc: document.getElementById('mas-doc').value,
      note: document.getElementById('mas-note').value,
    };
    try {
      if (EDIT_STEP_ID) {
        const r = await api('/steps/' + EDIT_STEP_ID, { method: 'PUT', body: JSON.stringify(body) });
        applyStep(r.step); applyDues(r.dues);
        closeM('m-addstep'); toast('Đã cập nhật bước tùy biến'); rCkTb();
      } else {
        const r = await api('/projects/' + CURP.id + '/steps', { method: 'POST', body: JSON.stringify(body) });
        replaceSteps(r.steps);
        closeM('m-addstep');
        toast('Đã thêm bước tùy biến vào giai đoạn ' + body.ph);
        rCkTb();
      }
    } catch (e) { toast(e.message, 'err'); }
  };

  window.deleteCustomStep = async function () {
    if (!EDIT_STEP_ID) return;
    try {
      const r = await api('/steps/' + EDIT_STEP_ID, { method: 'DELETE' });
      replaceSteps(r.steps);
      closeM('m-addstep'); toast('Đã xóa bước tùy biến'); rCkTb();
    } catch (e) { toast(e.message, 'err'); }
  };

  // ════ ĐÔN ĐỐC ════
  window.sendUrge = async function () {
    const ids = [...document.querySelectorAll('.urge-cb:checked')].map(c => c.value);
    if (!ids.length) { toast('Chọn ít nhất một đơn vị', 'err'); return; }
    try {
      const r = await api('/urge', {
        method: 'POST',
        body: JSON.stringify({
          project_ids: ids,
          subject: document.getElementById('urge-subject').value,
          body: document.getElementById('urge-body').value,
        }),
      });
      ids.forEach(id => { const p = PROJECTS.find(x => x.id === id); if (p) p.urged = r.date; });
      URGE_LOG.push({ date: r.date, n: r.n, subject: r.subject });
      closeM('m-urge');
      toast('Đã ghi nhận gửi đôn đốc ' + r.n + ' đơn vị — hệ thống lưu nhật ký');
      if (PF === 'pf-alerts') rPfAlerts();
    } catch (e) { toast(e.message, 'err'); }
  };

  // ════ TẢI VĂN BẢN LÊN ════
  window.uploadDoc = async function (inp) {
    const f = inp.files[0]; if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const d = await api('/projects/' + CURP.id + '/documents', { method: 'POST', body: fd });
      CURP.docsExtra.unshift(d);
      inp.value = '';
      toast('Đã tải lên: ' + d.name);
      rPjVanban();
    } catch (e) { toast(e.message, 'err'); inp.value = ''; }
  };

  // ════ GIẢI NGÂN ════
  window.updateDisbPrompt = async function () {
    const v = prompt('Tỷ lệ giải ngân mới (%)', CURP.disb || 0);
    if (v === null) return;
    try {
      const r = await api('/projects/' + CURP.id, { method: 'PUT', body: JSON.stringify({ disb: +v }) });
      CURP.disb = r.disb;
      toast('Đã cập nhật giải ngân');
      rPjKinhphi();
    } catch (e) { toast(e.message, 'err'); }
  };

  // ════ KHỞI ĐỘNG ════
  document.addEventListener('DOMContentLoaded', async () => {
    // Ngày hiện tại trên topbar
    const d = new Date();
    const wd = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][d.getDay()];
    const el = document.getElementById('tb-date');
    if (el) el.textContent = `${wd}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;

    // Tự đăng nhập lại nếu còn token hợp lệ
    if (TOKEN && USER) {
      try {
        await api('/auth/me');
        if (USER.role === 'cdt') ROLES.cdt.cdtName = USER.unit_name;
        if (USER.role === 'nt') ROLES.nt.ntName = USER.unit_name;
        ROLES[USER.role].user = USER.full_name || USER.unit_name || USER.username;
        await loadData();
        loginAs(USER.role);
      } catch { doLogout(); }
    }
  });
})();
