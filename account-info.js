// account-info.js
// Read-only: collects account info and logs it to the console.

const BASE = 'https://v3.g.ladypopular.com';
const GRAPHQL_CONTEST_URL = 'https://ladygram.v3.g.ladypopular.com/graphql';
const DIVIDER = '────────────────────────────────────────';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

const decodeEntities = (s) => String(s ?? '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'");

// 2d 21h  |  5h 12m  |  40m
function formatTimeLeft(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'none';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Pull the {...} argument out of LadyHeader.setLadyStats({...}) by matching braces
// (more reliable than a regex because the JSON is large and nested).
function extractLadyStats(html) {
  const marker = html.indexOf('setLadyStats(');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  if (start === -1) return null;

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  return null;
}

// DOM fallbacks (regex on the raw HTML) in case the JSON is missing a value
const domById = (html, id) => {
  const m = html.match(new RegExp(`id="${id}"[^>]*>\\s*([\\d,]+)`));
  return m ? num(m[1]) : null;
};
const domFashionPoints = (html) => {
  const m = html.match(/data-fashion-points="([\d,]+)"/);
  return m ? num(m[1]) : null;
};
const domAchievements = (html) => {
  const m = html.match(
    /achievements-icon-wrapper[\s\S]*?claim-rewards-indicator">\s*(\d+)/
  );
  return m ? num(m[1]) : null;
};
const domLadyId = (html) => {
  const m = html.match(/var LADY_ID = '(\d+)'/);
  return m ? m[1] : null;
};
const domPlayerId = (html) => {
  const m = html.match(/var PLAYER_ID = '(\d+)'/);
  return m ? m[1] : null;
};

// Active FLASHBACK event and collection from the header banners.
// Live (non-flashback) events and collections are ignored.
async function readFlashbacks(page, html) {
  const raw = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const container = doc.querySelector('#header-events-container');
    if (!container) return { found: false };

    const read = (el) => {
      if (!el) return null;
      const title = (el.querySelector('.item-title')?.textContent || '').replace(/\s+/g, ' ').trim();
      const seconds = Number(el.querySelector('.item-timeleft')?.getAttribute('data-time-left'));
      const typeClass = [...el.classList].find(c => c.startsWith('event-type-'));
      return {
        title,
        type: typeClass ? typeClass.replace('event-type-', '') : null,
        seconds: Number.isFinite(seconds) ? seconds : null
      };
    };

    return {
      found: true,
      event: read(container.querySelector('.header-event-banner[data-is_flashback="1"]')),
      collection: read(container.querySelector('.header-collection-banner[data-is_flashback="1"]'))
    };
  }, html);

  if (!raw.found) {
    console.log('⚠️ Flashback banners: the header event list was not found on the page. Showing none.');
  }

  const ev = raw.event;
  const col = raw.collection;

  return {
    event: {
      name: ev ? `${decodeEntities(ev.title)}${ev.type ? ` (${ev.type})` : ''}` : 'none',
      timeLeft: ev ? formatTimeLeft(ev.seconds) : 'none'
    },
    collection: {
      name: col ? decodeEntities(col.title) : 'none',
      timeLeft: col ? formatTimeLeft(col.seconds) : 'none'
    }
  };
}

async function getVipShopInfo(page) {
  const res = await page.request.get(`${BASE}/vip_shop.php?tab=dollars`, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1',
      referer: `${BASE}/ranking/players.php`
    }
  });
  if (!res.ok()) throw new Error(`vip_shop.php returned HTTP ${res.status()}`);

  const html = await res.text();
  const j = extractLadyStats(html);
  if (!j) throw new Error('Could not find LadyHeader.setLadyStats({...}) in page (session expired?)');

  const season = j.fashion_season_data ?? {};
  const chests = season.season_chests_data ?? {};

  const flashback = await readFlashbacks(page, html);

  return {
    currencies: {
      dollars: num(j.dollars) ?? domById(html, 'player-dollars'),
      emeralds: num(j.emeralds) ?? domById(html, 'player-emeralds'),
      diamonds: num(j.credits) ?? domById(html, 'player-credits'),
      fashionPoints: num(j.fashion_points) ?? domFashionPoints(html),
      beautyPageantPasses: num(j.beauty_pageant_pass),
      level: num(j.level),
      totalExp: num(j.exp)
    },
    season: {
      achievementsWaiting: domAchievements(html),
      unclaimedChests: chests.seasons_total_unclaimed_count ?? null
    },
    identity: {
      ladyId: j.id ?? domLadyId(html),
      playerId: domPlayerId(html),
      name: j.name ?? null
    },
    flashback
  };
}

