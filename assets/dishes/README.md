# Dish plate assets

The game renders each dish from `assets/dishes/<key>.png` (one circular plate
per file). Until a file exists for a key, the game falls back to that dish's
emoji automatically — so it always runs.

Generate these from the reference grid art:

```bash
pip install pillow
python3 scripts/slice_dishes.py path/to/grid.png
```

That slices the 7×4 grid into the 24 catalogue plates named by their asset key
(see `DISHES` in `../menus.js` and `MAPPING` in `../../scripts/slice_dishes.py`).
Debug copies of every tile land in `scripts/_tiles/` so the mapping can be
checked and corrected.

Expected filenames (asset keys):

```
tom_yum  tom_kha  green_curry  red_curry  massaman  khao_soi
pad_thai  pad_see_ew  pad_see_mao  drunken_noodles
pineapple_rice  pad_kra_pao  khao_moo_daeng  kai_jeow  hoy_tod
som_tum  laab_moo  nam_tok_moo  tod_mun_pla  moo_ping
gai_yang  pla_rad_prik  mango_sticky_rice  tub_tim_grob
```
