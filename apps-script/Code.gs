/**
 * Project B KWIK — Google Apps Script backend.
 * Paste this whole file into Extensions → Apps Script of the "Project B KWIK" Google Sheet
 * (signed in as bkwikinfo@gmail.com), fill in CLIENT_ID below, run setup() once, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 */
const CLIENT_ID = '638627569252-6p3g98i76bh9lbdml0jgs0k1n5p7pvqv.apps.googleusercontent.com';
const ADMIN_EMAILS = ['bkwikinfo@gmail.com'];
const COMPANIES = {
  dalby: { name: 'B IN DALBY', from: 'bindalbyptyltd@gmail.com' },
  kwik:  { name: 'KWIK TRIP',  from: 'kwiktripptyltd@gmail.com' }
};
const STORE = '_store';
const CHUNK = 45000;

/* ---------- web app ---------- */
function doGet() { return json({ ok: true, app: 'Project B KWIK' }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const user = verify_(req.token);
    const role = role_(user);
    if (role !== 'admin' && ['whoami', 'portal', 'portalNotify', 'portalRsvp', 'portalPrefs', 'portalDoc'].indexOf(req.action) < 0) return json({ ok: false, error: 'Only the admin can do that.' });
    switch (req.action) {
      case 'whoami': return json({ ok: true, email: user, role: role });
      case 'portal': return json(portal_(user));
      case 'portalNotify': return json(portalNotify_(user, req));
      case 'portalRsvp': return json(portalEdit_(user, req, 'rsvp'));
      case 'portalPrefs': return json(portalEdit_(user, req, 'prefs'));
      case 'portalDoc': return json(portalDoc_(user, req));
      case 'docUpload': return json(docUpload_(req));
      case 'docGet': return json(docGet_(req));
      case 'load': return json({ ok: true, companies: Object.keys(COMPANIES).reduce((o, id) => { o[id] = load_(id); return o; }, {}) });
      case 'save': return json(save_(req.id, req.data, req.version));
      case 'versions': return json({ ok: true, versions: Object.keys(COMPANIES).reduce((o, id) => { const x = load_(id); o[id] = x ? x.version : 0; return o; }, {}) });
      case 'sendEmail': return json(sendEmail_(req.id, req.emails || [], req.attachment));
      default: return json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err), auth: String(err && err.message || '').indexOf('AUTH') === 0 });
  }
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- sign-in check ---------- */
function verify_(token) {
  if (!token) throw new Error('AUTH: not signed in');
  const key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: sign-in expired');
  const info = JSON.parse(res.getContentText());
  const email = String(info.email || '').toLowerCase();
  if (info.aud !== CLIENT_ID) throw new Error('AUTH: wrong app');
  if (String(info.email_verified) !== 'true') throw new Error('AUTH: email not verified');
  const left = Number(info.exp) - Math.floor(Date.now() / 1000);
  if (left > 60) cache.put(key, email, Math.min(left - 30, 1800));
  return email;
}

