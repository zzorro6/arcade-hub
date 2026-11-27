const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const sql = fs.readFileSync(path.join(__dirname, 'reveal-claims.sql'), 'utf8');
const helper = source.slice(source.indexOf('async function requestMatchReveal('), source.indexOf('async function loadLeaderboardForGame('));
const matchId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const receipt = (overrides = {}) => ({ match_id: matchId, player_id: userId, outcome: 'won', payout_amount: 1.7, currency: 'CASH', credited_now: true, ...overrides });

function harness(response, user = { id: userId }) {
  const calls = [];
  const context = vm.createContext({
    currentUser: user,
    supabaseClient: { rpc: async (...args) => { calls.push(args); return typeof response === 'function' ? response(context) : response; } },
  });
  vm.runInContext(helper, context);
  return { context, calls, reveal: context.requestMatchReveal };
}

test('reveal uses only the server claim RPC and returns its receipt', async () => {
  const result = receipt();
  const h = harness({ data: result, error: null });
  assert.equal(await h.reveal(matchId), result);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'rpc_reveal_match');
  assert.equal(h.calls[0][1].p_match_id, matchId);
});

test('anonymous users and invalid IDs never reach the claim RPC', async () => {
  const anonymous = harness({}, null);
  await assert.rejects(anonymous.reveal(matchId), /Sign in/);
  assert.equal(anonymous.calls.length, 0);
  const invalid = harness({});
  await assert.rejects(invalid.reveal('not-a-match'), /Invalid match/);
  assert.equal(invalid.calls.length, 0);
});

test('server failures remain retryable without a fabricated receipt', async () => {
  const h = harness({ data: null, error: new Error('Claim unavailable') });
  await assert.rejects(h.reveal(matchId), /Claim unavailable/);
});

test('invalid or mismatched receipts are rejected', async () => {
  for (const fields of [
    { player_id: 'another-player' }, { match_id: 'another-match' }, { outcome: 'pending' },
    { currency: 'USD' }, { payout_amount: -1 }, { payout_amount: 'NaN' }, { payout_amount: null },
  ]) {
    await assert.rejects(harness({ data: receipt(fields) }).reveal(matchId), /Could not read/);
  }
});

test('switching accounts during a request rejects the old receipt', async () => {
  const h = harness((context) => {
    context.currentUser = { id: 'different-user' };
    return { data: receipt() };
  });
  await assert.rejects(h.reveal(matchId), /Could not read/);
});

test('lost and already-revealed outcomes do not trigger client balance writes', async () => {
  for (const result of [receipt({ outcome: 'lost', payout_amount: 0, credited_now: false }), receipt({ already_revealed: true, credited_now: false })]) {
    const h = harness({ data: result });
    assert.equal(await h.reveal(matchId), result);
    assert.equal(h.calls.length, 1);
  }
  assert.doesNotMatch(helper, /cash_balance|coin_balance|\.update\(|localStorage/);
});

test('result text and verification attributes escape untrusted markup', () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function escapeResultText('), source.indexOf('async function requestMatchReveal(')), context);
  assert.equal(context.escapeResultText('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(context.escapeResultText(null), '');
});

test('normal-match resolution has no automatic settlement RPC calls', () => {
  assert.doesNotMatch(source, /\.rpc\(["']rpc_settle_match["']/);
  assert.match(source, /Your result is ready to reveal/);
  assert.match(source, /!row\.unrevealed && row\.isWin/);
  assert.match(source, /!row\.unrevealed && row\.isLoss/);
});

function watchHarness(latest) {
  const callbacks = [];
  const container = { isConnected: true };
  let reads = 0;
  let refreshes = 0;
  const context = vm.createContext({
    document: { getElementById: () => container }, currentView: 'hub', currentUser: { id: userId },
    MATCH_TIMEOUT_MS: 600000, console,
    setTimeout: (callback) => { callbacks.push(callback); return callbacks.length; }, clearTimeout: () => {},
    supabaseClient: { from: () => ({ select: () => ({ in: async () => { reads++; return { data: latest }; } }) }) },
    loadAndRenderWagers: async () => { refreshes++; },
  });
  vm.runInContext(source.slice(source.indexOf("let hubPanel = 'games';"), source.indexOf('function syncHubPanel()')), context);
  vm.runInContext("hubPanel = 'results';", context);
  return { context, container, callbacks, reads: () => reads, refreshes: () => refreshes };
}

const pendingMatch = () => ({ id: matchId, status: 'active', winner_id: null, settled_at: null, created_at: new Date().toISOString() });

test('results watcher reloads when a match finishes without repeated full-page loads', async () => {
  const row = pendingMatch();
  const steady = watchHarness([row]);
  steady.context.startResultsWatch([row], steady.container);
  await steady.callbacks.shift()();
  assert.equal(steady.reads(), 1);
  assert.equal(steady.refreshes(), 0);
  assert.equal(steady.callbacks.length, 1);
  const done = watchHarness([{ ...row, status: 'complete', winner_id: userId }]);
  done.context.startResultsWatch([row], done.container);
  await done.callbacks.shift()();
  assert.equal(done.refreshes(), 1);
});

test('results watcher stops after navigation or cancellation', async () => {
  for (const cancel of [(context) => { context.currentView = 'game'; }, (context) => context.stopResultsWatch()]) {
    const row = pendingMatch();
    const h = watchHarness([row]);
    h.context.startResultsWatch([row], h.container);
    cancel(h.context);
    await h.callbacks.shift()();
    assert.equal(h.reads(), 0);
    assert.equal(h.refreshes(), 0);
  }
});

test('results watcher lets the existing resolver sweep ten-minute timeouts', async () => {
  const row = { ...pendingMatch(), created_at: new Date(Date.now() - 660000).toISOString() };
  const h = watchHarness([row]);
  h.context.startResultsWatch([row], h.container);
  await h.callbacks.shift()();
  assert.equal(h.refreshes(), 1);
});

test('migration contains server-side authorization and transaction guards', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /PRIMARY KEY \(match_id, player_id\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /USING \(player_id = \(SELECT auth.uid\(\)\)\)/);
  assert.match(sql, /v_user IS NULL/);
  assert.match(sql, /v_user IS DISTINCT FROM v_match.player1_id/);
  assert.match(sql, /v_user IS DISTINCT FROM v_match.player2_id/);
  assert.match(sql, /v_user IS DISTINCT FROM v_match.player3_id/);
  assert.match(sql, /status IS DISTINCT FROM 'complete'/);
  assert.match(sql, /WHERE id = p_match_id FOR UPDATE/);
  assert.ok(sql.indexOf('WHERE id = p_match_id FOR UPDATE') < sql.indexOf('UPDATE public.profiles'));
  assert.match(sql, /IF v_match.settled_at IS NULL THEN/);
  assert.match(sql, /IF v_user <> v_match.winner_id THEN/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public.rpc_settle_match\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public.rpc_reveal_match\(uuid\) FROM PUBLIC, anon/);
  assert.match(sql, /SET search_path = pg_catalog, public, pg_temp/);
});
