// pot-drop: runs the pot plinko drop on the server and settles it.
//
// Deployed to Supabase as the "pot-drop" edge function. Tables and RPCs:
// sql/pot-plinko.sql. Client: js/pot-plinko.js (calls this at game over).
// plinko-sim.js here is a COPY of js/plinko-sim.js (the browser replays the
// same code); tools/plinko-tune.mjs checks the two files are the same.
//
// POST JSON { room }: settles that room's newest pending drop plus up to 5
// older pending drops (games where nobody called this). Safe to call many
// times: a settled drop is never run again. Returns { drops: [...] }.
// POST JSON { check: [seed, ...], coins }: only runs the sim (up to 5 seeds) and
// returns the slots, to compare with a browser or Node run. Changes nothing.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";
import Matter from "npm:matter-js@0.19.0";
import "./plinko-sim.js";

// deno-lint-ignore no-explicit-any
const PlinkoSim = (globalThis as any).PlinkoSim;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let room = 0;
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try {
    body = await req.json();
    room = Number(body?.room) || 0;
  } catch (_) { /* no body: only stale drops */ }

  if (Array.isArray(body?.check)) {
    const coins = Math.min(PlinkoSim.MAX_COINS, Number(body.coins) || 10);
    return json({
      version: PlinkoSim.VERSION,
      slots: body.check.slice(0, 5).map((s: number) => PlinkoSim.simulate({ seed: Number(s), coins, Matter }).slots),
    });
  }

  const { data: pending, error } = await admin.rpc("_pending_pot_drops", { p_room: room });
  if (error) return json({ error: error.message }, 500);

  const drops = [];
  for (const d of pending || []) {
    const r = PlinkoSim.simulate({ seed: Number(d.seed), coins: d.coins, Matter });
    const { data, error: e2 } = await admin.rpc("_settle_pot_drop", {
      p_id: d.id, p_slots: r.slots, p_version: PlinkoSim.VERSION,
    });
    if (e2) { drops.push({ id: d.id, error: e2.message }); continue; }
    drops.push({ id: d.id, room_id: data.room_id, won: data.won, hit_coin: data.hit_coin });
  }
  return json({ drops });
});
