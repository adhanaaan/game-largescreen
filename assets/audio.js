/*
 * Tiny WebAudio helper for the "to the beat" feel: a metronome tick, plus
 * short success / error stingers. All nodes are created lazily on the first
 * user gesture so autoplay policies never block us. Fails silently if
 * WebAudio is unavailable.
 */
(function () {
  "use strict";

  var ctx = null;
  var muted = false;

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function blip(freq, dur, type, gainPeak, when) {
    if (muted) return;
    var ac = ensure();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    var t0 = (when || ac.currentTime);
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.2, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  window.Sound = {
    unlock: function () { var ac = ensure(); if (ac && ac.state === "suspended") ac.resume(); },
    setMuted: function (m) { muted = !!m; },
    isMuted: function () { return muted; },
    tick: function () { blip(660, 0.06, "square", 0.12); },
    beat: function () { blip(180, 0.09, "sine", 0.22); },
    reveal: function () { blip(880, 0.10, "triangle", 0.16); },
    tap: function () { blip(520, 0.07, "sine", 0.18); },
    correct: function () {
      var ac = ensure(); if (!ac) return;
      var base = ac.currentTime;
      blip(660, 0.12, "sine", 0.18, base);
      blip(990, 0.16, "sine", 0.18, base + 0.10);
    },
    wrong: function () { blip(160, 0.28, "sawtooth", 0.22); },
    win: function () {
      var ac = ensure(); if (!ac) return;
      var base = ac.currentTime;
      [523, 659, 784, 1047].forEach(function (f, i) {
        blip(f, 0.18, "triangle", 0.18, base + i * 0.11);
      });
    },
    lose: function () {
      var ac = ensure(); if (!ac) return;
      var base = ac.currentTime;
      [392, 330, 262].forEach(function (f, i) {
        blip(f, 0.22, "sawtooth", 0.18, base + i * 0.14);
      });
    }
  };

  /*
   * Music — the looping backing track ("say the word on the beat"). Reveals in
   * the memorize phase are synced to its onset map. Uses a plain <audio> el so
   * it works from file:// with no fetch.
   */
  var audioEl = null;
  window.Music = {
    init: function (src) {
      if (audioEl) return audioEl;
      audioEl = new Audio(src);
      audioEl.loop = false; // the clue page runs exactly one pass of the song
      audioEl.preload = "auto";
      audioEl.volume = 0.85;
      return audioEl;
    },
    /* Restart from the top; returns a promise that resolves when playback
       actually begins (or immediately if blocked). */
    play: function () {
      if (!audioEl) return Promise.resolve();
      audioEl.muted = muted;
      try { audioEl.currentTime = 0; } catch (e) {}
      var p = audioEl.play();
      return (p && p.then) ? p.catch(function () {}) : Promise.resolve();
    },
    stop: function () {
      if (!audioEl) return;
      audioEl.pause();
      try { audioEl.currentTime = 0; } catch (e) {}
    },
    currentTime: function () { return audioEl ? audioEl.currentTime : 0; },
    setMuted: function (m) { if (audioEl) audioEl.muted = !!m; }
  };
})();
