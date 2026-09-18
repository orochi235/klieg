# Counter rescue prototype

Shipped `tubing`: radius 0.022, bend 2, minRun 0.15, blockout 0.7, select seed 0.85.
16 faces (the 15 in apps/lab/public/fonts/ plus Archivo Black, apps/lab/public/font.ttf), letters ABDOPQRabdegopq04689@&, seed 0; seed sweep 0-9.
Counters measured: 372, of which 52 are not LIT.

Ring reconstruction, isolated-ring perimeter, isolated path count and 271 cut replays checked: no problems.

## Classes at stock settings (in-glyph, seed 0)

| face |          LIT |     DARK_ALL | SELECT_UNLIT |         NONE | total |
|:--|-------------:|-------------:|-------------:|-------------:|------:|
| abril-fatface      |           25 |            0 |            0 |            0 |    25 |
| anton              |           15 |            5 |            0 |            5 |    25 |
| bebas-neue         |           19 |            4 |            0 |            0 |    23 |
| cinzel             |           14 |            0 |            0 |            0 |    14 |
| great-vibes        |           15 |            1 |            1 |            1 |    18 |
| limelight          |           14 |            2 |            0 |            0 |    16 |
| lobster            |           14 |            1 |            0 |            2 |    17 |
| monoton            |           24 |            0 |            0 |            0 |    24 |
| pirata-one         |           24 |            0 |            0 |            0 |    24 |
| press-start-2p     |           23 |            2 |            0 |            0 |    25 |
| rye                |           68 |            2 |            2 |            3 |    75 |
| satisfy            |           22 |            1 |            1 |            2 |    26 |
| shadows-into-light |           20 |            1 |            0 |            1 |    22 |
| vegapunk           |            3 |            0 |            0 |           12 |    15 |
| archivo-black      |           20 |            2 |            0 |            1 |    23 |
| ALL                |          320 |           21 |            4 |           27 |   372 |

No counters in this letter set: black-ops-one.

### Why DARK_ALL

Raw spans at stock, before the floor. A dark span is exempt from `minRun`; a lightable one under it is dropped.

DARK_ALL counters: 21. No lightable raw span at all: 0. Lightable spans present but every one under 0.15 em: 21. Any other: 0.

| face | letter | hole | perim em | dark spans | dark em | lightable spans | longest lightable em |
|:--|:--:|---:|--------:|----------:|--------:|---------------:|--------------------:|
| press-start-2p     | & |   1 |   0.994 |         5 |   0.621 |              2 |               0.080 |
| anton              | 4 |   0 |   0.973 |         1 |   0.271 |              3 |               0.120 |
| anton              | A |   0 |   0.955 |         1 |   0.278 |              3 |               0.100 |
| bebas-neue         | A |   0 |   0.797 |         2 |   0.343 |              1 |               0.019 |
| bebas-neue         | a |   0 |   0.797 |         2 |   0.343 |              1 |               0.019 |
| limelight          | A |   0 |   0.794 |         2 |   0.302 |              3 |               0.142 |
| rye                | @ |   3 |   0.767 |         1 |   0.330 |              2 |               0.083 |
| limelight          | e |   0 |   0.682 |         2 |   0.295 |              4 |               0.103 |
| archivo-black      | A |   0 |   0.656 |         2 |   0.334 |              2 |               0.060 |
| anton              | @ |   0 |   0.607 |         1 |   0.220 |              2 |               0.124 |
| bebas-neue         | P |   0 |   0.596 |         1 |   0.203 |              3 |               0.122 |
| bebas-neue         | p |   0 |   0.596 |         1 |   0.203 |              3 |               0.122 |
| anton              | a |   0 |   0.595 |         1 |   0.230 |              2 |               0.101 |
| anton              | & |   1 |   0.558 |         1 |   0.159 |              2 |               0.085 |
| lobster            | e |   0 |   0.544 |         1 |   0.198 |              2 |               0.124 |
| press-start-2p     | @ |   0 |   0.494 |         3 |   0.381 |              2 |               0.020 |
| archivo-black      | e |   0 |   0.485 |         1 |   0.214 |              2 |               0.104 |
| great-vibes        | e |   0 |   0.485 |         1 |   0.249 |              2 |               0.021 |
| shadows-into-light | e |   0 |   0.465 |         1 |   0.235 |              2 |               0.022 |
| rye                | & |   0 |   0.460 |         1 |   0.182 |              2 |               0.145 |
| satisfy            | o |   0 |   0.436 |         1 |   0.236 |              3 |               0.042 |

## Isolation agreement at stock settings