/* ---------- who is signed in ---------- */
function role_(email) {
  if (ADMIN_EMAILS.indexOf(email) >= 0) return 'admin';
  const found = Object.keys(COMPANIES).some(id => { const x = load_(id); return x && (x.data.shareholders || []).some(p => String(p.email || '').trim().toLowerCase() === email); });
  if (found) return 'shareholder';
  throw new Error('NOACCESS: This Google account (' + email + ') is not set up in B KWIK. Ask the admin to add this email to your shareholder details.');
}
/* a shareholder only ever receives their own records */
function portal_(email) {
  const out = [];
  Object.keys(COMPANIES).forEach(id => {
    const x = load_(id); if (!x) return; const d = x.data;
    (d.shareholders || []).filter(p => String(p.email || '').trim().toLowerCase() === email).forEach(p => {
      const single = (d.shareholders || []).filter(q => Number(q.share) === Number(p.share)).length === 1;
      const mine = r => (r.personId === p.id) || (!r.personId && single && shareOf_(d, r) === Number(p.share));
      const members = (d.shareholders || []).filter(q => Number(q.share) === Number(p.share)).length;
      out.push({ id: id, logo: (String(d.logo || '').indexOf('data:image/') === 0 || d.logo === 'none') ? d.logo : '', name: d.name || COMPANIES[id].name, abn: d.abn || '', email: d.email || COMPANIES[id].from, phone: d.phone || '', address: d.address || '',
        land: d.land ? { address: d.land.address || '' } : {},
        person: { id: p.id, name: p.name, share: Number(p.share), email: p.email, pct: +(25 / members).toFixed(2) },
        plans: (d.plans || []).filter(r => Number(r.shareId) === Number(p.share) && mine(r)).map(r => ({ id: r.id, shareId: Number(r.shareId), personId: p.id, cat: r.cat, amount: r.amount, day: r.day, from: r.from, until: r.until })),
        contributions: (d.contributions || []).filter(r => shareOf_(d, r) === Number(p.share) && mine(r)).map(r => ({ id: r.id, date: r.date, amount: r.amount, type: r.type, shareId: Number(p.share), personId: p.id, note: String(r.note || '').replace(/^Bank: /, '') })),
        details: { email: p.email || '', mobile: p.mobile || '', whatsapp: p.whatsapp || '', prefs: p.prefs || {} },
        pay: d.payDetails || {},
        loan: d.loan || {}, payments: (d.payments || []).map(r => ({ id: r.id, date: r.date, amount: r.amount, type: r.type, interestManual: r.interestManual })),
        landFull: d.land || {},
        stages: (d.stages || []).map(st => ({ id: st.id, name: st.name, status: st.status, budget: st.budget, start: st.start, end: st.end,
          spent: (d.expenses || []).filter(e => e.stageId === st.id).reduce((a, e) => a + (Number(e.amount) || 0), 0),
          photos: (d.docs || []).filter(x => x.kind === 'photo' && x.stageId === st.id).map(x => ({ id: x.id, title: x.title, date: x.date })) })),
        announcements: (d.announcements || []).slice(-50).reverse().map(a => ({ id: a.id, date: a.date, title: a.title, text: a.text, pinned: !!a.pinned })),
        meetings: (d.meetings || []).map(m => ({ id: m.id, title: m.title, date: m.date, time: m.time, place: m.place, agenda: m.agenda, minutes: m.minutes || '', rsvp: (m.rsvp || {})[p.id] || '', attended: (m.attendees || []).indexOf(p.id) >= 0 })),
        inbox: (d.messages || []).filter(m => (m.recipients || []).some(r => r.personId === p.id) || (m.audience === 'all' && !(m.recipients || []).length)).slice(-100).reverse()
          .map(m => { const r = (m.recipients || []).find(q => q.personId === p.id) || {}; return { id: m.id, date: m.date, subject: m.subject, text: r.text || m.body || '' }; }),
        docs: (d.docs || []).filter(x => x.kind !== 'photo' && (x.personId === p.id || x.personId === 'all' || (x.personId === 'share' + p.share))).map(x => ({ id: x.id, title: x.title, date: x.date, kind: x.kind || 'doc', name: x.name })) });
    });
  });
  return { ok: true, companies: out };
}

