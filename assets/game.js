/*
 * 8 Orders — game engine.
 *
 * A memory game for a 43" vertical touchscreen. Flow:
 *   start → intro → (per round) countdown → memorize → recall → feedback
 *        → result
 *
 * Rules (from the Figma spec notes):
 *   - Memorize N menus in the correct order before the song ends.
 *   - Recall by tapping the plates in that exact order.
 *   - A wrong tap = "Wrong menu" and costs a life. Running out the clock =
 *     "Time's up" and costs a life. Losing all lives ends the game.
 *   - Score = correct plates + speed bonus for finishing quickly.
 *   Result screens tier the score: sharp / good / room to improve.
 */
(function () {
  "use strict";

  var ROUNDS = window.ROUNDS;
  var Sound = window.Sound;

  // Resolve a dish asset key -> render object.
  function dish(key) {
    var d = window.DISHES[key];
    return { id: key, name: d ? d.name : key, emoji: d ? d.emoji : "🍽️" };
  }

  var screenEl = document.getElementById("screen");
  var stageShellEl = document.getElementById("stage-shell");
  var stageEl = document.getElementById("stage");

  var MAX_SCORE = 50;
  var START_LIVES = 2;
  var DESIGN_WIDTH = 1046;
  var DESIGN_HEIGHT = 1860;
  var SAFE_PAD = 24;
  var DEBUG_STAGE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  // ---- runtime state ----
  var state = {
    roundIndex: 0,
    lives: START_LIVES,
    score: 0,
    correctPlates: 0,
    totalPlates: 0,
    sequence: [],   // array of menu objects, in correct order
    distinct: [],   // distinct menu objects used this round (palette)
    progress: 0     // how many plates recalled correctly this round
  };

  var timer = null; // active countdown timer handle

  // ---- helpers ----
  function h(html) { screenEl.innerHTML = html; }
  function $(sel) { return screenEl.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(screenEl.querySelectorAll(sel)); }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, n); }

  // Inner plate content: the real dish photo (assets/dishes/<id>.png) when it
  // loads; if the asset is missing, onerror drops the <img> and the emoji
  // fallback shows through.
  function plateInner(menu) {
    return '<img class="dish" alt="" src="assets/dishes/' + menu.id + '.png" ' +
      'onerror="this.remove()"><span class="dish-emoji">' + menu.emoji + "</span>";
  }
  function plateHTML(menu, extra) {
    if (!menu) return '<div class="plate"></div>' + (extra || "");
    return '<div class="plate">' + plateInner(menu) + "</div>" + (extra || "");
  }

  function brandHTML() {
    return (
      '<div class="brand">' +
        '<div class="logo">🍜</div>' +
        '<div class="txt"><b>Gray Matter Solutions</b><hr />' +
          "<small>A spin-off from Nanyang Technological University, Singapore</small></div>" +
      "</div>"
    );
  }

  function soundToggleHTML() {
    return '<button class="sound-toggle" id="soundBtn" aria-label="Toggle sound">' +
      (Sound.isMuted() ? "🔇" : "🔊") + "</button>";
  }

  // A little inline QR-looking glyph (decorative, not a real code).
  function qrHTML() {
    var cells = "";
    var seed = 0b101101011;
    for (var y = 0; y < 9; y++) {
      for (var x = 0; x < 9; x++) {
        var on = ((x * 3 + y * 7 + (x ^ y) * 5 + seed) % 3) === 0 ||
                 (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5);
        if (on) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1" />';
      }
    }
    return '<div class="qr"><svg viewBox="0 0 9 9" fill="#1e0a3c" shape-rendering="crispEdges">' + cells + "</svg></div>";
  }

  function wireChrome() {
    var btn = $("#soundBtn");
    if (btn) {
      btn.addEventListener("click", function () {
        var m = !Sound.isMuted();
        Sound.setMuted(m);
        window.Music.setMuted(m);
        btn.textContent = m ? "🔇" : "🔊";
      });
    }
  }

  // ---- countdown timer utility ----
  function clearTimer() {
    if (timer) { cancelAnimationFrame(timer.raf); timer = null; }
  }

  /* Runs a smooth countdown, calling onTick(fractionRemaining) each frame and
     onDone() once when it hits zero. */
  function runTimer(seconds, onTick, onDone) {
    clearTimer();
    var start = null;
    timer = { raf: 0, done: false };
    function frame(ts) {
      if (start === null) start = ts;
      var elapsed = (ts - start) / 1000;
      var frac = Math.max(0, 1 - elapsed / seconds);
      onTick(frac, seconds * frac);
      if (frac <= 0) {
        if (!timer.done) { timer.done = true; onDone(); }
        return;
      }
      timer.raf = requestAnimationFrame(frame);
    }
    timer.raf = requestAnimationFrame(frame);
  }

  // ============================================================
  // SCREENS
  // ============================================================

  function showStart() {
    clearTimer();
    window.Music.stop();
    h(
      brandHTML() + soundToggleHTML() +
      '<div class="screen">' +
        '<div class="logo-wordmark">' +
          '<span class="eight">8</span>' +
          '<span class="orders">Orders</span>' +
        "</div>" +
        '<div class="tagline">Test Your Memory &amp; Speed</div>' +
        '<div class="grow"></div>' +
        '<div class="gap-col">' +
          '<div class="emoji-hero" style="font-size:180px" aria-hidden="true">🍽️</div>' +
          '<button class="cta big pulse" id="startBtn">TAP TO START</button>' +
          '<div class="hint">Memorize the menu order before the song ends</div>' +
        "</div>" +
        '<div class="grow"></div>' +
      "</div>"
    );
    wireChrome();
    $("#startBtn").addEventListener("click", function () {
      Sound.unlock(); Sound.tap();
      showIntro();
    });
  }

  function showIntro() {
    clearTimer();
    h(
      brandHTML() + soundToggleHTML() +
      '<div class="screen">' +
        '<div class="grow"></div>' +
        '<div class="emoji-hero" aria-hidden="true">🇹🇭</div>' +
        '<h1 class="headline mt-m">Let\'s memorize<br/>Thai Foods</h1>' +
        '<p class="subhead mt-s">Tap the <span class="accent">8 dishes</span> back in the<br/>exact order they\'re served.</p>' +
        '<div class="grow"></div>' +
        '<div class="result-card" style="margin-bottom:30px">' +
          '<div class="stat-row"><span>👀 Watch</span><span>the plates light up in order</span></div>' +
          '<div class="stat-row"><span>🧠 Remember</span><span>the sequence</span></div>' +
          '<div class="stat-row"><span>👆 Tap them back</span><span>before the song ends</span></div>' +
          '<div class="stat-row"><span>❤️ Lives</span><span><b>' + START_LIVES + '</b> — a wrong menu costs one</span></div>' +
        "</div>" +
        '<button class="cta big" id="goBtn">I\'M READY</button>' +
        '<div class="grow"></div>' +
      "</div>"
    );
    wireChrome();
    $("#goBtn").addEventListener("click", function () {
      Sound.tap();
      state.roundIndex = 0;
      state.lives = START_LIVES;
      state.score = 0;
      state.correctPlates = 0;
      state.totalPlates = 0;
      state.foodMap = window.newFoodMap(); // fresh food this playthrough
      startRound();
    });
  }

  /*
   * Build a round (mirrors build_session/resolve_round in eight_menus_logic.py):
   *   - pick a random board from this round's rule-validated pool
   *   - flatten its 2x4 tokens into reading order (row1 then row2)
   *   - map each token a/b/c -> dish for this tier via the session food map
   */
  function buildRound() {
    var spec = window.ROUND_SPEC[state.roundIndex];
    var pool = window.ROUND_POOLS[spec.rid];
    var board = pool[Math.floor(Math.random() * pool.length)];
    var tokens = (board[0] + board[1]).split(""); // 8 tokens, reading order
    var fm = state.foodMap;

    state.sequence = tokens.map(function (t) { return dish(window.dishKeyFor(t, spec.tier, fm)); });

    // palette = the distinct dishes present this round (2 easy, 3 medium/hard)
    var seenKey = {};
    state.distinct = [];
    tokens.forEach(function (t) {
      var k = window.dishKeyFor(t, spec.tier, fm);
      if (!seenKey[k]) { seenKey[k] = 1; state.distinct.push(dish(k)); }
    });

    state.board = board.join("-");
    state.progress = 0;
    state.totalPlates += state.sequence.length;
    return spec;
  }

  function startRound() {
    buildRound();
    showCountdown(3, function () { showMemorize(); });
  }

  function showCountdown(from, done) {
    clearTimer();
    var n = from;
    function tick() {
      if (n <= 0) { done(); return; }
      h(
        '<div class="screen center-col">' +
          '<div class="chip" style="position:absolute;top:70px">Round ' + (state.roundIndex + 1) +
            " · " + ROUNDS[state.roundIndex].label + "</div>" +
          '<div class="countdown-num">' + n + "</div>" +
        "</div>"
      );
      Sound.beat();
      n--;
      setTimeout(tick, 900);
    }
    tick();
  }

  function showMemorize() {
    clearTimer();
    var cfg = ROUNDS[state.roundIndex];
    var seq = state.sequence;
    var onsets = window.BEAT.onsets;

    // All 8 dishes are shown from the start (max time to study them). The beat
    // highlights each one in order with a neon outline; its number appears as
    // it lights and stays, so the sequence builds up visually.
    var tiles = seq.map(function (m, i) {
      return '<div class="tile" data-i="' + i + '">' +
        plateHTML(m, '<div class="idx">' + (i + 1) + "</div>") + "</div>";
    }).join("");

    h(
      brandHTML() + soundToggleHTML() +
      '<div class="screen">' +
        '<div class="chip" style="margin-bottom:14px">Round ' + (state.roundIndex + 1) +
          " · " + cfg.label + "</div>" +
        '<h1 class="headline">Remember the order</h1>' +
        '<p class="subhead">watch each dish <span class="accent">light up</span> to the beat</p>' +
        '<p class="hint mt-s">🎵 1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 🎵</p>' +
        '<div class="grow"></div>' +
        '<div class="plate-grid rows-2">' + tiles + "</div>" +
        '<div class="grow"></div>' +
        '<div class="timerbar"><div class="fill"></div><div class="note">🎵</div></div>' +
      "</div>"
    );
    wireChrome();

    var tileEls = $all(".tile");
    // The clue page lasts exactly one pass of the song. The moment it ends we
    // flip to the answer page.
    var windowSec = window.BEAT.duration;

    // Start the track; on each beat, light the matching tile with a neon
    // outline, then leave a soft outline + its order number behind. Scheduled
    // off play() so it lines up with the audio (still fires if autoplay blocked).
    window.Music.play().then(function () {
      onsets.forEach(function (sec, i) {
        setTimeout(function () {
          var el = tileEls[i];
          if (!el) return;
          el.classList.add("beat-on", "pop");
          setTimeout(function () {
            el.classList.remove("beat-on");
            el.classList.add("beat-seen");
          }, 420);
        }, sec * 1000);
      });

      // The timer bar tracks the song; when it (the music) ends, go to recall.
      var fill = $(".fill");
      runTimer(windowSec, function (frac) {
        if (fill) fill.style.transform = "scaleX(" + frac + ")";
      }, function () {
        showRecall();
      });
    });
  }

  function showRecall() {
    clearTimer();
    window.Music.stop(); // song is over — the answer page is a fixed timer
    var seq = state.sequence;

    var slots = seq.map(function (_, i) {
      return '<div class="tile empty" data-slot="' + i + '"><span class="qmark">?</span>' +
        '<div class="plate"></div></div>';
    }).join("");

    var choices = shuffle(state.distinct).map(function (m) {
      return '<button class="choice" data-id="' + m.id + '">' + plateHTML(m) + "</button>";
    }).join("");

    h(
      brandHTML() + soundToggleHTML() +
      '<div class="screen">' +
        '<div class="statusrow">' +
          '<span class="lives" id="lives">' + livesStr() + "</span>" +
          '<span class="chip">Round ' + (state.roundIndex + 1) + "/" + ROUNDS.length + "</span>" +
          '<span class="chip">Score ' + state.score + "</span>" +
        "</div>" +
        '<h1 class="headline mt-s" style="font-size:84px">Serve the order!</h1>' +
        '<div class="plate-grid rows-2 mt-s">' + slots + "</div>" +
        '<div class="timerbar mt-m"><div class="fill"></div><div class="note" id="secs">' +
          window.RECALL_SECONDS + "s</div></div>" +
        '<div class="grow"></div>' +
        '<p class="hint">Tap the plates in the order you saw them — quick!</p>' +
        '<div class="palette mt-s">' + choices + "</div>" +
      "</div>"
    );
    wireChrome();

    var slotEls = $all(".tile");
    var locked = false;

    function finish(outcome, remainingFrac) {
      if (locked) return;
      locked = true;
      clearTimer();
      window.Music.stop();
      if (outcome === "win") {
        // speed bonus: up to +? based on remaining time
        var bonus = Math.round(remainingFrac * 5);
        state.score += bonus;
        Sound.win();
        showFeedback("win", bonus);
      } else if (outcome === "timeup") {
        state.lives--;
        Sound.lose();
        showFeedback("timeup", 0);
      } else {
        state.lives--;
        Sound.wrong();
        showFeedback("wrong", 0);
      }
    }

    $all(".choice").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (locked) return;
        var id = btn.getAttribute("data-id");
        var expected = seq[state.progress];
        var slot = slotEls[state.progress];
        var picked = dish(id);

        slot.classList.remove("empty");
        slot.classList.add("filled", "pop");
        slot.querySelector(".plate").innerHTML = plateInner(picked);

        if (id === expected.id) {
          slot.classList.add("correct");
          state.progress++;
          state.score += 1;
          state.correctPlates += 1;
          Sound.tap();
          $("#lives"); // noop keep ref
          var scoreChip = screenEl.querySelectorAll(".chip")[1];
          if (scoreChip) scoreChip.textContent = "Score " + state.score;
          if (state.progress >= seq.length) {
            finish("win", lastFrac);
          }
        } else {
          slot.classList.add("wrong");
          finish("wrong", 0);
        }
      });
    });

    var lastFrac = 1;
    var fill = $(".fill");
    var secsEl = $("#secs");
    runTimer(window.RECALL_SECONDS, function (frac, secsLeft) {
      lastFrac = frac;
      if (fill) fill.style.transform = "scaleX(" + frac + ")";
      if (secsEl) secsEl.textContent = Math.ceil(secsLeft) + "s";
    }, function () {
      finish("timeup", 0);
    });
  }

  function livesStr() {
    var s = "";
    for (var i = 0; i < START_LIVES; i++) s += i < state.lives ? "❤️" : "🖤";
    return s;
  }

  function showFeedback(kind, bonus) {
    clearTimer();
    var titleMap = {
      win: "You got it!",
      wrong: "Wrong menu",
      timeup: "Time's up"
    };
    var emojiMap = { win: "👏", wrong: "😖", timeup: "😵" };
    var subMap = {
      win: bonus > 0 ? "+" + bonus + " speed bonus! 🔥" : "Nice memory!",
      wrong: "That plate was out of order.",
      timeup: "Keep up with the beat!"
    };

    var gameOver = state.lives <= 0 && kind !== "win";
    var lastRound = state.roundIndex >= ROUNDS.length - 1;

    var btnLabel, next;
    if (gameOver) {
      btnLabel = "SEE RESULT";
      next = showResult;
    } else if (kind === "win") {
      if (lastRound) { btnLabel = "SEE RESULT"; next = showResult; }
      else { btnLabel = "NEXT ROUND"; next = function () { state.roundIndex++; startRound(); }; }
    } else {
      btnLabel = "TRY AGAIN";
      next = function () { startRound(); }; // rebuild same round with a new sequence
    }

    h(
      brandHTML() + soundToggleHTML() +
      '<div class="screen center-col">' +
        '<div class="emoji-hero" aria-hidden="true">' + emojiMap[kind] + "</div>" +
        '<h1 class="headline mt-m">' + titleMap[kind] + "</h1>" +
        '<p class="subhead mt-s">' + subMap[kind] + "</p>" +
        '<div class="lives mt-m" style="font-size:56px">' + livesStr() + "</div>" +
        '<button class="cta big mt-l" id="nextBtn">' + btnLabel + "</button>" +
      "</div>"
    );
    wireChrome();
    $("#nextBtn").addEventListener("click", function () { Sound.tap(); next(); });
  }

  function showResult() {
    clearTimer();
    // Final score scaled to MAX_SCORE based on how many plates were served
    // correctly plus accumulated speed bonuses, capped.
    var raw = state.score;
    var capped = Math.min(MAX_SCORE, raw);
    var accuracy = state.totalPlates ? Math.round((state.correctPlates / state.totalPlates) * 100) : 0;

    var tier, tierTitle, tierEmoji, tierMsg;
    if (capped >= 38) {
      tier = "high"; tierEmoji = "🧠✨"; tierTitle = "Your memory is sharp!";
      tierMsg = "You served the beat like a pro. Chef's kiss!";
    } else if (capped >= 20) {
      tier = "mid"; tierEmoji = "👍"; tierTitle = "Nicely done!";
      tierMsg = "Solid memory — a little more speed and you're elite.";
    } else {
      tier = "low"; tierEmoji = "💪"; tierTitle = "Room for improvement!";
      tierMsg = "Every chef starts somewhere. Give it another go!";
    }

    Sound[capped >= 20 ? "win" : "lose"]();

    h(
      brandHTML() + soundToggleHTML() +
      '<div class="screen">' +
        '<div class="tagline" style="margin-top:0">8 Orders · Final Score</div>' +
        '<div class="emoji-hero" style="font-size:180px" aria-hidden="true">' + tierEmoji + "</div>" +
        '<h1 class="headline mt-s" style="font-size:88px">' + tierTitle + "</h1>" +
        '<div class="score-big mt-m"><span class="num">' + capped + '</span><span class="den">/ ' + MAX_SCORE + "</span></div>" +
        '<div class="result-card mt-m">' +
          '<div class="stat-row"><span>✅ Plates served</span><span><b>' + state.correctPlates + "</b> / " + state.totalPlates + "</span></div>" +
          '<div class="stat-row"><span>🎯 Accuracy</span><span><b>' + accuracy + "%</b></span></div>" +
          '<div class="stat-row"><span>🏁 Rounds cleared</span><span><b>' + clearedRounds() + "</b> / " + ROUNDS.length + "</span></div>" +
        "</div>" +
        '<p class="subhead mt-m" style="font-size:44px">' + tierMsg + "</p>" +
        '<div class="grow"></div>' +
        '<div class="row" style="justify-content:center;width:100%">' +
          qrHTML() +
          '<div style="text-align:left"><div class="hint" style="text-align:left;font-size:30px">Scan to play again on your phone</div>' +
          '<button class="cta mt-s" id="againBtn">PLAY AGAIN</button></div>' +
        "</div>" +
        '<div class="grow"></div>' +
      "</div>"
    );
    wireChrome();
    $("#againBtn").addEventListener("click", function () { Sound.tap(); showStart(); });
  }

  function clearedRounds() {
    // A round is "cleared" if we advanced past it. If game over mid-round,
    // roundIndex marks the current (failed) round.
    if (state.lives > 0) return Math.min(ROUNDS.length, state.roundIndex + 1);
    return state.roundIndex;
  }

  // ============================================================
  // Responsive scaling of the fixed 1046x1860 stage
  // ============================================================
  function fitStage() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var availableWidth = Math.max(1, vw - SAFE_PAD * 2);
    var availableHeight = Math.max(1, vh - SAFE_PAD * 2);
    var scale = Math.min(availableWidth / DESIGN_WIDTH, availableHeight / DESIGN_HEIGHT);
    scale = Math.max(0.1, scale);

    stageShellEl.style.setProperty("--stage-scale", scale);

    if (DEBUG_STAGE) {
      var rect = stageEl.getBoundingClientRect();
      console.debug(
        "[stage] viewport=" + vw + "x" + vh +
        " design=" + DESIGN_WIDTH + "x" + DESIGN_HEIGHT +
        " scale=" + scale.toFixed(3) +
        " rect=" + rect.width.toFixed(1) + "x" + rect.height.toFixed(1) +
        " @" + rect.left.toFixed(1) + "," + rect.top.toFixed(1)
      );
    }
  }
  window.addEventListener("resize", fitStage);
  window.addEventListener("orientationchange", fitStage);
  window.addEventListener("load", fitStage);
  if (document.fonts && typeof document.fonts.addEventListener === "function") {
    document.fonts.addEventListener("loadingdone", fitStage);
  }

  // ---- boot ----
  window.Music.init(window.BEAT.src);
  fitStage();
  showStart();
})();