Isolated class matches in-glyph class on **338/372 counters (90.9%)**, but on only **32/52 (61.5%) of the non-LIT ones** -- the counters the ladder is for.

Rows in-glyph, columns isolated:

| in-glyph \ isolated |          LIT |     DARK_ALL | SELECT_UNLIT |         NONE |
|:--|-------------:|-------------:|-------------:|-------------:|
| LIT          |          306 |           14 |            0 |            0 |
| DARK_ALL     |           14 |            6 |            0 |            1 |
| SELECT_UNLIT |            4 |            0 |            0 |            0 |
| NONE         |            1 |            0 |            0 |           26 |

`select` lights round(0.85 x n) runs, so a pool of 1, 2 or 3 lightable runs is lit in full: an isolated counter
cannot be SELECT_UNLIT unless it carries 4 or more lightable runs.

## Rescue ladder (blockout 0, radius x k), seed 0

Rescued = at least one non-dark run survives, i.e. a lightable span of at least 0.15 em.

| rung | k | isolated | in-glyph |
|:-----|-----:|---------:|---------:|
| R1 | 1.00 |       23 |       22 |
| R2 | 0.85 |        4 |        4 |
| R3 | 0.70 |        5 |        5 |
| R4 | 0.60 |       12 |        2 |
| R5 | 0.50 |        1 |        2 |
| UNRESCUED | |        7 |       17 |

Isolated and in-glyph name the same seed-0 rung on 36/52 counters.

By stock class:

| stock class | n | R1 iso | R1 glyph | later iso | later glyph | unresc iso | unresc glyph |
|:--|--:|------:|--------:|---------:|-----------:|----------:|------------:|
| DARK_ALL     |  21 |    18 |      18 |        3 |          3 |         0 |           0 |
| SELECT_UNLIT |   4 |     4 |       4 |        0 |          0 |         0 |           0 |
| NONE         |  27 |     1 |       0 |       19 |         10 |         7 |          17 |

## Rung stability, seeds 0-9

Each rung built at every seed, independently of where the ladder stopped. A cell is the seeds out of 10 at which that
rung rescues. **Robust** is the first rung rescuing at all 10; `unlit` is how many of the 10 seeds leave the counter
rescued but unlit by select at the robust in-glyph rung.

| rung | robust in-glyph | robust isolated |
|:--|---------------:|---------------:|
| R1 |             22 |             21 |
| R2 |              3 |              3 |
| R3 |              5 |              4 |
| R4 |              2 |              2 |
| R5 |              1 |              3 |
| never robust |             19 |             19 |

Robust rung agrees between isolated and in-glyph on 44/52 counters.
Counters with at least one rung that rescues at some seeds but not all (a draw, not a radius): 23/52.
At the robust in-glyph rung, select leaves a rescued counter unlit on 49 of 330 counter-seeds (14.8%) -- the rate a "light the longest non-dark run" guarantee would fire.

