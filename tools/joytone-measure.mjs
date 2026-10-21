// tools/joytone-measure.mjs: render the Joytone music and measure it.
//
// Claude cannot hear the music, so this tool turns it into numbers and
// pictures. It loads joytone/index.html in headless Chromium, drives it
// through window.JoytoneAPI the same way js/joytone-bridge.js does, records
// the final output (after the soft clipper, at volume 1) for each scenario,
// and then measures every recording:
//   - loudness (ITU-R BS.1770 / EBU R128): integrated, short-term range, true peak
//   - clipping: output samples at full scale, and how hard the signal hits
//     the soft clipper (peak before it)
//   - possible clicks (sudden sample jumps) and drop-outs (sudden silence)
//   - DC offset, left / right balance, stereo correlation (mono safety)
//   - tone: spectral centroid and low / mid / high energy share
// It also measures the sound effects in sounds/ at the volume the game
// plays them, so music and effects can be compared.
//
// Recording is real time (Web Audio cannot run faster in a live page), so
// the default run takes about 4 minutes.
//
// One-time setup (in the repo folder):
//   npm i                 (installs Playwright, see package.json)
//   ffmpeg on PATH
//
// Run:
//   node tools/joytone-measure.mjs                     every scenario, 16 s each
//   node tools/joytone-measure.mjs --seconds 30
//   node tools/joytone-measure.mjs --only calm,peak,salsa
//   node tools/joytone-measure.mjs --list              list the scenarios
//   node tools/joytone-measure.mjs --no-sfx            skip the sound effects
//   node tools/joytone-measure.mjs --headful           show the browser
//   node tools/joytone-measure.mjs --tone '{"harmGain":0.8}'
//                                                      try other TONE settings (joytone/index.html)
//                                                      without editing the file; "bassGain" = master
//                                                      bass shelf in dB (THEME_MASTER_FX); "partials" =
//                                                      BASS_PARTIALS, e.g. [[2,0.3],[3,0.15]]; "mute" =
//                                                      track labels to silence; "section" = start at
//                                                      that section index (5 = Union, every track);
//                                                      "roles" = per-track settings by label, "master" =
//                                                      master settings. --tone @file.json reads a file.
//
// Output (git-ignored), default tools/.cache/joytone-measure/:
//   report.md        tables + warnings, with changes since the last run
//   report.json      the same numbers for scripts
//   <scenario>.wav   the recording (32-bit float, 44.1 kHz stereo)
//   <scenario>.png   waveform over a log-frequency spectrogram
//   grid.png         every scenario stacked, same scale, for side-by-side reading
// The previous report is kept as report.prev.json, so a before / after
// check is: run, change Joytone, run again, read report.md.
//
// Note: a fresh browser has no saved Joytone FX states (localStorage), the
// same as most players. A designer browser with a saved Meta State sounds
// different from this.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const SECONDS = Math.max(4, Number(opt('seconds', 16)) || 16);
const OUT = path.resolve(ROOT, String(opt('out', 'tools/.cache/joytone-measure')));
const HEADFUL = !!opt('headful', false);
const DO_SFX = !args.includes('--no-sfx');
const SR = 44100;
const toneArg = opt('tone', null);
const TONE_OVERRIDE = !toneArg ? null
    : JSON.parse(String(toneArg).startsWith('@') ? fs.readFileSync(String(toneArg).slice(1), 'utf8') : toneArg);