/* a shareholder tells the admin about a payment or asks for more time */
function portalNotify_(email, req) {
  const id = String(req.id || ''); if (!COMPANIES[id]) return { ok: false, error: 'Unknown company' };
  const kinds = { paid: 'Paid', partial: 'Partly paid', extra: 'Extra paid', extension: 'Needs an extension', details: 'Change of details' };
  if (!kinds[req.kind]) return { ok: false, error: 'Unknown request' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let p, d, name;
  try {
    const cur = load_(id); if (!cur) return { ok: false, error: 'Nothing saved yet' }; d = cur.data;
    p = (d.shareholders || []).find(q => String(q.email || '').trim().toLowerCase() === email); if (!p) return { ok: false, error: 'Not a shareholder of this company' };
    const clean = v => String(v == null ? '' : v).slice(0, 500);
    const r = { id: Utilities.getUuid().slice(0, 12), at: new Date().toISOString(), date: Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyy-MM-dd'), personId: p.id, name: p.name, share: Number(p.share),
      kind: req.kind, amount: Math.max(0, Number(req.amount) || 0), payDate: clean(req.payDate).slice(0, 10), cat: clean(req.cat).slice(0, 20), until: clean(req.until).slice(0, 10), note: clean(req.note), month: clean(req.month).slice(0, 7), status: 'new' };
    if (req.kind === 'details' && req.changes) r.changes = { email: clean(req.changes.email).slice(0, 120), mobile: clean(req.changes.mobile).slice(0, 40), whatsapp: clean(req.changes.whatsapp).slice(0, 40) };
    d.requests = d.requests || []; d.requests.push(r); if (d.requests.length > 500) d.requests.splice(0, d.requests.length - 500);
    write_(id, d, cur.version + 1);
    name = d.name || COMPANIES[id].name;
    const lines = [p.name + ' (Share ' + p.share + ') says: ' + kinds[r.kind] + '.', ''];
    if (r.amount) lines.push('Amount: ' + money_(r.amount));
    if (r.cat) lines.push('For: ' + r.cat);
    if (r.payDate) lines.push('Paid on: ' + niceDate_(r.payDate));
    if (r.until) lines.push('Asking until: ' + niceDate_(r.until));
    if (r.month) lines.push('Month: ' + r.month);
    if (r.note) lines.push('Note: ' + r.note);
    lines.push('', 'Open B KWIK → Shareholders → Monthly payments to record it or reply.', '', 'B KWIK');
    try { GmailApp.sendEmail(ADMIN_EMAILS[0], kinds[r.kind] + ' · ' + p.name + ' · ' + name, lines.join('\n'), { replyTo: email, name: 'B KWIK' }); } catch (e) { Logger.log(e); }
  } finally { lock.releaseLock(); }
  return { ok: true };
}

/* shareholder answers a meeting or saves their notification choices; nothing else can be changed */
function portalEdit_(email, req, what) {
  const id = String(req.id || ''); if (!COMPANIES[id]) return { ok: false, error: 'Unknown company' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const cur = load_(id); if (!cur) return { ok: false, error: 'Nothing saved yet' }; const d = cur.data;
    const p = (d.shareholders || []).find(q => String(q.email || '').trim().toLowerCase() === email); if (!p) return { ok: false, error: 'Not a shareholder of this company' };
    if (what === 'rsvp') {
      const m = (d.meetings || []).find(x => x.id === req.meetingId); if (!m) return { ok: false, error: 'Meeting not found' };
      const ans = req.answer === 'yes' ? 'yes' : req.answer === 'no' ? 'no' : ''; m.rsvp = m.rsvp || {}; m.rsvp[p.id] = ans;
      try { GmailApp.sendEmail(ADMIN_EMAILS[0], p.name + (ans === 'yes' ? ' is coming to ' : ' can\'t make ') + (m.title || 'the meeting') + ' · ' + (d.name || id), p.name + ' (Share ' + p.share + ') answered "' + (ans === 'yes' ? 'Going' : 'Can\'t make it') + '" for ' + (m.title || 'the meeting') + ' on ' + niceDate_(m.date) + '.\n\nB KWIK', { replyTo: email, name: 'B KWIK' }); } catch (e) {}
    } else {
      const pr = req.prefs || {}; p.prefs = { email: pr.email !== false, sms: !!pr.sms, whatsapp: !!pr.whatsapp, receipts: pr.receipts !== false };
    }
    write_(id, d, cur.version + 1);
  } finally { lock.releaseLock(); }
  return { ok: true };
}
/* documents and photos live in a Drive folder; a shareholder can only open their own, their share's, or ones for everyone */
function docFolder_(id) {
  const name = 'B KWIK documents', it = DriveApp.getFoldersByName(name); const root = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  const sub = root.getFoldersByName(id); return sub.hasNext() ? sub.next() : root.createFolder(id);
}
function docUpload_(req) {
  const id = String(req.id || ''); if (!COMPANIES[id]) return { ok: false, error: 'Unknown company' };
  const bytes = Utilities.base64Decode(String(req.base64 || '')); if (bytes.length > 15 * 1024 * 1024) return { ok: false, error: 'File is over 15 MB' };
  const f = docFolder_(id).createFile(Utilities.newBlob(bytes, req.mime || 'application/octet-stream', req.name || 'file'));
  return { ok: true, fileId: f.getId(), size: bytes.length };
}
function docGet_(req) { const f = DriveApp.getFileById(String(req.fileId)); const b = f.getBlob(); return { ok: true, name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) }; }
function portalDoc_(email, req) {
  const id = String(req.id || ''); if (!COMPANIES[id]) return { ok: false, error: 'Unknown company' };
  const x = load_(id); if (!x) return { ok: false, error: 'Not found' }; const d = x.data;
  const p = (d.shareholders || []).find(q => String(q.email || '').trim().toLowerCase() === email); if (!p) return { ok: false, error: 'Not allowed' };
  const doc = (d.docs || []).find(q => q.id === req.docId); if (!doc || !doc.fileId) return { ok: false, error: 'Not found' };
  if (!(doc.kind === 'photo' || doc.personId === p.id || doc.personId === 'all' || doc.personId === 'share' + p.share)) return { ok: false, error: 'Not allowed' };
  return docGet_({ fileId: doc.fileId });
}