| face | letter | hole | perim em | class | glyph R1 R2 R3 R4 R5 | iso R1 R2 R3 R4 R5 | robust glyph | robust iso | unlit |
|:--|:--:|---:|--------:|:--|:--|:--|:--|:--|----:|
| rye                | 0 |   0 |   1.456 | SELECT_UNLIT | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   1 |
| satisfy            | B |   0 |   1.095 | SELECT_UNLIT | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   1 |
| rye                | o |   0 |   1.094 | SELECT_UNLIT | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   1 |
| press-start-2p     | & |   1 |   0.994 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   1 |
| anton              | 4 |   0 |   0.973 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| anton              | A |   0 |   0.955 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| bebas-neue         | A |   0 |   0.797 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| bebas-neue         | a |   0 |   0.797 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| limelight          | A |   0 |   0.794 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   1 |
| rye                | @ |   3 |   0.767 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| limelight          | e |   0 |   0.682 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| rye                | b |   2 |   0.664 | NONE         |  9 10 10 10 10 |  9 10 10 10 10 | R2    | R2    |   0 |
| archivo-black      | A |   0 |   0.656 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| great-vibes        | 8 |   0 |   0.644 | SELECT_UNLIT | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   2 |
| anton              | @ |   0 |   0.607 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   1 |
| bebas-neue         | P |   0 |   0.596 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| bebas-neue         | p |   0 |   0.596 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| anton              | a |   0 |   0.595 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| anton              | & |   1 |   0.558 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   1 |
| lobster            | e |   0 |   0.544 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| press-start-2p     | @ |   0 |   0.494 | DARK_ALL     |  8  9  9  9 10 |  7  9  9  9  9 | R5    | never |   1 |
| anton              | B |   0 |   0.493 | NONE         |  0  3 10 10 10 |  0  0 10 10 10 | R3    | R3    |   3 |
| archivo-black      | e |   0 |   0.485 | DARK_ALL     | 10 10 10 10 10 |  9 10 10 10 10 | R1    | R2    |   2 |
| great-vibes        | e |   0 |   0.485 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   0 |
| anton              | e |   0 |   0.469 | NONE         |  0 10 10 10 10 |  0 10 10 10 10 | R2    | R2    |   2 |
| shadows-into-light | e |   0 |   0.465 | DARK_ALL     | 10 10 10 10 10 | 10 10 10 10 10 | R1    | R1    |   4 |
| rye                | & |   0 |   0.460 | DARK_ALL     |  1  2  1  1  2 |  0  0  4  5  5 | never | never |   — |
| anton              | R |   0 |   0.437 | NONE         |  0  0 10 10 10 |  0  5 10 10 10 | R3    | R3    |   3 |
| satisfy            | o |   0 |   0.436 | DARK_ALL     |  5  9 10 10 10 |  4  7 10 10 10 | R3    | R3    |   1 |
| anton              | 8 |   0 |   0.409 | NONE         |  1 10 10 10 10 |  0  5 10 10 10 | R2    | R3    |   2 |
| shadows-into-light | & |   0 |   0.374 | NONE         |  2  2 10 10 10 |  0  0  7 10 10 | R3    | R4    |   6 |
| anton              | & |   0 |   0.350 | NONE         |  0  0  0 10 10 |  0  0  0  8 10 | R4    | R5    |   4 |
| lobster            | g |   1 |   0.331 | NONE         |  0  0  2 10 10 |  0  0  1  8 10 | R4    | R5    |   6 |
| archivo-black      | @ |   0 |   0.329 | NONE         |  0  0 10 10 10 |  0  3  8 10 10 | R3    | R4    |   6 |
| satisfy            | Q |   0 |   0.328 | NONE         |  0  0  6  6  7 |  0  0  0  0 10 | never | R5    |   — |
| rye                | e |   1 |   0.316 | NONE         |  0  0  0  0  0 |  0  0  0  0  0 | never | never |   — |
| vegapunk           | A |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | 8 |   1 |   0.266 | NONE         |  0  0  0  0  2 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | B |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | R |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | 8 |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | P |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | 6 |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | B |   1 |   0.266 | NONE         |  0  0  0  0  2 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | b |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| vegapunk           | 9 |   0 |   0.266 | NONE         |  0  0  0  0  3 |  0  0  0  3  6 | never | never |   — |
| great-vibes        | & |   0 |   0.231 | NONE         |  0  0  0  0  0 |  0  0  0  0  0 | never | never |   — |
| lobster            | Q |   0 |   0.205 | NONE         |  0  0  0  0  0 |  0  0  0  0  0 | never | never |   — |
| vegapunk           | 0 |   1 |   0.193 | NONE         |  0  0  0  0  0 |  0  0  0  0  0 | never | never |   — |
| vegapunk           | 0 |   0 |   0.189 | NONE         |  0  0  0  0  0 |  0  0  0  0  0 | never | never |   — |
| satisfy            | R |   0 |   0.128 | NONE         |  0  0  0  0  0 |  0  0  0  0  0 | never | never |   — |
| rye                | A |   2 |   0.006 | NONE         |  0  0  0  0  0 |  0  0  0  0  0 | never | never |   — |

Never robustly rescued in-glyph, by perimeter:

| face | letter | hole | perim em | best rung seeds/10 |
|:--|:--:|---:|--------:|------------------:|
| rye                | & |   0 |   0.460 |                 2 |
| satisfy            | Q |   0 |   0.328 |                 7 |
| rye                | e |   1 |   0.316 |                 0 |
| vegapunk           | A |   0 |   0.266 |                 3 |
| vegapunk           | 8 |   1 |   0.266 |                 2 |
| vegapunk           | B |   0 |   0.266 |                 3 |
| vegapunk           | R |   0 |   0.266 |                 3 |
| vegapunk           | 8 |   0 |   0.266 |                 3 |
| vegapunk           | P |   0 |   0.266 |                 3 |
| vegapunk           | 6 |   0 |   0.266 |                 3 |
| vegapunk           | B |   1 |   0.266 |                 2 |
| vegapunk           | b |   0 |   0.266 |                 3 |
| vegapunk           | 9 |   0 |   0.266 |                 3 |
| great-vibes        | & |   0 |   0.231 |                 0 |
| lobster            | Q |   0 |   0.205 |                 0 |
| vegapunk           | 0 |   1 |   0.193 |                 0 |
| vegapunk           | 0 |   0 |   0.189 |                 0 |
| satisfy            | R |   0 |   0.128 |                 0 |
| rye                | A |   2 |   0.006 |                 0 |

