// ================================================================
// 🎁 BATTLE PASS CHEST COLLECTION (reads the game's own chest status)
// ================================================================
//
// Instead of sending ~100 blind claims, this script:
//   1. Reads the Fashion Season popup (current season) and claims only
//      the FREE chests that are ready.
//   2. Claims bonus chests (id 107) as many times as the game counts them.
//   3. If the game says a previous season has rewards waiting, reads the
//      previous-season list and claims only its ready FREE chests.
//
// Premium chests are never touched. Requests go one at a time, wait for
// each reply (60 s timeout), and are never retried. A claim that does not
// return status 1 stops that season. Diamonds are checked after EVERY claim
// and the script stops if they ever go down.
// ================================================================

const BASE = 'https://v3.g.ladypopular.com';
const GRAPHQL_URL = `${BASE}/api/graphql/index.php`;
const POPUP_URL = `${BASE}/ajax/battlepass/quests.php?type=getDailyQuestsPopup&page=welcome`;
const PREVIOUS_URL = `${BASE}/ajax/battlepass/quests.php?type=getPreviousSeasonChestsPopup`;
const CLAIM_URL = `${BASE}/ajax/battlepass/chest.php`;
const REQUEST_TIMEOUT_MS = 60000;

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

module.exports = async function runBattlePassChests(page) {

  console.log('🎁 Battle Pass chest collection starting...');

  // ==============================================================
  // helpers
  // ==============================================================

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

  // Diamonds (the game calls them "credits")
  async function readDiamonds() {
    const token = await getToken();
    const res = await page.evaluate(async ({ query, token, url, timeoutMs }) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          signal: controller.signal,
          body: JSON.stringify({
            operationName: 'getLadyGlobalData',
            query,
            variables: {},
            extensions: { clientLibrary: { name: '@apollo/client', version: '4.0.5' } }
          })
        });
        return await r.json();
      } finally {
        clearTimeout(timer);
      }
    }, { query: STATS_QUERY, token, url: GRAPHQL_URL, timeoutMs: REQUEST_TIMEOUT_MS });

    const n = Number(res?.data?.main?.LadyStatsInfo?.credits);
    if (res?.errors || !Number.isFinite(n)) {
      throw new Error('Could not read the diamond count, so nothing was claimed.');
    }
    return n;
  }

  // GET a JSON reply from the game
  async function getJson(url) {
    return await page.evaluate(async ({ url, timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          method: 'GET',
          headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'x-requested-with': 'XMLHttpRequest'
          },
          credentials: 'include',
          signal: controller.signal
        });
        return await r.json();
      } finally {
        clearTimeout(timer);
      }
    }, { url, timeoutMs: REQUEST_TIMEOUT_MS });
  }

  // POST one chest claim
  async function postClaim(chestId, season, css) {
    return await page.evaluate(async ({ url, chestId, season, css, timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest'
          },
          credentials: 'include',
          signal: controller.signal,
          body: new URLSearchParams({
            action: 'chestClaim',
            chest_id: String(chestId),
            previousSeason: String(season),
            chest_css_class: css
          }).toString()
        });
        return await r.json();
      } finally {
        clearTimeout(timer);
      }
    }, { url: CLAIM_URL, chestId, season, css, timeoutMs: REQUEST_TIMEOUT_MS });
  }

  // Read the current-season popup HTML with a real HTML parser.
  // Returns the ready free chests, the free bonus counter and the
  // number on the "previous season" button.
  async function parsePopup(html) {
    return await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const re = /claimSeasonChest\(this,\s*'(\d+)',\s*(\d+),\s*'([^']+)'\)/;

      const rows = [...doc.querySelectorAll('.seasons-wrapper ul.chests > li')];
      const ready = [];
      let numberedRows = 0;

      rows.forEach(li => {
        if (li.classList.contains('bonus-chest')) return;
        numberedRows++;
        if (!li.classList.contains('level-reached')) return;       // row not reached yet
        const right = li.querySelector('.right-col.reward-chest'); // free chest column
        if (!right || right.classList.contains('claimed')) return;
        const m = re.exec(right.getAttribute('onclick') || '');
        if (!m) return;
        ready.push({ id: m[1], season: Number(m[2]), css: m[3] });
      });

      // free bonus chest (r-2): the number is how many are waiting
      let bonus = null;
      const bonusLi = doc.querySelector('.seasons-wrapper ul.chests > li.bonus-chest');
      if (bonusLi) {
        const right = bonusLi.querySelector('.right-col');
        const m = re.exec((right && right.getAttribute('onclick')) || '');
        const txt = right && right.querySelector('.chest.r-2 .checked');
        const n = txt ? parseInt(txt.textContent.trim(), 10) : NaN;
        if (m && Number.isFinite(n)) bonus = { id: m[1], season: Number(m[2]), css: m[3], count: n };
      }

      // previous-season button counter
      let previousCount = 0;
      const ind = doc.querySelector('#previous-season-notify-counter .claim-rewards-indicator');
      if (ind) {
        const n = parseInt(ind.textContent.trim(), 10);
        if (Number.isFinite(n)) previousCount = n;
      }

      return { numberedRows, ready, bonus, previousCount };
    }, html);
  }

  // ==============================================================
  // claiming (one request at a time, diamond check after each)
  // ==============================================================

  let diamonds = null;
  let lastSeasonData = null;

  // returns true when the claim worked (status 1), false when the game refused
  async function claimOne(chest, season) {

    if (diamonds === null) {
      diamonds = await readDiamonds();
      console.log(`💎 Diamonds before claiming: ${diamonds}`);
    }

    const res = await postClaim(chest.id, season, chest.css);

    if (res?.status !== 1) {
      console.log(
        `⛔ ${chest.css} (ID ${chest.id}) - Season ${season} was not claimed ` +
        `(status ${res?.status}). Stopping this season.`
      );
      return false;
    }

    const after = Number(res?.lady_stats?.credits);
    if (!Number.isFinite(after)) {
      throw new Error('Claim reply did not include the diamond count. Stopping.');
    }
    if (after < diamonds) {
      throw new Error(`Diamonds went down during a claim (${diamonds} -> ${after}). Stopping.`);
    }
    diamonds = after;

    if (res?.lady_stats?.fashion_season_data?.season_chests_data) {
      lastSeasonData = res.lady_stats.fashion_season_data.season_chests_data;
    }

    console.log(`✅ Collected ${chest.css} (ID ${chest.id}) - Season ${season}`);
    return true;
  }

  async function claimList(list, season) {
    for (const chest of list) {
      const ok = await claimOne(chest, season);
      if (!ok) return false;
    }
    return true;
  }

  async function claimBonus(chest, count, season) {
    if (!chest || !(count > 0)) {
      console.log(`ℹ️ Season ${season}: no bonus chests waiting.`);
      return;
    }
    console.log(`🎁 Season ${season}: ${count} bonus chest(s) waiting.`);
    for (let i = 0; i < count; i++) {
      const ok = await claimOne(chest, season);
      if (!ok) return;
    }
  }

  // ==============================================================
  // STEP 1: open a game page
  // ==============================================================

  await page.goto(`${BASE}/guild.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // ==============================================================
  // STEP 2: current season
  // ==============================================================

  const popupRes = await getJson(POPUP_URL);

  if (popupRes?.status !== 1 || typeof popupRes.popup !== 'string') {
    console.log('❌ Could not read the Fashion Season popup. Nothing was claimed.');
    return;
  }

  const popup = await parsePopup(popupRes.popup);

  if (!popup.numberedRows) {
    console.log('❌ The chest list was not found in the popup. Nothing was claimed.');
    return;
  }

  console.log(
    `🔎 Season 0: ${popup.numberedRows} rows read | ${popup.ready.length} free chest(s) ready | ` +
    `previous-season badge: ${popup.previousCount}`
  );

  if (popup.ready.length > 0) {
    const ok = await claimList(popup.ready, 0);
    if (ok) await claimBonus(popup.bonus ? { id: popup.bonus.id, css: popup.bonus.css } : null,
                             popup.bonus ? popup.bonus.count : 0, 0);
  } else {
    await claimBonus(popup.bonus ? { id: popup.bonus.id, css: popup.bonus.css } : null,
                     popup.bonus ? popup.bonus.count : 0, 0);
  }

  // ==============================================================
  // STEP 3: previous season (only when the game says rewards wait)
  // ==============================================================

  if (!(popup.previousCount > 0)) {

    console.log('ℹ️ No previous-season rewards waiting. Skipping season 1.');

  } else {

    const prevRes = await getJson(PREVIOUS_URL);
    const data = prevRes?.season?.season_chests_data;

    if (prevRes?.status !== 1 || !data || !Array.isArray(data.free)) {
      console.log('❌ Could not read the previous-season chest list. Skipping season 1.');
    } else {

      const readyPrev = data.free
        .filter(c => c.status === 1 && !c.is_chest_repeatable)
        .map(c => ({ id: String(c.id), css: `c${c.level}-2` }));

      const repeatable = data.free.find(c => c.is_chest_repeatable);
      const repeatCount = Number(data.unclaimed_repeatable_count) || 0;

      console.log(
        `🔎 Season 1: ${readyPrev.length} free chest(s) ready | ` +
        `${repeatCount} bonus | total unclaimed (all types): ${data.total_unclaimed_count}`
      );

      if (readyPrev.length === 0 && repeatCount === 0) {
        console.log('ℹ️ Nothing free to claim in season 1 (the rest may be premium chests, which are never touched).');
      } else {
        const ok = readyPrev.length > 0 ? await claimList(readyPrev, 1) : true;
        if (ok) {
          await claimBonus(repeatable ? { id: String(repeatable.id), css: 'r-2' } : null, repeatCount, 1);
        }
      }
    }
  }

  // ==============================================================
  // STEP 4: final check (log only, no extra claims)
  // ==============================================================

  if (lastSeasonData) {
    const cur = lastSeasonData.current_season;
    const prev = lastSeasonData.previous_season;
    console.log(
      `📋 Still unclaimed after this run | current season: ${cur ? cur.total_unclaimed_count : '?'} ` +
      `| previous season: ${prev ? prev.total_unclaimed_count : '?'} (premium chests included)`
    );
  }

  console.log('🎁 Battle Pass chest collection finished.');

};
