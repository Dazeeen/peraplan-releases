/**
 * PeraPlan reviews — a tiny backend that runs in Google Apps Script.
 *
 * The app sends a review with the reviewer's Google ID token. This script:
 *  1. Verifies the token with Google (audience = PeraPlan's web client id,
 *     issuer = Google, not expired, verified email). Fake or stolen-from-
 *     another-app tokens are rejected, so every review belongs to a real
 *     Google account.
 *  2. Allows ONE review per Google account and ONE per device. Sending again
 *     from the same account edits the existing review instead of adding one.
 *  3. Rate-limits (per account and a daily cap) and limits sizes.
 *  4. Cleans the text (control characters, length) and stops spreadsheet
 *     formula injection (cells starting with = + - @ are stored as text).
 *  5. Holds reviews with links or bad words for manual review ("pending").
 *  6. Stores only salted hashes of the account and device — never emails.
 *
 * The public web page reads published reviews with GET ?action=list and
 * shows them as plain text (never as HTML), so a review can't run code there.
 *
 * Setup: see README.md in this folder.
 */

const CLIENT_ID = '259803821684-fia34qjlv2ad656fkmit3r1h3f0ko6lp.apps.googleusercontent.com';
const SHEET_NAME = 'Reviews';
const HEADER = ['id', 'account', 'device', 'name', 'stars', 'text', 'status', 'createdAt', 'updatedAt', 'version'];
const MAX_BODY = 6000;
const MAX_NAME = 40;
const MAX_TEXT = 1000;
const MIN_TEXT = 10;
const PER_ACCOUNT_SECONDS = 60; // one submit per minute per account
const DAILY_CAP = 300; // all submits per day
const BAD_WORDS = ['putangina', 'tangina', 'gago', 'tarantado', 'ulol', 'fuck', 'shit', 'bitch', 'nigger', 'kantot', 'puke', 'titi'];

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  if (action !== 'list') return json({ ok: false, error: 'unknown_action' });
  const cache = CacheService.getScriptCache();
  const hit = cache.get('list');
  if (hit) return text(hit);
  const rows = sheet_().getDataRange().getValues().slice(1);
  const published = rows
    .filter((r) => r[6] === 'published')
    .map((r) => ({ name: String(r[3]), stars: Number(r[4]), text: String(r[5]), date: Number(r[8]) || Number(r[7]) }))
    .sort((a, b) => b.date - a.date);
  const count = published.length;
  const avg = count ? published.reduce((t, r) => t + r.stars, 0) / count : 0;
  const out = JSON.stringify({ ok: true, count: count, average: Math.round(avg * 10) / 10, reviews: published.slice(0, 200) });
  cache.put('list', out, 300);
  return text(out);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > MAX_BODY) return json({ ok: false, error: 'invalid' });
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (_) {
      return json({ ok: false, error: 'invalid' });
    }

    const claims = verifyIdToken_(String(body.idToken || ''));
    if (!claims) return json({ ok: false, error: 'auth' });

    const name = clean_(body.name, MAX_NAME);
    const review = clean_(body.text, MAX_TEXT);
    const stars = Number(body.stars);
    const device = String(body.device || '');
    if (!name || review.length < MIN_TEXT || !(stars >= 1 && stars <= 5 && Math.floor(stars) === stars) || device.length < 16 || device.length > 128) {
      return json({ ok: false, error: 'invalid' });
    }

    const account = hash_('acct:' + claims.sub);
    const dev = hash_('dev:' + device);
    const cache = CacheService.getScriptCache();
    if (cache.get('rl_' + account)) return json({ ok: false, error: 'rate' });
    const dayKey = 'day_' + Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyyMMdd');
    const today = Number(cache.get(dayKey) || 0);
    if (today >= DAILY_CAP) return json({ ok: false, error: 'busy' });

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json({ ok: false, error: 'busy' });
    try {
      const sh = sheet_();
      const rows = sh.getDataRange().getValues();
      let mine = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][1] === account) mine = i;
        else if (rows[i][2] === dev) return json({ ok: false, error: 'device_used' }); // another account already reviewed from this phone
      }
      const now = Date.now();
      const status = needsReview_(name + ' ' + review) ? 'pending' : 'published';
      if (mine > 0) {
        if (rows[mine][6] === 'hidden') return json({ ok: false, error: 'hidden' });
        sh.getRange(mine + 1, 4, 1, 7).setValues([[cell_(name), stars, cell_(review), status, rows[mine][7], now, cell_(String(body.version || '').slice(0, 20))]]);
      } else {
        sh.appendRow([Utilities.getUuid(), account, dev, cell_(name), stars, cell_(review), status, now, now, cell_(String(body.version || '').slice(0, 20))]);
      }
      cache.put('rl_' + account, '1', PER_ACCOUNT_SECONDS);
      cache.put(dayKey, String(today + 1), 6 * 3600);
      cache.remove('list');
      return json({ ok: true, status: status, updated: mine > 0 });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  }
}

/** Ask Google whether the ID token is real, then check it was made for PeraPlan. */
function verifyIdToken_(token) {
  if (!token || token.length > 4096) return null;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const c = JSON.parse(res.getContentText());
  const okIssuer = c.iss === 'accounts.google.com' || c.iss === 'https://accounts.google.com';
  const notExpired = Number(c.exp) * 1000 > Date.now();
  const verified = c.email_verified === true || c.email_verified === 'true';
  if (c.aud !== CLIENT_ID || !okIssuer || !notExpired || !verified || !c.sub) return null;
  return c;
}

/** Salted hash, so the sheet never holds account ids or device ids. */
function hash_(value) {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('SALT');
  if (!salt) {
    salt = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SALT', salt);
  }
  const bytes = Utilities.computeHmacSha256Signature(value, salt);
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

/** Plain text only: no control characters, single spaces, trimmed, limited length. */
function clean_(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Stop formula injection: a cell that starts with = + - @ (or tab/CR) is stored as text. */
function cell_(v) {
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/** Links and bad words wait for the owner to publish them by hand. */
function needsReview_(s) {
  const t = s.toLowerCase();
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ph|xyz|info|io|ly|me)\b)/.test(t)) return true;
  if (/(.)\1{7,}/.test(t)) return true;
  return BAD_WORDS.some((w) => t.indexOf(w) >= 0);
}

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json(o) {
  return text(JSON.stringify(o));
}

function text(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the sheet and the secret salt. */
function setup() {
  sheet_();
  hash_('setup');
}
