// outfit-buyer.js
// EVENING only, followers only (never main). Buys what this account is missing, based on today's record on the board:
//  1) items from collections main owns from (live, or the flashback one)
//  2) mall items main is wearing (only when the record says "dress up")
// Unlocks the flashback collection ONLY if: no flashback collection is active here, the free slot is available, and ALLOW_UNLOCK=1.
// OUTFIT_DRY_RUN=1 logs what it WOULD do and changes nothing.

const BASE = 'https://v3.g.ladypopular.com';
const DRY_RUN = process.env.OUTFIT_DRY_RUN === '1';
const ALLOW_UNLOCK = process.env.ALLOW_UNLOCK === '1';
const MAIN_LADY_ID = String(process.env.MAIN_LADY_ID || '8859158');
const DIAMOND_CAP = Number(process.env.DIAMOND_CAP || 60);
const CUR = { 1: 'dollars', 2: 'emeralds', 3: 'diamonds' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const safe = (o) => JSON.stringify(o).replace(/\[/g, '⟦').replace(/\]/g, '⟧').slice(0, 400);

const FORM = {
  accept: '*/*', 'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'x-requested-with': 'XMLHttpRequest', referer: `${BASE}/mall/boutique.php`
};
const HTML = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9', referer: `${BASE}/welcome.php`
};

async function getText(page, path) {
  const res = await page.request.get(BASE + path, { headers: HTML });
  if (!res.ok()) throw new Error(`GET ${path} returned HTTP ${res.status()}`);
  return res.text();
}
async function postJson(page, path, body) {
  const res = await page.request.post(BASE + path, { headers: FORM, data: body });
  if (!res.ok()) throw new Error(`POST ${path} returned HTTP ${res.status()}`);
  const t = await res.text();
  try { return JSON.parse(t); } catch (e) { throw new Error(`${path} gave non-JSON: ${t.slice(0, 150)}`); }
}
function grab(text, marker, open, close) {
  const s = text.indexOf(marker); if (s === -1) return null;
  const b = text.indexOf(open, s); if (b === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = b; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return JSON.parse(text.slice(b, i + 1)); }
  }
  return null;
}

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

async function readHeader(page, html) {
  return page.evaluate((h) => {
    const doc = new DOMParser().parseFromString(h, 'text/html');
    const txt = (el, sel) => { const e = el.querySelector(sel); return e ? e.textContent.trim() : ''; };
    const tiles = [...doc.querySelectorAll('[data-entity_type="collection"]')].map(el => {
      const a = el.querySelector('a');
      return { id: Number(el.getAttribute('data-id')), flashback: el.getAttribute('data-is_flashback') === '1',
        name: txt(el, '.item-title'), href: a ? a.getAttribute('href') : null };
    });
    return { tiles, freeSlot: !!doc.querySelector('.choose-flashback-button-js[data-type="collection_types"]') };
  }, html);
}

async function readStats(page) {
  const j = grab(await getText(page, '/vip_shop.php?tab=dollars'), 'setLadyStats(', '{', '}');
  if (!j) throw new Error('account stats not found');
  return { dollars: Number(j.dollars), emeralds: Number(j.emeralds), diamonds: Number(j.credits), level: Number(j.level) };
}

// itemId -> Set of colours this account owns, for one wardrobe filter
async function ownedMap(page, filter) {
  const re = /\$\('#item-(\d+)'\)\.data\('item',\s*(\{[^\n]*?\})\);/g;
  const map = {};
  for (let p = 1; p <= 10; p++) {
    const j = await postJson(page, '/ajax/wardrobe.php',
      `wardrobetype=lady&archive=0&pet=0&${filter}&page=${p}&currentPageNum=${p}&updatePartials%5B%5D=10&updatePartials%5B%5D=3`);
    const html = j && j.partials && j.partials.partial3;
    if (!html) break;
    for (const m of html.matchAll(re)) {
      try {
        const it = JSON.parse(m[2]);
        (map[Number(it.id)] = map[Number(it.id)] || new Set());
        (it.colors || []).forEach(c => map[Number(it.id)].add(Number(c.color)));
      } catch (e) { /* skip */ }
    }
    if (!(j.options && j.options.hasMore)) break;
    await sleep(400);
  }
  return map;
}

async function cartCount(page) {
  const j = await postJson(page, '/ajax/mall/cart.php', 'action=loadMallContent');
  const m = String(j.cartContentData || '').match(/data-total="(\d+)"/);
  return m ? Number(m[1]) : 0;
}

