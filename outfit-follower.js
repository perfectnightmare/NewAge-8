// outfit-follower.js
// MORNING (server time before noon): every account switches to its own saved F1/F2/F3 outfit.
// EVENING (noon to midnight): follower accounts (never main) copy main's look from the board,
// only if the record is for today, says "dress up", and the account can complete the look.
// Per piece, in this order:
//   1) the account owns the exact colour -> use it
//   2) "Any colour" is ticked on the board -> wear the owned colour of that item that is closest to main's colour
//   3) "Minor" is ticked on the board -> skip the piece, dress the rest
//   4) otherwise the whole look is dropped (the account stays in its default outfit)
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

// ---------------------------------------------------------------- NEW: colour table (clothes colours 1-89, average RGB of the game's swatch)
const COLOUR_RGB = {
  1: [236,236,236], 2: [20,20,20], 3: [21,167,223], 4: [20,91,159], 5: [20,95,90], 6: [55,149,63], 7: [138,189,72],
  8: [235,225,20], 9: [129,51,216], 10: [229,122,174], 11: [199,22,105], 12: [153,29,32], 13: [221,44,49],
  14: [225,139,21], 15: [225,104,49], 16: [236,230,118], 17: [158,158,158], 18: [88,63,49], 19: [210,145,226],
  20: [149,186,217], 21: [149,217,152], 22: [115,99,87], 23: [222,197,168], 24: [83,93,128], 25: [121,70,32],
  26: [150,111,59], 27: [81,110,75], 28: [150,123,102], 29: [172,82,46], 30: [236,192,55], 31: [132,216,221],
  32: [233,220,170], 33: [236,177,202], 34: [167,198,118], 35: [198,119,119], 36: [180,131,196], 37: [193,199,209],
  38: [96,60,177], 39: [42,83,30], 40: [165,57,148], 41: [65,79,94], 42: [39,56,101], 43: [110,186,149],
  44: [147,60,49], 45: [78,33,33], 46: [111,20,39], 47: [207,152,58], 48: [242,190,176], 49: [191,20,67],
  50: [99,101,114], 51: [89,50,94], 52: [213,201,171], 53: [40,94,126], 54: [66,141,157], 55: [236,150,138],
  56: [229,47,126], 57: [40,209,21], 58: [232,109,233], 59: [157,225,192], 60: [212,236,50], 61: [33,221,230],
  62: [235,71,33], 63: [17,157,136], 64: [239,208,206], 65: [242,229,214], 66: [216,242,239], 67: [242,235,200],
  68: [22,158,185], 69: [224,136,153], 70: [145,79,84], 71: [232,148,95], 72: [123,198,184], 73: [222,215,138],
  74: [225,197,131], 75: [201,178,157], 76: [208,78,126], 77: [156,184,201], 78: [212,171,197], 79: [171,161,194],
  80: [33,53,21], 81: [110,123,9], 82: [108,97,60], 83: [121,144,152], 84: [90,50,56], 85: [144,95,77],
  86: [242,113,132], 87: [117,47,143], 88: [195,135,180], 89: [106,126,166]
};
// NEW: the game's colour families (palettes). Family 1 is black and white together, so it is never used as a guide.
const PALETTES = {
  1: [1, 2],
  6: [6, 59, 21, 43, 72, 63, 5, 27, 39, 57, 7, 34, 81, 80, 82],
  8: [8, 16, 30, 32, 60, 73, 67],
  13: [12, 13, 46, 45, 48, 55, 65],
  15: [14, 15, 71, 47, 62, 29, 44],
  17: [17, 41, 83, 50, 37],
  19: [19, 78, 88, 58, 36, 40, 87, 38, 9, 79, 51],
  56: [56, 49, 11, 76, 69, 10, 33, 86, 35, 70, 64],
  68: [68, 20, 3, 4, 53, 54, 61, 31, 77, 24, 42, 89, 66],
  85: [85, 28, 22, 84, 18, 25, 26, 75, 52, 74, 23]
};
const FAMILY_OF = {};
Object.keys(PALETTES).forEach(p => PALETTES[p].forEach(c => { FAMILY_OF[c] = Number(p); }));

