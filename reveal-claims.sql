BEGIN;

CREATE TABLE IF NOT EXISTS public.match_reveals (
  match_id uuid NOT NULL REFERENCES public.matches(id),
  player_id uuid NOT NULL REFERENCES public.profiles(id),
  outcome text NOT NULL CHECK (outcome IN ('won', 'lost', 'refunded')),
  payout_amount numeric NOT NULL CHECK (payout_amount >= 0),
  currency text NOT NULL CHECK (currency IN ('CASH', 'COIN')),
  credited_now boolean NOT NULL DEFAULT false,
  revealed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);

ALTER TABLE public.match_reveals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_reveals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.match_reveals TO authenticated;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'match_reveals'
      AND policyname = 'match_reveals_select_own'
  ) THEN
    CREATE POLICY match_reveals_select_own ON public.match_reveals
      FOR SELECT TO authenticated USING (player_id = (SELECT auth.uid()));
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.rpc_settle_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $retired$
BEGIN
  RAISE EXCEPTION 'Automatic settlement is disabled. Reveal the result with rpc_reveal_match instead.';
END;
$retired$;

REVOKE EXECUTE ON FUNCTION public.rpc_settle_match(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_reveal_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_match public.matches%ROWTYPE;
  v_reveal public.match_reveals%ROWTYPE;
  v_house uuid := '1a2b3c4d-5e6f-7081-9203-4b5c6d7e8f90';
  v_count integer;
  v_entry numeric;
  v_total numeric;
  v_fee numeric;
  v_prize numeric;
  v_winner_score numeric;
  v_paid boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to reveal a result' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;
  IF v_user IS DISTINCT FROM v_match.player1_id
     AND v_user IS DISTINCT FROM v_match.player2_id
     AND v_user IS DISTINCT FROM v_match.player3_id THEN
    RAISE EXCEPTION 'Only participants can reveal this match' USING ERRCODE = '42501';
  END IF;
  IF v_match.status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'This match is not complete yet';
  END IF;

  SELECT * INTO v_reveal FROM public.match_reveals
    WHERE match_id = p_match_id AND player_id = v_user;
  IF FOUND THEN
    RETURN to_jsonb(v_reveal) || jsonb_build_object('already_revealed', true, 'credited_now', false);
  END IF;

  IF v_match.currency NOT IN ('CASH', 'COIN') OR v_match.currency IS NULL THEN
    RAISE EXCEPTION 'Unsupported currency';
  END IF;
  v_entry := CASE WHEN v_match.currency = 'CASH' THEN v_match.cash_entry ELSE v_match.wager END;
  IF v_entry IS NULL OR v_entry <= 0 OR v_entry::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Invalid entry amount';
  END IF;

  IF v_match.winner_id IS NULL THEN
    RAISE EXCEPTION 'No winning payout to reveal. Refunds are handled separately.';
  END IF;

  IF v_match.winner_id IS DISTINCT FROM v_match.player1_id
     AND v_match.winner_id IS DISTINCT FROM v_match.player2_id
     AND v_match.winner_id IS DISTINCT FROM v_match.player3_id THEN
    RAISE EXCEPTION 'Invalid match winner';
  END IF;

  v_count := COALESCE(v_match.max_players, 2);
  IF v_count NOT IN (2, 3) OR v_match.player1_id IS NULL OR v_match.player2_id IS NULL
     OR v_match.player1_id = v_match.player2_id
     OR (v_count = 3 AND (v_match.player3_id IS NULL OR v_match.player3_id IN (v_match.player1_id, v_match.player2_id)))
     OR (v_count = 2 AND v_match.player3_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid participant count';
  END IF;

  IF v_user <> v_match.winner_id THEN
    INSERT INTO public.match_reveals (match_id, player_id, outcome, payout_amount, currency)
    VALUES (p_match_id, v_user, 'lost', 0, v_match.currency)
    RETURNING * INTO v_reveal;
    RETURN to_jsonb(v_reveal) || jsonb_build_object('already_revealed', false);
  END IF;

  v_total := v_entry * v_count;
  v_fee := CASE WHEN v_match.currency = 'CASH' THEN round(v_total * 0.15, 2) ELSE round(v_total * 0.15) END;
  v_prize := v_total - v_fee;

  IF v_match.settled_at IS NULL THEN
    SELECT score INTO v_winner_score FROM (VALUES
      (v_match.player1_id, v_match.player1_score),
      (v_match.player2_id, v_match.player2_score),
      (v_match.player3_id, v_match.player3_score)
    ) AS players(id, score) WHERE id = v_match.winner_id;
    IF v_winner_score IS NULL OR v_winner_score < 0 OR v_winner_score::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Winner has no valid score';
    END IF;
    IF EXISTS (
      SELECT 1 FROM (VALUES
        (v_match.player1_id, v_match.player1_score),
        (v_match.player2_id, v_match.player2_score),
        (v_match.player3_id, v_match.player3_score)
      ) AS players(id, score)
      WHERE id IS NOT NULL AND id <> v_match.winner_id AND score >= v_winner_score
    ) THEN
      RAISE EXCEPTION 'Winner does not have the highest score';
    END IF;
    IF (v_match.player1_score IS NULL OR v_match.player2_score IS NULL
        OR (v_count = 3 AND v_match.player3_score IS NULL))
       AND (v_match.created_at IS NULL OR v_match.created_at > now() - interval '10 minutes') THEN
      RAISE EXCEPTION 'Opponent still has time to finish';
    END IF;
    IF EXISTS (SELECT 1 FROM public.fees_ledger WHERE match_id = p_match_id) THEN
      RAISE EXCEPTION 'Payment history needs review before claiming';
    END IF;

    PERFORM id FROM public.profiles WHERE id IN (v_user, v_house) ORDER BY id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user)
       OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_house) THEN
      RAISE EXCEPTION 'Winner or house profile is missing';
    END IF;
    IF v_match.currency = 'CASH' THEN
      UPDATE public.profiles SET cash_balance = COALESCE(cash_balance, 0) + v_prize WHERE id = v_user;
      UPDATE public.profiles SET cash_balance = COALESCE(cash_balance, 0) + v_fee WHERE id = v_house;
    ELSE
      UPDATE public.profiles SET coin_balance = COALESCE(coin_balance, 0) + v_prize WHERE id = v_user;
      UPDATE public.profiles SET coin_balance = COALESCE(coin_balance, 0) + v_fee WHERE id = v_house;
    END IF;
    INSERT INTO public.fees_ledger (match_id, game_id, winner_id, total_entry, fee_amount, payout_amount, currency)
    VALUES (p_match_id, v_match.game_id, v_user, v_total, v_fee, v_prize, v_match.currency);
    UPDATE public.matches SET settled_at = now() WHERE id = p_match_id;
    v_paid := true;
  ELSE
    SELECT payout_amount INTO v_prize FROM public.fees_ledger
      WHERE match_id = p_match_id AND winner_id = v_user ORDER BY created_at DESC LIMIT 1;
    IF v_prize IS NULL THEN
      RAISE EXCEPTION 'Previously settled payment needs review';
    END IF;
  END IF;

  INSERT INTO public.match_reveals (match_id, player_id, outcome, payout_amount, currency, credited_now)
  VALUES (p_match_id, v_user, 'won', v_prize, v_match.currency, v_paid)
  RETURNING * INTO v_reveal;
  RETURN to_jsonb(v_reveal) || jsonb_build_object('already_revealed', false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_reveal_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_reveal_match(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
