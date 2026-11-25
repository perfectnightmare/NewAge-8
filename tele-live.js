// ================================================================
// 🚀 TELEPORT LIVE EVENT: fully independent script
// Detect live teleport → Zone detection → Zone activation → Playing
// (No activation of the event itself: live events are already open.)
// ================================================================

module.exports = async function runTeleportLive(page) {

  // ==============================================================
  // 🔑 AUTH TOKEN HELPER
  // ==============================================================

  async function getAuthToken() {
    return await page.evaluate(() => {
      const candidateKeys = ['token', 'authToken', 'auth_token', 'jwt', 'access_token', 'accessToken'];
      for (const key of candidateKeys) {
        const val = localStorage.getItem(key);
        if (val && val.length > 10) return val;
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

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

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
              extensions: { clientLibrary: { name: '@apollo/client', version: '4.0.5' } }
            })
          }
        );

        return await res.json();
      },
      { operationName, query, variables, token }
    );
  }

  // ==============================================================
  // 📜 GRAPHQL QUERY / MUTATION STRINGS
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
  // 🎮 PLAY LOGIC
  // ==============================================================

  async function playTeleportGame(teleportUrl, eventId) {

    console.log("🌐 [Live] Navigating to teleport event page...");
    await page.goto(teleportUrl, { waitUntil: 'domcontentloaded' });

    const emeraldText = await page.textContent('#player-emeralds');
    const emeralds = parseInt(emeraldText.replace(/\D/g, ''), 10);
    console.log('💎 [Live] Emeralds:', emeralds);
    if (emeralds < 3) {
      console.log('➡️ [Live] Not enough emeralds. Exiting.');
      return;
    }

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

    console.log('🎲 [Live] Initial tries:', tries);
    if (tries === 0) {
      console.log('➡️ [Live] No tries available. Exiting.');
      return;
    }

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
        console.log('🏆 [Live] Zone completed.');
        tries = 0;
      }
    };

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
      console.log('🧪 [Live] Grid validation:', totalCheck === 100, altCheck === 100);

      let clicked = false;

      // Phase 0: until a blocked cell is found, probe the four standard cells
      if (blockSet.size === 0) {
        const probeCells = [[2, 2], [2, 9], [9, 2], [9, 9]]
          .filter(p => untouchedSet.has(key(p)) || hintSet.has(key(p)));
        if (probeCells.length > 0) {
          const tk = randomPick(probeCells);
          console.log('🔎 [Live] Phase 0 probe click:', tk);
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

            console.log('🎯 [Live] Phase I click:', clickTarget);
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
          console.log('🎯 [Live] Priority click:', tk);
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
          console.log('🎯 [Live] Overlap-bigblock click:', tk);
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
          console.log('🎯 [Live] Overlap-lagging click:', tk);
          await openCell(tk);
          clicked = true;
        }
      }

      if (!clicked && tries > 0) {
        const candidates = [...highProb];
        if (candidates.length === 0) {
          console.log('⚠️ [Live] No clickable cell left. Stopping.');
          break;
        }
        const tk = randomPick(candidates).split(',').map(Number);
        console.log('🎯 [Live] Fallback click:', tk);
        await openCell(tk);
      }

      console.log('➡️ [Live] Remaining tries:', tries);
    }

    console.log('🎉 [Live] All done — no tries left.');
  }


  // ==============================================================
  // DETECT A LIVE TELEPORT EVENT IN THE HEADER
  // (event-type-teleport banner whose data-is_flashback is empty)
  // ==============================================================

  try {
    await page.goto('https://v3.g.ladypopular.com/guild.php', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
  } catch (error) {
    console.log(`❌ [Live] Guild page failed to load: ${error.message}`);
    throw error;
  }

  const liveBanner = page.locator(
    '#header-events-container .header-event-banner.event-type-teleport[data-is_flashback=""]'
  ).first();

  if ((await liveBanner.count()) === 0) {
    console.log('ℹ️ [Live] No live teleport event right now. Nothing to do.');
    return;
  }

  const eventId = Number(await liveBanner.getAttribute('data-id'));
  const liveTitle = (await liveBanner.locator('.item-title').innerText()).trim();

  if (!Number.isFinite(eventId)) {
    throw new Error('Live teleport banner found, but its event id could not be read.');
  }

  console.log(`📌 [Live] Live teleport event: ${liveTitle} (ID ${eventId})`);


  // ----------------------------------------------------------------
  // STEP 1 — Go to event URL
  // ----------------------------------------------------------------

  const teleportUrl = `https://v3.g.ladypopular.com/events/teleport.php?event_id=${eventId}`;

  console.log(`🌐 [Live Step 1] Navigating to event URL: ${teleportUrl}`);

  await page.goto(teleportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });


  // ----------------------------------------------------------------
  // STEP 2 — Get zone list data via GraphQL
  // ----------------------------------------------------------------

  console.log('📡 [Live Step 2] Requesting Teleport EventInfo via GraphQL...');

  let infoResponse;

  try {
    infoResponse = await runGraphQL({
      operationName: 'Teleport',
      query: TELEPORT_EVENT_INFO_QUERY,
      variables: { eventId }
    });
  } catch (error) {
    console.log(`❌ [Live Step 2] GraphQL request failed: ${error.message}`);
    throw error;
  }

  if (infoResponse?.errors) {
    console.log(`❌ [Live Step 2] GraphQL returned errors: ${JSON.stringify(infoResponse.errors)}`);
    throw new Error('GraphQL EventInfo request returned errors.');
  }

  const eventInfo = infoResponse?.data?.teleport?.EventInfo;

  if (!eventInfo) {
    console.log('❌ [Live Step 2] EventInfo missing from GraphQL response.');
    throw new Error('EventInfo missing from GraphQL response.');
  }


  // ----------------------------------------------------------------
  // STEP 3 — Activity determination
  // ----------------------------------------------------------------

  if (eventInfo.active_zone_id !== null && eventInfo.active_zone_id !== undefined) {
    console.log(`✅ [Live Step 3] Zone already active (ID ${eventInfo.active_zone_id}). Skipping ahead to playing.`);
    await playTeleportGame(teleportUrl, eventId);
    console.log('🏁 [Live] Teleport flow finished.');
    return;
  }

  console.log('🔎 [Live Step 3] No zone currently active. Checking activation type...');

  if (eventInfo.next_free_game_time && eventInfo.next_free_game_time !== 0) {
    console.log(
      `💰 [Live Step 3.1] Zone activation is currently PAID (next free at ${eventInfo.next_free_game_time}). Stopping here.`
    );
    return;
  }

  console.log('🆓 [Live Step 3.2] Zone activation is FREE. Gathering uncompleted zones...');

  const zonesInfo = eventInfo.zones_info;

  if (!Array.isArray(zonesInfo)) {
    console.log('❌ [Live Step 3.2] zones_info missing or invalid.');
    throw new Error('zones_info missing or invalid in EventInfo response.');
  }

  // Priority order of final reward types (best first). Anything not listed ranks last.
  const FINAL_PRIORITY = [
    'clothes',
    'appearance',
    'pet',
    'car',
    'background',
    'boyfriend_clothes',
    'boyfriend_appearance'
  ];

  const uncompletedZones = zonesInfo
    .filter(z => z.is_completed === false)
    .map(z => {
      const f = z.rewards && z.rewards.final;
      const finals = Array.isArray(f) ? f : (f ? [f] : []);

      let rank = FINAL_PRIORITY.length;
      let finalType = 'none';
      for (const x of finals) {
        const r = FINAL_PRIORITY.indexOf(x && x.type);
        if (r !== -1 && r < rank) { rank = r; finalType = x.type; }
      }

      return { id: z.id, name: z.name, rank, finalType };
    });

  console.log(
    `🗺️ [Live Step 3.2] Found ${uncompletedZones.length} uncompleted zone(s): ` +
    uncompletedZones.map(z => `${z.name} (${z.id})`).join(', ')
  );

  if (uncompletedZones.length === 0) {
    console.log('✅ [Live Step 3.2] No uncompleted zones left. Nothing to activate.');
    return;
  }


  // ----------------------------------------------------------------
  // STEP 4 — Activate the best-ranked uncompleted zone
  // ----------------------------------------------------------------

  const chosenZone = uncompletedZones.reduce(
    (best, z) => (z.rank < best.rank ? z : best),
    uncompletedZones[0]
  );

  console.log(`📊 [Live Step 4] Chosen zone's final reward type: ${chosenZone.finalType} (rank ${chosenZone.rank + 1})`);
  console.log(`🎯 [Live Step 4] Activating zone: ${chosenZone.name} (ID ${chosenZone.id})`);

  let enterResponse;

  try {
    enterResponse = await runGraphQL({
      operationName: 'EventTeleportEnterZone',
      query: ENTER_ZONE_MUTATION,
      variables: { eventId, zoneId: chosenZone.id }
    });
  } catch (error) {
    console.log(`❌ [Live Step 4] Zone activation request failed: ${error.message}`);
    throw error;
  }

  if (enterResponse?.errors) {
    console.log(`❌ [Live Step 4] GraphQL returned errors: ${JSON.stringify(enterResponse.errors)}`);
    throw new Error('GraphQL EnterZoneMutation returned errors.');
  }

  const enterStatus = enterResponse?.data?.teleport?.EnterZoneMutation?.status;

  if (enterStatus !== 1) {
    console.log(
      `❌ [Live Step 4] Zone activation failed. Status=${enterStatus}, message=${enterResponse?.data?.teleport?.EnterZoneMutation?.message}`
    );
    throw new Error(`Failed to enter zone "${chosenZone.name}" (ID ${chosenZone.id}). Status: ${enterStatus}`);
  }

  console.log(`✅ [Live Step 4] Zone "${chosenZone.name}" activated successfully.`);


  // ----------------------------------------------------------------
  // STEP 5 — Play the game
  // ----------------------------------------------------------------

  await playTeleportGame(teleportUrl, eventId);

  console.log('🏁 [Live] Teleport flow finished.');

};
