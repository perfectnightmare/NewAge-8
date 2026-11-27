// ================================================================
// 🏅 STATS & ACHIEVEMENTS
// 1) Claim every achievement reward that is ready.
// 2) Spend all available Fashion Points (FP) on the 4 stats, keeping
//    them level: the lowest stat is always raised first, so all four
//    reach step N before any goes to N+1.
//
// Stats are read from the game each run, so nothing starts from step 1.
// Past the end of the cost list, every step costs 2000 FP.
// No diamonds are involved, no waits, one request at a time, no retries.
// ================================================================

const DUELS_URL = 'https://v3.g.ladypopular.com/duels.php';

const STAT_KEYS = ['style', 'creativity', 'devotion', 'beauty'];

// FP cost of each step (after the list ends, every step costs 2000)
const AMOUNTS = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13,
  14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46,
  49, 52, 55, 58, 61, 64, 67, 70, 73, 77, 81, 85, 89, 93, 97, 101, 105,
  109, 113, 117, 121, 125, 129, 134, 139, 144, 149, 155, 161, 167, 173, 179,
  187, 193, 199, 205, 211, 217, 223, 229, 236, 243, 250, 257, 264, 272, 280,
  288, 296, 304, 312, 321, 330, 339, 348, 357, 366, 375, 385, 395, 405, 415,
  425, 435, 445, 455, 465, 476, 487, 498, 509, 520, 532, 544, 556, 568, 581,
  594, 607, 620, 633, 646, 659, 672, 685, 698, 711, 724, 738, 752, 767, 782,
  797, 812, 827, 842, 858, 874, 890, 906, 922, 939, 956, 973, 990, 1007, 1024,
  1042, 1060, 1078, 1096, 1114, 1132, 1150, 1168, 1187, 1206, 1225, 1244, 1264,
  1284, 1304, 1324, 1346, 1368, 1390, 1412, 1434, 1456, 1478, 1500, 1522, 1544,
  1566, 1588, 1610, 1632, 1656, 1680, 1704, 1728, 1752, 1776, 1800, 1824, 1848,
  1874, 1900, 1926, 1952, 1978, 2000
];

