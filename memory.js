// ================================================================
// 🃏 MEMORY FLASHBACK: fully independent script
// Detect / activate (from YOUR list, free only) → use up free flips → free Start → Phase 1 and 2
// Every flip is a request (no clicks). Tile positions in the logs count from 1.
// Placeholder (decoration) tiles are read from the page and are NEVER flipped.
// ================================================================

const BASE = 'https://v3.g.ladypopular.com';
const GRAPHQL_URL = `${BASE}/api/graphql/index.php`;

// ---------------------------- SETTINGS ----------------------------
// ⭐ YOUR MEMORY PRIORITY LIST (best first). Events not on this list are NEVER activated.
const PRIORITY_EVENTS = [539, 558, 478, 472, 428, 447, 404, 394, 181, 462, 439, 412, 518, 526, 496, 454];
const MAX_PRIORITY_ATTEMPTS = 5;   // if activations are refused, try at most this many

const MIN_EMERALDS = 15;           // needs MORE than this to activate, to start playing and for every paid flip
const WAIT_LIMIT_SECONDS = 300;    // wait for the free Start only when it is this close (5 minutes)
const AFTER_START_WAIT_MS = 3000;  // time for the board to finish shuffling after Start
const REQUEST_TIMEOUT_MS = 60000;  // wait this long for every reply, never retry

class GracefulStop extends Error {}

// 🆓 "Is this activation free?"
// The game's is_free_activation flag does NOT mean "free to activate"
// (it was false on every event while the free slot was open).
// What the game really shows is activation_price:
//   - empty ([])        → free right now (the flashback slot is open)
//   - {"credits": 20}   → costs diamonds (the slot is taken)
// Anything else (null, missing, a price above 0) is NOT treated as free.
function isFreeActivation(e) {
  const p = e.activation_price;
  if (Array.isArray(p)) return p.length === 0;
  if (p && typeof p === 'object') {
    return ['credits', 'emeralds', 'dollars'].every(k => !(Number(p[k]) > 0));
  }
  return false;
}

// ---------------------------- REQUEST TEXTS ----------------------------
const STATS_QUERY = `query getLadyGlobalData {
  main {
    LadyStatsInfo {
      emeralds
      credits
      dollars
      fashion_points
    }
  }
}`;

const MEMORY_EVENT_DATA_QUERY = `query MemoryEventData($eventId: Int!) {
  memory(eventId: $eventId) {
    EventInfo {
      id
      reset_cooldown
      is_reset_allowed
      static_reset_cooldown
      has_played_event
      is_flashback
      can_be_played
      zone_info {
        id
        name
        is_boyfriend_zone
        board_width
        board_height
        free_open_square_count
        free_tries_left
        is_completed
        reset_price {
          credits
          emeralds
          dollars
        }
        open_square_price {
          credits
          emeralds
          dollars
        }
        map {
          value
          pending
          is_opened
        }
      }
    }
  }
}`;

const OPEN_SQUARE_MUTATION = `mutation EventMemoryOpenGridSquareMutation($eventId: Int, $zoneId: Int, $positionX: Int, $positionY: Int, $skipEvent: Boolean) {
  memory {
    OpenGridSquareMutation(
      eventId: $eventId
      zoneId: $zoneId
      positionX: $positionX
      positionY: $positionY
      skipEvent: $skipEvent
    ) {
      status
      message
      show_credits
      square_info {
        value
        pending
        is_opened
        x
        y
      }
      lady_stats {
        emeralds
        credits
        dollars
      }
      zone_info {
        id
        free_tries_left
        is_completed
        map {
          value
          pending
          is_opened
        }
      }
    }
  }
}`;

const RESET_BOARD_MUTATION = `mutation EventMemoryResetBoardMutation($eventId: Int, $zoneId: Int) {
  memory {
    ResetBoardMutation(eventId: $eventId, zoneId: $zoneId) {
      status
      message
      show_credits
      lady_stats {
        emeralds
        credits
        dollars
        fashion_points
      }
      reset_cooldown
      is_reset_allowed
      active_zone_id
      free_tries_left
    }
  }
}`;