async function getStats(page) {
  const res = await page.request.post(`${BASE}/ajax/main.php`, {
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'x-requested-with': 'XMLHttpRequest',
      referer: `${BASE}/vip_shop.php?tab=dollars`
    },
    form: { type: 'getStatistics' }
  });
  if (!res.ok()) throw new Error(`getStatistics returned HTTP ${res.status()}`);

  const json = await res.json();
  if (json?.status !== 1 || !json.statsHtml) {
    throw new Error(`getStatistics failed: status=${json?.status}`);
  }

  // Parse statsHtml inside the browser with DOMParser
  return await page.evaluate((statsHtml) => {
    const doc = new DOMParser().parseFromString(statsHtml, 'text/html');
    const n = (t) => {
      const v = Number(String(t ?? '').replace(/,/g, '').trim());
      return Number.isFinite(v) ? v : 0;
    };

    // internal key -> display name
    const names = {
      style: 'Elegance',
      creativity: 'Creativity',
      devotion: 'Confidence',
      beauty: 'Grace',
      generosity: 'Kindness',
      loyalty: 'Loyalty'
    };

    const stats = {};
    for (const [key, label] of Object.entries(names)) {
      const card = doc.querySelector(`.player-stat-${key}`);
      const bonus = (href) => {
        const li = [...(card?.querySelectorAll('.stat-bottom li') ?? [])].find(
          (el) => el.querySelector(`a[href="${href}"]`)
        );
        return n(li?.querySelector('.stat-vallue')?.textContent);
      };

      stats[label] = {
        total: n(doc.querySelector(`#stat_${key}_all`)?.textContent),
        fromFP: n(card?.querySelector('.income-fpoints')?.parentElement
          ?.querySelector('.stat-vallue')?.textContent),
        fromBoyfriend: bonus('/myboy.php'),
        fromClub: bonus('/guild.php'),
        fromBoosters: n(card?.querySelector(`.stat-${key}-booster-value-js.stat-vallue`)
          ?.textContent),
        nextCostFP: n(doc.querySelector(`#practice-fp-${key}`)?.dataset?.fp) || null
      };
    }

    return {
      fpAvailable: n(doc.querySelector('.total-fp-amount-js')?.textContent),
      stats
    };
  }, json.statsHtml);
}

// Club page: club name + trophies.
// The page has no trophy names, only an ID and an effect text per trophy,
// so the effect text (without the shared "-10% popularity" line) is used as the name.
async function getGuildInfo(page) {
  const res = await page.request.get(`${BASE}/guild.php`, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1',
      referer: `${BASE}/welcome.php`
    }
  });
  if (!res.ok()) throw new Error(`guild.php returned HTTP ${res.status()}`);

  const html = await res.text();

  // Not in a club: no club name on the page. Not an error.
  const nameMatch = html.match(/<h2 id="guildName">([^<]*)<\/h2>/);
  if (!nameMatch) {
    return { id: null, name: null, trophyCount: 0, trophies: '', trophyIds: '' };
  }

  const idMatch = html.match(/showInfoPopup\((\d+)\)/);

  const trophies = [];
  const ids = [];
  const re = /<li class="trophy trophy-(\d+)[^"]*"\s+title="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const effect = decodeEntities(m[2])
      .split(/<br\s*\/?>/i)[0]        // drop the shared "-10% popularity" line
      .replace(/[\[\]]/g, '')          // GitHub masks [ ] in logs
      .trim();
    ids.push(m[1]);
    trophies.push(effect);
  }

  return {
    id: idMatch ? idMatch[1] : null,
    name: decodeEntities(nameMatch[1]).replace(/[\[\]]/g, '').trim(),
    trophyCount: trophies.length,
    trophies: trophies.join(' | '),   // string, not array: [ ] would be masked in logs
    trophyIds: ids.join(',')
  };
}