module.exports = async function runStatsAndAchievements(page) {

  console.log('🏅 Stats & achievements starting...');

  // The requests below use paths like /ajax/train.php, so the page must be on the game site.
  await page.goto(DUELS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });


  // ==============================================================
  // PART 1: ACHIEVEMENTS (same logic as steps 74 and 75)
  // ==============================================================

  try {

    const popup = await page.evaluate(async () => {
      const res = await fetch('/ajax/quests.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: 'type=getAchievementsPopup&tab=main',
        credentials: 'include'
      });
      try { return await res.json(); } catch (e) { return null; }
    });

    if (!popup || popup.status !== 1 || !popup.html) {

      console.log('⚠️ Could not read the achievements list. Skipping achievements.');

    } else {

      const ready = await page.evaluate((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const out = [];
        doc.querySelectorAll('article.single-achievement').forEach(a => {
          if (a.classList.contains('dummy-achievement-tile') || !a.classList.contains('ready')) return;
          const btn = a.querySelector('.achievement-action-button');
          const m = btn && (btn.getAttribute('onclick') || '').match(/this,\s*(\d+)/);
          const h = a.querySelector('.headline');
          if (m) out.push({ id: m[1], headline: h ? h.textContent.trim() : '' });
        });
        return out;
      }, popup.html);

      console.log(`📋 Ready achievements: ${ready.length}`);

      for (const a of ready) {

        const json = await page.evaluate(async (id) => {
          const res = await fetch('/ajax/quests.php', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: `type=getReward&quest_id=${id}`,
            credentials: 'include'
          });
          try { return await res.json(); } catch (e) { return null; }
        }, a.id);

        if (json && json.won_reward && json.won_reward.status === 1) {
          console.log(`🎁 Achievement ${a.id} claimed | ${a.headline}`);
        } else {
          console.log(`⚠️ Achievement ${a.id} not claimed (skipping) | ${a.headline}`);
        }

      }

    }

  } catch (err) {

    console.log(`⚠️ Achievements part failed: ${err.message}. Going on to the stats.`);

  }


  // ==============================================================
  // PART 2: STATS (equalizer)
  // ==============================================================

  const result = await page.evaluate(async ({ amounts, keys }) => {

    const num = (t) => Number(String(t ?? '').replace(/,/g, '').trim());

    // ---- read current progress
    const res = await fetch('/ajax/main.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ type: 'getStatistics' }),
      credentials: 'include'
    });

    let data = null;
    try { data = await res.json(); } catch (e) { /* handled below */ }

    if (!data || data.status !== 1 || !data.statsHtml) {
      return { error: 'getStatistics failed' };
    }

    const doc = new DOMParser().parseFromString(data.statsHtml, 'text/html');

    let fp = num(doc.querySelector('.total-fp-amount-js')?.textContent);
    if (!Number.isFinite(fp)) fp = null;

    const idx = {};
    const notes = [];

    for (const key of keys) {

      const practiced = num(
        doc.querySelector(`.player-stat-${key} .income-fpoints`)
          ?.parentElement?.querySelector('.stat-vallue')?.textContent
      );
      const nextCost = num(doc.querySelector(`#practice-fp-${key}`)?.dataset?.fp);

      if (!Number.isFinite(practiced)) {
        return { error: `could not read the finished steps of ${key}` };
      }

      let i = practiced;

      // Cross-check with the cost the game shows, but only while the stat
      // is still inside the cost list (past it, every step costs 2000).
      if (i < amounts.length && Number.isFinite(nextCost) && amounts[i] !== nextCost) {
        const byCost = amounts.indexOf(nextCost);
        if (byCost !== -1) {
          notes.push(`${key}: finished steps ${practiced} do not match the cost ${nextCost}; using step ${byCost}`);
          i = byCost;
        }
      }

      idx[key] = i;
    }

    const start = { ...idx };
    let requests = 0;
    let stopReason = 'finished';

    // ---- equalizer: always raise the lowest stat (ties: fixed order)
    while (true) {

      let key = keys[0];
      for (const k of keys) if (idx[k] < idx[key]) key = k;

      const cost = amounts[idx[key]] ?? 2000;

      // the lowest stat is the cheapest, so if it cannot be afforded, none can
      if (fp !== null && fp < cost) { stopReason = `not enough FP (have ${fp}, next step costs ${cost})`; break; }

      let out = null;
      try {
        const r = await fetch('/ajax/train.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams({
            type: 'trainStats',
            popularityType: key,
            practiceType: 'fp',
            amount: cost
          }),
          credentials: 'include'
        });
        out = await r.json();
      } catch (e) {
        stopReason = `request failed (${key}, amount ${cost})`;
        break;
      }

      if (!out || out.status !== 1) {
        stopReason = `game refused ${key} at amount ${cost}`;
        break;
      }

      idx[key]++;
      requests++;
      if (fp !== null) fp -= cost;
    }

    return { start, end: idx, requests, fpLeft: fp, stopReason, notes };

  }, { amounts: AMOUNTS, keys: STAT_KEYS });

  if (result.error) {
    console.log(`❌ Stats part stopped: ${result.error}`);
    console.log('🏅 Stats & achievements finished.');
    return;
  }

  result.notes.forEach(n => console.log(`⚠️ ${n}`));

  console.log(
    '📊 Steps before: ' + STAT_KEYS.map(k => `${k} ${result.start[k]}`).join(' | ')
  );
  console.log(
    '📊 Steps after:  ' + STAT_KEYS.map(k => `${k} ${result.end[k]}`).join(' | ')
  );
  console.log(
    `💪 ${result.requests} training request(s) sent | FP left: ${result.fpLeft === null ? 'unknown' : result.fpLeft} | stopped: ${result.stopReason}`
  );

  console.log('🏅 Stats & achievements finished.');

};
