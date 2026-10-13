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