// Contest info (Fashion Arena and Beauty Pageant): points are the wins.
// The request needs the user id that is inside the login token, so the token is
// found in the browser storage and decoded there.
const CONTEST_QUERY =
  'query GetContest($id: Int!) { ' +
  'arenaContestInfo: userContestInfo(contest_type: "ARENA", user_id: $id) { points position league } ' +
  'pageantContestInfo: userContestInfo(contest_type: "BEAUTY_PAGEANT", user_id: $id) { points position league } ' +
  '}';

async function getContestInfo(page) {
  if (!page.url().startsWith(BASE)) {
    await page.goto(`${BASE}/guild.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  const out = await page.evaluate(async ({ query, url }) => {
    const decode = (jwt) => {
      try {
        let p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        while (p.length % 4) p += '=';
        return JSON.parse(atob(p));
      } catch (e) { return null; }
    };

    let token = null, userId = null;
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length && !token; i++) {
        let v = store.getItem(store.key(i)) || '';
        v = v.replace(/^"|"$/g, '').replace(/^Bearer\s+/i, '');
        if (!v.startsWith('eyJ')) continue;
        const payload = decode(v);
        if (payload && payload.user_id && (!payload.exp || payload.exp * 1000 > Date.now())) {
          token = v; userId = payload.user_id;
        }
      }
    }
    if (!token) return { error: 'no login token with a user id was found in the browser storage' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/graphql-response+json,application/json;q=0.9',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ operationName: 'GetContest', variables: { id: userId }, query })
      });
      const text = await res.text();
      try { return { json: JSON.parse(text), http: res.status }; }
      catch (e) { return { error: `non-JSON reply (HTTP ${res.status})` }; }
    } catch (e) {
      return { error: `request failed: ${e.message}` };
    } finally {
      clearTimeout(timer);
    }
  }, { query: CONTEST_QUERY, url: GRAPHQL_CONTEST_URL });

  if (out.error) throw new Error(out.error);

  const d = out.json?.data;
  if (out.json?.errors || !d?.arenaContestInfo || !d?.pageantContestInfo) {
    throw new Error(`contest reply had no data: ${JSON.stringify(out.json).slice(0, 200)}`);
  }

  const map = (c) => ({ wins: c.points, rank: c.position, league: c.league });
  return { arena: map(d.arenaContestInfo), pageant: map(d.pageantContestInfo) };
}

// The doll in her CURRENT outfit: one finished picture, linked from duels.php
// (lady.<ladyId>.<hash>.webp). In the page source the slashes are written as \/ .
// A failed read is only logged: it does not count as an error step.
async function getDollUrl(page, ladyId) {
  const res = await page.request.get(`${BASE}/duels.php`, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1',
      referer: `${BASE}/welcome.php`
    }
  });
  if (!res.ok()) throw new Error(`duels.php returned HTTP ${res.status()}`);

  const html = await res.text();
  const re = /https:\\?\/\\?\/photos\.static-ladypopular\.com\\?\/ldp3\\?\/photos\\?\/[A-Za-z0-9_-]+\\?\/lady\.(\d+)\.[A-Za-z0-9]+\.webp/g;

  let first = null;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[0].replace(/\\/g, '');
    if (ladyId && m[1] === String(ladyId)) return url;   // the one for this account
    if (!first) first = url;
  }
  return first;
}

module.exports = async function runAccountInfo(page) {
  console.log('📊 Collecting account info...');

  const payload = { collectedAt: new Date().toISOString() };
  const errors = [];

  // Step 1: VIP shop page (also reads the flashback banners)
  try {
    Object.assign(payload, await getVipShopInfo(page));
  } catch (err) {
    errors.push(`Step 1: ${err.message}`);
    console.log(`❌ Step 1 (VIP shop) failed: ${err.message}`);
  }

  // Step 2: stats popup
  try {
    payload.popularity = await getStats(page);
  } catch (err) {
    errors.push(`Step 2: ${err.message}`);
    console.log(`❌ Step 2 (stats) failed: ${err.message}`);
  }

  // Step 3: club page
  try {
    payload.guild = await getGuildInfo(page);
  } catch (err) {
    errors.push(`Step 3: ${err.message}`);
    console.log(`❌ Step 3 (club) failed: ${err.message}`);
  }

  // Step 4: contest info (wins, rank, league)
  try {
    payload.contest = await getContestInfo(page);
  } catch (err) {
    errors.push(`Step 4: ${err.message}`);
    console.log(`❌ Step 4 (contest) failed: ${err.message}`);
  }

  // Doll picture (NOT counted as an error step)
  try {
    const url = await getDollUrl(page, payload.identity?.ladyId);
    payload.dollUrl = url || '';
    if (!url) console.log('⚠️ Doll: no doll picture link was found on duels.php.');
  } catch (err) {
    payload.dollUrl = '';
    console.log(`⚠️ Doll: could not read it (${err.message}). The cell stays empty.`);
  }

  // ---------- Human-readable log ----------
  const { currencies: c, season: s, identity: id, popularity: p, guild: g, flashback: f, contest: k } = payload;

  console.log(DIVIDER);
  console.log('📋 ACCOUNT INFO');
  console.log(DIVIDER);

  if (id) {
    console.log(`🪪 Name: ${id.name} | Lady ID: ${id.ladyId} | Player ID: ${id.playerId}`);
  }
  if (c) {
    console.log(
      `💰 Dollars: ${c.dollars} | 💎 Diamonds: ${c.diamonds} | 🟢 Emeralds: ${c.emeralds}`
    );
    console.log(
      `⭐ Level: ${c.level} | Exp: ${c.totalExp} | 👗 FP: ${c.fashionPoints} | 👑 BP passes: ${c.beautyPageantPasses}`
    );
  }
  if (s) {
    console.log(`🏆 Achievements waiting: ${s.achievementsWaiting}`);
    console.log(`🎁 Unclaimed season chests: ${s.unclaimedChests}`);
  }
  if (p) {
    console.log(`📈 Stats (FP to spend: ${p.fpAvailable})`);
    for (const [label, v] of Object.entries(p.stats)) {
      console.log(
        `   ${label.padEnd(11)} ${String(v.total).padStart(4)}` +
        `  (FP ${v.fromFP}, BF ${v.fromBoyfriend}, Club ${v.fromClub}, Boost ${v.fromBoosters})`
      );
    }
  }
  if (g) {
    console.log(`🏰 Club: ${g.name ?? '(no club)'} (ID ${g.id ?? '-'}) | Trophies: ${g.trophyCount}`);
    if (g.trophies) console.log(`🏅 ${g.trophies}`);
  }
  if (f) {
    console.log(
      `🕰️ Flashback event: ${f.event.name} (${f.event.timeLeft}) | collection: ${f.collection.name} (${f.collection.timeLeft})`
    );
  }
  if (k) {
    console.log(
      `⚔️ Arena: ${k.arena.league}, rank ${k.arena.rank}, wins ${k.arena.wins} | ` +
      `👑 Pageant: ${k.pageant.league}, rank ${k.pageant.rank}, wins ${k.pageant.wins}`
    );
  }
  console.log(`🧍 Doll: ${payload.dollUrl || 'none'}`);

  // ---------- Machine-readable line (for the Google Sheet parser) ----------
  // errorCount is a plain number, so the line has no [ ] for GitHub to mask as ***
  payload.errorCount = errors.length;
  console.log(`LP_INFO_JSON ${JSON.stringify(payload)}`);
  console.log(DIVIDER);

  // Let the main script know this step failed if all parts broke
  if (errors.length === 4) {
    throw new Error(errors.join(' | '));
  }
};