// Each scenario: a fresh page, then setup in the page, then SECONDS of recording.
// tension: 0..1 (game-core.js updateMusicTension). tile: an element riff
// (bridge addTileTheme), and playback jumps to that riff so it is what we hear.
// sweep: tension moves 0 -> 1 in 10 steps while recording (tempo change glitches).
const SCENARIOS = [
    { name: 'calm',        about: 'game start, tension 0',              tension: 0 },
    { name: 'mid',         about: 'tension 0.5',                        tension: 0.5 },
    { name: 'peak',        about: 'tension 1 (someone about to win)',   tension: 1 },
    { name: 'sweep',       about: 'tension 0 to 1 in 10 steps',         tension: 0, sweep: true },
    { name: 'salsa',       about: 'Spanish salsa layer, tension 0',     tension: 0, salsa: true },
    { name: 'salsa-peak',  about: 'salsa layer, tension 1',             tension: 1, salsa: true },
    { name: 'tile-earth',  about: 'earth tile riff',                    tension: 0.2, tile: 'earth' },
    { name: 'tile-water',  about: 'water tile riff',                    tension: 0.2, tile: 'water' },
    { name: 'tile-fire',   about: 'fire tile riff',                     tension: 0.2, tile: 'fire' },
    { name: 'tile-wind',   about: 'wind tile riff',                     tension: 0.2, tile: 'wind' },
    { name: 'tile-void',   about: 'void tile riff',                     tension: 0.2, tile: 'void' },
    { name: 'tile-catacomb', about: 'catacomb (two element) riff',      tension: 0.2, tile: 'catacomb' },
];

// Game play volumes (js/sounds.js). Not listed = 1.
const SFX_VOLUME = { collectstones: 0.55, footsteps: 0.7 };

const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const db = (x) => x > 0 ? 20 * Math.log10(x) : -Infinity;
const r1 = (x) => Number.isFinite(x) ? Math.round(x * 10) / 10 : x;
const fmt = (x, unit = '') => Number.isFinite(x) ? `${r1(x)}${unit}` : '-inf';

// ── Static file server for the repo (joytone fetches midi / sf2 / mp3) ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.sf2': 'application/octet-stream', '.mid': 'audio/midi' };
function serve() {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
            const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
            if (!p.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
            fs.readFile(p, (e, d) => {
                if (e) { res.statusCode = 404; return res.end(); }
                res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
                res.end(d);
            });
        });
        srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