/* ---------- storage ---------- */
function store_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(STORE);
  if (!sh) { sh = ss.insertSheet(STORE); sh.appendRow(['id', 'version', 'updated', 'data…']); sh.hideSheet(); }
  return sh;
}
function row_(sh, id) {
  const ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(r => r[0]);
  const i = ids.indexOf(id);
  return i < 0 ? 0 : i + 1;
}
function load_(id) {
  const sh = store_(), r = row_(sh, id);
  if (!r) return null;
  const vals = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
  const text = vals.slice(3).join('');
  return text ? { version: Number(vals[1]) || 0, data: JSON.parse(text) } : null;
}
function write_(id, data, version) {
  const sh = store_(), text = JSON.stringify(data), parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
  let r = row_(sh, id);
  if (!r) { r = sh.getLastRow() + 1; }
  else sh.getRange(r, 1, 1, sh.getMaxColumns()).clearContent();
  const rowVals = [id, version, new Date()].concat(parts);
  if (sh.getMaxColumns() < rowVals.length) sh.insertColumnsAfter(sh.getMaxColumns(), rowVals.length - sh.getMaxColumns());
  sh.getRange(r, 1, 1, rowVals.length).setValues([rowVals]);
  try { mirror_(id, data); } catch (e) { console.warn('mirror failed', e); }
}
function save_(id, data, baseVersion) {
  if (!COMPANIES[id]) return { ok: false, error: 'Unknown company' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const cur = load_(id), curV = cur ? cur.version : 0;
    if (cur && Number(baseVersion) !== curV) return { ok: false, conflict: true, version: curV, data: cur.data };
    write_(id, data, curV + 1);
    return { ok: true, version: curV + 1 };
  } finally { lock.releaseLock(); }
}

/* ---------- readable tables in the Sheet ---------- */
function mirror_(id, d) {
  const name = (d.name || COMPANIES[id].name);
  const share = x => x.shareId ? Number(x.shareId) : ((d.shareholders || []).find(p => p.id === x.personId) || {}).share || '';
  table_(name + ' · Shareholders', ['Share', 'Name', 'Email', 'Mobile', 'WhatsApp'], (d.shareholders || []).map(p => [p.share, p.name, p.email, p.mobile, p.whatsapp]));
  table_(name + ' · Payments in', ['Date', 'Share', 'Type', 'Amount', 'Note'], (d.contributions || []).map(x => [x.date, share(x), x.type, Number(x.amount) || 0, x.note || '']));
  table_(name + ' · Mortgage', ['Date', 'Bank', 'Type', 'Amount', 'Interest (manual)', 'Reference', 'Note'], (d.payments || []).map(x => [x.date, x.bank || '', x.type || 'regular', Number(x.amount) || 0, x.interestManual || '', x.ref || '', x.note || '']));
  table_(name + ' · Utilities', ['Date paid', 'Utility', 'Provider', 'Invoice / bill no.', 'Amount'], (d.expenses || []).filter(e => e.kind === 'utility').map(e => [e.date, e.utility || e.category, e.provider || '', e.invoice || '', Number(e.amount) || 0]));
  table_(name + ' · Project works', ['Date', 'Item', 'Category', 'Invoice no.', 'Supplier', 'Amount'], (d.expenses || []).filter(e => e.kind !== 'utility').map(e => [e.date, e.description || '', e.category || '', e.invoice || '', e.supplier || '', Number(e.amount) || 0]));
}
function table_(title, head, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), nm = title.slice(0, 99);
  const sh = ss.getSheetByName(nm) || ss.insertSheet(nm);
  sh.clearContents();
  const all = [head].concat(rows.sort((a, b) => String(b[0]).localeCompare(String(a[0]))));
  sh.getRange(1, 1, all.length, head.length).setValues(all);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/* ---------- email ---------- */
