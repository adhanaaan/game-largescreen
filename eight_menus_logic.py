"""eight_menus_logic.py
================================================================================
Sequence-memory game logic for the "8 Menus / 8 Orders" station
(Brain Cognitive Zone, powered by ReCOGnAIze).

This is the single source of truth for the game. It supersedes earlier drafts
and folds the whole design into one file:

  1. BOARD LAYER  — the a/b/c patterns that carry the cognitive measurement.
                    A board is 2 rows x 4 tiles (8 tiles total).
  2. RULE         — for the 3-order rounds: exactly one row uses all 3 orders,
                    the other uses only 2 (the "anchor" row you can chunk).
  3. GENERATOR    — enumerates every valid board and ranks by chunk score, so
                    each round has a large pool of interchangeable boards.
  4. ROUND LADDER — 6 rounds: R1-R2 easy (2 orders), R3-R4 medium, R5-R6 hard,
                    getting progressively less chunkable as it climbs.
  5. FOOD LAYER   — dishes are assigned to tokens SEPARATELY from the board,
                    so the same rule-validated boards can wear different menus.
  6. ROTATOR      — fresh food every launch (different experience on replay),
                    seedable for reproducibility / leaderboard sync.

Design principles baked in (do not "optimise" these away):
  - 8 tiles per round, always.
  - Board layer and food layer are DECOUPLED. Patterns stay constant across
    players (so leaderboard scores are comparable); food rotates for freshness.
  - Difficulty climbs two independent ways: pattern (less chunkable) and
    perception (a look-alike dish pair introduced only at the hard tier).
  - Early rounds are chunkable and use distinct, familiar dishes so players of
    any age can orient before difficulty escalates.

The JS implementation should mirror this module explicitly to stay in sync.
================================================================================
"""

from __future__ import annotations

import random
import secrets
from collections import Counter
from itertools import product
from typing import Dict, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────
ROWS = 2
COLS = 4
TILES_PER_ROUND = ROWS * COLS          # 8
ORDERS = "abc"                          # up to 3 distinct "orders" per board

Board = Tuple[str, str]                 # (row1, row2), each a 4-char a/b/c string


# ═════════════════════════════════════════════════════════════
# 1 + 2.  BOARD RULE + SCORING
# ═════════════════════════════════════════════════════════════

def rule_valid(board: Board) -> bool:
    """The 3-order rule: one row uses all 3 orders, the other exactly 2."""
    return {len(set(row)) for row in board} == {2, 3}

def is_two_order(board: Board) -> bool:
    """True for easy boards: the whole board uses exactly 2 orders."""
    return len(set(board[0] + board[1])) == 2

def chunk_score(board: Board) -> int:
    """Adjacent-equal tile pairs across both rows. Higher = more chunkable =
    easier. Range 0 (fully alternating) .. 3 (max, one clean row + one pair)."""
    return sum(row[i] == row[i + 1]
               for row in board for i in range(len(row) - 1))

def two_order_row(board: Board) -> str:
    """The row that uses only 2 orders (the anchor). Assumes rule_valid."""
    return board[0] if len(set(board[0])) == 2 else board[1]

def _row_shape(row: str) -> List[int]:
    """Sorted order-counts, e.g. 'aaab' -> [3, 1], 'aabb' -> [2, 2]."""
    return sorted(Counter(row).values(), reverse=True)

def _canon(board: Board) -> Board:
    """Relabel orders by first appearance so relabelings collapse to one form."""
    m: Dict[str, str] = {}
    out = []
    for row in board:
        cr = ""
        for ch in row:
            if ch not in m:
                m[ch] = ORDERS[len(m)]
            cr += m[ch]
        out.append(cr)
    return tuple(out)


# ═════════════════════════════════════════════════════════════
# 3.  BOARD GENERATOR
# ═════════════════════════════════════════════════════════════

_ALL_ROWS = ["".join(p) for p in product(ORDERS, repeat=COLS)]

def generate_rule_boards(score: int,
                         two_row_shape: Optional[List[int]] = None) -> List[Board]:
    """All distinct valid 3-order boards at a given chunk score.

    score          : 0..3  (see chunk_score)
    two_row_shape  : optional filter on the 2-order row, e.g. [3,1] forces a
                     triple (very chunky), [2,2] forces clean pairs.
    """
    seen, pool = set(), []
    for r1 in _ALL_ROWS:
        for r2 in _ALL_ROWS:
            b = (r1, r2)
            if not rule_valid(b) or chunk_score(b) != score:
                continue
            if two_row_shape and _row_shape(two_order_row(b)) != two_row_shape:
                continue
            c = _canon(b)
            if c not in seen:
                seen.add(c)
                pool.append(b)
    return pool