// ── In-page recorder ─────────────────────────────────────────────────
// Runs inside joytone/index.html. audioCtx / softClip / masterOut are its
// script-level lets, so page.evaluate can reach them by name.
async function recordInPage({ sc, seconds, tone }) {
    const A = window.JoytoneAPI;
    if (tone) Object.assign(TONE, tone); // before boot builds the audio graph
    if (tone?.partials) BASS_PARTIALS.splice(0, BASS_PARTIALS.length, ...tone.partials);
    const shelf = () => { // tone.bassGain: try another master bass shelf (dB) too
        if (tone?.bassGain == null) return;
        project.masterFx.bassGain = tone.bassGain;
        bassBoost.gain.value = tone.bassGain;
    };
    await A.boot();
    shelf();
    const mute = () => { // tone.mute: track labels to silence (find who makes what)
        if (!tone?.mute) return;
        for (const sec of Object.values(project.sections))
            for (const t of Object.values(sec.tracks))
                if (tone.mute.some(m => t.label.includes(m))) { t.muted = true; trackEngines[t.id]?.apply?.(t); }
        rebuildEngines();
    };
    mute();
    // tone.roles: per-track settings by label ({volume, reverbSend, effects: {...}}),
    // tone.master: master settings (compThreshold, limiterCeiling, bassGain, ...).
    const style = () => {
        if (tone?.roles) for (const sec of Object.values(project.sections)) for (const t of Object.values(sec.tracks)) {
            const r = tone.roles[t.label];
            if (!r) continue;
            if (r.volume != null) t.volume = r.volume;
            if (r.reverbSend != null) t.reverbSend = r.reverbSend;
            t.effects = { ...t.effects, ...(r.effects || {}) };
            trackEngines[t.id]?.apply(t);
        }
        if (tone?.master) { Object.assign(project.masterFx, tone.master); applyMasterFxToAudio(0.01); }
    };
    style();
    if (tone?.section != null) { // start playback at this section index
        stopPlayback(); activeSectionId = project.sectionOrder[tone.section]; startPlayback(0);
    }
    if (sc.salsa) A.setSalsa(true);
    A.setTension(sc.tension);
    if (sc.tile) {
        const before = new Set(project.sectionOrder);
        const key = await A.addTileTheme(sc.tile, 'measure:' + sc.tile);
        const fresh = project.sectionOrder.find(id => !before.has(id));
        if (!key || !fresh) throw new Error('tile riff was not added: ' + sc.tile);
        // Jump playback to the new riff (startPlayback starts at activeSectionId).
        stopPlayback();
        activeSectionId = fresh;
        startPlayback(0);
        if (sc.salsa) A.setSalsa(true);
        A.setTension(sc.tension);
        mute(); style();
    }

    // AudioWorklet taps: 'out' records the final output, 'pre' only keeps
    // peak stats of the signal going into the soft clipper.
    const code = `
      class Rec extends AudioWorkletProcessor {
        constructor(o) { super(); this.mode = o.processorOptions.mode; this.on = false;
          this.peak = 0; this.over = 0; this.n = 0;
          this.port.onmessage = (e) => { this.on = e.data === 'on';
            if (e.data === 'stats') this.port.postMessage({ peak: this.peak, over: this.over, n: this.n }); }; }
        process(inputs) {
          const a = inputs[0];
          if (!this.on || !a || !a.length) return true;
          const L = a[0], R = a[1] || a[0];
          if (this.mode === 'out') this.port.postMessage([L.slice(), R.slice()]);
          else for (let i = 0; i < L.length; i++) {
            const m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
            if (m > this.peak) this.peak = m; if (m > 1) this.over++; this.n++; }
          return true;
        }
      }
      registerProcessor('jt-rec', Rec);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    await audioCtx.audioWorklet.addModule(url);
    const sink = audioCtx.createGain(); sink.gain.value = 0; sink.connect(audioCtx.destination);
    const out = new AudioWorkletNode(audioCtx, 'jt-rec', { channelCount: 2, channelCountMode: 'explicit', processorOptions: { mode: 'out' } });
    const pre = new AudioWorkletNode(audioCtx, 'jt-rec', { channelCount: 2, channelCountMode: 'explicit', processorOptions: { mode: 'pre' } });
    softClip.connect(out); masterOut.connect(pre);
    out.connect(sink); pre.connect(sink);
    const L = [], R = [];
    out.port.onmessage = (e) => { L.push(e.data[0]); R.push(e.data[1]); };

    await new Promise(r => setTimeout(r, 800)); // let the new section settle in
    const events = [];
    const t0 = audioCtx.currentTime;
    out.port.postMessage('on'); pre.port.postMessage('on');
    if (sc.sweep) {
        for (let k = 1; k <= 10; k++) setTimeout(() => {
            A.setTension(k / 10);
            events.push({ t: audioCtx.currentTime - t0, what: 'tension ' + (k / 10) });
        }, k * seconds * 1000 / 11);
    }
    await new Promise(r => setTimeout(r, seconds * 1000));
    out.port.postMessage('off');
    const preStats = await new Promise(r => { pre.port.onmessage = (e) => r(e.data); pre.port.postMessage('stats'); });
    await new Promise(r => setTimeout(r, 100));
    const st = A.getState();

    const n = L.reduce((s, b) => s + b.length, 0);
    const buf = new Float32Array(n * 2);
    let o = 0;
    for (let b = 0; b < L.length; b++) for (let i = 0; i < L[b].length; i++) { buf[o++] = L[b][i]; buf[o++] = R[b][i]; }
    // Hand back as base64 (Playwright passes strings fast; arrays slowly).
    const bytes = new Uint8Array(buf.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { b64: btoa(s), frames: n, sampleRate: audioCtx.sampleRate, preStats, events,
        state: { tempo: st.tempo, salsa: st.salsa, used: st.used, sections: st.sections } };
}

// ── WAV writer (32-bit float, interleaved stereo) ────────────────────
function writeWav(file, inter, sr) {
    const data = Buffer.from(inter.buffer, inter.byteOffset, inter.byteLength);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
    h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
    h.write('data', 36); h.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([h, data]));
}

// ── ffmpeg: loudness ─────────────────────────────────────────────────
// Laptop speakers: almost nothing below about 200 Hz. Two 2nd-order high-pass
// filters (24 dB per octave) at 200 Hz stand in for one.
const LAPTOP = 'highpass=f=200:p=2,highpass=f=200:p=2';
function ebur128(file, volume = 1, pre = '') {
    // apad: sounds shorter than 400 ms still get a momentary (M) reading.
    const af = (pre ? pre + ',' : '') + (volume !== 1 ? `volume=${volume},` : '') + 'apad=pad_dur=0.5,ebur128=peak=true';
    const txt = execFileSyncSafe('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', af, '-f', 'null', '-']);
    const summary = txt.slice(txt.lastIndexOf('Summary:'));
    const g = (re) => { const m = summary.match(re); return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : NaN; };
    const M = [], S = [];
    for (const m of txt.matchAll(/t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+|-inf)\s+S:\s*(-?[\d.]+|-inf)/g)) {
        M.push({ t: +m[1], v: Number(m[2]) }); S.push({ t: +m[1], v: Number(m[3]) });
    }
    return { I: g(/I:\s+(-?[\d.]+|-inf) LUFS/), LRA: g(/LRA:\s+(-?[\d.]+) LU/), TP: g(/Peak:\s+(-?[\d.]+|-inf) dBFS/), M, S };
}
// ffmpeg prints its report on stderr: run it through sh with 2>&1.
function execFileSyncSafe(cmd, a) {
    try {
        return execFileSync('sh', ['-c', '"$0" "$@" 2>&1', cmd, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
    } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

// ── Sample checks done in Node ───────────────────────────────────────
function fftMag(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k, b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
            }
        }
    }
}

function analyze(inter, sr) {
    const n = inter.length / 2;
    let peak = 0, full = 0, sumL = 0, sumR = 0, eL = 0, eR = 0, eLR = 0;
    for (let i = 0; i < n; i++) {
        const l = inter[2 * i], r = inter[2 * i + 1];
        const m = Math.max(Math.abs(l), Math.abs(r));
        if (m > peak) peak = m;
        if (m >= 0.999) full++;
        sumL += l; sumR += r; eL += l * l; eR += r * r; eLR += l * r;
    }
    const dcL = sumL / n, dcR = sumR / n;
    const corr = eL > 0 && eR > 0 ? eLR / Math.sqrt(eL * eR) : 1;
    const balance = db(Math.sqrt(eL / n)) - db(Math.sqrt(eR / n)); // + = left louder

    // Drop-outs: 50 ms windows far below the median window.
    const W = Math.round(sr * 0.05), rms = [];
    for (let s = 0; s + W <= n; s += W) {
        let e = 0;
        for (let i = s; i < s + W; i++) { const m = (inter[2 * i] + inter[2 * i + 1]) / 2; e += m * m; }
        rms.push(db(Math.sqrt(e / W)));
    }
    const sorted = rms.filter(Number.isFinite).sort((a, b) => a - b);
    const median = sorted.length ? sorted[sorted.length >> 1] : -Infinity;
    // A drop-out is a SHORT hole (50 to 150 ms) 30 dB+ under the median with
    // sound on both sides. Longer quiet stretches are rests in the music.
    const dropouts = [];
    const quiet = (k) => rms[k] < median - 30, loud = (k) => rms[k] > median - 12;
    for (let k = 1; k < rms.length - 1; k++) {
        if (median <= -45 || !quiet(k) || quiet(k - 1)) continue;
        let e = k; while (e + 1 < rms.length && quiet(e + 1)) e++;
        if (e - k < 3 && e + 1 < rms.length && loud(k - 1) && loud(e + 1)) dropouts.push(r1(k * 0.05));
        k = e;
    }

    // Possible clicks: one sample step much bigger than the steps in the
    // 10 ms before AND after it. Noise drum hits (shaker, conga) have many
    // big steps in a row, so they do not count.
    const clicks = [];
    const D = Math.round(sr * 0.01);
    for (const ch of [0, 1]) {
        const cum = new Float64Array(n + 1); // cum[i] = sum of steps up to sample i
        for (let i = 1; i < n; i++) cum[i + 1] = cum[i] + Math.abs(inter[2 * i + ch] - inter[2 * (i - 1) + ch]);
        for (let i = D + 1; i < n - D - 1; i++) {
            const d = cum[i + 1] - cum[i];
            if (d <= 0.25) continue;
            const before = (cum[i] - cum[i - D]) / D, after = (cum[i + 1 + D] - cum[i + 1]) / D;
            if (d > 10 * before && d > 10 * after) {
                const t = r1(i / sr);
                if (!clicks.length || t - clicks[clicks.length - 1] > 0.05) clicks.push(t);
            }
        }
    }
    clicks.sort((a, b) => a - b);

    // Tone: average power spectrum of the mid signal, 4096-point Hann frames.
    const N = 4096, bins = new Float64Array(N / 2);
    const hann = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    let frames = 0;
    for (let s = 0; s + N <= n; s += N) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < N; i++) re[i] = hann[i] * (inter[2 * (s + i)] + inter[2 * (s + i) + 1]) / 2;
        fftMag(re, im);
        for (let k = 0; k < N / 2; k++) bins[k] += re[k] * re[k] + im[k] * im[k];
        frames++;
    }
    let tot = 0, cen = 0, low = 0, mid = 0, high = 0;
    for (let k = 1; k < N / 2; k++) {
        const f = k * sr / N, p = bins[k];
        tot += p; cen += f * p;
        if (f < 250) low += p; else if (f < 4000) mid += p; else high += p;
    }
    const rel = (x) => tot > 0 && x > 0 ? r1(10 * Math.log10(x / tot)) : -Infinity;
    return {
        seconds: r1(n / sr), peakDb: r1(db(peak)), fullScaleSamples: full,
        dcOffset: Math.round(Math.max(Math.abs(dcL), Math.abs(dcR)) * 1e5) / 1e5,
        balanceDb: r1(balance), correlation: Math.round(corr * 100) / 100,
        dropouts: dropouts.slice(0, 20), dropoutCount: dropouts.length,
        clicks: clicks.slice(0, 20), clickCount: clicks.length,
        centroidHz: tot > 0 ? Math.round(cen / tot) : 0,
        bands: { low: rel(low), mid: rel(mid), high: rel(high) },
        median50msDb: r1(median),
    };
}

// ── Pictures ─────────────────────────────────────────────────────────
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf'].find(f => fs.existsSync(f));
function pngSize(file) {
    const b = fs.readFileSync(file);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function picture(wav, png, label) {
    // Spectrogram with frequency / time labels (20 Hz to 22 kHz, log scale,
    // fixed 90 dB range) and above it a waveform of the same width (sqrt
    // scale so quiet parts show; full height = full scale). Every scenario
    // is drawn on the same scales. No start= / stop= range: ffmpeg 6.1 then
    // draws tones at the wrong height (a 100 Hz tone near 1 kHz).
    const spec = png + '.spec.png', wave = png + '.wave.png';
    execFileSyncSafe('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-lavfi',
        'showspectrumpic=s=1100x340:legend=1:scale=log:fscale=log:color=intensity:drange=90', '-frames:v', '1', spec]);
    const { w } = pngSize(spec);
    const text = FONT ? `,drawtext=fontfile=${FONT}:text='${label.replace(/[':\\]/g, ' ')}':x=8:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6` : '';
    execFileSyncSafe('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-lavfi',
        `showwavespic=s=${w}x140:split_channels=0:colors=#7fd1ff:scale=sqrt${text}`, '-frames:v', '1', wave]);
    execFileSyncSafe('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wave, '-i', spec, '-filter_complex',
        '[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]vstack[v]', '-map', '[v]', '-frames:v', '1', png]);
    fs.rmSync(spec, { force: true }); fs.rmSync(wave, { force: true });
}
function grid(pngs, out) {
    if (!pngs.length) return;
    const inputs = pngs.flatMap(p => ['-i', p]);
    const fc = pngs.map((_, i) => `[${i}:v]`).join('') + `vstack=inputs=${pngs.length}[v]`;
    execFileSyncSafe('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', pngs.length > 1 ? fc : '[0:v]copy[v]', '-map', '[v]', '-frames:v', '1', out]);
}