## Does select light it at the seed-0 rescuing rung?

| | rescued | select lights one | needs the guarantee |
|:--|--------:|------------------:|--------------------:|
| isolated |      45 |                45 |                   0 |
| in-glyph |      35 |                34 |                   1 |

In-glyph, rescued but left unlit by select:

| face | letter | hole | perim em | rung | runs | longest em |
|:--|:--:|---:|--------:|:--|---:|----------:|
| satisfy            | B |   0 |   1.095 | R1 |   1 |     1.058 |

## Rule F: radius = min(radius, minRho / max(1.25, bend))

`minRho` is the tightest vertex bend radius on the counter path the cut receives (`F cut`, wandered, 3D) and on the
same points flattened (`F flat`). Fractions are of the glyph radius 0.022. `F corners` and `F rescued` build the counter
isolated at the `F cut` radius with stock blockout -- the rule as stated.

Rule F touches 50/52 non-LIT counters; 49 fall below 0.5 on the cut path, 49 on the flat ring. At its radius it leaves 49 with zero corners and rescues 49.

| face | letter | hole | perim em | minRho cut | F cut | minRho flat | F flat | <0.5 | F corners | F rescued | robust ladder (glyph) |
|:--|:--:|---:|--------:|-----------:|------:|------------:|-------:|:--:|---------:|:--:|:--|
| rye                | A |   2 |   0.006 |     0.0055 | 0.125 |      0.0004 |  0.009 |  !  |        0 |  no | never |
| anton              | 4 |   0 |   0.973 |     0.0082 | 0.187 |      0.0081 |  0.183 |  !  |        0 | yes | R1 |
| rye                | @ |   3 |   0.767 |     0.0085 | 0.194 |      0.0080 |  0.182 |  !  |        0 | yes | R1 |
| anton              | A |   0 |   0.955 |     0.0091 | 0.208 |      0.0090 |  0.204 |  !  |        0 | yes | R1 |
| great-vibes        | & |   0 |   0.231 |     0.0097 | 0.221 |      0.0092 |  0.208 |  !  |        0 | yes | never |
| archivo-black      | A |   0 |   0.656 |     0.0099 | 0.226 |      0.0096 |  0.219 |  !  |        0 | yes | R1 |
| bebas-neue         | A |   0 |   0.797 |     0.0102 | 0.231 |      0.0098 |  0.223 |  !  |        0 | yes | R1 |
| bebas-neue         | a |   0 |   0.797 |     0.0102 | 0.231 |      0.0098 |  0.223 |  !  |        0 | yes | R1 |
| rye                | & |   0 |   0.460 |     0.0109 | 0.247 |      0.0105 |  0.238 |  !  |        0 | yes | never |
| anton              | & |   0 |   0.350 |     0.0115 | 0.261 |      0.0115 |  0.261 |  !  |        0 | yes | R4 |
| rye                | b |   2 |   0.664 |     0.0116 | 0.263 |      0.0108 |  0.246 |  !  |        0 | yes | R2 |
| satisfy            | R |   0 |   0.128 |     0.0118 | 0.269 |      0.0079 |  0.179 |  !  |        0 | yes | never |
| limelight          | A |   0 |   0.794 |     0.0118 | 0.269 |      0.0118 |  0.268 |  !  |        0 | yes | R1 |
| vegapunk           | 0 |   1 |   0.193 |     0.0120 | 0.274 |      0.0100 |  0.228 |  !  |        0 | yes | never |
| lobster            | g |   1 |   0.331 |     0.0121 | 0.275 |      0.0104 |  0.236 |  !  |        0 | yes | R4 |
| satisfy            | B |   0 |   1.095 |     0.0122 | 0.276 |      0.0118 |  0.269 |  !  |        0 | yes | R1 |
| anton              | & |   1 |   0.558 |     0.0124 | 0.282 |      0.0112 |  0.255 |  !  |        0 | yes | R1 |
| satisfy            | Q |   0 |   0.328 |     0.0132 | 0.300 |      0.0128 |  0.292 |  !  |        0 | yes | never |
| rye                | e |   1 |   0.316 |     0.0132 | 0.300 |      0.0101 |  0.229 |  !  |        0 | yes | never |
| great-vibes        | e |   0 |   0.485 |     0.0137 | 0.312 |      0.0133 |  0.303 |  !  |        0 | yes | R1 |
| shadows-into-light | e |   0 |   0.465 |     0.0137 | 0.312 |      0.0134 |  0.304 |  !  |        0 | yes | R1 |
| lobster            | Q |   0 |   0.205 |     0.0146 | 0.333 |      0.0131 |  0.298 |  !  |        0 | yes | never |
| press-start-2p     | & |   1 |   0.994 |     0.0147 | 0.334 |      0.0141 |  0.321 |  !  |        0 | yes | R1 |
| anton              | a |   0 |   0.595 |     0.0148 | 0.336 |      0.0134 |  0.304 |  !  |        0 | yes | R1 |
| anton              | B |   0 |   0.493 |     0.0150 | 0.341 |      0.0150 |  0.342 |  !  |        0 | yes | R3 |
| archivo-black      | e |   0 |   0.485 |     0.0151 | 0.343 |      0.0138 |  0.314 |  !  |        1 | yes | R1 |
| press-start-2p     | @ |   0 |   0.494 |     0.0162 | 0.367 |      0.0140 |  0.318 |  !  |        0 | yes | R5 |
| lobster            | e |   0 |   0.544 |     0.0162 | 0.367 |      0.0160 |  0.364 |  !  |        0 | yes | R1 |
| vegapunk           | 0 |   0 |   0.189 |     0.0165 | 0.375 |      0.0098 |  0.222 |  !  |        0 | yes | never |
| anton              | e |   0 |   0.469 |     0.0167 | 0.379 |      0.0167 |  0.379 |  !  |        0 | yes | R2 |
| limelight          | e |   0 |   0.682 |     0.0167 | 0.379 |      0.0161 |  0.366 |  !  |        0 | yes | R1 |
| great-vibes        | 8 |   0 |   0.644 |     0.0167 | 0.380 |      0.0167 |  0.378 |  !  |        0 | yes | R1 |
| bebas-neue         | P |   0 |   0.596 |     0.0168 | 0.383 |      0.0166 |  0.378 |  !  |        0 | yes | R1 |
| bebas-neue         | p |   0 |   0.596 |     0.0168 | 0.383 |      0.0166 |  0.378 |  !  |        0 | yes | R1 |
| shadows-into-light | & |   0 |   0.374 |     0.0185 | 0.420 |      0.0161 |  0.365 |  !  |        0 | yes | R3 |
| satisfy            | o |   0 |   0.436 |     0.0197 | 0.447 |      0.0184 |  0.419 |  !  |        0 | yes | R3 |
| vegapunk           | 8 |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | 8 |   1 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | 9 |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | B |   1 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | R |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | B |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | P |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | b |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | 6 |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| vegapunk           | A |   0 |   0.266 |     0.0205 | 0.467 |      0.0182 |  0.413 |  !  |        0 | yes | never |
| anton              | R |   0 |   0.437 |     0.0207 | 0.471 |      0.0214 |  0.485 |  !  |        0 | yes | R3 |
| archivo-black      | @ |   0 |   0.329 |     0.0210 | 0.478 |      0.0219 |  0.497 |  !  |        0 | yes | R3 |
| anton              | @ |   0 |   0.607 |     0.0214 | 0.486 |      0.0201 |  0.456 |  !  |        0 | yes | R1 |
| anton              | 8 |   0 |   0.409 |     0.0319 | 0.725 |      0.0373 |  0.849 |     |        0 | yes | R2 |

