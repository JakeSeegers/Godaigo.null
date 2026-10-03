# Game plans: "X invites you to play" (Doodle style)

Owner request 2026-10-03. Modeled on Doodle's group poll: the organizer proposes specific times,
people answer each time Yes / If need be / No, everyone sees the answers, the best time gets a
star, and the organizer picks the final time.

## Step 1 (BUILT 2026-10-03): in the game
- Server: sql/game-plans.sql (applied). Tables game_plans, game_plan_slots, game_plan_members,
  game_plan_votes (RLS on, no client policies). RPCs create_game_plan(title, users[], slots[])
  (1-5 people who are friends or played with you in the last 30 days, 1-8 future times within 60
  days, no guests, 5 plans a day), my_game_plans(), vote_game_plan(plan, {slot: 0|1|2}),
  set_game_plan_time(plan, slot or null), cancel_game_plan(plan), open_game_plan_room(plan, room).
- Client: js/game-plans.js, lobby "Plans" button (dot = plans waiting for your answer).
  Times are entered in the player's own time zone and stored as UTC.
- When set: "Add to Google Calendar" link and a calendar file (.ics, 10 min alarm). From 30 min
  before, the creator gets "Open the room" (private room, linked to the plan, normal game invites
  to everyone who said Yes / If need be); others get a Join button. Lobby pop-ups: new invitation,
  reminder 10 min before, room open.
- Not tested on the live server with real accounts yet: a rollback SQL test timed out in the
  Supabase tool (nothing was left behind). Tested in the browser against a mocked server.

## Step 2 (planned): email alerts
Opt-in checkbox at registration and in Profile > Settings ("Email me about game invites"), only to
a confirmed recovery email. Emails: "X invites you to play: pick your times" and "It's set" (with
the .ics). Sent by the account-recovery edge function (Resend). Budget: about 90 emails a day in
total today, so cap plans per player or move to a paid plan if it grows. No reminder emails.

## Step 3 (later): show busy times from a linked calendar
Google / Outlook free-busy while voting. Needs a Google Cloud app, verification for the calendar
scope, a privacy policy page, and safe storage of tokens. Only if step 1 is used.

Left out on purpose: hidden polls (friends deciding together want to see answers), vote limits per
option.
