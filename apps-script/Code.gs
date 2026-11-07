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
    switch (req.action) {
      case 'whoami': return json({ ok: true, email: user });
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
  if (ADMIN_EMAILS.indexOf(email) < 0) throw new Error('AUTH: this Google account is not allowed');
  const left = Number(info.exp) - Math.floor(Date.now() / 1000);
  if (left > 60) cache.put(key, email, Math.min(left - 30, 1800));
  return email;
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
      if (changed) write_(id, d, cur.version + 1);
    } finally { lock.releaseLock(); }
  });
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
