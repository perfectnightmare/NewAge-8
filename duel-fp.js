// duel-fp.js
//
// Steps performed by this script:
//
// 1. Open the Duels page.
// 2. Send getStatistics and read the base/practice numbers for
//    Elegance (style), Creativity (creativity), Confidence (devotion),
//    and Grace (beauty). Kindness and Loyalty are ignored.
//    Also read the available Fashion Points (FP), if possible.
// 3. Case 1: if ANY of those 4 numbers is < 200 -> STOP.
// 4. Case 2: if ALL 4 numbers are >= 200 -> pick the stat with the
//    LOWEST base/practice number (random tie-break), then train it
//    with FP, but only if enough FP is available.
//
// Important:
// - This script does NOT buy Fashion Points. It only spends FP you already have.
// - getStatistics goes to /ajax/main.php.
// - trainStats goes to /ajax/train.php, amount is always 2000.
// - Playwright's existing logged-in browser session is used.


const DUELS_URL = 'https://v3.g.ladypopular.com/duels.php';
const TRAIN_URL = 'https://v3.g.ladypopular.com/ajax/train.php';
const MAIN_URL = 'https://v3.g.ladypopular.com/ajax/main.php';

const TRAIN_AMOUNT = 2000;

// Maps the internal payload key -> friendly display name.
const STAT_LABELS = {
  style: 'Elegance',
  creativity: 'Creativity',
  devotion: 'Confidence',
  beauty: 'Grace'
};

// The 4 stats we care about, in the order we want to check them.
const STAT_KEYS = ['style', 'creativity', 'devotion', 'beauty'];


// ------------------------------------------------------------
// Helper: extract base/practice numbers from getStatistics HTML
// ------------------------------------------------------------

function extractBaseStatValues(statsHtml) {

  const result = {};

  const blocks = statsHtml.split('<li class="player-stat');

  for (const block of blocks) {

    const typeMatch = block.match(
      /data-type="(style|creativity|devotion|beauty)"\s+id="stat_/
    );

    if (!typeMatch) {
      continue;
    }

    const type = typeMatch[1];

    const valueMatch = block.match(
      /<div class="value">\s*([\d,]+)\s*<\/div>/
    );

    if (valueMatch) {
      result[type] = parseInt(valueMatch[1].replace(/,/g, ''), 10);
    }
  }

  return result;
}


// ------------------------------------------------------------
// Helper: extract available FP from getStatistics HTML
// (same element account-info.js reads: .total-fp-amount-js)
// Returns null if it can't be found.
// ------------------------------------------------------------

function extractAvailableFP(statsHtml) {

  const match = statsHtml.match(
    /class="[^"]*total-fp-amount-js[^"]*"[^>]*>\s*([\d,]+)/
  );

  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
}


// ------------------------------------------------------------
// Main function
// ------------------------------------------------------------