function sendEmail_(id, emails, attachment) {
  const co = COMPANIES[id]; if (!co) return { ok: false, error: 'Unknown company' };
  const stored = load_(id), companyName = (stored && stored.data && stored.data.name) || co.name;
  const from = (stored && stored.data && stored.data.email) || co.from;
  const aliases = GmailApp.getAliases().map(a => a.toLowerCase());
  const useFrom = aliases.indexOf(String(from).toLowerCase()) >= 0;
  const opts = { name: companyName, replyTo: from };
  if (useFrom) opts.from = from;
  if (attachment && attachment.base64) opts.attachments = [Utilities.newBlob(Utilities.base64Decode(attachment.base64), attachment.mime || 'application/pdf', attachment.name || 'report.pdf')];
  let sent = 0; const failed = [];
  emails.forEach(m => {
    if (!m.to) return;
    try { GmailApp.sendEmail(m.to, m.subject || companyName, m.body || '', opts); sent++; }
    catch (e) { failed.push(m.to + ': ' + e.message); }
  });
  return { ok: true, sent, failed, from: useFrom ? from : Session.getEffectiveUser().getEmail(), aliasReady: useFrom };
}


/* ---------- automatic emails (set in the app: Setup > Automatic emails) ---------- */
function ym_(s) { return String(s || '').slice(0, 7); }
function mRange_(ym) { const p = ym.split('-').map(Number); const last = new Date(p[0], p[1], 0).getDate(); return [ym + '-01', ym + '-' + ('0' + last).slice(-2)]; }
function addYm_(ym, k) { const p = ym.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + k, 1); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
function ymLabel_(ym) { const p = ym.split('-').map(Number); return Utilities.formatDate(new Date(p[0], p[1] - 1, 1), 'Australia/Brisbane', 'MMMM yyyy'); }
function shareOf_(d, x) { if (x.shareId) return Number(x.shareId); const p = (d.shareholders || []).find(q => q.id === x.personId); return p ? Number(p.share) : 0; }
function catOf_(x) { const t = String(x.type || ''); if (t === 'Deposit') return 'Deposit'; if (t === 'Principal' || t === 'Loan repayment') return 'Principal'; if (t === 'Interest') return 'Interest'; if (t === 'Outgoings' || t === 'Expense' || t === 'Construction') return 'Outgoings'; return 'Other'; }
const CATS_ = ['Deposit', 'Principal', 'Interest', 'Outgoings'];
function planDue_(x, ym) { const r = mRange_(ym); return (!x.from || x.from <= r[1]) && (!x.until || x.until >= r[0]) ? (Number(x.amount) || 0) : 0; }
function personData_(d, p) {
  const single = (d.shareholders || []).filter(q => Number(q.share) === Number(p.share)).length === 1;
  const mine = r => r.personId === p.id || (!r.personId && single);
  return { plans: (d.plans || []).filter(x => Number(x.shareId) === Number(p.share) && mine(x)), pays: (d.contributions || []).filter(x => shareOf_(d, x) === Number(p.share) && mine(x)) };
}
function statement_(d, p, ym) {
  const pd = personData_(d, p), r = mRange_(ym);
  const rows = CATS_.map(cat => { const pl = pd.plans.filter(x => x.cat === cat); const due = pl.reduce((a, x) => a + planDue_(x, ym), 0);
    const paid = pd.pays.filter(x => catOf_(x) === cat && x.date >= r[0] && x.date <= r[1]).reduce((a, x) => a + (Number(x.amount) || 0), 0);
    const act = pl.find(x => planDue_(x, ym)); return { cat: cat, due: due, paid: paid, day: act ? (Number(act.day) || 1) : null }; }).filter(x => x.due > 0 || x.paid > 0);
  let earlier = 0;
  CATS_.forEach(cat => { const pl = pd.plans.filter(x => x.cat === cat); if (!pl.length) return; const start = pl.map(x => ym_(x.from) || ym).sort()[0];
    for (let k = start; k < ym; k = addYm_(k, 1)) earlier += pl.reduce((a, x) => a + planDue_(x, k), 0) - pd.pays.filter(x => catOf_(x) === cat && ym_(x.date) === k).reduce((a, x) => a + (Number(x.amount) || 0), 0); });
  const due = rows.reduce((a, x) => a + x.due, 0), paid = rows.reduce((a, x) => a + x.paid, 0);
  const dueDay = rows.filter(x => x.day).map(x => x.day).sort((a, b) => a - b)[0] || null;
  return { rows: rows, due: due, paid: paid, earlier: earlier, dueDay: dueDay };
}
function stLabel_(due, paid) { return due <= 0.005 && paid <= 0.005 ? 'No monthly amount' : paid <= 0.005 ? 'Not paid' : paid < due - 0.005 ? 'Partly paid' : paid > due + 0.005 ? 'Extra paid' : 'Paid'; }
function stText_(d, p, S, ym, overdue) {
  const name = d.name || 'the company', L = [];
  L.push('Hi ' + p.name + ',', '');
  L.push(overdue ? 'This is a friendly reminder that your ' + name + ' payment for ' + ymLabel_(ym) + ' (Share ' + p.share + ') has not been fully received yet.' : 'Here is your ' + name + ' payment summary for ' + ymLabel_(ym) + ' (Share ' + p.share + ').', '');
  S.rows.forEach(r => L.push(r.cat + ': due ' + money_(r.due) + (r.day ? ' (on day ' + r.day + ')' : '') + ', paid ' + money_(r.paid) + ' – ' + stLabel_(r.due, r.paid)));
  if (!S.rows.length) L.push('No monthly payment is set for you this month.');
  L.push('', 'Total due: ' + money_(S.due), 'Total paid: ' + money_(S.paid));
  const diff = S.paid - S.due;
  if (diff < -0.005) L.push('Still to pay this month: ' + money_(-diff)); else if (diff > 0.005) L.push('Extra paid this month: ' + money_(diff)); else if (S.due > 0) L.push('This month is fully paid. Thank you.');
  if (S.earlier > 0.005) L.push('Still owing from earlier months: ' + money_(S.earlier)); else if (S.earlier < -0.005) L.push('Paid ahead from earlier months: ' + money_(-S.earlier));
  if (overdue) L.push('', 'If you have already paid, thank you, and please ignore this message.');
  L.push('', 'This message is just for you.', '', 'Kind regards,', name);
  return L.join('\n');
}
function logAuto_(d, subject, list, source) {
  d.messages = d.messages || [];
  d.messages.push({ id: Utilities.getUuid().slice(0, 8), date: Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyy-MM-dd'), subject: subject, body: 'Individual messages', audience: 'statements', channels: ['email'], emailed: list.length, auto: true, source: source,
    recipients: list.map(x => ({ personId: x.p.id, name: x.p.name, email: x.p.email, text: x.text, missing: [] })) });
}
function runAuto_(id, d, today) {
  const a = d.auto || {}, day = Number(today.slice(8)), ym = ym_(today), name = d.name || COMPANIES[id].name;
  d.autoLog = d.autoLog || {}; let changed = false; const gotSummary = {};
  const people = (d.shareholders || []).filter(p => p.email && !(p.prefs && p.prefs.email === false));
  // 1. monthly summary
  if (Number(a.statementDay) && day === Number(a.statementDay) && !d.autoLog['st-' + ym]) {
    const list = people.map(p => ({ p: p, S: statement_(d, p, ym) })).filter(x => a.statementWho === 'all' || (a.statementWho === 'owing' ? x.S.paid < x.S.due - 0.005 : x.S.due > 0))
      .map(x => ({ p: x.p, text: stText_(d, x.p, x.S, ym, false) }));
    list.forEach(x => gotSummary[x.p.id] = 1);
    if (list.length) { sendEmail_(id, list.map(x => ({ to: x.p.email, subject: 'Your payment summary for ' + ymLabel_(ym) + ' · ' + name, body: x.text }))); logAuto_(d, 'Your payment summary for ' + ymLabel_(ym), list, 'statement'); }
    d.autoLog['st-' + ym] = today; changed = true;
  }
  // 2. overdue reminder, once a month per person
  if (Number(a.overdueDays)) {
    const list = [];
    people.forEach(p => { const S = statement_(d, p, ym); if (!S.dueDay || S.paid >= S.due - 0.005) return; if (gotSummary[p.id]) return; if (day < S.dueDay + Number(a.overdueDays)) return;
      const key = 'od-' + p.id + '-' + ym; if (d.autoLog[key]) return; d.autoLog[key] = today; list.push({ p: p, text: stText_(d, p, S, ym, true) }); });
    if (list.length) { sendEmail_(id, list.map(x => ({ to: x.p.email, subject: 'Payment reminder for ' + ymLabel_(ym) + ' · ' + name, body: x.text }))); logAuto_(d, 'Payment reminder for ' + ymLabel_(ym), list, 'overdue'); changed = true; }
  }
  const admin = ADMIN_EMAILS[0];
  // 3. loan repayment alert to the admin
  const L = d.loan || {};
  if (Number(a.loanAlertDays) && Number(L.repayment)) {
    const dd = Math.min(28, Math.max(1, Number(L.dueDay) || 1)); const t = new Date(today + 'T00:00:00');
    let due = new Date(t.getFullYear(), t.getMonth(), dd); if (due < t) due = new Date(t.getFullYear(), t.getMonth() + 1, dd);
    const dueIso = Utilities.formatDate(due, 'Australia/Brisbane', 'yyyy-MM-dd'), diffDays = Math.round((due - t) / 86400000);
    if (diffDays === Number(a.loanAlertDays) && !d.autoLog['la-' + dueIso]) {
      const r = mRange_(ym_(dueIso)); const got = (d.contributions || []).filter(x => x.date >= r[0] && x.date <= r[1] && ['Principal', 'Interest'].indexOf(catOf_(x)) >= 0).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const body = 'Loan repayment of ' + money_(L.repayment) + ' for ' + name + ' is due on ' + niceDate_(dueIso) + (L.lender ? ' (' + L.lender + ')' : '') + '.\n\nPrincipal and interest received from shareholders this month: ' + money_(got) + '.\n' + (got + 0.005 < Number(L.repayment) ? 'That is ' + money_(Number(L.repayment) - got) + ' short of the repayment.' : 'That covers the repayment.') + '\n\nB KWIK';
      sendEmail_(id, [{ to: admin, subject: 'Loan repayment due ' + niceDate_(dueIso) + ' · ' + name, body: body }]); d.autoLog['la-' + dueIso] = today; changed = true;
    }
  }
  // 4. bills due soon (from reminders) to the admin
  if (Number(a.billAlertDays)) {
    const t = new Date(today + 'T00:00:00');
    (d.reminders || []).filter(r => r.active !== false && r.nextDate && ['Loan repayment', 'Meeting'].indexOf(r.type) < 0).forEach(r => {
      const due = new Date(r.nextDate + 'T00:00:00'), dd = Math.round((due - t) / 86400000), key = 'bill-' + r.id + '-' + r.nextDate;
      if (dd !== Number(a.billAlertDays) || d.autoLog[key]) return;
      sendEmail_(id, [{ to: admin, subject: r.title + ' due ' + niceDate_(r.nextDate) + ' · ' + name, body: r.title + (Number(r.amount) ? ' of ' + money_(r.amount) : '') + ' is due on ' + niceDate_(r.nextDate) + ' for ' + name + '.\n\nB KWIK' }]);
      d.autoLog[key] = today; changed = true; });
  }
  // keep the log small
  const keys = Object.keys(d.autoLog); if (keys.length > 400) keys.sort((x, y) => String(d.autoLog[x]).localeCompare(String(d.autoLog[y]))).slice(0, keys.length - 300).forEach(k => delete d.autoLog[k]);
  return changed;
}
function weeklyBackup_(today) {
  const t = new Date(today + 'T00:00:00'); if (t.getDay() !== 1) return;
  const want = Object.keys(COMPANIES).some(id => { const x = load_(id); return x && x.data.auto && x.data.auto.backup === 'weekly'; }); if (!want) return;
  const all = Object.keys(COMPANIES).reduce((o, id) => { const x = load_(id); o[id] = x ? x.data : null; return o; }, {});
  const blob = Utilities.newBlob(JSON.stringify(all, null, 1), 'application/json', 'B KWIK backup ' + today + '.json');
  GmailApp.sendEmail(ADMIN_EMAILS[0], 'B KWIK weekly backup ' + niceDate_(today), 'Attached is a full backup of B IN DALBY and KWIK TRIP as of ' + niceDate_(today) + '.\nKeep it somewhere safe. It contains everyone\'s details.', { attachments: [blob], name: 'B KWIK' });
}