## Self-intersection check

Every surviving run at the seed-0 rescuing rung: `minCurvatureRadius3(run)` against `minBendRadius(radius x k, bend)`.
The stock baseline runs the same check over LIT counters at stock radius. The control checks the thinned rungs'
runs against the stock radius's limit instead, which they should break -- it shows the check can go red.

| check | runs | flagged | worst curv / limit |
|:--|-----:|-------:|------------------:|
| rescued, isolated     |   88 |      0 |             1.000 |
| rescued, in-glyph     |   55 |      0 |             1.000 |
| stock LIT baseline    |  792 |      0 |             1.000 |
| control (stock limit) |   25 |     25 |             0.543 |

No run at any rescuing rung bends tighter than its glass allows.

## Archivo Black, JACKPOT! at slot seeds

| letter | seed | hole | perim em | stock class | isolated class | rung iso | rung glyph | lit at rung (glyph) | robust glyph | F cut |
|:--:|---:|---:|--------:|:--|:--|:--|:--|:--:|:--|------:|
| A |   1 |   0 |   0.656 | DARK_ALL | DARK_ALL | R1 | R1 | yes | R1 | 0.220 |
| P |   4 |   0 |   0.552 | LIT | LIT | — | — | — | — | 0.460 |
| O |   5 |   0 |   1.107 | LIT | LIT | — | — | — | — | 1.000 |

