// ================================================================
// 🚀 TELEPORT FLASHBACK EVENT — FULL INTEGRATED SINGLE FLOW
// Activation (or detection) → Zone Detection → Zone Activation → Playing
// ================================================================

module.exports = async function runTeleport(page) {

  // ==============================================================
  // ⭐ MY FAVOURITES (this is the only block you need to edit)
  // ==============================================================
  //
  // PRIORITY_EVENTS : event ids in the order they should be activated.
  //                   The first one the game says can be activated wins.
  //                   If none can be activated, the normal order is used.
  //
  // FAVOURITE_ZONES : for an event id, the zone ids to play first, best
  //                   first. Finished zones are skipped automatically.
  //                   Works for any event listed here, priority or not.
  //                   When all favourite zones are done, the normal
  //                   final-reward ranking (below) takes over.
  // ==============================================================

  const PRIORITY_EVENTS = [
    534, 522, 553, 565, 336, 423, 277, 502, 456, 434, 327, 431, 486, 511, 314,
    230, 402, 266, 387, 244, 239, 340, 346, 363, 361, 376, 290, 284, 192, 95,
    173, 463, 474, 497, 353, 222
  ];

  const FAVOURITE_ZONES = {
    // ---- priority events
    534: [2218, 2215, 2214, 2216],
    522: [2145, 2146],
    553: [2329, 2328],
    565: [2396, 2397, 2395],
    336: [146, 145, 144, 148],
    423: [413, 414, 415, 412, 411],
    277: [512, 514, 513, 509],
    502: [2020, 2019, 2018],
    456: [640, 641, 639, 642],
    434: [116, 115, 118, 212, 119],
    327: [474, 476, 479, 478],
    431: [371, 373, 374],
    486: [1878, 1877, 1876, 1875],
    511: [2080, 2078, 2081],
    314: [491, 489, 488],
    230: [539, 537],
    402: [427, 424, 423],
    266: [521, 516, 519, 522],
    387: [434, 438, 436],
    244: [527, 525, 523, 524, 526],
    239: [531, 534, 535, 533],
    340: [469, 471],
    346: [464, 463],
    363: [448, 447, 446],
    361: [450, 449],
    376: [441, 439, 443, 444],
    290: [743, 740, 739, 741, 745, 742, 744],
    284: [747, 749],
    192: [1293, 1290],
    95:  [1938, 1936, 1937, 1935],
    173: [1271, 1269],
    463: [785, 787, 786],
    474: [1358, 1359, 1360],
    497: [1998, 2000, 1996],
    353: [452, 456, 453, 455, 458],
    222: [612, 613, 611, 609],

    // ---- not priority events, but with favourite zones when they get picked
    415: [421, 420, 419],
    397: [433, 429],
    201: [1299, 1298, 1297, 1296],
    319: [484],
    208: [1301, 1304, 1303],
    307: [495, 501, 498],
    155: [1255, 1256, 1254],
    301: [506, 505],
    296: [736, 735],
    164: [1266, 1265],
    216: [1307, 1309, 1311, 1312],
    543: [2270, 2269]
  };

  // If activating a priority event is refused, try at most this many before the normal order.
  const MAX_PRIORITY_ATTEMPTS = 5;


  // ==============================================================
  // 🔑 AUTH TOKEN HELPER (for GraphQL requests)
  // ==============================================================
  //
  // Your captured GraphQL request included an
  // "authorization: Bearer <token>" header.
  //
  // I don't know for certain where the site stores this token
  // client-side. This helper tries common localStorage key names.
  //
  // If the GraphQL calls below fail (401/403, or an "errors"
  // field in the JSON), open DevTools → Application → Local
  // Storage on the teleport page and tell me the real key name.
  // ==============================================================

  async function getAuthToken() {
    return await page.evaluate(() => {
      const candidateKeys = [
        'token',
        'authToken',
        'auth_token',
        'jwt',
        'access_token',
        'accessToken'
      ];

      for (const key of candidateKeys) {
        const val = localStorage.getItem(key);
        if (val && val.length > 10) {
          return val;
        }
      }

      return null;
    });
  }


  // ==============================================================
  // 🧬 GENERIC GRAPHQL REQUEST HELPER
  // ==============================================================

  async function runGraphQL({ operationName, query, variables }) {

    const token = await getAuthToken();

    return await page.evaluate(
      async ({ operationName, query, variables, token }) => {

        const headers = {
          'Content-Type': 'application/json',
        };

        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(
          'https://v3.g.ladypopular.com/api/graphql/index.php',
          {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify({
              operationName,
              query,
              variables,
              extensions: {
                clientLibrary: {
                  name: '@apollo/client',
                  version: '4.0.5'
                }
              }
            })
          }
        );

        return await res.json();

      },
      { operationName, query, variables, token }
    );
  }


  // ==============================================================
  // 📜 GRAPHQL QUERY / MUTATION STRINGS (copied from your capture)
  // ==============================================================

  const TELEPORT_EVENT_INFO_QUERY = `query Teleport($eventId: Int!) {
  teleport {
    EventInfo(eventId: $eventId) {
      id
      title
      icon
      type
      total_rewards_count {
        ...EventsTotalRewardsCount
        __typename
      }
      timeleft
      next_free_game_time
      is_event_completed
      active_zone_id
      final_rewards {
        event_final {
          ...EventsRewards
          __typename
        }
        __typename
      }
      zone_info {
        id
        name
        map {
          flag
          pending
          is_opened
          __typename
        }
        unlock_after_completed_zones_count
        zone_active_until_time
        zone_active_time_cooldown
        open_square_info {
          emerald_tries_amount
          max_emerald_tries_amount
          timeleft_until_next_try
          open_square_price_emeralds
          open_square_price_credits
          __typename
        }
        background_id
        __typename
      }
      zones_info {
        id
        name
        is_boyfriend_zone
        is_locked
        is_completed
        is_active
        unlock_after_completed_zones_count
        rewards {
          final {
            ...EventsRewards
            __typename
          }
          regular {
            ...EventsRewards
            __typename
          }
          event_final {
            ...EventsRewards
            __typename
          }
          __typename
        }
        total_rewards_count {
          ...EventsTotalRewardsCount
          __typename
        }
        background_id
        __typename
      }
      price_enter_zone {
        emeralds
        credits
        dollars
        __typename
      }
      is_tutorial_flashback
      is_flashback
      is_favourite
      can_be_deactivated
      can_be_activated
      can_be_played
      activation_duration
      activation_price {
        credits
        emeralds
        dollars
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment EventsRewards on EventRewards {
  color
  colors
  default_color
  fashion_points
  html_image
  html_indexes
  num
  modelref
  remove_body_parts_flag
  flags
  id
  name
  amount
  item_type
  owned_amount
  thumb
  tooltip
  energy_type
  type
  price
  currency
  status
  total_amount
  zone_id
  reward_type
  type_name
  item_pack_reward_type
  __typename
}

fragment EventsTotalRewardsCount on EventRewardsTotalCount {
  id
  total
  owned
  __typename
}`;


  const ENTER_ZONE_MUTATION = `mutation EventTeleportEnterZone($eventId: Int, $zoneId: Int) {
  teleport {
    EnterZoneMutation(eventId: $eventId, zoneId: $zoneId) {
      status
      message
      show_credits
      next_free_game_time
      lady_stats {
        emeralds
        credits
        dollars
        fashion_points
        __typename
      }
      zone_info {
        id
        name
        map {
          flag
          pending
          is_opened
          __typename
        }
        unlock_after_completed_zones_count
        zone_active_until_time
        zone_active_time_cooldown
        open_square_info {
          emerald_tries_amount
          max_emerald_tries_amount
          timeleft_until_next_try
          open_square_price_emeralds
          open_square_price_credits
          __typename
        }
        background_id
        __typename
      }
      notifications {
        vip_gift_to_claim
        __typename
      }
      __typename
    }
    __typename
  }
}`;


  // Opens one grid cell (copied from your click capture, trimmed to the fields we use).
  const OPEN_GRID_BOX_MUTATION = `mutation EventTeleportOpenGridBox($eventId: Int, $zoneId: Int, $positionX: Int, $positionY: Int) {
  teleport {
    OpenGridBoxMutation(
      eventId: $eventId
      zoneId: $zoneId
      positionX: $positionX
      positionY: $positionY
    ) {
      status
      message
      lady_stats {
        emeralds
        credits
      }
      zone_info {
        id
        map {
          flag
          pending
          is_opened
        }
        open_square_info {
          emerald_tries_amount
        }
        is_completed
      }
    }
  }
}`;


  // ==============================================================
  // 🎮 STEP 5 PLAY LOGIC
  // Your solver, unchanged, now fed by the game's own grid data and
  // clicking through requests instead of real mouse clicks.
  // ==============================================================

  async function playTeleportGame(teleportUrl) {

    console.log("🌐 Navigating to teleport event page...");
    await page.goto(teleportUrl, { waitUntil: 'domcontentloaded' });

    const emeraldText = await page.textContent('#player-emeralds');
    const emeralds = parseInt(emeraldText.replace(/\D/g, ''), 10);
    console.log('💎 Emeralds:', emeralds);
    if (emeralds < 3) {
      console.log('➡️ Not enough emeralds. Exiting teleport script.');
      return;
    }

    // ---- read the current zone state from the game
    const stateResponse = await runGraphQL({
      operationName: 'Teleport',
      query: TELEPORT_EVENT_INFO_QUERY,
      variables: { eventId }
    });
    const zoneInfo = stateResponse?.data?.teleport?.EventInfo?.zone_info;
    if (stateResponse?.errors || !zoneInfo || !Array.isArray(zoneInfo.map)) {
      throw new Error('Could not read the zone state from the game.');
    }

    const zoneId = zoneInfo.id;
    let currentMap = zoneInfo.map;
    let tries = Number(zoneInfo.open_square_info?.emerald_tries_amount);
    if (!Number.isFinite(tries)) throw new Error('Could not read the number of tries.');

    console.log('🎲 Initial tries:', tries);
    if (tries === 0) {
      console.log('➡️ No tries available. Exiting teleport script.');
      return;
    }

    // ---- translate the game's grid into your own cell types
    // game flag: 4 untouched | 2 hint | 1 reward | 0 empty | 3 block (miss)
    const FLAG_TYPE = { 4: 'untouched', 2: 'hint', 1: 'reward', 0: 'empty', 3: 'block' };

    const mapToGrid = (map) => {
      if (map.length !== 10 || map.some(row => row.length !== 10)) {
        throw new Error('Unexpected grid size (expected 10 x 10).');
      }
      const cells = [];
      map.forEach((row, i) => row.forEach((cell, j) => {
        const t = FLAG_TYPE[cell.flag];
        if (!t) throw new Error(`Unknown cell flag ${cell.flag} at row ${i + 1}, column ${j + 1}.`);
        cells.push({ idx: i * 10 + j + 1, type: t });
      }));
      return cells;
    };

    // ---- click one cell with a request ([row, col] counted from 1, like your code)
    const openCell = async ([r, c]) => {
      const res = await runGraphQL({
        operationName: 'EventTeleportOpenGridBox',
        query: OPEN_GRID_BOX_MUTATION,
        variables: { eventId, zoneId, positionX: r - 1, positionY: c - 1 }
      });

      if (res?.errors) {
        throw new Error(`Open cell returned errors: ${JSON.stringify(res.errors)}`);
      }

      const m = res?.data?.teleport?.OpenGridBoxMutation;
      if (!m || m.status !== 1) {
        throw new Error(`Open cell failed. Status=${m?.status}, message=${m?.message}`);
      }

      currentMap = m.zone_info.map;
      tries = Number(m.zone_info.open_square_info.emerald_tries_amount);
      if (!Number.isFinite(tries)) throw new Error('Could not read the number of tries after the click.');

      if (m.zone_info.is_completed) {
        console.log('🏆 Zone completed.');
        tries = 0;
      }
    };

    const getIndex = (r, c) => (r - 1) * 10 + c;
    const getCoords = idx => [Math.floor((idx - 1) / 10) + 1, ((idx - 1) % 10) + 1];
    const getNeighbors = (r, c) => {
      const n = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 1 && rr <= 10 && cc >= 1 && cc <= 10) n.push([rr, cc]);
        }
      }
      return n;
    };
    const key = ([r, c]) => `${r},${c}`;
    const randomPick = arr => arr[Math.floor(Math.random() * arr.length)];

    while (tries > 0) {
      const grid = mapToGrid(currentMap);

      const sets = { block: [], reward: [], empty: [], hint: [], untouched: [] };
      grid.forEach(c => {
        const [r, c0] = getCoords(c.idx);
        sets[c.type].push([r, c0]);
      });

      const toMap = arr => new Set(arr.map(key));
      const blockSet = toMap(sets.block);
      const rewardSet = toMap(sets.reward);
      const emptySet = toMap(sets.empty);
      const hintSet = toMap(sets.hint);
      const untouchedSet = toMap(sets.untouched);

      const bigBlock = new Set();
      blockSet.forEach(k => {
        const [r, c0] = k.split(',').map(Number);
        getNeighbors(r, c0).forEach(nn => bigBlock.add(key(nn)));
      });
      blockSet.forEach(b => bigBlock.add(b));
      rewardSet.forEach(r0 => bigBlock.delete(r0));
      emptySet.forEach(e0 => bigBlock.delete(e0));

      const sacrificialHint = new Set([...hintSet].filter(h => bigBlock.has(h)));
      const laggingHint = new Set([...hintSet].filter(h => !bigBlock.has(h)));
      const qualifiedUntouch = new Set([...untouchedSet].filter(u => !bigBlock.has(u)));
      const highProb = new Set([...laggingHint, ...qualifiedUntouch]);

      const totalCheck = bigBlock.size + rewardSet.size + emptySet.size + laggingHint.size + qualifiedUntouch.size;
      const altCheck = bigBlock.size + rewardSet.size + emptySet.size + highProb.size;
      console.log('🧪 Grid validation:', totalCheck === 100, altCheck === 100);

      let clicked = false;

      // Phase 0: until a blocked cell is found, probe the four standard cells
      if (blockSet.size === 0) {
        const probeCells = [[2, 2], [2, 9], [9, 2], [9, 9]]
          .filter(p => untouchedSet.has(key(p)) || hintSet.has(key(p)));
        if (probeCells.length > 0) {
          const tk = randomPick(probeCells);
          console.log('🔎 Phase 0 probe click:', tk);
          await openCell(tk);
          clicked = true;
        }
      }

      // Phase I: Hint-driven click
      const hintArr = [...hintSet];
      if (!clicked && hintArr.length > 0) {
        let minMark = Infinity, hingeList = [];
        hintArr.forEach(hk => {
          const [hr, hc] = hk.split(',').map(Number);
          const marks = getNeighbors(hr, hc).filter(nk => highProb.has(key(nk))).length;
          if (marks <= minMark) {
            if (marks < minMark) hingeList = [];
            minMark = marks;
            hingeList.push({ cell: hk, marks });
          }
        });

        if (minMark <= 3 && hingeList.length) {
          const sac = hingeList.filter(h => sacrificialHint.has(h.cell));
          const chosenH = randomPick(sac.length ? sac : hingeList);
          const [hr, hc] = chosenH.cell.split(',').map(Number);
          const targetNeighbors = getNeighbors(hr, hc).filter(nk => highProb.has(key(nk)));

          if (targetNeighbors.length) {
            let clickTarget;
            if (targetNeighbors.length === 1) {
              clickTarget = targetNeighbors[0];
            } else {
              if (!sacrificialHint.has(chosenH.cell)) {
                const others = targetNeighbors.filter(t => key(t) !== chosenH.cell);
                clickTarget = others.length ? randomPick(others) : randomPick(targetNeighbors);
              } else {
                clickTarget = randomPick(targetNeighbors);
              }
            }

            console.log('🎯 Phase I click:', clickTarget);
            await openCell(clickTarget);
            clicked = true;
          }
        }
      }

      // Phase II: Strategy fallbacks
      if (!clicked && tries > 0) {
        const priority = [[2, 2], [2, 9], [9, 2], [9, 9]];
        const candidates = priority.filter(p => highProb.has(key(p)));
        if (candidates.length >= 1) {
          const tk = randomPick(candidates);
          console.log('🎯 Priority click:', tk);
          await openCell(tk);
          clicked = true;
        }
      }

      if (!clicked && tries > 0) {
        const candidateHP = [...highProb];
        let best = [], bestCount = -1;
        candidateHP.forEach(hk => {
          const [hr, hc] = hk.split(',').map(Number);
          const overlap = getNeighbors(hr, hc).filter(nk => bigBlock.has(key(nk))).length;
          if (overlap > bestCount) { bestCount = overlap; best = [hk]; }
          else if (overlap === bestCount) best.push(hk);
        });
        if (bestCount > 0) {
          const tk = randomPick(best).split(',').map(Number);
          console.log('🎯 Overlap-bigblock click:', tk);
          await openCell(tk);
          clicked = true;
        }
      }

      if (!clicked && tries > 0) {
        const candidateHP = [...highProb];
        let best = [], bestCount = -1;
        candidateHP.forEach(hk => {
          const [hr, hc] = hk.split(',').map(Number);
          const overlap = getNeighbors(hr, hc).filter(nk => laggingHint.has(key(nk))).length;
          if (overlap > bestCount) { bestCount = overlap; best = [hk]; }
          else if (overlap === bestCount) best.push(hk);
        });
        if (bestCount > 0) {
          const tk = randomPick(best).split(',').map(Number);
          console.log('🎯 Overlap-lagging click:', tk);
          await openCell(tk);
          clicked = true;
        }
      }

      if (!clicked && tries > 0) {
        const candidates = [...highProb];
        if (candidates.length === 0) {
          console.log('⚠️ No clickable cell left. Stopping.');
          break;
        }
        const tk = randomPick(candidates).split(',').map(Number);
        console.log('🎯 Fallback click:', tk);
        await openCell(tk);
      }

      console.log('➡️ Remaining tries:', tries);
    }

    console.log('🎉 All done — no tries left.');
  }


  // ==============================================================
  // OPEN GUILD PAGE
  // CHECK WHETHER A FLASHBACK EVENT IS ALREADY ACTIVE
  // ==============================================================

  try {

    await page.goto(
      'https://v3.g.ladypopular.com/guild.php',
      {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }
    );

  } catch (error) {

    console.log(`❌ Guild page failed to load: ${error.message}`);

    throw error;

  }


  // ==============================================================
  // DETECT CURRENTLY ACTIVE FLASHBACK EVENT
  //   - a TELEPORT flashback banner  → play it
  //   - a flashback of another type  → do nothing (only one flashback
  //     can be active for free, so activating now would cost diamonds)
  //   - no flashback at all          → activate one (free only)
  // ==============================================================

  const activeFlashbackElement = page.locator(
    '#header-events-container .header-event-banner.event-type-teleport[data-is_flashback="1"]'
  ).first();

  const activeFlashbackEvents = await activeFlashbackElement.count();

  const anyFlashbackCount = await page.locator(
    '#header-events-container .header-event-banner[data-is_flashback="1"]'
  ).count();


  // --------------------------------------------------------------
  // 🔴 THIS IS THE SHARED VARIABLE.
  //
  // Whichever branch runs below (CASE 1 or CASE 2), it will
  // populate this single variable with the event id. Steps 1–5
  // further down use THIS variable — there is only one copy of
  // Steps 1–5 in the whole file, executed once, linearly.
  // --------------------------------------------------------------

  let eventId;


  // --------------------------------------------------------------
  // CASE 1
  // A TELEPORT flashback event is already active.
  // --------------------------------------------------------------

  if (activeFlashbackEvents > 0) {

    const activeFlashbackId = await activeFlashbackElement.getAttribute(
      'data-id'
    );

    const activeFlashbackTitle = await activeFlashbackElement.locator(
      '.item-title'
    ).innerText();


    // Store the currently active flashback event.
    const activeFlashbackEvent = {
      id: activeFlashbackId,
      title: activeFlashbackTitle.trim()
    };


    console.log('🚀 Teleport flashback event already active.');

    console.log(
      `📌 Active flashback: ${activeFlashbackEvent.title} (ID ${activeFlashbackEvent.id})`
    );

    console.log('🚀 Skipping Teleport activation. Feeding event ID into Steps 1–5.');

    eventId = Number(activeFlashbackEvent.id);

  } else if (anyFlashbackCount > 0) {


    // --------------------------------------------------------------
    // CASE 1b
    // A flashback of ANOTHER type is active. Activating a teleport
    // flashback now would cost diamonds, so do nothing.
    // --------------------------------------------------------------

    console.log(
      '⏭️ Another flashback event (not teleport) is active. Teleport does nothing, so no diamonds are spent.'
    );

    return;

  } else {


    // --------------------------------------------------------------
    // CASE 2
    // No flashback event is active.
    // Continue to Teleport event request.
    // --------------------------------------------------------------


    // ==============================================================
    // GET TELEPORT FLASHBACK EVENTS
    // ==============================================================

    let eventsResponse;


    try {

      eventsResponse = await page.evaluate(async () => {

        const response = await fetch(
          'https://v3.g.ladypopular.com/ajax/events.php',
          {
            method: 'POST',

            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest'
            },

            body: new URLSearchParams({
              'event_types[]': 'teleport',
              'ignore_won_rewards': 'false',
              type: 'loadMoreEvents',
              offset: '0',
              name: ''
            }),

            credentials: 'same-origin'
          }
        );

        return await response.json();

      });


      console.log(
        `🚀 Teleport events loaded. Server status=${eventsResponse?.status}`
      );


    } catch (error) {

      console.log(`❌ Teleport events request failed: ${error.message}`);

      throw error;

    }


    // --------------------------------------------------------------
    // Make sure the response has the structure we expect.
    // --------------------------------------------------------------

    if (!eventsResponse) {

      console.log('❌ Teleport events response was empty.');

      throw new Error(
        'Empty response received from events.php.'
      );

    }


    if (eventsResponse.status !== 1) {

      console.log(
        `❌ Teleport events request returned status=${eventsResponse.status}`
      );

      throw new Error(
        `Teleport flashback event request failed with status ${eventsResponse.status}.`
      );

    }


    // --------------------------------------------------------------
    // Get event list.
    // --------------------------------------------------------------

    const events = eventsResponse.search_events?.list;


    if (!Array.isArray(events)) {

      console.log('❌ Teleport event list missing or invalid.');

      throw new Error(
        'Unexpected events response structure: search_events.list is missing.'
      );

    }


    // ==============================================================
    // FILTER TELEPORT FLASHBACK EVENTS (first page, normal order)
    // Only events that can be activated AND are a FREE activation.
    // ==============================================================

    const unlockedEvents = [];
    const lockedEvents = [];


    for (const event of events) {

      if (event.is_flashback !== true) {

        continue;

      }


      if (event.can_be_activated === true && event.is_free_activation === true) {

        unlockedEvents.push({
          id: event.id,
          title: event.title
        });

      } else {

        lockedEvents.push({
          id: event.id,
          title: event.title,
          lockReason: event.lock_type_info
        });

      }

    }


    console.log(
      `🚀 Teleport flashbacks found: ${events.length} total | ${unlockedEvents.length} free to activate`
    );


    // ==============================================================
    // ⭐ PRIORITY EVENTS
    // The game lists only a few events per request, so read ALL pages
    // and find which of your priority events can be activated now.
    // If anything goes wrong here, the normal order is used.
    // ==============================================================

    const priorityCandidates = [];

    if (PRIORITY_EVENTS.length > 0) {

      try {

        const allEvents = await page.evaluate(async () => {

          const out = [];
          let offset = 0;

          for (let i = 0; i < 30; i++) {

            const response = await fetch(
              'https://v3.g.ladypopular.com/ajax/events.php',
              {
                method: 'POST',

                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'X-Requested-With': 'XMLHttpRequest'
                },

                body: new URLSearchParams({
                  'event_types[]': 'teleport',
                  'ignore_won_rewards': 'false',
                  type: 'loadMoreEvents',
                  offset: String(offset),
                  name: ''
                }),

                credentials: 'same-origin'
              }
            );

            const j = await response.json();
            const list = (j.search_events && j.search_events.list) || [];

            list.forEach(e => out.push({
              id: e.id,
              title: e.title,
              is_flashback: e.is_flashback,
              can_be_activated: e.can_be_activated,
              is_free_activation: e.is_free_activation
            }));

            if (!(j.search_events && j.search_events.has_more) || !list.length) {
              break;
            }

            offset = j.search_events.offset;

            await new Promise(r => setTimeout(r, 500));

          }

          return out;

        });


        const activatable = new Map();

        for (const e of allEvents) {

          if (e.is_flashback === true && e.can_be_activated === true && e.is_free_activation === true) {

            activatable.set(Number(e.id), e.title);

          }

        }


        PRIORITY_EVENTS.forEach((id, index) => {

          if (activatable.has(id)) {

            priorityCandidates.push({
              id,
              title: activatable.get(id),
              order: index + 1
            });

          }

        });


        console.log(
          `⭐ Full event list: ${allEvents.length} teleport events read | ` +
          `${activatable.size} can be activated for free | ` +
          `${priorityCandidates.length} of them are priority events`
        );

      } catch (error) {

        console.log(
          `⚠️ Could not read the full event list (${error.message}). Using the normal order.`
        );

      }

    }


    // --------------------------------------------------------------
    // If there is nothing to activate at all, stop.
    // --------------------------------------------------------------

    if (unlockedEvents.length === 0 && priorityCandidates.length === 0) {

      console.log('🚀 No free-to-activate Teleport flashback events. Skipping.');

      return;

    }


    // ==============================================================
    // BUILD THE LIST OF EVENTS TO TRY, IN ORDER
    //   1) priority events that can be activated (best first)
    //   2) the first unlocked event of the normal order (fallback)
    // ==============================================================

    const candidates = [];

    priorityCandidates.slice(0, MAX_PRIORITY_ATTEMPTS).forEach(c => {
      candidates.push({
        id: c.id,
        title: c.title,
        why: `priority event, number ${c.order} in your list`
      });
    });

    if (
      unlockedEvents.length > 0 &&
      !candidates.some(c => Number(c.id) === Number(unlockedEvents[0].id))
    ) {

      candidates.push({
        id: unlockedEvents[0].id,
        title: unlockedEvents[0].title,
        why: 'first unlocked event (normal order)'
      });

    }


    // ==============================================================
    // ACTIVATE EVENT (tries the candidates one by one)
    // ==============================================================

    let selectedEvent = null;
    let lastStatus;


    for (const cand of candidates) {

      console.log(
        `🎯 Activating Teleport event: ${cand.title} (ID ${cand.id}) | reason: ${cand.why}`
      );


      let activationResponse;


      try {

        activationResponse = await page.evaluate(async (id) => {

          const response = await fetch(
            'https://v3.g.ladypopular.com/ajax/events.php',
            {
              method: 'POST',

              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
              },

              body: new URLSearchParams({
                type: 'activateEvent',
                event_id: String(id)
              }),

              credentials: 'same-origin'
            }
          );

          return await response.json();

        }, cand.id);


      } catch (error) {

        console.log(`❌ Teleport event activation request failed: ${error.message}`);

        throw error;

      }


      if (activationResponse?.status === 1) {

        console.log(
          `✅ Teleport flashback activated: ${cand.title}`
        );

        selectedEvent = cand;

        break;

      }


      lastStatus = activationResponse?.status;

      console.log(
        `❌ Teleport event activation failed. Status=${lastStatus}. Trying the next one, if any.`
      );

    }


    if (!selectedEvent) {

      throw new Error(
        `Failed to activate any Teleport event. Last server status: ${lastStatus}`
      );

    }


    // Feed the newly activated event's ID into the shared variable.
    eventId = Number(selectedEvent.id);

  }


  // ================================================================
  // 🔁 STEPS 1–5 — SINGLE, SHARED, RUNS EXACTLY ONCE
  // ================================================================
  //
  // At this point, `eventId` has been populated by whichever
  // branch ran above (CASE 1 or CASE 2). Everything from here
  // down is ONE linear continuation of the same function —
  // not a separate callable block, not invoked twice.
  // ================================================================


  // ----------------------------------------------------------------
  // STEP 1 — Go to event URL
  // ----------------------------------------------------------------

  const teleportUrl = `https://v3.g.ladypopular.com/events/teleport.php?event_id=${eventId}`;

  console.log(`🌐 [Step 1] Navigating to event URL: ${teleportUrl}`);

  await page.goto(teleportUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });


  // ----------------------------------------------------------------
  // STEP 2 — Get zone list data via GraphQL
  // ----------------------------------------------------------------

  console.log('📡 [Step 2] Requesting Teleport EventInfo via GraphQL...');

  let infoResponse;

  try {

    infoResponse = await runGraphQL({
      operationName: 'Teleport',
      query: TELEPORT_EVENT_INFO_QUERY,
      variables: { eventId }
    });

  } catch (error) {

    console.log(`❌ [Step 2] GraphQL request failed: ${error.message}`);
    throw error;

  }


  if (infoResponse?.errors) {

    console.log(
      `❌ [Step 2] GraphQL returned errors: ${JSON.stringify(infoResponse.errors)}`
    );

    throw new Error('GraphQL EventInfo request returned errors.');

  }


  const eventInfo = infoResponse?.data?.teleport?.EventInfo;

  if (!eventInfo) {

    console.log('❌ [Step 2] EventInfo missing from GraphQL response.');
    throw new Error('EventInfo missing from GraphQL response.');

  }


  // ----------------------------------------------------------------
  // STEP 3 — Activity determination
  // ----------------------------------------------------------------

  // ---------- CASE 1 of Step 3: a zone is already active ----------

  if (eventInfo.active_zone_id !== null && eventInfo.active_zone_id !== undefined) {

    console.log(
      `✅ [Step 3] Zone already active (ID ${eventInfo.active_zone_id}). Skipping ahead to Step 5.`
    );

    await playTeleportGame(teleportUrl);

    console.log('🏁 Teleport flow finished.');

    return;

  }


  console.log('🔎 [Step 3] No zone currently active. Checking activation type...');


  // ---------- Subcase 2.1 of Step 3: paid activation ----------

  if (eventInfo.next_free_game_time && eventInfo.next_free_game_time !== 0) {

    console.log(
      `💰 [Step 3.1] Zone activation is currently PAID (next free at ${eventInfo.next_free_game_time}). Stopping here.`
    );

    return;

  }


  // ---------- Subcase 2.2 of Step 3: free activation ----------

  console.log('🆓 [Step 3.2] Zone activation is FREE. Gathering uncompleted zones...');

  const zonesInfo = eventInfo.zones_info;

  if (!Array.isArray(zonesInfo)) {

    console.log('❌ [Step 3.2] zones_info missing or invalid.');
    throw new Error('zones_info missing or invalid in EventInfo response.');

  }

  // Priority order of final reward types (best first). Anything not listed ranks last.
  const FINAL_PRIORITY = [
    'clothes',               // 1) any clothing item
    'appearance',            // 2) lady appearance
    'pet',                   // 3)
    'car',                   // 4)
    'background',            // 5)
    'boyfriend_clothes',     // 6)
    'boyfriend_appearance'   // 7)
  ];

  // Favourite zones of this event (if any), best first
  const favOrder = (FAVOURITE_ZONES[eventId] || []).map(Number);

  const uncompletedZones = zonesInfo
    .filter(z => z.is_completed === false)
    .map(z => {
      const f = z.rewards && z.rewards.final;
      const finals = Array.isArray(f) ? f : (f ? [f] : []);

      // best (lowest) rank among this zone's final rewards
      let rank = FINAL_PRIORITY.length;
      let finalType = 'none';
      for (const x of finals) {
        const r = FINAL_PRIORITY.indexOf(x && x.type);
        if (r !== -1 && r < rank) { rank = r; finalType = x.type; }
      }

      // position in your favourite list for this event (-1 = not a favourite zone)
      const favIndex = favOrder.indexOf(Number(z.id));

      return { id: z.id, name: z.name, rank, finalType, favIndex };
    });

  console.log(
    `🗺️ [Step 3.2] Found ${uncompletedZones.length} uncompleted zone(s): ` +
    uncompletedZones.map(z => `${z.name} (${z.id})`).join(', ')
  );

  if (uncompletedZones.length === 0) {

    console.log('✅ [Step 3.2] No uncompleted zones left. Nothing to activate.');
    return;

  }


  // ----------------------------------------------------------------
  // STEP 4 — Activate the best uncompleted zone
  //   1) your favourite zones for this event, best first
  //   2) otherwise the best final-reward rank, ties by game order
  //   3) otherwise the first zone
  // ----------------------------------------------------------------

  const favZones = uncompletedZones.filter(z => z.favIndex !== -1);

  let chosenZone;

  if (favZones.length > 0) {

    chosenZone = favZones.reduce(
      (best, z) => (z.favIndex < best.favIndex ? z : best),
      favZones[0]
    );

    console.log(
      `⭐ [Step 4] Favourite zone picked (position ${chosenZone.favIndex + 1} in your list for this event, ` +
      `${favZones.length} favourite zone(s) left).`
    );

  } else {

    // lowest rank wins; ties keep the game's list order (so the first zone is the fallback)
    chosenZone = uncompletedZones.reduce(
      (best, z) => (z.rank < best.rank ? z : best),
      uncompletedZones[0]
    );

    console.log(`📊 [Step 4] Chosen zone's final reward type: ${chosenZone.finalType} (rank ${chosenZone.rank + 1})`);

  }

  console.log(
    `🎯 [Step 4] Activating zone: ${chosenZone.name} (ID ${chosenZone.id})`
  );

  let enterResponse;

  try {

    enterResponse = await runGraphQL({
      operationName: 'EventTeleportEnterZone',
      query: ENTER_ZONE_MUTATION,
      variables: { eventId, zoneId: chosenZone.id }
    });

  } catch (error) {

    console.log(`❌ [Step 4] Zone activation request failed: ${error.message}`);
    throw error;

  }


  if (enterResponse?.errors) {

    console.log(
      `❌ [Step 4] GraphQL returned errors: ${JSON.stringify(enterResponse.errors)}`
    );

    throw new Error('GraphQL EnterZoneMutation returned errors.');

  }


  const enterStatus = enterResponse?.data?.teleport?.EnterZoneMutation?.status;

  if (enterStatus !== 1) {

    console.log(
      `❌ [Step 4] Zone activation failed. Status=${enterStatus}, message=${enterResponse?.data?.teleport?.EnterZoneMutation?.message}`
    );

    throw new Error(
      `Failed to enter zone "${chosenZone.name}" (ID ${chosenZone.id}). Status: ${enterStatus}`
    );

  }

  console.log(`✅ [Step 4] Zone "${chosenZone.name}" activated successfully.`);


  // ----------------------------------------------------------------
  // STEP 5 — Play the game
  // ----------------------------------------------------------------

  await playTeleportGame(teleportUrl);

  console.log('🏁 Teleport flow finished.');

};
