const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, 'reveal-claims.sql'), 'utf8');
const winner = '20000000-0000-4000-8000-000000000001';
const loser = '20000000-0000-4000-8000-000000000002';
const outsider = '20000000-0000-4000-8000-000000000003';
const house = '1a2b3c4d-5e6f-7081-9203-4b5c6d7e8f90';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('reveal migration and claims execute inside isolated PostgreSQL', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, cash_balance numeric DEFAULT 100, coin_balance bigint DEFAULT 100);
    CREATE TABLE public.matches (
      id uuid PRIMARY KEY, game_id text DEFAULT 'pro-golf', status text DEFAULT 'complete',
      player1_id uuid, player2_id uuid, player3_id uuid,
      player1_score bigint DEFAULT 200, player2_score bigint DEFAULT 100, player3_score bigint,
      winner_id uuid, max_players integer DEFAULT 2, currency text DEFAULT 'CASH',
      cash_entry numeric DEFAULT 1, wager bigint DEFAULT 10,
      settled_at timestamptz, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.fees_ledger (
      id bigserial PRIMARY KEY, match_id uuid, game_id text, winner_id uuid,
      total_entry numeric, fee_amount numeric, payout_amount numeric,
      currency text, created_at timestamptz DEFAULT now()
    );
    CREATE FUNCTION public.rpc_settle_match(p_match_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    INSERT INTO public.profiles(id) VALUES ('${winner}'), ('${loser}'), ('${outsider}');
  `);
  await db.exec(migration);
  await db.exec(migration);

  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const createMatch = async (n) => {
    await query('INSERT INTO public.matches(id, player1_id, player2_id, winner_id) VALUES ($1, $2, $3, $2)', [id(n), winner, loser]);
    return id(n);
  };
  const as = async (user, fn) => {
    await db.exec('RESET ROLE');
    await query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user || '']);
    await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`);
    try { return await fn(); } finally { await db.exec('RESET ROLE'); }
  };
  const claim = async (matchId) => (await query('SELECT public.rpc_reveal_match($1) AS receipt', [matchId]))[0].receipt;
  const balance = async (user) => {
    const [row] = await query('SELECT cash_balance, coin_balance FROM public.profiles WHERE id = $1', [user]);
    return { cash: Number(row.cash_balance), coins: Number(row.coin_balance) };
  };
  const count = async (table, matchId) => Number((await query(`SELECT count(*) AS n FROM public.${table} WHERE match_id = $1`, [matchId]))[0].n);

  const first = await createMatch(1);
  await t.test('anonymous callers, outsiders, incomplete matches and missing house are rejected', async () => {
    await assert.rejects(as(null, () => claim(first)), /permission denied/);
    await assert.rejects(as(outsider, () => claim(first)), /Only participants/);
    await query("UPDATE public.matches SET status = 'active' WHERE id = $1", [first]);
    await assert.rejects(as(winner, () => claim(first)), /not complete/);
    await query("UPDATE public.matches SET status = 'complete' WHERE id = $1", [first]);
    await assert.rejects(as(winner, () => claim(first)), /house profile is missing/);
    assert.deepEqual(await balance(winner), { cash: 100, coins: 100 });
    assert.equal(await count('match_reveals', first), 0);
    await query('INSERT INTO public.profiles(id, cash_balance, coin_balance) VALUES ($1, 0, 0)', [house]);
  });

  await t.test('loser reveal never pays the winner or the house', async () => {
    const receipt = await as(loser, () => claim(first));
    assert.equal(receipt.outcome, 'lost');
    assert.equal(receipt.credited_now, false);
    assert.deepEqual(await balance(winner), { cash: 100, coins: 100 });
    assert.deepEqual(await balance(house), { cash: 0, coins: 0 });
  });

  await t.test('only the winner reveal credits the prize and fee, exactly once', async () => {
    const receipt = await as(winner, () => claim(first));
    assert.equal(receipt.outcome, 'won');
    assert.equal(receipt.credited_now, true);
    assert.equal(Number(receipt.payout_amount), 1.7);
    for (let n = 0; n < 5; n++) {
      const retry = await as(winner, () => claim(first));
      assert.equal(retry.already_revealed, true);
      assert.equal(retry.credited_now, false);
    }
    assert.deepEqual(await balance(winner), { cash: 101.7, coins: 100 });
    assert.deepEqual(await balance(house), { cash: 0.3, coins: 0 });
    assert.equal(await count('fees_ledger', first), 1);
    assert.equal(await count('match_reveals', first), 2);
    assert.ok((await query('SELECT settled_at FROM public.matches WHERE id = $1', [first]))[0].settled_at);
  });

  await t.test('receipt RLS is per player and direct writes are denied', async () => {
    const own = await as(loser, () => query('SELECT player_id FROM public.match_reveals'));
    assert.deepEqual(own.map((row) => row.player_id), [loser]);
    assert.deepEqual(await as(outsider, () => query('SELECT player_id FROM public.match_reveals')), []);
    await assert.rejects(as(winner, () => query("UPDATE public.match_reveals SET payout_amount = 999 WHERE match_id = $1", [first])), /permission denied/);
    await assert.rejects(as(winner, () => query('SELECT public.rpc_settle_match($1)', [first])), /permission denied/);
    await assert.rejects(query('SELECT public.rpc_settle_match($1)', [first]), /Automatic settlement is disabled/);
  });

  await t.test('three-player cash prizes use all three entries', async () => {
    const match = await createMatch(2);
    await query('UPDATE public.matches SET max_players = 3, player3_id = $2, player3_score = 50 WHERE id = $1', [match, outsider]);
    const before = await balance(winner);
    const receipt = await as(winner, () => claim(match));
    assert.equal(Number(receipt.payout_amount), 2.55);
    assert.equal((await balance(winner)).cash, Number((before.cash + 2.55).toFixed(2)));
  });

  await t.test('coin claims preserve the 15 percent rounded fee', async () => {
    const match = await createMatch(3);
    await query("UPDATE public.matches SET currency = 'COIN' WHERE id = $1", [match]);
    const receipt = await as(winner, () => claim(match));
    assert.equal(Number(receipt.payout_amount), 17);
    assert.equal((await balance(winner)).coins, 117);
    assert.equal((await balance(house)).coins, 3);
  });

  await t.test('missing scores must wait ten minutes', async () => {
    const match = await createMatch(4);
    await query('UPDATE public.matches SET player2_score = NULL WHERE id = $1', [match]);
    await assert.rejects(as(winner, () => claim(match)), /still has time/);
    await query("UPDATE public.matches SET created_at = now() - interval '11 minutes' WHERE id = $1", [match]);
    assert.equal((await as(winner, () => claim(match))).credited_now, true);
  });

  await t.test('invalid winners, ties, missing players and ambiguous payment history fail closed', async () => {
    const wrongWinner = await createMatch(5);
    await query('UPDATE public.matches SET player2_score = 300 WHERE id = $1', [wrongWinner]);
    await assert.rejects(as(winner, () => claim(wrongWinner)), /highest score/);
    await query('UPDATE public.matches SET player2_score = 200 WHERE id = $1', [wrongWinner]);
    await assert.rejects(as(winner, () => claim(wrongWinner)), /highest score/);
    const solo = await createMatch(6);
    await query('UPDATE public.matches SET player2_id = NULL WHERE id = $1', [solo]);
    await assert.rejects(as(winner, () => claim(solo)), /participant count/);
    const ambiguous = await createMatch(7);
    await query('INSERT INTO public.fees_ledger(match_id, winner_id, payout_amount) VALUES ($1, $2, 1.7)', [ambiguous, winner]);
    await assert.rejects(as(winner, () => claim(ambiguous)), /Payment history needs review/);
  });

  await t.test('already settled legacy winners receive a receipt but no further credit', async () => {
    const match = await createMatch(8);
    await query('UPDATE public.matches SET settled_at = now() WHERE id = $1', [match]);
    await query('INSERT INTO public.fees_ledger(match_id, winner_id, payout_amount) VALUES ($1, $2, 1.7)', [match, winner]);
    const before = await balance(winner);
    const receipt = await as(winner, () => claim(match));
    assert.equal(receipt.credited_now, false);
    assert.equal(Number(receipt.payout_amount), 1.7);
    assert.deepEqual(await balance(winner), before);
  });

  await t.test('refunds cannot be credited or falsely recorded by the win-claim endpoint', async () => {
    const match = await createMatch(10);
    await query('UPDATE public.matches SET winner_id = NULL WHERE id = $1', [match]);
    const before = await balance(winner);
    await assert.rejects(as(winner, () => claim(match)), /Refunds are handled separately/);
    assert.deepEqual(await balance(winner), before);
    assert.equal(await count('match_reveals', match), 0);
  });

  await t.test('ledger errors roll back balances, settlement and reveal receipt together', async () => {
    const match = await createMatch(9);
    await db.exec(`
      CREATE FUNCTION fail_test_fee() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.match_id = '${match}'::uuid THEN RAISE EXCEPTION 'Test ledger failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_test_fee BEFORE INSERT ON public.fees_ledger FOR EACH ROW EXECUTE FUNCTION fail_test_fee();
    `);
    const beforeWinner = await balance(winner);
    const beforeHouse = await balance(house);
    await assert.rejects(as(winner, () => claim(match)), /Test ledger failure/);
    assert.deepEqual(await balance(winner), beforeWinner);
    assert.deepEqual(await balance(house), beforeHouse);
    assert.equal(await count('match_reveals', match), 0);
    assert.equal(await count('fees_ledger', match), 0);
    assert.equal((await query('SELECT settled_at FROM public.matches WHERE id = $1', [match]))[0].settled_at, null);
  });
});
