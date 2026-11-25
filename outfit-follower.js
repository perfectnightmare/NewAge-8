// outfit-follower.js
// MORNING (server time before noon): every account switches to its own saved F1/F2/F3 outfit.
// EVENING (noon to midnight): follower accounts (never main) copy main's look from the board,
// only if the record is for today, says "dress up", and the account owns every piece (event items included).
// MAKEUP: copied too (through the beauty salon save), but only if the clothes check passed AND every makeup item
// (hair included) is already available to this account in the salon (no purchases ever).
// Otherwise the account keeps its own makeup.
// OUTFIT_DRY_RUN=1 logs what it WOULD do without changing anything.
// Console output: one line on success; the full log only when something is not a clean success.

const BASE = 'https://v3.g.ladypopular.com';
const DEFAULT_NAMES = ['f1', 'f2', 'f3'];
const EVENING_FROM_HOUR = 12;
const DRY_RUN = process.env.OUTFIT_DRY_RUN === '1';
const MAIN_LADY_ID = String(process.env.MAIN_LADY_ID || '8859158');
const SALON = '/ajax/beauty_salon_lady.php';
const MAX_WARDROBE_PAGES = 100;   // pages per wardrobe category (about 18 items per page)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- buffered logging
let buf = [];
const log = (msg) => { buf.push(msg); };
function flush() { buf.forEach(l => console.log(l)); buf = []; }
function finish(successSummary) {
  if (successSummary && !DRY_RUN) { console.log(successSummary); buf = []; }
  else flush();
}

const HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'x-requested-with': 'XMLHttpRequest',
  referer: `${BASE}/wardrobe.php?wardrobetype=lady&archive=0&category_id%5B0%5D=9`
};
const SALON_HEADERS = { ...HEADERS, referer: `${BASE}/beauty_salon.php` };

