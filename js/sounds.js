(function () {
    'use strict';

    const BASE = 'sounds/';
    const FOOTSTEP_DIR = 'sounds/footsteps/';

    // Sequential footstep rotation — cycles through all files so no step repeats consecutively
    const FOOTSTEP_FILES = [
        'step_cloth1.ogg',
        'step_cloth2.ogg',
        'step_cloth3.ogg',
        'step_cloth4.ogg',
        'step_lth1.ogg',
        'step_lth2.ogg',
        'step_lth33.ogg',
        'step_lth4.ogg',
        'step_metal.ogg',
        'step_metal (2).ogg',
        'step_metal (3).ogg',
        'step_metal (4).ogg',
    ];

    const SOUNDS = {
        click:          BASE + 'clicksounds.mp3',
        zipclick:       BASE + 'zipclick.mp3',
        error:          BASE + 'error.mp3',
        activatescroll: BASE + 'activatescroll.mp3',
        breakstone:     BASE + 'breakstone.mp3',
        collectstones:  BASE + 'collectstones.mp3',
        endturn:        BASE + 'endturn.mp3',
        placeearthstone: BASE + 'placeearthstone.mp3',
        placestone:      BASE + 'placestone.mp3',
        placetile:      BASE + 'placetile.mp3',
        scrollmove:     BASE + 'scrollmove.mp3',
        tilereveal:     BASE + 'tilereveal.mp3',
        wincondition:   BASE + 'wincondition.mp3',
        fireactivates:  BASE + 'fireactivates.mp3',
        wateractivates: BASE + 'wateractivates.mp3',
        windactivates:  BASE + 'windactivates.mp3',
        voidactivates:  BASE + 'voidactivates.mp3',
    };

    // Element-specific win-condition sounds; earth and catacomb fall back to generic
    const ELEMENT_WIN_SOUNDS = {
        fire:     'fireactivates',
        water:    'wateractivates',
        wind:     'windactivates',
        void:     'voidactivates',
        earth:    'wincondition',
        catacomb: 'wincondition',
    };

    // Sounds that belong to the UI channel (settings → UI Sounds toggle)
    // Everything else belongs to the game channel (settings → Game Sounds toggle)
    const UI_SOUNDS = new Set(['click', 'zipclick', 'error']);

    let footstepIndex = 0;
    let winConditionLastPlayed = 0; // debounce — prevent double-fire within same cast

    function _isEnabled(name) {
        if (UI_SOUNDS.has(name)) return window.uiSoundEnabled !== false;
        return window.gameSoundEnabled !== false;
    }

    // opts.rate: play faster / slower, which also moves the pitch (1 = as recorded)
    function play(name, volume = 1.0, opts = {}) {
        if (!_isEnabled(name)) return;
        const src = SOUNDS[name];
        if (!src) { console.warn(`SoundSystem: unknown sound "${name}"`); return; }
        const audio = new Audio(src);
        audio.volume = volume;
        if (opts.rate && opts.rate !== 1) {
            audio.preservesPitch = false; audio.mozPreservesPitch = false; audio.webkitPreservesPitch = false;
            audio.playbackRate = opts.rate;
        }
        audio.play().catch(() => {}); // silently ignore autoplay policy blocks
    }

    // Shrine collection (owner 2026-10-15: "a bit samey"): one pitch per
    // element, earth deepest, then water, fire, wind, void, two semitones
    // apart, plus a small random wobble (about 1/4 semitone) so repeats differ.
    const COLLECT_STEPS = { earth: -4, water: -2, fire: 0, wind: 2, void: 4 };
    function playCollect(element) {
        const semis = (COLLECT_STEPS[element] ?? 0) + (Math.random() - 0.5) * 0.5;
        play('collectstones', 1.0, { rate: Math.pow(2, semis / 12) });
    }

    function playFootstep() {
        if (window.gameSoundEnabled === false) return;
        const file = FOOTSTEP_FILES[footstepIndex % FOOTSTEP_FILES.length];
        footstepIndex++;
        const audio = new Audio(FOOTSTEP_DIR + file);
        audio.volume = 0.7;
        audio.play().catch(() => {});
    }

    // Plays the element-specific win-condition sound (debounced so multi-add calls in one cast only fire once)
    function onWinCondition(element) {
        if (window.gameSoundEnabled === false) return;
        const now = Date.now();
        if (now - winConditionLastPlayed < 300) return;
        winConditionLastPlayed = now;
        const soundName = ELEMENT_WIN_SOUNDS[element] || 'wincondition';
        play(soundName);
    }

    // urls: every file above, for js/asset-preloader.js to warm the cache
    // with before a match (play() makes a fresh Audio per call, so the
    // first play of each sound otherwise waits on its download).
    const urls = Object.values(SOUNDS).concat(FOOTSTEP_FILES.map(f => FOOTSTEP_DIR + f));

    window.SoundSystem = { play, playCollect, playFootstep, onWinCondition, urls };

    // ── Login screen music ────────────────────────────────────────────────────
    // Strategy: start the audio MUTED immediately (browsers allow muted autoplay
    // without any user gesture), then unmute on the first interaction. This
    // guarantees the track is already buffered and in-sync the moment it becomes
    // audible — no waiting, no race conditions.
    (function initLoginMusic() {
        const MUSIC_SRC = 'sounds/music/LoginScreen.intropage.mp3';
        let _track          = null;
        let _cancelPending  = null; // cancels any pending gesture-start listener

        function _makeTrack() {
            const a = new Audio(MUSIC_SRC);
            a.loop   = true;
            a.volume = 0.45;
            return a;
        }

        // Cancel any gesture listener that hasn't fired yet (called before fade/stop)
        function _clearPending() {
            if (_cancelPending) { _cancelPending(); _cancelPending = null; }
        }

        // Unmute the track on the next user gesture (called after muted autoplay succeeds)
        function _waitForGestureToUnmute() {
            const unmute = () => {
                document.removeEventListener('click',   unmute);
                document.removeEventListener('keydown', unmute);
                if (_track) _track.muted = false;
            };
            document.addEventListener('click',   unmute);
            document.addEventListener('keydown', unmute);
        }

        function startMusic() {
            if (window.musicEnabled === false) return;
            if (_track) return; // already running
            _clearPending();
            _track = _makeTrack();
            _track.muted = true; // start silent — no gesture required

            _track.play().then(() => {
                // Muted autoplay succeeded: unmute on first interaction
                _waitForGestureToUnmute();
            }).catch(() => {
                // Even muted autoplay was blocked (rare) — start + unmute on gesture
                _track = null;
                const startOnGesture = () => {
                    _cancelPending = null;
                    document.removeEventListener('click',   startOnGesture);
                    document.removeEventListener('keydown', startOnGesture);
                    // Abort if lobby is gone or music was disabled while waiting
                    const lw = document.getElementById('lobby-wrapper');
                    if (!lw || lw.style.display === 'none') return;
                    if (window.musicEnabled === false) return;
                    _track = _makeTrack();
                    _track.play().catch(() => {});
                };
                // Store cancel fn so fadeOutMusic/stopMusic can clean this up
                _cancelPending = () => {
                    document.removeEventListener('click',   startOnGesture);
                    document.removeEventListener('keydown', startOnGesture);
                };
                document.addEventListener('click',   startOnGesture);
                document.addEventListener('keydown', startOnGesture);
            });
        }

        function stopMusic() {
            _clearPending();
            if (!_track) return;
            _track.pause();
            _track.currentTime = 0;
            _track = null;
        }

        // Smoothly fade the music out over `ms` milliseconds then stop it.
        // If the track is still muted (gesture never happened) just stop silently.
        function fadeOutMusic(ms = 1200) {
            _clearPending(); // always cancel pending start, even if no track
            if (!_track) return;
            if (_track.muted || _track.paused) { stopMusic(); return; }
            const dying = _track;
            _track = null;
            const startVol  = dying.volume;
            const startTime = performance.now();
            function step(now) {
                const elapsed  = now - startTime;
                const progress = Math.min(elapsed / ms, 1);
                dying.volume   = startVol * (1 - progress);
                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    dying.pause();
                    dying.currentTime = 0;
                }
            }
            requestAnimationFrame(step);
        }

        // Expose for external control
        window.SoundSystem.startLoginMusic   = startMusic;
        window.SoundSystem.stopLoginMusic    = stopMusic;
        window.SoundSystem.fadeOutLoginMusic = fadeOutMusic;

        // Watch the lobby-wrapper: fade out when game starts, restart on return
        function watchLobbyVisibility() {
            const lw = document.getElementById('lobby-wrapper');
            if (!lw) return;
            new MutationObserver(() => {
                if (lw.style.display === 'none') {
                    fadeOutMusic();
                } else {
                    startMusic();
                }
            }).observe(lw, { attributes: true, attributeFilter: ['style'] });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                startMusic();
                watchLobbyVisibility();
            });
        } else {
            startMusic();
            watchLobbyVisibility();
        }
    })();

    console.log('🔊 SoundSystem loaded');
})();