// ── Warnings in plain words ──────────────────────────────────────────
function warningsFor(r) {
    const w = [];
    if (r.loud.TP > -1) w.push(`true peak ${fmt(r.loud.TP)} dBTP is over -1 (may distort after MP3 / Bluetooth / OS mixing)`);
    if (r.samples.fullScaleSamples > 0) w.push(`${r.samples.fullScaleSamples} samples at full scale (hard clipping)`);
    if (r.pre.overPct > 0.1) w.push(`${r.pre.overPct}% of samples go over 1.0 into the soft clipper (peak ${fmt(r.pre.peakDb)} dBFS before it): it is distorting, not just guarding`);
    if (r.samples.clickCount) w.push(`${r.samples.clickCount} possible clicks at ${r.samples.clicks.join(', ')} s`);
    if (r.samples.dropoutCount) w.push(`${r.samples.dropoutCount} drop-outs (sudden silence) at ${r.samples.dropouts.join(', ')} s`);
    if (r.samples.dcOffset > 0.005) w.push(`DC offset ${r.samples.dcOffset}`);
    if (Math.abs(r.samples.balanceDb) > 3) w.push(`left / right off balance by ${r.samples.balanceDb} dB`);
    if (r.samples.correlation < 0.2) w.push(`stereo correlation ${r.samples.correlation}: parts may cancel on a mono speaker (phones)`);
    if (r.loud.LRA > 15) w.push(`loudness range ${r.loud.LRA} LU is wide for background music`);
    return w;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
    if (args.includes('--list')) {
        for (const s of SCENARIOS) console.log(s.name.padEnd(15), s.about);
        return;
    }
    const only = opt('only', null);
    const picked = only ? SCENARIOS.filter(s => String(only).split(',').includes(s.name)) : SCENARIOS;
    if (!picked.length) { console.error('No such scenario. Use --list.'); process.exit(2); }
    if (!/ffmpeg version/.test(execFileSyncSafe('ffmpeg', ['-version']))) { console.error('ffmpeg is not on PATH'); process.exit(2); }

    fs.mkdirSync(OUT, { recursive: true });
    const prevFile = path.join(OUT, 'report.json');
    let prev = null;
    if (fs.existsSync(prevFile)) {
        prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
        fs.copyFileSync(prevFile, path.join(OUT, 'report.prev.json'));
    }

    const srv = await serve();
    const base = `http://127.0.0.1:${srv.address().port}/joytone/index.html`;
    const browser = await chromium.launch({ headless: !HEADFUL, args: ['--autoplay-policy=no-user-gesture-required'] });
    say(`Recording ${picked.length} scenarios x ${SECONDS} s (real time, about ${Math.ceil(picked.length * (SECONDS + 6) / 60)} min)`);

    const results = [];
    for (const sc of picked) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message || e)));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        try {
            await page.goto(base);
            await page.waitForFunction(() => window.JoytoneAPI, null, { timeout: 20000 });
            const got = await page.evaluate(recordInPage, { sc, seconds: SECONDS, tone: TONE_OVERRIDE });
            const raw = Buffer.from(got.b64, 'base64');
            const inter = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
            const wav = path.join(OUT, sc.name + '.wav');
            writeWav(wav, inter, got.sampleRate);
            const loud = ebur128(wav);
            const laptop = ebur128(wav, 1, LAPTOP);
            const S = loud.S.filter(x => x.t >= 3 && Number.isFinite(x.v) && x.v > -70).map(x => x.v);
            const samples = analyze(inter, got.sampleRate);
            const pre = { peakDb: r1(db(got.preStats.peak)), overPct: got.preStats.n ? Math.round(1000 * got.preStats.over / got.preStats.n) / 10 : 0 };
            const r = {
                name: sc.name, about: sc.about, tempo: got.state.tempo, salsa: got.state.salsa, riffs: got.state.used,
                loud: { I: r1(loud.I), LRA: r1(loud.LRA), TP: r1(loud.TP), laptop: r1(laptop.I), Smin: r1(Math.min(...S)), Smax: r1(Math.max(...S)) },
                pre, samples, events: got.events, errors: errors.slice(0, 5),
            };
            if (sc.sweep) {
                // Short-term loudness at each tension step (just before the next step).
                r.sweep = got.events.map((ev, i) => {
                    const until = got.events[i + 1]?.t ?? SECONDS;
                    // Mean momentary (400 ms) loudness over this step, skipping its first 0.4 s.
                    const vals = loud.M.filter(x => x.t <= until && x.t > ev.t + 0.4 && x.v > -70).map(x => x.v);
                    const mean = vals.length ? 10 * Math.log10(vals.reduce((a, v) => a + Math.pow(10, v / 10), 0) / vals.length) : NaN;
                    return { at: r1(ev.t), what: ev.what, M: r1(mean) };
                });
            }
            r.warnings = warningsFor(r);
            picture(wav, path.join(OUT, sc.name + '.png'), `${sc.name}: ${sc.about}`);
            results.push(r);
            say(`${sc.name.padEnd(14)} I ${fmt(r.loud.I)} LUFS  TP ${fmt(r.loud.TP)}  ${r.warnings.length ? r.warnings.length + ' warnings' : 'ok'}`);
        } catch (e) {
            results.push({ name: sc.name, about: sc.about, failed: String(e.message || e), errors });
            say(`${sc.name.padEnd(14)} FAILED: ${e.message || e}`);
        }
        await page.close();
    }
    await browser.close();
    srv.close();
    grid(results.filter(r => !r.failed).map(r => path.join(OUT, r.name + '.png')), path.join(OUT, 'grid.png'));

    // Sound effects at game volume.
    const sfx = [];
    if (DO_SFX) {
        const files = [];
        for (const f of fs.readdirSync(path.join(ROOT, 'sounds'))) if (/\.(mp3|ogg|wav)$/i.test(f)) files.push(['sounds/' + f, f.replace(/\.\w+$/, '')]);
        const steps = path.join(ROOT, 'sounds/footsteps');
        if (fs.existsSync(steps)) for (const f of fs.readdirSync(steps)) if (/\.(mp3|ogg|wav)$/i.test(f)) files.push(['sounds/footsteps/' + f, 'footsteps']);
        for (const [rel, key] of files) {
            const vol = SFX_VOLUME[key] ?? 1;
            const l = ebur128(path.join(ROOT, rel), vol);
            const Mmax = Math.max(...l.M.map(x => x.v).filter(Number.isFinite));
            sfx.push({ file: rel, volume: vol, Mmax: r1(Mmax), TP: r1(l.TP), I: r1(l.I) });
        }
    }

    const ok = results.filter(r => !r.failed);
    const musicRef = ok.find(r => r.name === 'calm') || ok[0];
    const report = { when: new Date().toISOString(), seconds: SECONDS, tone: TONE_OVERRIDE, scenarios: results, sfx };
    fs.writeFileSync(prevFile, JSON.stringify(report, null, 1));
    fs.writeFileSync(path.join(OUT, 'report.md'), toMarkdown(report, prev, musicRef));
    say(`Done. Read ${path.relative(ROOT, path.join(OUT, 'report.md'))} and grid.png`);
}