// NEW: perceptual colour distance ("redmean"); unknown colours fall back to a huge number plus the id gap
function colourDistance(a, b) {
  const A = COLOUR_RGB[a], B = COLOUR_RGB[b];
  if (!A || !B) return 1e6 + Math.abs(a - b);
  const rm = (A[0] + B[0]) / 2;
  const dr = A[0] - B[0], dg = A[1] - B[1], db = A[2] - B[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

// NEW: from the colours the account owns, pick the one closest to the wanted colour.
// Same family first (except family 1, black/white, which is judged by RGB only), then everything owned. Ties go to the lower id.
function pickColour(wanted, ownedList) {
  if (!ownedList.length) return null;
  const fam = FAMILY_OF[wanted];
  let pool = ownedList, sameFamily = false;
  if (fam && fam !== 1) {
    const inFam = ownedList.filter(c => FAMILY_OF[c] === fam);
    if (inFam.length) { pool = inFam; sameFamily = true; }
  }
  let best = null;
  for (const c of pool) {
    const d = colourDistance(wanted, c);
    if (best === null || d < best.distance - 1e-9 || (Math.abs(d - best.distance) <= 1e-9 && c < best.colour)) {
      best = { colour: c, distance: d, sameFamily };
    }
  }
  return best;
}

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

  // CHANGED: per piece: exact colour -> closest owned colour (if "Any colour") -> skip (if "Minor") -> drop the look
  const rows = [], missing = [], swaps = [], skipped = [];
  for (const l of look) {
    const have = (owned[l.category] && owned[l.category][l.itemId]) || {};
    const exact = have[l.colour];
    if (exact) {
      rows.push({ id: exact, layer: l.layer, itemId: l.itemId, colour: l.colour });
      log(`👗 layer ${l.layer}: item ${l.itemId} colour ${l.colour} (${l.kind}) -> owned, row ${exact}`);
      continue;
    }
    let pick = null;
    if (l.anyColour === true) pick = pickColour(l.colour, Object.keys(have).map(Number));
    if (pick) {
      rows.push({ id: have[pick.colour], layer: l.layer, itemId: l.itemId, colour: pick.colour });
      swaps.push(`item ${l.itemId}: wanted ${l.colour}, wearing ${pick.colour}`);
      log(`🎨 layer ${l.layer}: item ${l.itemId} wanted colour ${l.colour}, wearing colour ${pick.colour} (${pick.sameFamily ? 'same family' : 'closest overall'}, distance ${Math.round(pick.distance)})`);
    } else if (l.minor === true) {
      skipped.push(`item ${l.itemId} (${l.kind})`);
      log(`⏭️ layer ${l.layer}: item ${l.itemId} colour ${l.colour} (${l.kind}) -> NOT OWNED, but it is a minor piece, skipping it`);
    } else {
      missing.push(l);
      log(`👗 layer ${l.layer}: item ${l.itemId} colour ${l.colour} (${l.kind}) -> NOT OWNED${l.anyColour === true ? ' (no other colour owned either)' : ''}`);
    }
  }
  if (missing.length) {
    log(`⏭️ Missing ${missing.length} piece(s). Staying in the default outfit: ${missing.map(m => `${m.itemId}/colour ${m.colour} (${m.kind})`).join(', ')}`);
    return null;   // no clothes change means no makeup change either
  }
  if (rows.length === 0) { log('⏭️ Every piece was skipped, so there is nothing to wear. Staying in the default outfit.'); return null; }

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
  // the original layer numbers are kept; a skipped minor piece just leaves a gap (the game accepts that)
  const items = rows.map((r, i) => `items%5B${i}%5D%5Bid%5D=${r.id}&items%5B${i}%5D%5Boffset%5D=${r.layer}`).join('&');
  const body = `action=saveChanges&selectedPet=&${items}&${makeupBody(myEntries)}`;
  if (DRY_RUN) { log(`🧪 DRY RUN: the look can be dressed (${rows.length} pieces, ${swaps.length} colour swap(s), ${skipped.length} minor piece(s) skipped). Would save the clothes now, then: ${makeupNote}. Nothing changed.`); return null; }

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

  // ---- 3) read everything back and confirm (CHANGED: compares against what was actually chosen)
  const after = await readLook(page);
  const want = rows.map(w => `${w.itemId}:${w.colour}`).sort().join(',');
  const got = after.worn.map(w => `${w.itemId}:${w.colour}`).sort().join(',');
  if (want !== got) {
    log(`⚠️ Look saved, but what is worn now differs from what was chosen. Wanted ${want}, got ${got}.`);
    return null;
  }
  if (copyMakeup) {
    const gotMakeup = after.appearance ? keysOf(appearanceEntries(after.appearance)) : '';
    if (gotMakeup !== keysOf(wanted)) {
      log(`⚠️ Clothes are on, but the makeup differs from main's after the salon save. Wanted ${keysOf(wanted)}, got ${gotMakeup}.`);
      return null;
    }
  }
  const extra = (swaps.length || skipped.length) ? `, ${swaps.length} colour swap(s), ${skipped.length} minor skipped` : '';
  log(`✅ Look saved and confirmed (${rows.length} pieces${extra}), ${makeupNote}.`);
  return `✅ Outfit follower: ${noChange ? 'look already on' : 'look copied'} and confirmed (${rows.length} pieces${extra}), ${makeupNote}.`;
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