module.exports = async function runMemoryActivation(page) {

  const log = (...a) => console.log(...a);
  const sleep = (ms) => page.waitForTimeout(ms);

  // ---------------------------- state ----------------------------
  let eventId, memoryUrl;
  let zoneId, rows, cols, map, freeTries;
  let emeralds = 0, credits = 0;
  let seen = {};          // tile index -> number it showed (this board only)
  let fake = new Set();   // placeholder (decoration) tiles of this board

  // ---------------------------- request helpers ----------------------------
  let cachedToken = null;
  async function getToken() {
    if (cachedToken) return cachedToken;
    cachedToken = await page.evaluate(() => {
      const keys = ['token', 'authToken', 'auth_token', 'jwt', 'access_token', 'accessToken'];
      for (const k of keys) {
        const v = localStorage.getItem(k);
        if (v && v.length > 10) return v;
      }
      return null;
    });
    return cachedToken;
  }

  // waits for the reply (up to the timeout) and never retries
  async function runGraphQL({ operationName, query, variables }) {
    const token = await getToken();
    return await page.evaluate(async ({ operationName, query, variables, token, url, timeoutMs }) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          signal: controller.signal,
          body: JSON.stringify({
            operationName, query, variables,
            extensions: { clientLibrary: { name: '@apollo/client', version: '4.0.5' } }
          })
        });
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    }, { operationName, query, variables, token, url: GRAPHQL_URL, timeoutMs: REQUEST_TIMEOUT_MS });
  }

  const num = (v, name) => {
    if (v === null || v === undefined) throw new Error(`${name} is missing in the game's reply.`);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} is not a number in the game's reply.`);
    return n;
  };

  async function getStats() {
    const res = await runGraphQL({ operationName: 'getLadyGlobalData', query: STATS_QUERY, variables: {} });
    if (res?.errors) throw new Error(`Stats request returned errors: ${JSON.stringify(res.errors)}`);
    const s = res?.data?.main?.LadyStatsInfo;
    if (!s) throw new Error('Could not read emeralds and diamonds.');
    return { emeralds: num(s.emeralds, 'emeralds'), credits: num(s.credits, 'diamonds') };
  }

  async function readState() {
    const res = await runGraphQL({ operationName: 'MemoryEventData', query: MEMORY_EVENT_DATA_QUERY, variables: { eventId } });
    if (res?.errors) throw new Error(`MemoryEventData returned errors: ${JSON.stringify(res.errors)}`);
    const info = res?.data?.memory?.EventInfo;
    if (!info) throw new Error('EventInfo is missing in the MemoryEventData reply.');
    const z = info.zone_info;
    return {
      info,
      cooldown: num(info.reset_cooldown, 'reset_cooldown'),
      allowed: info.is_reset_allowed === true,
      zone: z ? {
        id: num(z.id, 'zone id'),
        name: z.name,
        rows: num(z.board_height, 'board height'),
        cols: num(z.board_width, 'board width'),
        freeTries: num(z.free_tries_left, 'free flips left'),
        map: z.map,
        resetPrice: z.reset_price
      } : null
    };
  }

  // ---------------------------- board helpers ----------------------------
  function setBoardFrom(zone) {
    if (!Array.isArray(zone.map) || zone.map.length !== zone.rows ||
        zone.map.some(r => !Array.isArray(r) || r.length !== zone.cols)) {
      throw new Error(`Board data does not match its size (${zone.rows} x ${zone.cols}).`);
    }
    zoneId = zone.id; rows = zone.rows; cols = zone.cols; map = zone.map; freeTries = zone.freeTries;
    seen = {};
    fake = new Set();
  }

  const total = () => rows * cols;
  const allIndexes = () => Array.from({ length: total() }, (_, i) => i);
  const realIndexes = () => allIndexes().filter(i => !fake.has(i));   // the tiles that really exist
  const cellAt = (i) => map[Math.floor(i / cols)][i % cols];
  const isOpened = (i) => cellAt(i).is_opened === true;
  const describe = (i) => `row ${Math.floor(i / cols) + 1} col ${(i % cols) + 1}`;
  const boardText = () => allIndexes().map(i => {
    if (fake.has(i)) return '##';
    const v = cellAt(i).value;
    return (v === null || v === undefined) ? '__' : v;
  }).reduce((acc, t, i) => acc + (i % cols === 0 ? (i === 0 ? '' : ' | ') : ' ') + t, '');

  // Placeholder tiles are marked on the page from the very start (class memory-grid-item-fake).
  // The page lists tiles in reading order: top left, row by row.
  // If the page cannot be matched to the board, the run STOPS before any flip.
  async function markFakeFromPage() {
    try {
      await page.waitForSelector('.memory-grid-item', { timeout: 30000 });
    } catch (e) {
      throw new Error('The tiles did not show on the page, so the placeholder tiles cannot be found. Nothing was flipped.');
    }
    const flags = await page.$$eval('.memory-grid-item', els => els.map(el => el.classList.contains('memory-grid-item-fake')));
    if (flags.length !== total()) {
      throw new Error(`The page shows ${flags.length} tiles but the board is ${rows} x ${cols} (${total()}). Cannot match the placeholders, so nothing was flipped.`);
    }
    fake = new Set();
    flags.forEach((isFake, i) => { if (isFake) fake.add(i); });
    if (fake.size > 0) log(`🪧 Placeholder tile(s), never flipped: ${[...fake].map(describe).join(', ')}`);
    else log('ℹ️ No placeholder tiles on this board.');
  }

  // ONE flip (one request). Positions: X = row, Y = column, counted from 0.
  async function flip(i) {
    if (fake.has(i)) throw new Error(`Refusing to flip ${describe(i)}: it is a placeholder tile.`);
    if (freeTries <= 0 && !(emeralds > MIN_EMERALDS)) {
      throw new GracefulStop(`emeralds (${emeralds}) are not above ${MIN_EMERALDS}, so no paid flip is made.`);
    }

    const res = await runGraphQL({
      operationName: 'EventMemoryOpenGridSquareMutation',
      query: OPEN_SQUARE_MUTATION,
      variables: { eventId, zoneId, positionX: Math.floor(i / cols), positionY: i % cols, skipEvent: false }
    });
    if (res?.errors) throw new Error(`Flip returned errors: ${JSON.stringify(res.errors)}`);

    const m = res?.data?.memory?.OpenGridSquareMutation;
    if (!m || m.status !== 1) {
      throw new Error(`Flip failed. Status=${m?.status}, message=${m?.message}, show_credits=${m?.show_credits}`);
    }

    const z = m.zone_info;
    if (!z || Number(z.id) !== zoneId || !Array.isArray(z.map)) throw new Error('Unexpected zone data in the flip reply.');
    const value = num(m.square_info?.value, 'tile number');
    const newCredits = num(m.lady_stats?.credits, 'diamonds');
    if (newCredits < credits) throw new Error(`Diamonds went down during a flip (${credits} -> ${newCredits}). Stopping.`);

    map = z.map;
    freeTries = num(z.free_tries_left, 'free flips left');
    emeralds = num(m.lady_stats.emeralds, 'emeralds');
    credits = newCredits;

    if (seen[i] !== undefined && seen[i] !== value) {
      throw new Error(`${describe(i)} showed ${seen[i]} before and ${value} now. The board layout changed, so the run stops.`);
    }
    seen[i] = value;

    log(`🃏 ${describe(i)} -> ${value} | free flips left ${freeTries} | emeralds ${emeralds}`);
    return value;
  }

  // ---------------------------- STEP: use up the free flips at random ----------------------------
  async function useUpFreeFlips() {
    log(`🎲 Using up the free flips at random (${freeTries} left)...`);
    let guard = total() * 4;   // safety against an endless loop
    while (guard-- > 0) {
      const unopened = realIndexes().filter(i => !isOpened(i));
      if (unopened.length === 0) { log('ℹ️ No hidden tiles left on this board.'); break; }

      const hasPending = unopened.some(i => cellAt(i).pending === true);
      if (freeTries <= 0 && !hasPending) break;   // free flips are over (a half-flipped pair is finished first)

      const candidates = unopened.filter(i => cellAt(i).pending !== true);
      if (candidates.length === 0) break;
      await flip(candidates[Math.floor(Math.random() * candidates.length)]);
    }
  }

  // ---------------------------- STEP: free Start ----------------------------
  async function startNewBoard() {
    const ready = (st) => !!st.zone && st.allowed === true && st.cooldown === 0 && st.zone.freeTries === 0;
    const why = (st) => `reset allowed=${st.allowed}, cooldown=${st.cooldown}s, free flips left=${st.zone ? st.zone.freeTries : 'n/a'}`;

    let s = await readState();
    if (!ready(s)) {
      if (s.cooldown >= 1 && s.cooldown <= WAIT_LIMIT_SECONDS) {
        log(`⏳ Free Start in ${s.cooldown}s. Waiting ${s.cooldown + 1}s...`);
        await sleep((s.cooldown + 1) * 1000);
        s = await readState();
        if (!ready(s)) { await sleep(2000); s = await readState(); }
      } else if (s.cooldown > WAIT_LIMIT_SECONDS) {
        log(`⏭️ Free Start is ${s.cooldown}s away (more than ${WAIT_LIMIT_SECONDS}s). The next run will pick it up.`);
        return false;
      }
      if (!ready(s)) {
        log(`⏭️ The free Start is not available (${why(s)}). Ending the run.`);
        return false;
      }
    }

    const pre = await getStats();
    credits = pre.credits; emeralds = pre.emeralds;
    log(`▶️ Free Start is ready (${why(s)}). Pressing Start. (a paid Start would cost ${JSON.stringify(s.zone.resetPrice)})`);

    const res = await runGraphQL({
      operationName: 'EventMemoryResetBoardMutation',
      query: RESET_BOARD_MUTATION,
      variables: { eventId, zoneId: s.zone.id }
    });
    if (res?.errors) throw new Error(`Start returned errors: ${JSON.stringify(res.errors)}`);
    const m = res?.data?.memory?.ResetBoardMutation;
    if (!m || m.status !== 1) throw new Error(`Start failed. Status=${m?.status}, message=${m?.message}, show_credits=${m?.show_credits}`);

    const afterCredits = num(m.lady_stats?.credits, 'diamonds');
    if (afterCredits < pre.credits) throw new Error(`Start used diamonds (${pre.credits} -> ${afterCredits}). Stopping.`);
    emeralds = num(m.lady_stats.emeralds, 'emeralds');
    credits = afterCredits;
    log(`✅ New board started (zone ${m.active_zone_id}). Waiting ${AFTER_START_WAIT_MS / 1000}s for the shuffle, then reloading the page...`);

    await sleep(AFTER_START_WAIT_MS);
    await page.goto(memoryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const s2 = await readState();
    if (!s2.zone) throw new Error('No zone data after Start.');
    if (Number(m.active_zone_id) !== s2.zone.id) log(`⚠️ Start said zone ${m.active_zone_id}, the game now reports zone ${s2.zone.id}. Using ${s2.zone.id}.`);
    setBoardFrom(s2.zone);
    await markFakeFromPage();

    const dirty = realIndexes().some(i => cellAt(i).is_opened === true || cellAt(i).pending === true);
    if (dirty) throw new Error('The new board already has opened tiles. Stopping.');

    log(`🗺️ New board: ${rows} x ${cols}, ${realIndexes().length} real tiles, free flips ${freeTries}, emeralds ${emeralds} | tiles: ${boardText()}`);
    return true;
  }

  // ---------------------------- STEP: play the board (your Phase 1 and Phase 2) ----------------------------
  // Placeholders are not on this board at all: only real tiles are listed, in reading order.
  async function playBoard() {
    const allIdx = realIndexes();
    const N = allIdx.length;
    const clickedOnce = new Set();
    const matched = new Set();
    const known = {};

    const checkPair = (a, b) => {
      if (isOpened(a) && isOpened(b)) {
        matched.add(a); matched.add(b);
        log(`✅ MATCHED: ${describe(a)} & ${describe(b)}`);
      } else {
        log(`❌ Not a match: ${describe(a)} & ${describe(b)}`);
      }
    };

    log('🧠 Phase 1: discovering tile numbers...');
    while (clickedOnce.size < N) {
      const firstIndex = allIdx.find(i => !clickedOnce.has(i) && !matched.has(i));
      if (firstIndex === undefined) break;

      const firstId = await flip(firstIndex);
      clickedOnce.add(firstIndex);

      const knownMatch = (known[firstId] || []).find(i => i !== firstIndex && !matched.has(i));
      const secondIndex = knownMatch !== undefined
        ? knownMatch
        : allIdx.find(i => !clickedOnce.has(i) && !matched.has(i) && i !== firstIndex);
      if (secondIndex === undefined) continue;

      const secondId = await flip(secondIndex);
      clickedOnce.add(secondIndex);

      known[firstId] = [...(known[firstId] || []), firstIndex];
      known[secondId] = [...(known[secondId] || []), secondIndex];

      checkPair(firstIndex, secondIndex);
    }

    log('🧠 Phase 2: matching all known pairs...');
    for (const indices of Object.values(known)) {
      const unmatched = indices.filter(i => !matched.has(i));
      for (let i = 0; i < unmatched.length; i += 2) {
        const a = unmatched[i];
        const b = unmatched[i + 1];
        if (a === undefined || b === undefined || a === b) continue;
        await flip(a);
        await flip(b);
        checkPair(a, b);
      }
    }

    const opened = allIdx.filter(isOpened).length;
    const note = fake.size > 0 ? ` (${fake.size} placeholder tile skipped)` : '';
    if (opened === N) log(`🎉 Board finished: all ${N} real tiles are matched${note}.`);
    else log(`⚠️ Board not finished: ${opened}/${N} real tiles are matched${note}.`);
  }

  // ---------------------------- STEP: activate a whitelisted memory flashback (free only) ----------------------------
  async function activateFromList() {
    // read ALL pages of the memory event list
    const all = await page.evaluate(async () => {
      const out = [];
      let offset = 0;
      for (let i = 0; i < 30; i++) {
        const response = await fetch('https://v3.g.ladypopular.com/ajax/events.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams({
            'event_types[]': 'memory', 'ignore_won_rewards': 'false',
            type: 'loadMoreEvents', offset: String(offset), name: ''
          }),
          credentials: 'same-origin'
        });
        const j = await response.json();
        const list = (j.search_events && j.search_events.list) || [];
        list.forEach(e => out.push({
          id: e.id, title: e.title, is_flashback: e.is_flashback,
          can_be_activated: e.can_be_activated, is_free_activation: e.is_free_activation,
          activation_price: e.activation_price, lock_type_info: e.lock_type_info
        }));
        if (!(j.search_events && j.search_events.has_more) || !list.length) break;
        offset = j.search_events.offset;
        await new Promise(r => setTimeout(r, 500));
      }
      return out;
    });

    // only events that can be activated AND have no activation price (an empty price is how the game shows "free")
    const activatable = new Map();
    let flashbackCount = 0, canActivateCount = 0, emptyPriceCount = 0;
    for (const e of all) {
      if (e.is_flashback === true) flashbackCount++;
      if (e.can_be_activated === true) canActivateCount++;
      if (isFreeActivation(e)) emptyPriceCount++;
      if (e.is_flashback === true && e.can_be_activated === true && isFreeActivation(e)) {
        activatable.set(Number(e.id), e.title);
      }
    }

    const candidates = [];
    PRIORITY_EVENTS.forEach((id, index) => {
      if (activatable.has(id)) candidates.push({ id, title: activatable.get(id), order: index + 1 });
    });

    log(`🔎 Event flags: ${all.length} read | ${flashbackCount} flashbacks | ${canActivateCount} can_be_activated | ${emptyPriceCount} with no activation price`);
    log(`⭐ ${all.length} memory events read | ${activatable.size} free to activate | ${candidates.length} of them are on your list`);
    if (candidates.length === 0) {
      log('⏭️ None of the events on your list can be activated for free right now. Nothing to do.');
      return null;
    }

    // 💎 diamond guard (before): if the diamonds cannot be read, nothing is activated
    const diamondsBefore = (await getStats()).credits;
    log(`💎 Diamonds before activation: ${diamondsBefore}`);

    for (const cand of candidates.slice(0, MAX_PRIORITY_ATTEMPTS)) {
      log(`🎯 Activating memory event: ${cand.title} (ID ${cand.id}) | number ${cand.order} in your list`);
      const resp = await page.evaluate(async (id) => {
        const response = await fetch('https://v3.g.ladypopular.com/ajax/events.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams({ type: 'activateEvent', event_id: String(id) }),
          credentials: 'same-origin'
        });
        return await response.json();
      }, cand.id);

      if (resp?.status === 1) {
        log(`✅ Memory flashback activated: ${cand.title}`);

        // 💎 diamond guard (after)
        const diamondsAfter = (await getStats()).credits;
        if (diamondsAfter < diamondsBefore) {
          throw new Error(`Diamonds went down during activation (${diamondsBefore} -> ${diamondsAfter}). Stopping.`);
        }
        log(`💎 Diamonds after activation: ${diamondsAfter} (no change)`);

        return cand;
      }
      log(`❌ Activation refused. Status=${resp?.status}. Trying the next one, if any.`);
    }
    log('⏭️ No activation went through. Ending the run.');
    return null;
  }

  // ---------------------------- MAIN ----------------------------
  async function run() {
    await page.goto(`${BASE}/guild.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const memoryBanner = page.locator(
      '#header-events-container .header-event-banner.event-type-memory[data-is_flashback="1"]'
    ).first();
    const memoryActive = (await memoryBanner.count()) > 0;
    const anyFlashback = await page.locator(
      '#header-events-container .header-event-banner[data-is_flashback="1"]'
    ).count();

    // emerald check first, so a free activation is never wasted
    const stats = await getStats();
    emeralds = stats.emeralds; credits = stats.credits;
    const emeraldsAtStart = emeralds;
    log(`💎 Emeralds: ${emeralds} | diamonds: ${credits}`);
    if (!(emeralds > MIN_EMERALDS)) {
      log(`🚫 Emeralds are not above ${MIN_EMERALDS}. Exiting.`);
      return;
    }

    if (memoryActive) {
      // a memory flashback is already active: play it (even if it is not on your list)
      eventId = Number(await memoryBanner.getAttribute('data-id'));
      const title = (await memoryBanner.locator('.item-title').innerText()).trim();
      if (!Number.isFinite(eventId)) throw new Error('Memory banner found, but its event id could not be read.');
      log(`📌 [Memory FB] Memory flashback already active: ${title} (ID ${eventId})`);
    } else if (anyFlashback > 0) {
      // only one flashback can be active for free: activating now would cost diamonds
      log('⏭️ [Memory FB] Another flashback event (not memory) is active. Doing nothing, so no diamonds are spent.');
      return;
    } else {
      log('🔎 [Memory FB] No flashback is active. Looking for an event on your list...');
      const chosen = await activateFromList();
      if (!chosen) return;
      eventId = Number(chosen.id);
    }

    memoryUrl = `${BASE}/events/memory.php?event_id=${eventId}`;
    await page.goto(memoryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // read the current board and find its placeholder tiles BEFORE any flip
    const state = await readState();
    if (!state.zone) {
      log(`⚠️ No zone data for this event (has_played_event=${state.info.has_played_event}). Nothing was flipped. Please send me this log.`);
      return;
    }
    setBoardFrom(state.zone);
    await markFakeFromPage();
    const real = realIndexes();
    const openedNow = real.filter(isOpened).length;
    log(`🗺️ Current board: ${state.zone.name} (zone ${zoneId}), ${rows} x ${cols}, ${openedNow}/${real.length} real tiles opened, ` +
        `free flips ${freeTries}, reset allowed=${state.allowed}, cooldown ${state.cooldown}s`);

    // an unfinished board is not finished: its free flips are used up at random
    if (openedNow < real.length) await useUpFreeFlips();
    else log('ℹ️ The current board is already finished.');

    // free Start (waits when it is 5 minutes away or less)
    const started = await startNewBoard();
    if (!started) return;

    // play the new board with Phase 1 and Phase 2
    await playBoard();

    log(`🏁 [Memory FB] Finished. Emeralds: ${emeraldsAtStart} -> ${emeralds}.`);
  }

  try {
    await run();
  } catch (e) {
    if (e instanceof GracefulStop) {
      log(`⏹️ [Memory FB] Stopped: ${e.message}`);
      return;
    }
    throw e;
  }
};