async function buyBatch(page, adds, pageType, label) {
  if (!adds.length) return 0;
  if (DRY_RUN) {
    adds.forEach(a => console.log(`🧪 DRY RUN (${label}): would add item ${a.itemId} colour ${a.colour} (${a.price} ${CUR[a.currency]})`));
    return 0;
  }
  const before = await cartCount(page);
  if (before > 0) { console.log(`⚠️ The cart already holds ${before} item(s). Not touching it. Empty the cart in the game, then it will work again.`); return 0; }
  let added = 0, last = null;
  for (const a of adds) {
    const body = `action=addToCart&mallType=1&itemId=${a.itemId}&itemCategoryId=${a.category}&itemCollectionId=${a.collectionId}` +
      `&itemColor=${a.colour}&pageNum=${a.pageNum}&collectionsPage=${pageType}&orderBy=${a.orderBy || ''}&orderType=${a.orderType || ''}`;
    const j = await postJson(page, '/ajax/mall/cart.php', body);
    if (j && j.status === 1) { added++; last = j; console.log(`🛒 (${label}) added item ${a.itemId} colour ${a.colour} (${a.price} ${CUR[a.currency]})`); }
    else console.log(`⚠️ (${label}) could not add item ${a.itemId} colour ${a.colour}: ${safe(j)}`);
    await sleep(1500 + Math.floor(Math.random() * 1500));
  }
  if (!added) return 0;
  if (!last || Number(last.total_items_in_cart) !== added) {
    console.log(`⚠️ The cart total (${last && last.total_items_in_cart}) does not match what was added (${added}). Not checking out. Empty the cart in the game.`);
    return 0;
  }
  await postJson(page, '/ajax/mall/cart.php', 'action=loadMallContent');
  const r = await postJson(page, '/ajax/mall/cart.php', `action=checkoutCart&collectionsPage=${pageType}`);
  if (r && r.status === 1) {
    const s = r.lady_stats || {};
    console.log(`✅ (${label}) bought ${added} item(s). Left: ${s.dollars} dollars, ${s.emeralds} emeralds, ${s.credits} diamonds.`);
    return added;
  }
  console.log(`❌ (${label}) checkout failed: ${safe(r)}. The cart still holds the items; empty it in the game.`);
  return 0;
}