function toMarkdown(rep, prev, musicRef) {
    const P = new Map((prev?.scenarios || []).filter(s => !s.failed).map(s => [s.name, s]));
    const delta = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) >= 0.1) ? ` (${a - b > 0 ? '+' : ''}${r1(a - b)})` : '';
    const L = [];
    L.push(`# Joytone measure report`, ``, `${rep.when}, ${rep.seconds} s per scenario, output at volume 1.`);
    if (rep.tone) L.push(``, `TONE override for this run: \`${JSON.stringify(rep.tone)}\``);
    if (prev) L.push(`Numbers in brackets = change since the run of ${prev.when}.`);
    L.push(``, `Targets for game background music: about -20 to -16 LUFS integrated, true peak under -1 dBTP,`,
        `scenarios within about 3 LU of each other so a mood change does not jump in volume.`,
        `"On laptop" = the same music through a 200 Hz high-pass like small laptop speakers (in brackets: how much`,
        `quieter it gets). A big drop means most of the music is bass the speakers cannot play.`, ``);
    L.push(`| Scenario | BPM | Integrated LUFS | On laptop LUFS | Short-term min / max | LRA | True peak dBTP | Into clipper | Centroid Hz | Low / mid / high dB | Corr | Warnings |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of rep.scenarios) {
        if (r.failed) { L.push(`| ${r.name} | | FAILED: ${r.failed} | | | | | | | | | |`); continue; }
        const p = P.get(r.name);
        L.push(`| ${r.name} | ${r.tempo} | ${fmt(r.loud.I)}${delta(r.loud.I, p?.loud?.I)} | ${fmt(r.loud.laptop)}${delta(r.loud.laptop, p?.loud?.laptop)} (${fmt(r.loud.laptop - r.loud.I)}) | ${fmt(r.loud.Smin)} / ${fmt(r.loud.Smax)} | ${fmt(r.loud.LRA)} | ${fmt(r.loud.TP)}${delta(r.loud.TP, p?.loud?.TP)} | ${r.pre.overPct}% (peak ${fmt(r.pre.peakDb)}) | ${r.samples.centroidHz} | ${fmt(r.samples.bands.low)} / ${fmt(r.samples.bands.mid)} / ${fmt(r.samples.bands.high)} | ${r.samples.correlation} | ${r.warnings.length} |`);
    }
    const Is = rep.scenarios.filter(r => !r.failed).map(r => r.loud.I).filter(Number.isFinite);
    if (Is.length > 1) L.push(``, `Spread of integrated loudness across scenarios: ${r1(Math.max(...Is) - Math.min(...Is))} LU.`);

    const sw = rep.scenarios.find(r => r.sweep);
    if (sw) {
        L.push(``, `## Tension sweep`, ``, `Mean momentary loudness during each step (rests left out). The tension also changes the tempo, the bit crusher and the sample rate reducer:`, ``);
        L.push(sw.sweep.map(s => `- ${s.at} s, ${s.what}: ${fmt(s.M)} LUFS`).join('\n'));
    }

    L.push(``, `## Warnings`, ``);
    let any = false;
    for (const r of rep.scenarios) {
        if (r.failed) { L.push(`- **${r.name}**: failed (${r.failed})`); any = true; continue; }
        for (const w of r.warnings) { L.push(`- **${r.name}**: ${w}`); any = true; }
        for (const e of r.errors || []) { L.push(`- **${r.name}**: page error: ${e}`); any = true; }
    }
    if (!any) L.push(`None.`);

    if (rep.sfx.length && musicRef && !musicRef.failed) {
        const ref = musicRef.loud.I;
        L.push(``, `## Sound effects vs music`, ``,
            `Effects at the volume the game plays them (js/sounds.js). "Max momentary" = loudest 400 ms.`,
            `"Over music" compares it with the ${musicRef.name} music (${fmt(ref)} LUFS). About +6 to +12 LU reads clearly over the music without startling.`, ``,
            `| File | Volume | Max momentary LUFS | Over music LU | True peak dBTP |`, `|---|---|---|---|---|`);
        for (const s of rep.sfx.sort((a, b) => b.Mmax - a.Mmax))
            L.push(`| ${s.file} | ${s.volume} | ${fmt(s.Mmax)} | ${Number.isFinite(s.Mmax) && Number.isFinite(ref) ? (s.Mmax - ref > 0 ? '+' : '') + r1(s.Mmax - ref) : ''} | ${fmt(s.TP)} |`);
    }

    L.push(``, `## Pictures`, ``, `Each <scenario>.png: waveform (top, square-root scale so quiet parts show, full height = full scale)`,
        `and spectrogram (bottom, 20 Hz to 22 kHz on a log scale, 90 dB range, brighter = louder, labelled axes).`,
        `grid.png stacks them all on the same scales.`);
    return L.join('\n') + '\n';
}

main().catch(e => { console.error(e); process.exit(1); });