def generate_two_order_boards(min_chunk: int = 3) -> List[Board]:
    """Distinct easy boards (whole board uses exactly 2 orders), structured
    enough (chunk_score >= min_chunk) to read at a glance."""
    seen, pool = set(), []
    for r1 in _ALL_ROWS:
        for r2 in _ALL_ROWS:
            b = (r1, r2)
            if not is_two_order(b) or chunk_score(b) < min_chunk:
                continue
            c = _canon(b)
            if c not in seen:
                seen.add(c)
                pool.append(b)
    return pool


# ═════════════════════════════════════════════════════════════
# 4.  ROUND LADDER
#     Each round pulls from a pool defined by tier + chunk score (+ shape).
#     Climb: 2 orders -> 3 orders max-chunk -> less chunk -> least chunk.
# ═════════════════════════════════════════════════════════════

# (round_id, tier, chunk_score, two_order_row_shape | None)
# For easy rounds chunk_score/shape are ignored (they use the 2-order pool).
ROUND_SPEC: List[Tuple[str, str, Optional[int], Optional[List[int]]]] = [
    ("R1", "easy",   None, None),          # 2 orders, structured
    ("R2", "easy",   None, None),          # 2 orders, structured (mirror/nested)
    ("R3", "medium", 3, [3, 1]),           # 3 orders, anchor row is a TRIPLE
    ("R4", "medium", 3, [2, 2]),           # 3 orders, anchor row is clean PAIRS
    ("R5", "hard",   2, None),             # 3 orders, one chunk removed
    ("R6", "hard",   1, None),             # 3 orders, near-alternating (hardest)
]

def _build_round_pools() -> Dict[str, List[Board]]:
    easy = generate_two_order_boards(min_chunk=3)
    pools: Dict[str, List[Board]] = {}
    for rid, tier, score, shape in ROUND_SPEC:
        if tier == "easy":
            pools[rid] = easy
        else:
            pools[rid] = generate_rule_boards(score, shape)
    return pools

ROUND_POOLS: Dict[str, List[Board]] = _build_round_pools()


def pool_sizes() -> Dict[str, int]:
    return {rid: len(ROUND_POOLS[rid]) for rid, *_ in ROUND_SPEC}

def total_board_scenarios() -> int:
    """Number of distinct board-only playthroughs (one board per round)."""
    n = 1
    for rid, *_ in ROUND_SPEC:
        n *= len(ROUND_POOLS[rid])
    return n


# ═════════════════════════════════════════════════════════════
# 5.  FOOD LAYER
# ═════════════════════════════════════════════════════════════

# Full dish catalogue (asset key -> display name).
DISHES: Dict[str, str] = {
    "tom_yum": "Tom Yum", "tom_kha": "Tom Kha",
    "green_curry": "Green Curry", "red_curry": "Red/Panang Curry",
    "khao_soi": "Khao Soi", "pad_thai": "Pad Thai", "pad_see_ew": "Pad See Ew",
    "pad_see_mao": "Pad See Mao", "drunken_noodles": "Drunken Noodles",
    "pineapple_rice": "Pineapple Fried Rice", "pad_kra_pao": "Pad Kra Pao Moo Sab",
    "khao_moo_daeng": "Khao Moo Daeng", "kai_jeow": "Kai Jeow", "hoy_tod": "Hoy Tod",
    "som_tum": "Som Tum", "laab_moo": "Laab Moo", "nam_tok_moo": "Nam Tok Moo",
    "tod_mun_pla": "Tod Mun Pla", "moo_ping": "Moo Ping", "gai_yang": "Gai Yang",
    "pla_rad_prik": "Pla Rad Prik", "mango_sticky_rice": "Mango Sticky Rice",
    "tub_tim_grob": "Tub Tim Grob",
}

# Look-alike pairs (display names) — hard to tell apart at a glance. The
# perceptual-difficulty lever; used ONLY at the hard tier.
LOOKALIKE_PAIRS: List[Tuple[str, str]] = [
    ("Green Curry", "Red/Panang Curry"),
    ("Tom Yum", "Tom Kha"),
    ("Kai Jeow", "Hoy Tod"),
    ("Moo Ping", "Gai Yang"),
    ("Pad See Ew", "Pad See Mao"),
    ("Laab Moo", "Nam Tok Moo"),
]

# Mutually-distinct dishes safe as clean anchors / medium-tier third order.
DISTINCT_FOODS: List[str] = [
    "Green Curry", "Tom Yum", "Pineapple Fried Rice", "Som Tum",
    "Kai Jeow", "Moo Ping", "Mango Sticky Rice", "Tub Tim Grob",
    "Khao Soi", "Pad Kra Pao Moo Sab", "Laab Moo", "Pad See Ew",
]

# twin lookup for confusability checks
_TWIN: Dict[str, str] = {}
for _x, _y in LOOKALIKE_PAIRS:
    _TWIN[_x] = _y
    _TWIN[_y] = _x

def confusable(x: str, y: str) -> bool:
    return x == y or _TWIN.get(x) == y


# ═════════════════════════════════════════════════════════════
# 6.  FOOD ROTATOR
# ═════════════════════════════════════════════════════════════

