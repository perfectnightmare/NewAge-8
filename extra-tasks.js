// ================================================================
// 🌙 EXTRA TASKS (Phase 2)
// ================================================================
//
// These run AFTER the common list in mspc.js, in the same
// logged-in session, only when the workflow was started with
// run_extra = true (the Apps Script does this inside its window).
// The ticket reserve is 0 while this list runs.
//
// This file only exports a list. Login, logout and the daily
// reward live in mspc.js.
//
// To move a task between the lists: cut its line from one file,
// paste it into the other, and add its require(...) line at the top
// of the file it moves to.

const runBurnEnergy = require('./burn-energy.js');
const runBattlePassChests = require('./battlepass-chests.js');
const runNewAccount = require('./new-account.js');
const runOutfitFollower = require('./outfit-follower.js'); //reverting back
const runOutfitBuyer = require('./outfit-buyer.js');

module.exports = [

  { name: 'Outfit Buyer', fn: runOutfitBuyer, alwaysRun: true },
  { name: 'Outfit Follower', fn: runOutfitFollower, alwaysRun: true },
  { name: 'Burn Energy-Before', fn: runBurnEnergy, alwaysRun: true },
  { name: 'Battle Pass Chests', fn: runBattlePassChests, alwaysRun: true },
  { name: 'Burn Energy-After', fn: runBurnEnergy, alwaysRun: true },
  { name: 'New Account', fn: runNewAccount, alwaysRun: true },

];