// ---------------------------------------------------------------- helpers
async function postBody(page, path, body, headers) {
  const res = await page.request.post(BASE + path, { headers: headers || HEADERS, data: body });
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
  log(`🕒 Clock: ${raw || 'not found'} | reset countdown: ${countdown !== null ? countdown + 's left' : 'not found'} | Lady ID: ${ladyId}`);
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

// returns a success summary string, or null when it is not a clean success
async function revertToDefault(page) {
  const outfits = await loadAllOutfits(page);
  log(`📂 ${outfits.length} saved outfit(s): ${outfits.map(o => o.name).join(', ')}`);
  const defaults = outfits.filter(o => DEFAULT_NAMES.includes(String(o.lowercase_name ?? o.name ?? '').trim().toLowerCase()));
  if (defaults.length === 0) { log('⚠️ No saved outfit named F1, F2 or F3 on this account. Leaving the look as it is.'); return null; }
  if (defaults.length > 1) { log(`⚠️ More than one default outfit found (${defaults.map(o => o.name).join(', ')}). Leaving the look as it is.`); return null; }
  const target = defaults[0];
  log(`🎯 Default outfit: "${target.name}" (id ${target.id})`);
  if (DRY_RUN) { log('🧪 DRY RUN: would switch to it now. Nothing changed.'); return null; }
  const res = await page.request.post(`${BASE}/ajax/wardrobe/lady.php`, {
    headers: { accept: '*/*', 'x-requested-with': 'XMLHttpRequest', referer: HEADERS.referer },
    form: { action: 'changeOutfit', outfitId: String(target.id), wardrobetype: 'wardrobe', contenttype: '', contentid: '', page: '1', apply_appearance: 'true' }
  });
  if (!res.ok()) throw new Error(`changeOutfit returned HTTP ${res.status()}`);
  const json = await res.json();
  if (json?.status !== 1) throw new Error(`changeOutfit failed: ${JSON.stringify(json).slice(0, 300)}`);
  log(`✅ Switched to "${target.name}".`);
  return `✅ Outfit follower: reverted to default "${target.name}".`;
}

// ---------------------------------------------------------------- EVENING: copy main's look
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

// ---- makeup helpers
// the game's appearance object -> list of { type, num, color, size? }
function appearanceEntries(app) {
  return Object.values(app).map(o => o && o.data).filter(Boolean).map(d => {
    const e = { type: Number(d.type), num: Number(d.num), color: Number(d.color) };
    if (d.size !== undefined) e.size = Number(d.size);
    return e;
  });
}
function makeupBody(entries) {
  return entries.map((d, i) => {
    let s = `appearance%5B${i}%5D%5Btype%5D=${d.type}&appearance%5B${i}%5D%5Bnum%5D=${d.num}&appearance%5B${i}%5D%5Bcolor%5D=${d.color}`;
    if (d.size !== undefined) s += `&appearance%5B${i}%5D%5Bsize%5D=${d.size}`;
    return s;
  }).join('&');
}
const entryKey = (d) => `${Number(d.type)}:${Number(d.num)}:${Number(d.color)}:${d.size === undefined ? '' : Number(d.size)}`;
const keysOf = (entries) => entries.map(entryKey).sort().join(',');

// every item of one salon category (the category id is the item type), following the pages
async function salonItems(page, type) {
  const items = [];
  for (let p = 1; p <= 30; p++) {
    const j = await postBody(page, SALON,
      `type=getItemsByFilter&page=${p}&category_id%5B%5D=${type}&archive=0&default_category=0`, SALON_HEADERS);
    if (!j || j.status !== 1 || !Array.isArray(j.items)) throw new Error(`salon list for category ${type} failed`);
    items.push(...j.items);
    if (!j.hasMore) break;
    await sleep(300);
  }
  return items;
}

// returns a list of problems; an empty list means every makeup item is available here without buying anything
async function checkMakeup(page, wanted, current) {
  const wearing = new Set(current.map(entryKey));
  const cache = {};
  const problems = [];
  for (const d of wanted) {
    if (wearing.has(entryKey(d))) continue;          // already wearing exactly this, so it is owned
    if (!cache[d.type]) { cache[d.type] = await salonItems(page, d.type); await sleep(300); }
    const it = cache[d.type].find(x => Number(x.type) === d.type && Number(x.num) === d.num);
    if (!it) problems.push(`type ${d.type} item ${d.num} is not in the salon list`);
    else if (Number(it.unlocked) !== 1) problems.push(`type ${d.type} item ${d.num} is not owned`);
    // colour check only for items with a real choice of colours (body and nose have a single entry in their list)
    else if (Array.isArray(it.colors) && it.colors.length > 1 && !it.colors.map(Number).includes(d.color)) {
      problems.push(`type ${d.type} item ${d.num} colour ${d.color} is not available`);
    }
  }
  return problems;
}

// itemId -> { colour -> row id } for everything this account owns in one category
async function ownedRows(page, cat) {
  const re = /\$\('#item-(\d+)'\)\.data\('item',\s*(\{[^\n]*?\})\);/g;
  const map = {};
  for (let p = 1; p <= MAX_WARDROBE_PAGES; p++) {
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

// returns a success summary string, or null when it is not a clean success
async function dressFromBoard(page, clock) {
  if (clock.ladyId === MAIN_LADY_ID) { log('⏭️ This is the main account. Nothing to copy; it keeps whatever you dressed it in.'); return '✅ Outfit follower: main account, nothing to copy.'; }
  if (!process.env.BOARD_URL || !process.env.BOARD_PASSWORD) { log('⚠️ BOARD_URL / BOARD_PASSWORD are not set. Staying in the default outfit.'); return null; }
  if (!clock.date) { log('⚠️ Could not read today\'s game date. Staying in the default outfit.'); return null; }

  const rec = await boardRead();
  if (!rec) { log('ℹ️ The board is empty. Staying in the default outfit.'); return null; }
  log(`📋 Board record: game date ${rec.gameDate}, saved ${rec.savedAt}, dress up: ${rec.dressUp}`);
  if (rec.gameDate !== clock.date) { log(`ℹ️ The record is for ${rec.gameDate}, today is ${clock.date}. Too old, staying in the default outfit.`); return null; }
  if (!rec.dressUp) { log(`ℹ️ The record says no dress up (${rec.reason}). Staying in the default outfit.`); return null; }

  const look = (rec.look || []).slice().sort((a, b) => b.layer - a.layer);
  if (look.length === 0) { log('ℹ️ The record has no worn items. Staying in the default outfit.'); return null; }

  // does this account own every piece? (event items are checked like any other piece)
  const cats = [...new Set(look.map(l => l.category))];
  const owned = {};
  for (const cat of cats) { owned[cat] = await ownedRows(page, cat); await sleep(400); }
  const rows = [], missing = [];
  for (const l of look) {
    const row = owned[l.category] && owned[l.category][l.itemId] && owned[l.category][l.itemId][l.colour];
    log(`👗 layer ${l.layer}: item ${l.itemId} colour ${l.colour} (${l.kind}) -> ${row ? 'owned, row ' + row : 'NOT OWNED'}`);
    if (row) rows.push({ id: row, layer: l.layer }); else missing.push(l);
  }
  if (missing.length) {
    log(`⏭️ Missing ${missing.length} piece(s). Staying in the default outfit: ${missing.map(m => `${m.itemId}/colour ${m.colour} (${m.kind})`).join(', ')}`);
    return null;   // no clothes change means no makeup change either
  }

  const mine = await readLook(page);
  if (!mine.appearance) { log('⚠️ Could not read this account\'s own makeup. Staying in the default outfit.'); return null; }
  const myEntries = appearanceEntries(mine.appearance);

  // ---- makeup: decide whether main's makeup can be copied (every item already available, nothing bought)
  let copyMakeup = false;
  let makeupNote;
  const wanted = Array.isArray(rec.appearance) ? rec.appearance.map(d => {
    const e = { type: Number(d.type), num: Number(d.num), color: Number(d.color) };
    if (d.size !== undefined && d.size !== null) e.size = Number(d.size);
    return e;
  }) : [];
  const makeupAlreadyOn = wanted.length > 0 && keysOf(wanted) === keysOf(myEntries);
  if (wanted.length === 0) {
    log('💄 The record has no makeup. Keeping this account\'s own makeup.');
    makeupNote = 'makeup kept (none published)';
  } else if (makeupAlreadyOn) {
    log('💄 The makeup is already main\'s.');
    makeupNote = 'makeup already main\'s';
  } else {
    let problems;
    try { problems = await checkMakeup(page, wanted, myEntries); }
    catch (e) { problems = [`could not check the salon (${e.message})`]; }
    if (problems.length) {
      log(`💄 Makeup not copied, keeping its own. Problems: ${problems.join('; ')}`);
      makeupNote = `makeup kept (${problems.join('; ')})`;
    } else {
      copyMakeup = true;
      log(`💄 Every makeup item is available (${wanted.length} entries). Main's makeup will be copied through the salon.`);
      makeupNote = 'makeup copied';
    }
  }

  // ---- 1) clothes (the game's look save ignores makeup changes, so this keeps the account's own makeup)
  const items = rows.map((r, i) => `items%5B${i}%5D%5Bid%5D=${r.id}&items%5B${i}%5D%5Boffset%5D=${r.layer}`).join('&');
  const body = `action=saveChanges&selectedPet=&${items}&${makeupBody(myEntries)}`;
  if (DRY_RUN) { log(`🧪 DRY RUN: the account owns every piece. Would save the clothes now, then: ${makeupNote}. Nothing changed.`); return null; }

  const r = await postBody(page, '/ajax/wardrobe/lady.php', body);
  const noChange = r && r.status === 0 && /no changes made/i.test(String(r.message || ''));
  if (noChange) log('ℹ️ The game says "No changes made", so the clothes are already on.');
  else if (!r || r.status !== 1) throw new Error(`saveChanges failed: ${JSON.stringify(r).slice(0, 300)}`);

  // ---- 2) makeup, through the beauty salon save
  if (copyMakeup) {
    await sleep(800);
    const s = await postBody(page, SALON, `type=save&${makeupBody(wanted)}`, SALON_HEADERS);
    if (!s || s.status !== 1) {
      log(`⚠️ The salon did not accept the makeup: ${JSON.stringify(s).slice(0, 300)}`);
      makeupNote = 'makeup kept (the salon save failed)';
      copyMakeup = false;
    } else {
      log('💄 Salon save accepted.');
    }
  }

  // ---- 3) read everything back and confirm
  const after = await readLook(page);
  const want = look.map(l => `${l.itemId}:${l.colour}`).sort().join(',');
  const got = after.worn.map(w => `${w.itemId}:${w.colour}`).sort().join(',');
  if (want !== got) {
    log(`⚠️ Look saved, but what is worn now differs from the record. Wanted ${want}, got ${got}.`);
    return null;
  }
  if (copyMakeup) {
    const gotMakeup = after.appearance ? keysOf(appearanceEntries(after.appearance)) : '';
    if (gotMakeup !== keysOf(wanted)) {
      log(`⚠️ Clothes are on, but the makeup differs from main's after the salon save. Wanted ${keysOf(wanted)}, got ${gotMakeup}.`);
      return null;
    }
  }
  log(`✅ Look saved and confirmed (${look.length} pieces), ${makeupNote}.`);
  return `✅ Outfit follower: ${noChange ? 'look already on' : 'look copied'} and confirmed (${look.length} pieces), ${makeupNote}.`;
}

// ---------------------------------------------------------------- entry point
module.exports = async function runOutfitFollower(page) {
  buf = [];
  try {
    log(DRY_RUN ? '👗 Outfit follower (DRY RUN)' : '👗 Outfit follower');
    const clock = await getClock(page);
    if (clock.seconds === null) { log('❌ Could not read the server time. Doing nothing; the look stays as it is.'); finish(null); return; }
    log(`🕒 Server time: ${pad(Math.floor(clock.seconds / 3600))}:${pad(Math.floor((clock.seconds % 3600) / 60))}`);
    let summary;
    if (clock.seconds >= EVENING_FROM_HOUR * 3600) {
      log('🌆 Evening phase (after noon, before midnight): looking for a look to copy.');
      summary = await dressFromBoard(page, clock);
    } else {
      log('🌅 Morning phase (after midnight, before noon): reverting to the default outfit.');
      summary = await revertToDefault(page);
    }
    finish(summary);
  } catch (e) {
    flush();            // show everything that happened before the error
    throw e;            // the launcher prints the ❌ line
  }
};
