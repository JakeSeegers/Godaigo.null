## Site build (Cloudflare Pages)

`build-site.js` copies only the files the game loads into `dist/` (index.html,
changelog.json, the logo SVG, js, css, images, assets, sounds, video,
LoreIntroClips, joytone; no .md files). Docs, planning, SQL and
repomix-output.txt stay out of the public site.

    node tools/build-site.js     # -> dist/ (git-ignored)

Cloudflare settings: build command `node tools/build-site.js`. On Workers
(the default for new projects) the deploy command stays `npx wrangler deploy`,
which reads `wrangler.jsonc` (publishes `dist/`; project name must be `godaigo`).
On Pages: output directory `dist`. If the game starts loading a file from a new top-level
folder, add it to `INCLUDE` in the script.
Cache rules (`tools/site-headers`, copied to `dist/_headers`): media is kept by
browsers for 1 day, code and the page are always checked. A changed image or
sound reaches players within a day; rename the file to make it instant.

---

## Splash video: re-bake the transparent version

`key-splash-video.py` bakes the boot splash's chroma key into
`video/splash-intro-alpha.webm` (VP9 with an alpha channel), which Chrome,
Edge and Firefox play without any per-pixel JavaScript. **Re-run it whenever
`video/splash-intro.mp4` changes**, or those browsers keep showing the old
animation (Safari/iOS use the MP4 directly and are unaffected):

    pip install numpy          # once; also needs ffmpeg with libvpx-vp9
    python3 tools/key-splash-video.py

If you change the key settings in `js/boot-splash.js` (`KEY_*`, `INNER`,
`OUTER`, `EDGE_DARKEN_MIN`, the trims), change them in the script too.

---

## Multiplayer console diagnostics

`console-diagnostics.js` is a paste-into-devtools-console tool for a real
multiplayer playtest (not loaded by `index.html`). Open the game in two
browsers, join the same room, paste the whole file into both consoles, then
run `godaigoTest.diag()` in both and compare the printed fingerprint numbers
to spot a desync, or `godaigoTest.trafficAudit(30)` to watch actual network
request volume for 30 seconds — see the file's own header comment for the
full usage guide.

---

## Bot training

The old PC trainer (`arena-headless.mjs`) was retired on 2026-10-13. Bots train
in the browser: Train Bot (lobby) and idle training. The current champion is
the newest promoted row of `bot_champion_weights`.

`online-test.mjs` runs online test games from a PC (see its header comment).

---

## Music: render and measure Joytone

`joytone-measure.mjs` lets Claude (who cannot hear) check the Joytone music.
It plays `joytone/index.html` in headless Chromium through `window.JoytoneAPI`
(the same calls `js/joytone-bridge.js` makes), records the final output for
12 scenarios (calm / mid / peak tension, a tension sweep, salsa, each element's
tile riff) and measures each one: loudness (LUFS, true peak, range), how hard
the soft clipper works, clicks, drop-outs, DC offset, stereo, tone. It also
measures the sound effects in `sounds/` at their game volume, to compare with
the music. Recording is real time: about 5 minutes for all scenarios.

    npm i                                       # once (Playwright); also needs ffmpeg
    node tools/joytone-measure.mjs              # all scenarios, 16 s each
    node tools/joytone-measure.mjs --only calm,salsa --seconds 30
    node tools/joytone-measure.mjs --list

Output in `tools/.cache/joytone-measure/` (git-ignored): `report.md` (tables,
warnings, change since the last run), `report.json`, one `.wav` and one `.png`
(waveform over a labelled spectrogram) per scenario, and `grid.png` with all of
them on the same scales. Before / after a Joytone change: run, change, run
again, read `report.md`.

`joytone-mixes/`: FX state variants to try in the Joytone popup (Shift+J+T, FX state
upload; never loaded by the game). `owner-fx-states.json` = the owner's FX 1.
`build-dnb.mjs` writes `Five_Elements_Theme-fx-states-dnb.json` = FX 1 + "DnB band"
(drum and bass with a band's attack; settings and reasons in the script).
`owner-fx-states-3.json` = the owner's bank with FX 3; `build-fx3-mastered.mjs` adds
"FX 3 mastered" (track levels balanced, measurements in the script) and writes
`Five_Elements_Theme-fx-states-fx3-mastered.json`. Measure a
state through Joytone's own recall: `--tone '{"bankFile":"...","recall":1,"gameTempo":true}'`.

`--tone '{...}'` tries settings without editing joytone/index.html: TONE
stage values (`presenceDb`, `airDb`, ...), `bassGain` (master bass shelf),
`mute` (track labels to
silence, to hear what one track adds) and `section` (start at that section;
5 = Union, where every track plays). The
"On laptop" column is the music through a 200 Hz high-pass, like small
speakers. Sound effect targets (as played): big moments about -14 LUFS max
momentary, actions about -17, clicks -20 to -24, footsteps about -26, with the
in-game music at about -23.

Limits: a fresh browser has no saved Joytone FX states, like most players. The
first 16 s of each scenario is mostly the theme's opening section, so use
`--seconds 60` or more to hear later sections. ffmpeg 6.1 draws spectrograms
wrongly when given a frequency range, so the picture always shows 20 Hz to
22 kHz.
