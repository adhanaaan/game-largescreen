/*
 * Board + food logic for "8 Orders" — a JS mirror of eight_menus_logic.py (v2).
 *
 * Two decoupled layers:
 *   BOARD  — 2 rows x 4 tiles of a/b/c "orders". A 3-order board obeys the rule
 *            "one row uses all 3 orders, the other exactly 2"; easy boards use
 *            just 2 orders. Difficulty climbs by chunkability (see ROUND_SPEC).
 *   FOOD   — dishes are assigned to tokens separately and rotate every launch.
 *            a/b are non-look-alike anchors; token c is a distinct dish at the
 *            medium tier and the LOOK-ALIKE TWIN of a at the hard tier.
 *
 * 8 tiles per round, always. 6-round ladder: easy·easy·medium·medium·hard·hard.
 */
(function () {
  "use strict";

  window.TILES_PER_ROUND = 8;
  window.RECALL_SECONDS = 8; // fixed answer window (game rule)

  // key -> { name, emoji }. Real art: assets/dishes/<key>.png (emoji is the
  // fallback). Every dish has a UNIQUE emoji so the fallback stays playable —
  // real art carries the intended look-alike similarity at the hard tier.
  window.DISHES = {
    tom_yum:           { name: "Tom Yum",              emoji: "🍲" },
    tom_kha:           { name: "Tom Kha",              emoji: "🥣" },
    green_curry:       { name: "Green Curry",          emoji: "🍛" },
    red_curry:         { name: "Red / Panang Curry",   emoji: "🥘" },
    massaman:          { name: "Massaman",             emoji: "🍥" },
    khao_soi:          { name: "Khao Soi",             emoji: "🍜" },
    pad_thai:          { name: "Pad Thai",             emoji: "🍝" },
    pad_see_ew:        { name: "Pad See Ew",           emoji: "🥡" },
    pad_see_mao:       { name: "Pad See Mao",          emoji: "🍱" },
    drunken_noodles:   { name: "Drunken Noodles",      emoji: "🌶️" },
    pineapple_rice:    { name: "Pineapple Fried Rice", emoji: "🍍" },
    pad_kra_pao:       { name: "Pad Kra Pao Moo Sab",  emoji: "🍳" },
    khao_moo_daeng:    { name: "Khao Moo Daeng",       emoji: "🍖" },
    kai_jeow:          { name: "Kai Jeow",             emoji: "🥚" },
    hoy_tod:           { name: "Hoy Tod",              emoji: "🧇" },
    som_tum:           { name: "Som Tum",              emoji: "🥗" },
    laab_moo:          { name: "Laab Moo",             emoji: "🥩" },
    nam_tok_moo:       { name: "Nam Tok Moo",          emoji: "🍠" },
    tod_mun_pla:       { name: "Tod Mun Pla",          emoji: "🧆" },
    moo_ping:          { name: "Moo Ping",             emoji: "🍢" },
    gai_yang:          { name: "Gai Yang",             emoji: "🍗" },
    pla_rad_prik:      { name: "Pla Rad Prik",         emoji: "🐟" },
    mango_sticky_rice: { name: "Mango Sticky Rice",    emoji: "🥭" },
    tub_tim_grob:      { name: "Tub Tim Grob",         emoji: "🍧" }
  };

  // Look-alike pairs (asset keys) — the perceptual lever, used only at hard tier.
  window.LOOKALIKE_PAIRS = [
    ["green_curry", "red_curry"],
    ["tom_yum", "tom_kha"],
    ["kai_jeow", "hoy_tod"],
    ["moo_ping", "gai_yang"],
    ["pad_see_ew", "pad_see_mao"],
    ["laab_moo", "nam_tok_moo"]
  ];

  // Mutually-distinct dishes safe as anchors / the medium-tier third order.
  window.DISTINCT_FOODS = [
    "green_curry", "tom_yum", "pineapple_rice", "som_tum",
    "kai_jeow", "moo_ping", "mango_sticky_rice", "tub_tim_grob",
    "khao_soi", "pad_kra_pao", "laab_moo", "pad_see_ew"
  ];

  // twin lookup for confusability checks
  var TWIN = {};
  window.LOOKALIKE_PAIRS.forEach(function (p) { TWIN[p[0]] = p[1]; TWIN[p[1]] = p[0]; });
  function confusable(x, y) { return x === y || TWIN[x] === y; }
  window.confusable = confusable;

  // ── Board layer ────────────────────────────────────────────────
  var ORDERS = "abc";
  var COLS = 4;

  function product4() {
    var out = [];
    var L = ORDERS.split("");
    L.forEach(function (a) { L.forEach(function (b) { L.forEach(function (c) { L.forEach(function (d) {
      out.push(a + b + c + d);
    }); }); }); });
    return out;
  }
  var ALL_ROWS = product4();

  function nOrders(s) { var m = {}; s.split("").forEach(function (c) { m[c] = 1; }); return Object.keys(m).length; }
  function ruleValid(b) { var x = nOrders(b[0]), y = nOrders(b[1]); return (x === 2 && y === 3) || (x === 3 && y === 2); }
  function isTwoOrder(b) { return nOrders(b[0] + b[1]) === 2; }
  function chunkScore(b) {
    var s = 0;
    b.forEach(function (row) { for (var i = 0; i < row.length - 1; i++) if (row[i] === row[i + 1]) s++; });
    return s;
  }
  function twoOrderRow(b) { return nOrders(b[0]) === 2 ? b[0] : b[1]; }
  function rowShape(row) {
    var m = {}; row.split("").forEach(function (c) { m[c] = (m[c] || 0) + 1; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b - a; });
  }
  function canon(b) {
    var m = {}, out = [];
    b.forEach(function (row) {
      var cr = "";
      row.split("").forEach(function (ch) {
        if (!(ch in m)) m[ch] = ORDERS[Object.keys(m).length];
        cr += m[ch];
      });
      out.push(cr);
    });
    return out.join("|");
  }

  function generateRuleBoards(score, shape) {
    var seen = {}, pool = [];
    for (var i = 0; i < ALL_ROWS.length; i++) {
      for (var j = 0; j < ALL_ROWS.length; j++) {
        var b = [ALL_ROWS[i], ALL_ROWS[j]];
        if (!ruleValid(b) || chunkScore(b) !== score) continue;
        if (shape && String(rowShape(twoOrderRow(b))) !== String(shape)) continue;
        var c = canon(b);
        if (!seen[c]) { seen[c] = 1; pool.push(b); }
      }
    }
    return pool;
  }
  function generateTwoOrderBoards(minChunk) {
    var seen = {}, pool = [];
    for (var i = 0; i < ALL_ROWS.length; i++) {
      for (var j = 0; j < ALL_ROWS.length; j++) {
        var b = [ALL_ROWS[i], ALL_ROWS[j]];
        if (!isTwoOrder(b) || chunkScore(b) < minChunk) continue;
        var c = canon(b);
        if (!seen[c]) { seen[c] = 1; pool.push(b); }
      }
    }
    return pool;
  }

  // Round ladder (mirrors ROUND_SPEC). Climb: 2 orders -> 3-order max-chunk
  // -> less chunk -> near-alternating.
  window.ROUND_SPEC = [
    { rid: "R1", tier: "easy",   label: "Easy",   score: null, shape: null },
    { rid: "R2", tier: "easy",   label: "Easy",   score: null, shape: null },
    { rid: "R3", tier: "medium", label: "Medium", score: 3,    shape: [3, 1] },
    { rid: "R4", tier: "medium", label: "Medium", score: 3,    shape: [2, 2] },
    { rid: "R5", tier: "hard",   label: "Hard",   score: 2,    shape: null },
    { rid: "R6", tier: "hard",   label: "Hard",   score: 1,    shape: null }
  ];

  var easyPool = generateTwoOrderBoards(3);
  window.ROUND_POOLS = {};
  window.ROUND_SPEC.forEach(function (s) {
    window.ROUND_POOLS[s.rid] = (s.tier === "easy") ? easyPool : generateRuleBoards(s.score, s.shape);
  });

  // UI round list (label/tier per round slot).
  window.ROUNDS = window.ROUND_SPEC.map(function (s) { return { round: s.rid, tier: s.tier, label: s.label }; });

  // ── Food rotator ───────────────────────────────────────────────
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // One food assignment per playthrough (fresh each launch).
  //   a, b     : two anchors, not confusable
  //   c.medium : a distinct 3rd dish
  //   c.hard   : the look-alike twin of a
  window.newFoodMap = function () {
    var pair = pick(window.LOOKALIKE_PAIRS);
    var a = pair[0], hardC = pair[1];
    if (Math.random() < 0.5) { var t = a; a = hardC; hardC = t; }
    var b = pick(window.DISTINCT_FOODS.filter(function (d) { return !confusable(d, a); }));
    var mediumC = pick(window.DISTINCT_FOODS.filter(function (d) {
      return !confusable(d, a) && !confusable(d, b) && d !== hardC;
    }));
    return { a: a, b: b, c: { medium: mediumC, hard: hardC } };
  };

  // Board token (a/b/c) -> dish key for a tier.
  window.dishKeyFor = function (token, tier, fm) {
    var v = fm[token];
    if (v && typeof v === "object") return v[tier] || v.medium; // token 'c'
    return v;
  };

  /*
   * Beat map for assets/song.mp3 — the 8 tiles light up on these onsets.
   */
  window.BEAT = {
    src: "assets/song.mp3",
    duration: 2.77,
    onsets: [0.186, 0.511, 0.673, 1.01, 1.498, 1.823, 1.997, 2.322]
  };
})();