module.exports = async function runOutfitBuyer(page) {
  console.log(DRY_RUN ? '🛍️ Outfit buyer (DRY RUN)' : '🛍️ Outfit buyer');

  const html = await getText(page, '/wardrobe.php?wardrobetype=lady&archive=0&category_id%5B0%5D=9');
  const lm = html.match(/var LADY_ID = '(\d+)'/);
  const ladyId = lm ? lm[1] : null;
  const cm = html.match(/var currentTime = new Date\('([^']+)'\)/);
  if (!cm) { console.log('❌ Could not read the server clock. Doing nothing.'); return; }
  const d = new Date(cm[1]);
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  console.log(`🪪 Lady ID ${ladyId} | 🕒 Server ${today} ${pad(d.getHours())}:${pad(d.getMinutes())}`);

  if (ladyId === MAIN_LADY_ID) { console.log('⏭️ This is the main account. Nothing to buy.'); return; }
  if (d.getHours() < 12) { console.log('🌅 Morning phase. Buying only happens in the evening.'); return; }
  if (!process.env.BOARD_URL || !process.env.BOARD_PASSWORD) { console.log('⚠️ BOARD_URL / BOARD_PASSWORD are not set. Nothing to do.'); return; }

  const rec = await boardRead();
  if (!rec) { console.log('ℹ️ The board is empty.'); return; }
  console.log(`📋 Board record: game date ${rec.gameDate}, dress up: ${rec.dressUp}`);
  if (rec.gameDate !== today) { console.log(`ℹ️ The record is for ${rec.gameDate}, today is ${today}. Too old, buying nothing.`); return; }

  let { tiles, freeSlot } = await readHeader(page, html);
  const stats = await readStats(page);
  console.log(`💰 ${stats.dollars} dollars, ${stats.emeralds} emeralds, ${stats.diamonds} diamonds (diamond cap this run: ${DIAMOND_CAP}) | level ${stats.level}`);
  console.log(`🗂️ Active here: ${tiles.map(t => `${t.name} (${t.id}, ${t.flashback ? 'FLASHBACK' : 'LIVE'})`).join(' | ') || 'none'} | free flashback slot: ${freeSlot}`);
  const left = { 1: stats.dollars, 2: stats.emeralds, 3: Math.min(stats.diamonds, DIAMOND_CAP) };
  const afford = (a) => { if (a.price <= left[a.currency]) { left[a.currency] -= a.price; return true; }
    console.log(`⏭️ Cannot afford item ${a.itemId} colour ${a.colour} (${a.price} ${CUR[a.currency]}, ${left[a.currency]} left to spend). Skipped.`); return false; };

  // ---------------- collections
  for (const c of (rec.collections || [])) {
    if (!c.owned || c.owned.length === 0) { console.log(`📦 ${c.name}: main owns nothing from it. Skipping.`); continue; }
    let tile = tiles.find(t => t.id === c.id);
    if (!tile) {
      if (c.kind !== 'flashback') { console.log(`⏭️ ${c.name} (live) is not active on this account. Skipping.`); continue; }
      if (tiles.some(t => t.flashback)) { console.log(`⏭️ ${c.name}: another flashback collection is already active here. Not unlocking a second one.`); continue; }
      if (!freeSlot) { console.log(`⏭️ ${c.name}: no free flashback slot on this account. Not unlocking.`); continue; }
      if (!ALLOW_UNLOCK) { console.log(`⏭️ ${c.name}: would unlock it (free slot available), but unlocking is switched off (ALLOW_UNLOCK is not 1).`); continue; }
      if (DRY_RUN) { console.log(`🧪 DRY RUN: would unlock ${c.name} (${c.id}) now.`); continue; }
      const u = await postJson(page, '/ajax/mall/boutique.php', `action=unlockCollection&collectionId=${c.id}`);
      console.log(`🔓 Unlock reply: ${safe(u)}`);
      await sleep(3000);
      ({ tiles, freeSlot } = await readHeader(page, await getText(page, '/wardrobe.php?wardrobetype=lady&archive=0&category_id%5B0%5D=9')));
      tile = tiles.find(t => t.id === c.id);
      if (!tile) { console.log(`❌ ${c.name} is still not active after the unlock. Stopping here for this collection.`); continue; }
      console.log(`✅ ${c.name} is now active on this account.`);
    }

    const mine = await ownedMap(page, `empty_filter=false&default_category=false&store_id%5B%5D=${c.id}`);
    const o = grab(await getText(page, tile.href), 'setMallOptions(', '{', '}');
    if (!o) { console.log(`⚠️ ${c.name}: could not read the collection page.`); continue; }
    const byId = {};
    Object.entries(o.pagination.itemsOnPages || {}).forEach(([pg, arr]) => arr.forEach(i => { byId[i.id] = { ...i, pageNum: Number(pg) }; }));

    const adds = [];
    for (const r of c.owned) for (const colour of r.colours) {
      if (mine[r.itemId] && mine[r.itemId].has(colour)) continue;                 // already owned
      const it = byId[r.itemId];
      if (!it) { console.log(`⏭️ ${c.name}: item ${r.itemId} is not in this account's listing. Skipped.`); continue; }
      if (!(it.colors || []).map(Number).includes(colour)) { console.log(`⏭️ ${c.name}: item ${r.itemId} colour ${colour} is not available. Skipped.`); continue; }
      if (it.can_buy !== 1) { console.log(`⏭️ ${c.name}: item ${r.itemId} cannot be bought here. Skipped.`); continue; }
      const a = { itemId: it.id, category: it.type, collectionId: it.store_id, colour, pageNum: it.pageNum, price: it.price, currency: it.currency };
      if (afford(a)) adds.push(a);
    }
    console.log(`📦 ${c.name}: ${adds.length} item colour(s) to buy.`);
    await buyBatch(page, adds, 'limited', c.name);
    await sleep(1000);
  }

  // ---------------- mall pieces from the look
  if (!rec.dressUp) { console.log('ℹ️ The record says no dress up, so no mall pieces are needed.'); return; }
  const adds = [];
  for (const l of (rec.look || []).filter(x => x.kind === 'mall')) {
    const own = await ownedMap(page, `category_id%5B%5D=${l.category}`);
    if (own[l.itemId] && own[l.itemId].has(l.colour)) { console.log(`🛍️ Mall item ${l.itemId} colour ${l.colour}: already owned.`); continue; }
    const mo = grab(await getText(page, `/mall/mall.php?action=loadMallContent&mallType=1&nextLevelItems=false&categoryId=${l.category}`), 'setMallOptions(', '{', '}');
    let found = null;
    if (mo) for (const [pg, arr] of Object.entries(mo.pagination.itemsOnPages || {})) { const it = arr.find(x => x.id === l.itemId); if (it) { found = { ...it, pageNum: Number(pg) }; break; } }
    if (!found) { console.log(`⏭️ Mall item ${l.itemId}: not in this account's mall listing (maybe a higher level is needed). Skipped.`); continue; }
    if (found.min_level > stats.level || found.can_buy !== 1) { console.log(`⏭️ Mall item ${l.itemId}: needs level ${found.min_level} or cannot be bought (this account is level ${stats.level}). Skipped.`); continue; }
    if (!(found.colors || []).map(Number).includes(l.colour)) { console.log(`⏭️ Mall item ${l.itemId}: colour ${l.colour} is not available. Skipped.`); continue; }
    const a = { itemId: found.id, category: found.type, collectionId: found.store_id, colour: l.colour, pageNum: found.pageNum,
      price: found.price, currency: found.currency, orderBy: (mo.orderItems && mo.orderItems.by) || 'id', orderType: (mo.orderItems && mo.orderItems.type) || 'desc' };
    if (afford(a)) adds.push(a);
    await sleep(500);
  }
  console.log(`🛍️ Mall: ${adds.length} item(s) to buy.`);
  await buyBatch(page, adds, 'false', 'mall');
};
