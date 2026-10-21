// tools/joytone-mixes/build-fx3-mastered.mjs: the owner's FX 3 with its track
// levels balanced. Writes a bank with FX 1, DnB band, FX 3 (all unchanged) and
// "FX 3 mastered".  node tools/joytone-mixes/build-fx3-mastered.mjs
// Measured with tools/joytone-measure.mjs, each track alone after recalling
// FX 3 (compressor, limiter and lo-fi off), integrated loudness in the Union
// section (bells: Void section):
//   bass drone -13, kick -30.6, snare -42.1, Koto -24.4, Shamisen -29.6,
//   lead -42.8, Taiko -52.6, hat -50.6, Horn -61.4, bells -41.8 LUFS.
// The bass was 11 dB over the riff and the drums were buried (a track's
// volume tops out at 1, and the snare synth is ~30 dB quieter than the
// distorted saw bass). So: the owner's riff and subtle parts keep their
// levels, the bass comes down to ~4 dB over the riff, the drums get drive +
// EQ to reach it. Sections grown later from the Meta State (6 of 36) get the
// same settings per track as the rest (instruments kept), so nothing changes
// sound halfway through. The master is the owner's, only its volume moves to
// match FX 3's loudness.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(DIR, 'owner-fx-states-3.json'), 'utf8'));
const fx3 = bank.snapshots.find(s => s.label === 'FX 3');
const MASTER_VOLUME = Number(process.argv[2] || 0.77); // matches FX 3's loudness (measured)

// Per label: volume and effect changes on top of FX 3's main settings.
const ROLES = {
  'Strings (drone)': { volume: 0.22 },                                  // measured: ~4 dB over the riff (its drive squashes level changes)
  'Kick':            { volume: 1, effects: { distDrive: 0.6, distMix: 0.6 } },   // +8 dB, ~2 dB over the riff
  'Snare':           { volume: 0.86, effects: { distDrive: 0.8, distMix: 0.8,    // +15 dB with drive + mid
                       eqMidFreq: 1800, eqMidGain: 5, eqMidQ: 0.6 } },
  'Taiko (Earth)':   { volume: 0.47, effects: { distDrive: 0.6, distMix: 0.6,    // ghost snare, 10 dB under the riff
                       eqMidFreq: 1800, eqMidGain: 4, eqMidQ: 0.6 } },
  'Hat':             { volume: 1, effects: { eqHighGain: 6 } },          // audible, still well under the riff
};
ROLES['Hi-Hat'] = ROLES['Hat'];

// Main settings per label = the most common one in FX 3.
const main = {};
const counts = {};
for (const sec of Object.values(fx3.sections)) for (const t of Object.values(sec.tracks)) {
  const k = JSON.stringify({ v: t.volume, r: t.reverbSend, e: t.effects });
  (counts[t.label] ||= {})[k] = (counts[t.label][k] || 0) + 1;
}
for (const [label, c] of Object.entries(counts)) {
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  main[label] = JSON.parse(best);
}

const out = JSON.parse(JSON.stringify(fx3));
Object.assign(out, { id: 'fx3_mastered_1', label: 'FX 3 mastered', createdAt: new Date().toISOString() });
out.masterFx = { ...out.masterFx, masterVolume: MASTER_VOLUME };
const apply = (t) => {
  const m = main[t.label];
  if (m) { t.volume = m.v; t.reverbSend = m.r; t.effects = { ...m.e }; } // instrument kept
  const r = ROLES[t.label];
  if (r) {
    if (r.volume != null) t.volume = r.volume;
    t.effects = { ...t.effects, ...(r.effects || {}) };
  }
};
for (const sec of Object.values(out.sections)) for (const t of Object.values(sec.tracks)) apply(t);
for (const t of Object.values(out.roles || {})) apply(t);

const result = { type: 'daw-fx-state-bank', version: 2, exportedAt: new Date().toISOString(),
  projectTitle: bank.projectTitle, snapshots: [...bank.snapshots, out] };
fs.writeFileSync(path.join(DIR, 'Five_Elements_Theme-fx-states-fx3-mastered.json'), JSON.stringify(result, null, 2));
console.log(`FX 3 mastered: masterVolume ${MASTER_VOLUME}, states: ${result.snapshots.map(s => s.label).join(', ')}`);
