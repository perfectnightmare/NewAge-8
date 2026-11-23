// outfit-follower.js
// MORNING (server time before noon): every account switches to its own saved F1/F2/F3 outfit.
// EVENING (noon to midnight): follower accounts (never main) copy main's themed look from the board,
// only if the record is for today, says "dress up", and the account owns every piece. Makeup is never changed.
// OUTFIT_DRY_RUN=1 logs what it WOULD do without changing anything.

const BASE = 'https://v3.g.ladypopular.com';
const DEFAULT_NAMES = ['f1', 'f2', 'f3'];
const EVENING_FROM_HOUR = 12;
const DRY_RUN = process.env.OUTFIT_DRY_RUN === '1';
const MAIN_LADY_ID = String(process.env.MAIN_LADY_ID || '8859158');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

const HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'x-requested-with': 'XMLHttpRequest',
  referer: `${BASE}/wardrobe.php?wardrobetype=lady&archive=0&category_id%5B0%5D=9`
};

// ---------------------------------------------------------------- helpers
async function postBody(page, path, body) {
  const res = await page.request.post(BASE + path, { headers: HEADERS, data: body });
  if (!res.ok()) throw new Error(`POST ${path} returned HTTP ${res.status()}`);
  const t = await res.text();
  try { return JSON.parse(t); } catch (e) { throw new Error(`${path} gave non-JSON: ${t.slice(0, 150)}`); }
}

// reads the JSON object/array that starts at the first open-bracket after position `from`
function parseAfter(text, from, open, close) {
  const b = text.indexOf(open, from);
  if (b === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = b; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { value: JSON.parse(text.slice(b, i + 1)), end: i + 1 }; }
  }
  return null;
}

// ---------------------------------------------------------------- server clock + who is logged in
async function getClock(page) {
  const res = await page.request.get(`${BASE}/vip_shop.php?tab=dollars`, {
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9', referer: `${BASE}/welcome.php` }
  });
  if (!res.ok()) throw new Error(`vip_shop.php returned HTTP ${res.status()}`);
  const html = await res.text();
  const lm = html.match(/var LADY_ID = '(\d+)'/);
  const ladyId = lm ? lm[1] : null;

  let seconds = null, date = null, raw = null;
  const m = html.match(/var currentTime = new Date\('([^']+)'\)/);
  if (m) {
    raw = m[1];
    const t = m[1].match(/(\d{1,2}):(\d{2}):(\d{2})\s*$/);
    if (t) seconds = +t[1] * 3600 + +t[2] * 60 + +t[3];
    const d = new Date(m[1]);
    if (!isNaN(d)) date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const c = html.match(/"reset_daily_quests_time_left":\s*"?(\d+)"?/);
  const countdown = c && +c[1] <= 86400 ? +c[1] : null;
  if (seconds === null && countdown !== null) seconds = (86400 - countdown) % 86400;
  console.log(`🕒 Clock: ${raw || 'not found'} | reset countdown: ${countdown !== null ? countdown + 's left' : 'not found'} | Lady ID: ${ladyId}`);
  return { seconds, date, ladyId };
}

// ---------------------------------------------------------------- MORNING: back to the default outfit
async function loadAllOutfits(page) {
  const all = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const res = await page.request.post(`${BASE}/ajax/wardrobe/lady.php`, {
      headers: { accept: '*/*', 'x-requested-with': 'XMLHttpRequest', referer: HEADERS.referer },
      form: { action: 'loadOutfits', offset: String(offset) }
    });
    if (!res.ok()) throw new Error(`loadOutfits returned HTTP ${res.status()}`);
    const json = await res.json();
    if (json?.status !== 1 || !Array.isArray(json.outfits)) throw new Error(`loadOutfits failed: ${JSON.stringify(json).slice(0, 300)}`);
    all.push(...json.outfits);
    if (!json.has_more || json.outfits.length === 0) break;
    offset = Number.isFinite(Number(json.offset)) ? Number(json.offset) : offset + json.outfits.length;
  }
  return all;
}