/* ---------- automatic daily reminders ---------- */
function dailyReminders() {
  const today = Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyy-MM-dd');
  Object.keys(COMPANIES).forEach(id => {
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const cur = load_(id); if (!cur) return;
      const d = cur.data; let changed = false;
      (d.reminders || []).forEach(r => {
        if (r.active === false || !r.nextDate || r.nextDate > today || (r.channels || []).indexOf('email') < 0) return;
        const people = audience_(d, r.audience).filter(p => p.email);
        const emails = people.map(p => ({ to: p.email, subject: r.title + ' · ' + (d.name || COMPANIES[id].name), body: fill_(r.message, d, p, r) }));
        const res = sendEmail_(id, emails);
        d.messages = d.messages || [];
        d.messages.push({ id: Utilities.getUuid().slice(0, 8), date: today, subject: r.title, body: r.message, audience: r.audience, channels: ['email'], emailed: res.sent, auto: true,
          recipients: people.map(p => ({ personId: p.id, name: p.name, email: p.email, text: fill_(r.message, d, p, r), missing: [] })), source: 'reminder' });
        if (r.frequency === 'once') r.active = false; else r.nextDate = nextDate_(r.nextDate, r.frequency);
        changed = true;
      });
      try { if (runAuto_(id, d, today)) changed = true; } catch (e) { Logger.log('Automatic emails failed for ' + id + ': ' + e); }
      if (changed) write_(id, d, cur.version + 1);
    } finally { lock.releaseLock(); }
  });
  try { weeklyBackup_(today); } catch (e) { Logger.log('Backup failed: ' + e); }
}
function audience_(d, a) { const all = d.shareholders || []; if (!a || a === 'all') return all; const s = Number(String(a).slice(1)); return all.filter(p => p.share === s); }
function money_(n) { return '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function niceDate_(s) { const p = String(s).split('-'); return p.length === 3 ? Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2]), 'Australia/Brisbane', 'd MMM yyyy') : s; }
function fill_(t, d, p, r) {
  const total = Number(r.amount) || 0;
  const v = { name: String(p.name || '').split(' ')[0], fullname: p.name, company: d.name, share: 'Share ' + p.share, title: r.title,
    total: total ? money_(total) : 'the amount', amount: total ? money_(total / 4) : 'your share', due: r.nextDate ? niceDate_(r.nextDate) : 'soon' };
  return String(t || '').replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m);
}
function nextDate_(s, f) {
  const p = s.split('-').map(Number), dt = new Date(p[0], p[1] - 1, p[2]);
  const addM = n => { const day = dt.getDate(); dt.setDate(1); dt.setMonth(dt.getMonth() + n); const dim = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); dt.setDate(Math.min(day, dim)); };
  if (f === 'weekly') dt.setDate(dt.getDate() + 7); else if (f === 'fortnightly') dt.setDate(dt.getDate() + 14);
  else if (f === 'monthly') addM(1); else if (f === 'quarterly') addM(3); else if (f === 'yearly') addM(12);
  return Utilities.formatDate(dt, 'Australia/Brisbane', 'yyyy-MM-dd');
}

/* ---------- run once ---------- */
function setup() {
  store_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyReminders').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(8).inTimezone('Australia/Brisbane').create();
  const aliases = GmailApp.getAliases();
  Logger.log('Daily reminders set for 8am. Send-as addresses ready: ' + (aliases.join(', ') || 'none yet'));
}