module.exports = async function runDuelFP(page) {

  console.log('');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('⚔️ Starting Duel FP distribution (no FP purchase)...');
  console.log('────────────────────────────────────────────────────────────────────────────────');


  // ============================================================
  // STEP 1
  // Open the Duels page
  // ============================================================

  console.log('🌐 Step 1: Opening Duels page...');

  await page.goto(DUELS_URL, {
    waitUntil: 'domcontentloaded'
  });

  console.log('✅ Duels page loaded.');

  await page.waitForTimeout(3000);


  // ============================================================
  // STEP 2
  // Send getStatistics and read the base/practice numbers + FP
  // ============================================================

  console.log('');
  console.log('📊 Step 2: Sending getStatistics request...');
  console.log('📦 type=getStatistics');

  let statValues = {};
  let availableFP = null;

  try {

    const response = await page.request.post(
      MAIN_URL,
      {
        form: {
          type: 'getStatistics'
        },
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );

    const responseText = await response.text();

    console.log(
      `📡 getStatistics HTTP status: ${response.status()}`
    );

    if (!response.ok()) {

      throw new Error(
        `getStatistics request returned HTTP ${response.status()}`
      );

    }

    const data = JSON.parse(responseText);

    if (data.status !== 1 || !data.statsHtml) {

      throw new Error(
        `getStatistics returned unexpected data (status=${data.status})`
      );

    }

    statValues = extractBaseStatValues(data.statsHtml);
    availableFP = extractAvailableFP(data.statsHtml);

    console.log('🔎 Base/practice numbers extracted:');

    for (const key of STAT_KEYS) {

      console.log(
        `   ${STAT_LABELS[key]} (${key}): ${statValues[key]}`
      );

    }

    console.log(
      `👗 Available FP: ${availableFP === null ? 'could not be read' : availableFP}`
    );

  } catch (error) {

    console.log(
      `❌ getStatistics request failed or could not be parsed: ${error.message}`
    );

    console.log(
      '🛑 Cannot evaluate stats. Stopping here.'
    );

    console.log('────────────────────────────────────────────────────────────────────────────────');

    return;

  }


  // ============================================================
  // STEP 3
  // Decide: Case 1 (stop) vs Case 2 (train weakest stat)
  // ============================================================

  console.log('');
  console.log('🧮 Step 3: Evaluating stats...');

  const missingOrInvalid = STAT_KEYS.some(
    (key) => statValues[key] === undefined || isNaN(statValues[key])
  );

  if (missingOrInvalid) {

    console.log(
      '⚠️ One or more stat values could not be read.'
    );

    console.log(
      '🛑 Case 1 (by default): stopping without further steps.'
    );

    console.log('────────────────────────────────────────────────────────────────────────────────');

    return;

  }

  const belowThreshold = STAT_KEYS.filter(
    (key) => statValues[key] < 200
  );

  if (belowThreshold.length > 0) {

    console.log(
      `⚠️ At least one stat is below 200: ${belowThreshold
        .map((key) => `${STAT_LABELS[key]}=${statValues[key]}`)
        .join(', ')}`
    );

    console.log(
      '🛑 Case 1: stopping here without going forward with next steps.'
    );

    console.log('────────────────────────────────────────────────────────────────────────────────');

    return;

  }

  console.log(
    '✅ Case 2: all 4 stats are 200 or greater.'
  );


  // ------------------------------------------------------------
  // FP check: no buying anymore, so only train if FP is enough.
  // If FP could not be read, try anyway and let the server decide.
  // ------------------------------------------------------------

  if (availableFP !== null && availableFP < TRAIN_AMOUNT) {

    console.log(
      `⚠️ Only ${availableFP} FP available, need ${TRAIN_AMOUNT} to train.`
    );

    console.log(
      '🛑 Not enough FP and buying is disabled. Stopping here.'
    );

    console.log('────────────────────────────────────────────────────────────────────────────────');

    return;

  }


  // ------------------------------------------------------------
  // Pick the stat with the lowest base/practice number.
  // Random tie-break if 2+ stats share the lowest value.
  // ------------------------------------------------------------

  const minValue = Math.min(
    ...STAT_KEYS.map((key) => statValues[key])
  );

  const lowestKeys = STAT_KEYS.filter(
    (key) => statValues[key] === minValue
  );

  const chosenKey =
    lowestKeys[Math.floor(Math.random() * lowestKeys.length)];

  console.log(
    `🎯 Lowest base/practice value is ${minValue}.`
  );

  if (lowestKeys.length > 1) {

    console.log(
      `🎲 Tie between: ${lowestKeys
        .map((key) => STAT_LABELS[key])
        .join(', ')}. Randomly picked: ${STAT_LABELS[chosenKey]}.`
    );

  } else {

    console.log(
      `🏆 Selected stat: ${STAT_LABELS[chosenKey]} (${chosenKey}).`
    );

  }


  // ============================================================
  // STEP 4
  // Send trainStats for the chosen stat
  // ============================================================

  const REPS = 1; // change this if you want more than one training request

  console.log('');
  console.log(
    `🏋️ Step 4: Sending trainStats for ${STAT_LABELS[chosenKey]} (${chosenKey}) x${REPS}...`
  );

  for (let i = 1; i <= REPS; i++) {

    console.log(`➡️ trainStats request ${i}/${REPS} for ${chosenKey}...`);

    try {

      const response = await page.request.post(
        TRAIN_URL,
        {
          form: {
            type: 'trainStats',
            popularityType: chosenKey,
            practiceType: 'fp',
            amount: String(TRAIN_AMOUNT)
          },
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
        }
      );

      const responseText = await response.text();

      console.log(
        `📡 trainStats (${i}/${REPS}) HTTP status: ${response.status()}`
      );

      console.log(
        `📨 trainStats (${i}/${REPS}) response: ${responseText}`
      );

      if (!response.ok()) {

        throw new Error(
          `trainStats request returned HTTP ${response.status()}`
        );

      }

      try {

        const data = JSON.parse(responseText);

        if (data.status === 1) {

          console.log(
            `✅ trainStats (${i}/${REPS}) succeeded: ${data.message || ''}`
          );

        } else {

          console.log(
            `⚠️ trainStats (${i}/${REPS}) returned status: ${data.status}`
          );

        }

      } catch {

        console.log(
          `⚠️ Could not parse trainStats (${i}/${REPS}) response as JSON.`
        );

      }

    } catch (error) {

      console.log(
        `❌ trainStats request ${i}/${REPS} failed: ${error.message}`
      );

      continue;

    }

  }


  // ============================================================
  // FINISHED
  // ============================================================

  console.log('');
  console.log('✅ Duel FP distribution completed.');
  console.log('────────────────────────────────────────────────────────────────────────────────');
};
