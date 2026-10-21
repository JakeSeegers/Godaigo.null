// tools/joytone-mixes/build-dnb.mjs: builds an FX state bank with the owner's
// FX 1 (unchanged) plus "DnB band", a drum-and-bass variant with a band's
// attack. Sound only: an FX state cannot change notes or drum patterns.
//   node tools/joytone-mixes/build-dnb.mjs
// -> tools/joytone-mixes/Five_Elements_Theme-fx-states-dnb.json (upload it in
// the Joytone popup, Shift+J+T, then click FX 1 / DnB band to compare).
// Measure: node tools/joytone-measure.mjs --tone '{"bankFile":"tools/joytone-mixes/Five_Elements_Theme-fx-states-dnb.json","recall":1}'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(DIR, 'owner-fx-states.json'), 'utf8'));
const owner = bank.snapshots[0];

// Per role (track label). Only listed keys change; the rest stays the owner's.
// Horn, Temple bells and the Shakuhachi lead stay as the owner set them
// (subtle on purpose).
const ROLES = {
  // The bass is the riff: a saw voice, gritty, with a filter wobble on 8th
  // notes at the game tempo (94 BPM = 3.13 Hz), so each held note moves.
  // Mid lift at 700 Hz: the growl is what laptop speakers hear.
  'Strings (drone)': { instrument: 'chisaw', volume: 0.7, reverbSend: 0.04, effects: {
    filterType: 'lowpass', filterCutoff: 900, filterRes: 5, lfoDepth: 0.7, lfoRate: 3.13,
    distDrive: 0.6, distMix: 0.45, eqHPF: 30, eqLowGain: 3, eqMidFreq: 700, eqMidGain: 4, eqMidQ: 1,
    eqHighGain: -4, revrevSend: 0, delayMix: 0, pan: 0 } },
  // Kick: short and punchy, click on top, no mud.
  'Kick': { volume: 1, effects: {
    eqHPF: 40, eqLowGain: 3, eqMidFreq: 300, eqMidGain: -4, eqMidQ: 1, eqHighGain: 4,
    filterType: 'lowpass', filterCutoff: 9000, filterRes: 0.7, lfoDepth: 0, distDrive: 0.5, distMix: 0.3 } },
  // Snare: the loud crack drum and bass lives on.
  'Snare': { volume: 1, reverbSend: 0.12, effects: {
    filterType: 'lowpass', filterCutoff: 12000, filterRes: 0.7, eqHPF: 120, eqMidFreq: 220, eqMidGain: 4,
    eqMidQ: 1.2, eqHighGain: 3, distDrive: 0.4, distMix: 0.25, pan: 0 } },
  // Taiko plays a busier rhythm than the snare: as a quiet second snare it
  // gives the ghost notes that make a break feel restless.
  'Taiko (Earth)': { instrument: 'snare', volume: 0.35, reverbSend: 0.05, effects: {
    filterType: 'lowpass', filterCutoff: 7000, filterRes: 0.7, eqHPF: 200, eqMidGain: 0, eqHighGain: 1,
    lfoDepth: 0, distDrive: 0.2, distMix: 0.15, pan: 0.15 } },
  // Hats: bright, with a short 1/16 echo so they roll.
  'Hat': { volume: 0.5, effects: {
    filterType: 'highpass', filterCutoff: 5000, filterRes: 0.7, eqLowGain: 0, eqMidGain: 0, eqHighGain: 2,
    delayMix: 0.18, delaySync: '1/16', delayFeedback: 0.2, pan: 0.25 } },
  // Koto + Shamisen: the band. Distorted, left and right like two guitars.
  'Koto (Water)': { instrument: 'guitar', volume: 0.5, effects: {
    filterType: 'lowpass', filterCutoff: 4500, filterRes: 1, eqHPF: 120, eqMidFreq: 1500, eqMidGain: 3,
    eqMidQ: 1, distDrive: 0.85, distMix: 0.6, delayMix: 0.12, delaySync: '1/8', delayFeedback: 0.2, pan: -0.4 } },
  'Shamisen (Fire)': { volume: 0.2, effects: {
    filterType: 'lowpass', filterCutoff: 3800, filterRes: 1, eqHPF: 200, eqMidGain: 0, eqHighGain: -4,
    distDrive: 0.6, distMix: 0.4, pan: 0.4 } },
};
ROLES['Hi-Hat'] = ROLES['Hat'];

// Master: keep drum hits punchy (gentler compressor, limiter not crushing).
// The bass shelf stays at the owner's -6.5: higher drives the TONE stage's
// laptop-bass copy into its buzz; the bass weight comes from the drone track.
// masterVolume matches FX 1's loudness (measured), so a comparison is fair.
const MASTER = { compThreshold: -28, compRatio: 4,
  limiterCeiling: -6, masterVolume: 0.42, hissLevel: 0, derezBits: 12, derezRate: 0.5, derezMix: 0.12 };

const patch = (t) => {
  const r = ROLES[t.label];
  if (!r) return 0;
  if (r.instrument) t.instrument = r.instrument;
  if (r.volume != null) t.volume = r.volume;
  if (r.reverbSend != null) t.reverbSend = r.reverbSend;
  t.effects = { ...t.effects, ...r.effects };
  return 1;
};
const dnb = JSON.parse(JSON.stringify(owner));
Object.assign(dnb, { id: 'dnb_band_1', label: 'DnB band', createdAt: new Date().toISOString(), tempo: 174 });
dnb.masterFx = { ...dnb.masterFx, ...MASTER };
let n = 0;
for (const sec of Object.values(dnb.sections)) for (const t of Object.values(sec.tracks)) n += patch(t);
for (const t of Object.values(dnb.roles || {})) patch(t);
const out = { type: 'daw-fx-state-bank', version: 2, exportedAt: new Date().toISOString(),
  projectTitle: bank.projectTitle, snapshots: [owner, dnb] };
fs.writeFileSync(path.join(DIR, 'Five_Elements_Theme-fx-states-dnb.json'), JSON.stringify(out, null, 2));
console.log(`DnB band: ${n} tracks changed`);