async function revertToDefault(page) {
  const outfits = await loadAllOutfits(page);
  console.log(`📂 ${outfits.length} saved outfit(s): ${outfits.map(o => o.name).join(', ')}`);
  const defaults = outfits.filter(o => DEFAULT_NAMES.includes(String(o.lowercase_name ?? o.name ?? '').trim().toLowerCase()));
  if (defaults.length === 0) { console.log('⚠️ No saved outfit named F1, F2 or F3 on this account. Leaving the look as it is.'); return; }
  if (defaults.length > 1) { console.log(`⚠️ More than one default outfit found (${defaults.map(o => o.name).join(', ')}). Leaving the look as it is.`); return; }
  const target = defaults[0];
  console.log(`🎯 Default outfit: "${target.name}" (id ${target.id})`);
  if (DRY_RUN) { console.log('🧪 DRY RUN: would switch to it now. Nothing changed.'); return; }
  const res = await page.request.post(`${BASE}/ajax/wardrobe/lady.php`, {
    headers: { accept: '*/*', 'x-requested-with': 'XMLHttpRequest', referer: HEADERS.referer },
    form: { action: 'changeOutfit', outfitId: String(target.id), wardrobetype: 'wardrobe', contenttype: '', contentid: '', page: '1', apply_appearance: 'true' }
  });
  if (!res.ok()) throw new Error(`changeOutfit returned HTTP ${res.status()}`);
  const json = await res.json();
  if (json?.status !== 1) throw new Error(`changeOutfit failed: ${JSON.stringify(json).slice(0, 300)}`);
  console.log(`✅ Switched to "${target.name}".`);
}

// ---------------------------------------------------------------- EVENING: copy main's themed look
async function boardRead() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(process.env.BOARD_URL, {
        method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ password: process.env.BOARD_PASSWORD, action: 'read' })
      });
      const text = await res.text();
      let j; try { j = JSON.parse(text); } catch (e) { throw new Error(`board gave non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`); }
      if (!j.ok) throw new Error(`board said: ${j.error}`);
      return j.record;
    } catch (e) { lastErr = e; await sleep(3000 * attempt); }
  }
  throw lastErr;
}

// what the account is wearing right now, plus its own makeup
async function readLook(page) {
  const j = await postBody(page, '/ajax/wardrobe.php', 'wardrobetype=lady&category_id%5B%5D=9&archive=0&pet=0&updatePartials%5B%5D=8');
  const p8 = j && j.partials && j.partials.partial8;
  if (!p8) throw new Error('worn items not found');
  const start = p8.indexOf('initModelImages(');
  const clothes = parseAfter(p8, start, '[', ']');
  if (!clothes) throw new Error('worn items could not be read');
  const app = parseAfter(p8, clothes.end, '{', '}');
  return {
    worn: clothes.value.map(x => ({ itemId: Number(x.id), colour: Number(x.additional && x.additional.color) })),
    appearance: app ? app.value : null
  };
}

function appearanceBody(app) {
  const entries = Object.values(app).map(o => o && o.data).filter(Boolean);
  return entries.map((d, i) => {
    let s = `appearance%5B${i}%5D%5Btype%5D=${d.type}&appearance%5B${i}%5D%5Bnum%5D=${d.num}&appearance%5B${i}%5D%5Bcolor%5D=${d.color}`;
    if (d.size !== undefined) s += `&appearance%5B${i}%5D%5Bsize%5D=${d.size}`;
    return s;
  }).join('&');
}

// itemId -> { colour -> row id } for everything this account owns in one category
async function ownedRows(page, cat) {
  const re = /\$\('#item-(\d+)'\)\.data\('item',\s*(\{[^\n]*?\})\);/g;
  const map = {};
  for (let p = 1; p <= 10; p++) {
    const j = await postBody(page, '/ajax/wardrobe.php',
      `wardrobetype=lady&category_id%5B%5D=${cat}&archive=0&pet=0&page=${p}&currentPageNum=${p}&updatePartials%5B%5D=10&updatePartials%5B%5D=3`);
    const html = j && j.partials && j.partials.partial3;
    if (!html) break;
    for (const m of html.matchAll(re)) {
      try {
        const it = JSON.parse(m[2]);
        map[Number(it.id)] = map[Number(it.id)] || {};
        (it.colors || []).forEach(c => { map[Number(it.id)][Number(c.color)] = c.concrete_id; });
      } catch (e) { /* skip */ }
    }
    if (!(j.options && j.options.hasMore)) break;
    await sleep(400);
  }
  return map;
}