def session_food_map(seed: Optional[int] = None) -> Tuple[int, Dict]:
    """Pick dishes for ONE playthrough.

    seed=None  -> fresh random game every call (different food each launch)
    seed=<int> -> reproduce that exact game (for logging / leaderboard sync)

    Guarantees:
      - a, b     : two anchors, NOT confusable (easy rounds stay readable)
      - c.medium : a distinct 3rd dish (clean 3-way telling-apart at R3-R4)
      - c.hard   : the LOOK-ALIKE twin of anchor a (perceptual spike at R5-R6)
    Returns (seed, food_map).
    """
    if seed is None:
        seed = secrets.randbits(32)
    rng = random.Random(seed)

    a, hard_c = rng.choice(LOOKALIKE_PAIRS)
    if rng.random() < 0.5:                      # randomise which member anchors
        a, hard_c = hard_c, a

    b = rng.choice([d for d in DISTINCT_FOODS if not confusable(d, a)])
    medium_c = rng.choice([
        d for d in DISTINCT_FOODS
        if not confusable(d, a) and not confusable(d, b) and d != hard_c
    ])

    return seed, {"a": a, "b": b, "c": {"medium": medium_c, "hard": hard_c}}


def new_game(avoid_seed: Optional[int] = None) -> Tuple[int, Dict]:
    """Fresh game; optionally guarantee it isn't identical to the last seed."""
    while True:
        seed, fm = session_food_map()
        if avoid_seed is None or seed != avoid_seed:
            return seed, fm


# ═════════════════════════════════════════════════════════════
# ROUND RESOLUTION + SESSION BUILDER
# ═════════════════════════════════════════════════════════════

def dish_for(token: str, tier: str, food_map: Dict) -> str:
    """Map a board token (a/b/c) -> dish name for a given tier."""
    v = food_map[token]
    return v[tier] if isinstance(v, dict) else v

def resolve_round(board: Board, tier: str, food_map: Dict) -> List[List[str]]:
    """Expand an a/b/c board into two rows of dish names."""
    if tier != "easy":
        assert rule_valid(board), "board breaks the 3-order rule"
    return [[dish_for(t, tier, food_map) for t in row] for row in board]


def build_session(seed: Optional[int] = None,
                  board_seed: Optional[int] = None) -> Dict:
    """Build one complete playthrough.

    seed        : food seed (None -> fresh food every launch)
    board_seed  : board-choice seed (None -> fresh boards; set for reproducible
                  board picks while still rotating food, or vice-versa)

    Returns a dict with the food seed, the food map, and the 6 resolved rounds.
    """
    food_seed, food_map = session_food_map(seed)
    brng = random.Random(board_seed if board_seed is not None
                         else secrets.randbits(32))

    rounds = []
    for rid, tier, _score, _shape in ROUND_SPEC:
        board = brng.choice(ROUND_POOLS[rid])
        rounds.append({
            "round": rid,
            "tier": tier,
            "board": board,                       # a/b/c pattern
            "orders": sorted(set(board[0] + board[1])),
            "dishes": resolve_round(board, tier, food_map),
        })
    return {"food_seed": food_seed, "food_map": food_map, "rounds": rounds}


# ═════════════════════════════════════════════════════════════
# OPTIONAL: rough session-length model (mirror on the leaderboard side)
# ═════════════════════════════════════════════════════════════
_ROUND_SECONDS = {"easy": 16.0, "medium": 21.0, "hard": 24.0}

def estimate_session_seconds() -> float:
    return round(sum(_ROUND_SECONDS[t] for _, t, *_ in ROUND_SPEC), 1)


# ═════════════════════════════════════════════════════════════
# DEMO
# ═════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=== Round pool sizes (interchangeable boards per round) ===")
    for rid, n in pool_sizes().items():
        print(f"  {rid}: {n}")
    print(f"  -> distinct board-only playthroughs: {total_board_scenarios():,}")
    print(f"  -> est. session length: {estimate_session_seconds()}s "
          f"(~{estimate_session_seconds()/60:.1f} min)\n")

    print("=== Two fresh launches (different food, same rule ladder) ===")
    last = None
    for i in range(2):
        s = build_session()
        fm = s["food_map"]
        print(f"\n--- Launch {i+1}  (food_seed {s['food_seed']}) ---")
        print(f"    anchors a={fm['a']}  b={fm['b']}  "
              f"| c: {fm['c']['medium']} (med) -> {fm['c']['hard']} (hard twin of a)")
        for r in s["rounds"]:
            row1 = " / ".join(r["dishes"][0])
            row2 = " / ".join(r["dishes"][1])
            print(f"    {r['round']} [{r['tier']:6s}] {'-'.join(r['board'])}")
            print(f"        {row1}")
            print(f"        {row2}")
        last = s["food_seed"]

    print("\n=== Reproducibility: same food_seed -> same food ===")
    a1 = build_session(seed=777)["food_map"]
    a2 = build_session(seed=777)["food_map"]
    print(f"    identical food map for seed 777: {a1 == a2}")