async function dressFromBoard(page, clock) {
  if (clock.ladyId === MAIN_LADY_ID) { console.log('⏭️ This is the main account. Nothing to copy; it keeps whatever you dressed it in.'); return; }
  if (!process.env.BOARD_URL || !process.env.BOARD_PASSWORD) { console.log('⚠️ BOARD_URL / BOARD_PASSWORD are not set. Staying in the default outfit.'); return; }
  if (!clock.date) { console.log('⚠️ Could not read today\'s game date. Staying in the default outfit.'); return; }

  const rec = await boardRead();
  if (!rec) { console.log('ℹ️ The board is empty. Staying in the default outfit.'); return; }
  console.log(`📋 Board record: game date ${rec.gameDate}, saved ${rec.savedAt}, dress up: ${rec.dressUp}`);
  if (rec.gameDate !== clock.date) { console.log(`ℹ️ The record is for ${rec.gameDate}, today is ${clock.date}. Too old, staying in the default outfit.`); return; }
  if (!rec.dressUp) { console.log(`ℹ️ The record says no dress up (${rec.reason}). Staying in the default outfit.`); return; }

  const look = (rec.look || []).slice().sort((a, b) => b.layer - a.layer);
  if (look.length === 0) { console.log('ℹ️ The record has no worn items. Staying in the default outfit.'); return; }
  if (look.some(l => l.kind === 'event')) { console.log('ℹ️ The record contains an event item. Staying in the default outfit.'); return; }

  // does this account own every piece?
  const cats = [...new Set(look.map(l => l.category))];
  const owned = {};
  for (const cat of cats) { owned[cat] = await ownedRows(page, cat); await sleep(400); }
  const rows = [], missing = [];
  for (const l of look) {
    const row = owned[l.category] && owned[l.category][l.itemId] && owned[l.category][l.itemId][l.colour];
    console.log(`👗 layer ${l.layer}: item ${l.itemId} colour ${l.colour} (${l.kind}) -> ${row ? 'owned, row ' + row : 'NOT OWNED'}`);
    if (row) rows.push({ id: row, layer: l.layer }); else missing.push(l);
  }
  if (missing.length) {
    console.log(`⏭️ Missing ${missing.length} piece(s). Staying in the default outfit: ${missing.map(m => `${m.itemId}/colour ${m.colour} (${m.kind})`).join(', ')}`);
    return;
  }

  const mine = await readLook(page);
  if (!mine.appearance) { console.log('⚠️ Could not read this account\'s own makeup. Staying in the default outfit.'); return; }
  const items = rows.map((r, i) => `items%5B${i}%5D%5Bid%5D=${r.id}&items%5B${i}%5D%5Boffset%5D=${r.layer}`).join('&');
  const body = `action=saveChanges&selectedPet=&${items}&${appearanceBody(mine.appearance)}`;
  if (DRY_RUN) { console.log('🧪 DRY RUN: the account owns every piece. Would save the look now. Nothing changed.'); return; }

  const r = await postBody(page, '/ajax/wardrobe/lady.php', body);
  if (!r || r.status !== 1) throw new Error(`saveChanges failed: ${JSON.stringify(r).slice(0, 300)}`);
  const after = await readLook(page);
  const want = look.map(l => `${l.itemId}:${l.colour}`).sort().join(',');
  const got = after.worn.map(w => `${w.itemId}:${w.colour}`).sort().join(',');
  console.log(want === got ? `✅ Look saved and confirmed (${look.length} pieces).` : `⚠️ Look saved, but what is worn now differs from the record. Wanted ${want}, got ${got}.`);
}

// ---------------------------------------------------------------- entry point
module.exports = async function runOutfitFollower(page) {
  console.log(DRY_RUN ? '👗 Outfit follower (DRY RUN)' : '👗 Outfit follower');
  const clock = await getClock(page);
  if (clock.seconds === null) { console.log('❌ Could not read the server time. Doing nothing; the look stays as it is.'); return; }
  console.log(`🕒 Server time: ${pad(Math.floor(clock.seconds / 3600))}:${pad(Math.floor((clock.seconds % 3600) / 60))}`);
  if (clock.seconds >= EVENING_FROM_HOUR * 3600) {
    console.log('🌆 Evening phase (after noon, before midnight): looking for a themed look to copy.');
    await dressFromBoard(page, clock);
  } else {
    console.log('🌅 Morning phase (after midnight, before noon): reverting to the default outfit.');
    await revertToDefault(page);
  }
};
