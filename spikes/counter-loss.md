# Counters lost at the shipped `tubing` settings

Fonts 15, letters tried A B D O P Q R a b d e g o p q 0 4 6 8 9 @ &, seed 0 (lit also sampled at 0,1,2,3,4).
`runs 7`, `minRun 0.15`, `radius 0.022`, `bend 2`, `select seed 0.85`.

## Mapping check

Path-to-ring mapping verified on 812 paths: 0 disagreed with the
independent nearest-ring test, 2 were an exact tie between rings sharing a vertex
(pixel faces), where the test cannot separate them and the order mapping stands.
Runs with no attributable source vertex: 11.
Runs spanning more than one path: 0.

## Every hole that produced zero runs

`perim` and `area` are the counter itself, in em and em². `drop` marks a ring that never
became a path at all (too short to resample); the rest became a path that carried no run.
`seeds` is how many of the five seeds produced zero runs.

### anton.ttf  (5 lost)

| letter | hole | perim em | area em² | drop | seeds |
|:------:|-----:|---------:|---------:|:----:|------:|
| B |    0 |    0.493 |   0.0132 |   no |     5/5 |
| e |    0 |    0.469 |   0.0133 |   no |     5/5 |
| R |    0 |    0.437 |   0.0114 |   no |     5/5 |
| 8 |    0 |    0.409 |   0.0118 |   no |     5/5 |
| & |    0 |    0.350 |   0.0064 |   no |     5/5 |

### great-vibes.ttf  (1 lost)

| letter | hole | perim em | area em² | drop | seeds |
|:------:|-----:|---------:|---------:|:----:|------:|
| & |    0 |    0.231 |   0.0024 |   no |     5/5 |

### lobster.ttf  (2 lost)

| letter | hole | perim em | area em² | drop | seeds |
|:------:|-----:|---------:|---------:|:----:|------:|
| g |    1 |    0.331 |   0.0066 |   no |     5/5 |
| Q |    0 |    0.205 |   0.0026 |   no |     5/5 |

### rye.ttf  (3 lost)

| letter | hole | perim em | area em² | drop | seeds |
|:------:|-----:|---------:|---------:|:----:|------:|
| b |    2 |    0.664 |   0.0083 |   no |     1/5 |
| e |    1 |    0.316 |   0.0036 |   no |     5/5 |
| A |    2 |    0.006 |   0.0000 |   no |     5/5 |

### satisfy.ttf  (2 lost)

| letter | hole | perim em | area em² | drop | seeds |
|:------:|-----:|---------:|---------:|:----:|------:|
| Q |    0 |    0.328 |   0.0066 |   no |     5/5 |
| R |    0 |    0.128 |   0.0009 |   no |     5/5 |

### shadows-into-light.ttf  (1 lost)

| letter | hole | perim em | area em² | drop | seeds |
|:------:|-----:|---------:|---------:|:----:|------:|
| & |    0 |    0.374 |   0.0095 |   no |     4/5 |

### vegapunk.otf  (12 lost)

| letter | hole | perim em | area em² | drop | seeds |
|:------:|-----:|---------:|---------:|:----:|------:|
| A |    0 |    0.266 |   0.0051 |   no |     5/5 |
| 8 |    1 |    0.266 |   0.0051 |   no |     5/5 |
| B |    0 |    0.266 |   0.0051 |   no |     5/5 |
| R |    0 |    0.266 |   0.0051 |   no |     5/5 |
| 8 |    0 |    0.266 |   0.0051 |   no |     5/5 |
| P |    0 |    0.266 |   0.0051 |   no |     5/5 |
| 6 |    0 |    0.266 |   0.0051 |   no |     5/5 |
| B |    1 |    0.266 |   0.0051 |   no |     5/5 |
| b |    0 |    0.266 |   0.0051 |   no |     5/5 |
| 9 |    0 |    0.266 |   0.0051 |   no |     5/5 |
| 0 |    1 |    0.193 |   0.0015 |   no |     5/5 |
| 0 |    0 |    0.189 |   0.0015 |   no |     5/5 |

## Rate

| font | holes | lost | rate % | letters | all-holes-lost |
|:-----|------:|-----:|-------:|--------:|---------------:|
| abril-fatface      |    25 |    0 |    0.0 |      22 |              0 |
| anton              |    25 |    5 |   20.0 |      22 |              2 |
| bebas-neue         |    23 |    0 |    0.0 |      20 |              0 |
| cinzel             |    14 |    0 |    0.0 |      14 |              0 |
| great-vibes        |    18 |    1 |    5.6 |      14 |              1 |
| limelight          |    16 |    0 |    0.0 |      16 |              0 |
| lobster            |    17 |    2 |   11.8 |      15 |              1 |
| monoton            |    24 |    0 |    0.0 |       6 |              0 |
| pirata-one         |    24 |    0 |    0.0 |      22 |              0 |
| press-start-2p     |    25 |    0 |    0.0 |      22 |              0 |
| rye                |    75 |    3 |    4.0 |      22 |              0 |
| satisfy            |    26 |    2 |    7.7 |      20 |              1 |
| shadows-into-light |    22 |    1 |    4.5 |      21 |              1 |
| vegapunk           |    15 |   12 |   80.0 |      12 |              9 |
| ALL                |   349 |   26 |    7.4 |     248 |             15 |

Absent from the table, having no `shape.holes` entry anywhere in this letter set: black-ops-one.ttf.
A stencil face has no enclosed counter to lose -- its letters break into disjoint outlines,
and the white inside them is open to the outside.

## Where loss starts

| | perim em | area em² | font | letter |
|:--|---------:|---------:|:-----|:------:|
| largest lost |    0.664 |   0.0083 | rye.ttf | b |
| smallest kept |    0.436 |   0.0140 | satisfy.ttf | o |
| largest lost at every seed |    0.493 |   0.0132 | anton.ttf | B |
| smallest kept at every seed |    0.436 |   0.0140 | satisfy.ttf | o |

Holes lost at some seeds but not all: 3.

`minRun * runs` = 1.05 em, `minRun` = 0.15 em.

Against minRun = 0.15 em: under it    2/   2 lost, at or over it   24/ 347 lost.
Against minRun*runs = 1.05 em: under it   26/ 237 lost, at or over it    0/ 112 lost.

Loss by perimeter band:

| band em | holes | lost | rate % |
|:--------|------:|-----:|-------:|
|  0.00- 0.15 |     2 |    2 |  100.0 |
|  0.15- 0.30 |    14 |   14 |  100.0 |
|  0.30- 0.50 |    19 |    9 |   47.4 |
|  0.50- 0.75 |    83 |    1 |    1.2 |
|  0.75- 1.05 |   119 |    0 |    0.0 |
|  1.05- 1.50 |    65 |    0 |    0.0 |
|  1.50- 2.50 |    43 |    0 |    0.0 |
|  2.50-  inf |     4 |    0 |    0.0 |

## Letters that lost every counter

| font | letter | holes | contours |
|:-----|:------:|------:|---------:|
| anton              | R |     1 |        2 |
| anton              | e |     1 |        2 |
| great-vibes        | & |     1 |        2 |
| lobster            | Q |     1 |        2 |
| satisfy            | Q |     1 |        2 |
| shadows-into-light | & |     1 |        2 |
| vegapunk           | A |     1 |        2 |
| vegapunk           | B |     2 |        3 |
| vegapunk           | P |     1 |        2 |
| vegapunk           | R |     1 |        2 |
| vegapunk           | b |     1 |        3 |
| vegapunk           | 0 |     2 |        3 |
| vegapunk           | 6 |     1 |        2 |
| vegapunk           | 8 |     2 |        3 |
| vegapunk           | 9 |     1 |        2 |

Letters whose counters all drew runs but none lit at seed 0: 15 (anton A, anton a, anton 4, anton @, anton &, bebas-neue A, bebas-neue P, bebas-neue a, bebas-neue p, great-vibes e, limelight A, limelight e, lobster e, press-start-2p @, shadows-into-light e)

## Every hole

| font | letter | hole | perim em | area em² | runs | lit | no-run seeds | no-lit seeds |
|:-----|:------:|-----:|---------:|---------:|-----:|----:|-------------:|-------------:|
| abril-fatface      | A |    0 |    0.729 |   0.0237 |    3 |   1 |            0 |            4 |
| abril-fatface      | B |    0 |    0.868 |   0.0441 |    3 |   1 |            0 |            1 |
| abril-fatface      | B |    1 |    0.778 |   0.0333 |    3 |   2 |            0 |            1 |
| abril-fatface      | D |    0 |    1.612 |   0.1331 |    3 |   1 |            0 |            0 |
| abril-fatface      | O |    0 |    1.632 |   0.1549 |    3 |   3 |            0 |            0 |
| abril-fatface      | P |    0 |    0.911 |   0.0428 |    3 |   2 |            0 |            1 |
| abril-fatface      | Q |    0 |    1.632 |   0.1549 |    1 |   1 |            0 |            0 |
| abril-fatface      | R |    0 |    0.812 |   0.0397 |    1 |   1 |            0 |            0 |
| abril-fatface      | a |    0 |    0.447 |   0.0109 |    2 |   2 |            0 |            1 |
| abril-fatface      | b |    0 |    0.963 |   0.0465 |    2 |   1 |            0 |            2 |
| abril-fatface      | d |    0 |    0.969 |   0.0471 |    2 |   1 |            0 |            1 |
| abril-fatface      | e |    0 |    0.527 |   0.0174 |    1 |   1 |            0 |            2 |
| abril-fatface      | g |    0 |    0.679 |   0.0238 |    2 |   2 |            0 |            0 |
| abril-fatface      | o |    0 |    1.040 |   0.0510 |    3 |   3 |            0 |            0 |
| abril-fatface      | p |    0 |    0.963 |   0.0465 |    1 |   1 |            0 |            2 |
| abril-fatface      | q |    0 |    0.963 |   0.0466 |    1 |   1 |            0 |            1 |
| abril-fatface      | 0 |    0 |    1.573 |   0.1216 |    3 |   3 |            0 |            0 |
| abril-fatface      | 4 |    0 |    1.140 |   0.0503 |    4 |   1 |            0 |            0 |
| abril-fatface      | 6 |    0 |    0.975 |   0.0582 |    2 |   2 |            0 |            0 |
| abril-fatface      | 8 |    0 |    0.879 |   0.0521 |    2 |   2 |            0 |            1 |
| abril-fatface      | 8 |    1 |    0.777 |   0.0382 |    1 |   1 |            0 |            1 |
| abril-fatface      | 9 |    0 |    0.975 |   0.0583 |    2 |   2 |            0 |            0 |
| abril-fatface      | @ |    0 |    0.865 |   0.0427 |    3 |   2 |            0 |            1 |
| abril-fatface      | & |    0 |    0.992 |   0.0585 |    2 |   1 |            0 |            1 |
| abril-fatface      | & |    1 |    0.698 |   0.0358 |    3 |   2 |            0 |            0 |
| anton              | A |    0 |    0.955 |   0.0187 |    1 |   0 |            0 |            3 |
| anton              | B |    0 |    0.493 |   0.0132 |    0 |   0 |            5 |            5 |
| anton              | B |    1 |    0.615 |   0.0196 |    2 |   1 |            0 |            2 |
| anton              | D |    0 |    1.229 |   0.0421 |    2 |   2 |            0 |            0 |
| anton              | O |    0 |    1.202 |   0.0434 |    3 |   3 |            0 |            0 |
| anton              | P |    0 |    0.520 |   0.0147 |    2 |   2 |            0 |            0 |
| anton              | Q |    0 |    1.201 |   0.0433 |    2 |   2 |            0 |            0 |
| anton              | R |    0 |    0.437 |   0.0114 |    0 |   0 |            5 |            5 |
| anton              | a |    0 |    0.595 |   0.0171 |    1 |   0 |            0 |            3 |
| anton              | b |    0 |    1.034 |   0.0360 |    2 |   1 |            0 |            0 |
| anton              | d |    0 |    1.038 |   0.0378 |    2 |   2 |            0 |            0 |
| anton              | e |    0 |    0.469 |   0.0133 |    0 |   0 |            5 |            5 |
| anton              | g |    0 |    0.855 |   0.0293 |    2 |   2 |            0 |            0 |
| anton              | o |    0 |    1.045 |   0.0375 |    3 |   3 |            0 |            0 |
| anton              | p |    0 |    1.034 |   0.0360 |    2 |   1 |            0 |            0 |
| anton              | q |    0 |    1.036 |   0.0377 |    2 |   1 |            0 |            0 |
| anton              | 0 |    0 |    1.208 |   0.0455 |    3 |   3 |            0 |            0 |
| anton              | 4 |    0 |    0.973 |   0.0220 |    1 |   0 |            0 |            2 |
| anton              | 6 |    0 |    0.554 |   0.0177 |    2 |   1 |            0 |            0 |
| anton              | 8 |    0 |    0.409 |   0.0118 |    0 |   0 |            5 |            5 |
| anton              | 8 |    1 |    0.573 |   0.0197 |    2 |   1 |            0 |            0 |
| anton              | 9 |    0 |    0.554 |   0.0177 |    2 |   1 |            0 |            0 |
| anton              | @ |    0 |    0.607 |   0.0181 |    1 |   0 |            0 |            3 |
| anton              | & |    0 |    0.350 |   0.0064 |    0 |   0 |            5 |            5 |
| anton              | & |    1 |    0.558 |   0.0141 |    1 |   0 |            0 |            4 |
| bebas-neue         | A |    0 |    0.797 |   0.0175 |    2 |   0 |            0 |            2 |
| bebas-neue         | B |    0 |    0.536 |   0.0187 |    2 |   1 |            0 |            2 |
| bebas-neue         | B |    1 |    0.618 |   0.0243 |    3 |   2 |            0 |            1 |
| bebas-neue         | D |    0 |    1.177 |   0.0547 |    3 |   2 |            0 |            0 |
| bebas-neue         | O |    0 |    1.173 |   0.0566 |    3 |   3 |            0 |            0 |
| bebas-neue         | P |    0 |    0.596 |   0.0216 |    1 |   0 |            0 |            3 |
| bebas-neue         | Q |    0 |    1.173 |   0.0566 |    2 |   2 |            0 |            0 |
| bebas-neue         | R |    0 |    0.562 |   0.0198 |    2 |   1 |            0 |            3 |
| bebas-neue         | a |    0 |    0.797 |   0.0175 |    2 |   0 |            0 |            2 |
| bebas-neue         | b |    0 |    0.536 |   0.0187 |    2 |   1 |            0 |            2 |
| bebas-neue         | b |    1 |    0.618 |   0.0243 |    3 |   2 |            0 |            1 |
| bebas-neue         | d |    0 |    1.177 |   0.0547 |    3 |   2 |            0 |            0 |
| bebas-neue         | o |    0 |    1.173 |   0.0566 |    3 |   3 |            0 |            0 |
| bebas-neue         | p |    0 |    0.596 |   0.0216 |    1 |   0 |            0 |            3 |
| bebas-neue         | q |    0 |    1.173 |   0.0566 |    2 |   2 |            0 |            0 |
| bebas-neue         | 0 |    0 |    1.173 |   0.0566 |    3 |   3 |            0 |            0 |
| bebas-neue         | 4 |    0 |    0.672 |   0.0153 |    2 |   2 |            0 |            1 |
| bebas-neue         | 6 |    0 |    0.656 |   0.0271 |    2 |   2 |            0 |            0 |
| bebas-neue         | 8 |    0 |    0.526 |   0.0199 |    1 |   1 |            0 |            1 |
| bebas-neue         | 8 |    1 |    0.593 |   0.0246 |    2 |   2 |            0 |            1 |
| bebas-neue         | 9 |    0 |    0.656 |   0.0271 |    2 |   2 |            0 |            0 |
| bebas-neue         | @ |    0 |    0.545 |   0.0191 |    2 |   2 |            0 |            1 |
| bebas-neue         | & |    0 |    0.600 |   0.0232 |    2 |   1 |            0 |            2 |
| cinzel             | A |    0 |    0.925 |   0.0396 |    3 |   2 |            0 |            0 |
| cinzel             | B |    0 |    1.856 |   0.1255 |    3 |   2 |            0 |            0 |
| cinzel             | D |    0 |    1.996 |   0.2727 |    3 |   2 |            0 |            0 |
| cinzel             | O |    0 |    1.965 |   0.3039 |    3 |   3 |            0 |            0 |
| cinzel             | Q |    0 |    1.968 |   0.3050 |    2 |   2 |            0 |            0 |
| cinzel             | a |    0 |    0.812 |   0.0311 |    3 |   1 |            0 |            0 |
| cinzel             | b |    0 |    1.728 |   0.1105 |    2 |   2 |            0 |            0 |
| cinzel             | d |    0 |    1.769 |   0.2170 |    3 |   2 |            0 |            0 |
| cinzel             | o |    0 |    1.733 |   0.2385 |    3 |   3 |            0 |            0 |
| cinzel             | q |    0 |    1.712 |   0.2324 |    2 |   2 |            0 |            0 |
| cinzel             | 0 |    0 |    1.639 |   0.1795 |    3 |   3 |            0 |            0 |
| cinzel             | 4 |    0 |    0.895 |   0.0345 |    3 |   1 |            0 |            0 |
| cinzel             | @ |    0 |    0.571 |   0.0142 |    2 |   1 |            0 |            2 |
| cinzel             | & |    0 |    1.133 |   0.0748 |    3 |   2 |            0 |            1 |
| great-vibes        | A |    0 |    1.346 |   0.1057 |    3 |   2 |            0 |            1 |
| great-vibes        | B |    0 |    2.497 |   0.2128 |    3 |   2 |            0 |            0 |
| great-vibes        | B |    1 |    0.656 |   0.0263 |    1 |   1 |            0 |            0 |
| great-vibes        | D |    0 |    1.848 |   0.1990 |    3 |   2 |            0 |            0 |
| great-vibes        | D |    1 |    0.658 |   0.0268 |    1 |   1 |            0 |            2 |
| great-vibes        | O |    0 |    2.636 |   0.1918 |    6 |   3 |            0 |            0 |
| great-vibes        | O |    1 |    1.552 |   0.1332 |    2 |   1 |            0 |            0 |
| great-vibes        | P |    0 |    1.391 |   0.1080 |    3 |   2 |            0 |            0 |
| great-vibes        | R |    0 |    1.096 |   0.0709 |    3 |   2 |            0 |            0 |
| great-vibes        | d |    0 |    0.814 |   0.0310 |    3 |   2 |            0 |            1 |
| great-vibes        | e |    0 |    0.485 |   0.0111 |    1 |   0 |            0 |            5 |
| great-vibes        | g |    0 |    0.871 |   0.0371 |    1 |   1 |            0 |            1 |
| great-vibes        | o |    0 |    0.804 |   0.0318 |    2 |   1 |            0 |            0 |
| great-vibes        | p |    0 |    0.816 |   0.0310 |    2 |   2 |            0 |            0 |
| great-vibes        | 0 |    0 |    1.402 |   0.1077 |    3 |   3 |            0 |            0 |
| great-vibes        | 8 |    0 |    0.644 |   0.0268 |    2 |   0 |            0 |            1 |
| great-vibes        | 8 |    1 |    0.796 |   0.0424 |    3 |   2 |            0 |            1 |
| great-vibes        | & |    0 |    0.231 |   0.0024 |    0 |   0 |            5 |            5 |
| limelight          | A |    0 |    0.794 |   0.0300 |    2 |   0 |            0 |            2 |
| limelight          | B |    0 |    1.924 |   0.1429 |    3 |   2 |            0 |            0 |
| limelight          | D |    0 |    1.667 |   0.1760 |    3 |   2 |            0 |            0 |
| limelight          | O |    0 |    1.731 |   0.1912 |    3 |   3 |            0 |            0 |
| limelight          | Q |    0 |    2.011 |   0.1858 |    2 |   1 |            0 |            0 |
| limelight          | a |    0 |    0.841 |   0.0408 |    4 |   2 |            0 |            2 |
| limelight          | b |    0 |    1.200 |   0.0750 |    4 |   1 |            0 |            0 |
| limelight          | d |    0 |    1.197 |   0.0747 |    4 |   1 |            0 |            0 |
| limelight          | e |    0 |    0.682 |   0.0288 |    2 |   0 |            0 |            2 |
| limelight          | g |    0 |    0.883 |   0.0504 |    2 |   1 |            0 |            1 |
| limelight          | o |    0 |    1.241 |   0.0957 |    4 |   3 |            0 |            0 |
| limelight          | p |    0 |    1.200 |   0.0749 |    4 |   2 |            0 |            0 |
| limelight          | q |    0 |    1.199 |   0.0749 |    4 |   2 |            0 |            0 |
| limelight          | 0 |    0 |    1.566 |   0.1322 |    4 |   3 |            0 |            0 |
| limelight          | 4 |    0 |    1.066 |   0.0477 |    4 |   2 |            0 |            0 |
| limelight          | @ |    0 |    0.927 |   0.0399 |    4 |   2 |            0 |            1 |
| lobster            | A |    0 |    0.703 |   0.0212 |    3 |   2 |            0 |            3 |
| lobster            | Q |    0 |    0.205 |   0.0026 |    0 |   0 |            5 |            5 |
| lobster            | a |    0 |    0.859 |   0.0418 |    3 |   2 |            0 |            1 |
| lobster            | b |    0 |    0.837 |   0.0405 |    2 |   2 |            0 |            0 |
| lobster            | d |    0 |    0.858 |   0.0416 |    2 |   2 |            0 |            2 |
| lobster            | e |    0 |    0.544 |   0.0164 |    1 |   0 |            0 |            5 |
| lobster            | g |    0 |    0.859 |   0.0417 |    1 |   1 |            0 |            3 |
| lobster            | g |    1 |    0.331 |   0.0066 |    0 |   0 |            5 |            5 |
| lobster            | o |    0 |    0.890 |   0.0412 |    2 |   2 |            0 |            0 |
| lobster            | p |    0 |    0.861 |   0.0415 |    3 |   1 |            0 |            0 |
| lobster            | q |    0 |    0.858 |   0.0415 |    2 |   1 |            0 |            0 |
| lobster            | 0 |    0 |    1.443 |   0.1100 |    3 |   3 |            0 |            0 |
| lobster            | 6 |    0 |    0.819 |   0.0484 |    2 |   2 |            0 |            0 |
| lobster            | 8 |    0 |    0.597 |   0.0257 |    3 |   1 |            0 |            0 |
| lobster            | 8 |    1 |    0.784 |   0.0448 |    1 |   1 |            0 |            2 |
| lobster            | 9 |    0 |    0.819 |   0.0481 |    2 |   2 |            0 |            0 |
| lobster            | @ |    0 |    0.570 |   0.0174 |    2 |   2 |            0 |            0 |
| monoton            | D |    0 |    1.141 |   0.0910 |    3 |   1 |            0 |            0 |
| monoton            | D |    0 |    1.646 |   0.1894 |    3 |   2 |            0 |            0 |
| monoton            | D |    0 |    2.149 |   0.3234 |    3 |   1 |            0 |            1 |
| monoton            | D |    0 |    2.652 |   0.4929 |    5 |   3 |            0 |            0 |
| monoton            | O |    0 |    1.217 |   0.1178 |    1 |   1 |            0 |            1 |
| monoton            | O |    0 |    1.658 |   0.2187 |    1 |   1 |            0 |            0 |
| monoton            | O |    0 |    2.099 |   0.3507 |    1 |   1 |            0 |            0 |
| monoton            | O |    0 |    2.540 |   0.5135 |    1 |   1 |            0 |            0 |
| monoton            | Q |    0 |    1.217 |   0.1178 |    1 |   1 |            0 |            1 |
| monoton            | Q |    0 |    1.658 |   0.2187 |    1 |   1 |            0 |            0 |
| monoton            | Q |    0 |    2.099 |   0.3507 |    1 |   1 |            0 |            0 |
| monoton            | Q |    0 |    2.540 |   0.5135 |    1 |   1 |            0 |            0 |
| monoton            | d |    0 |    0.845 |   0.0496 |    2 |   1 |            0 |            0 |
| monoton            | d |    0 |    1.351 |   0.1273 |    3 |   2 |            0 |            0 |
| monoton            | d |    0 |    1.854 |   0.2406 |    3 |   2 |            0 |            0 |
| monoton            | d |    0 |    2.359 |   0.3896 |    5 |   3 |            0 |            0 |
| monoton            | o |    0 |    0.884 |   0.0622 |    1 |   1 |            0 |            1 |
| monoton            | o |    0 |    1.327 |   0.1401 |    1 |   1 |            0 |            0 |
| monoton            | o |    0 |    1.767 |   0.2484 |    1 |   1 |            0 |            0 |
| monoton            | o |    0 |    2.209 |   0.3882 |    1 |   1 |            0 |            0 |
| monoton            | 0 |    0 |    2.413 |   0.4604 |    1 |   1 |            0 |            1 |
| monoton            | 0 |    0 |    1.092 |   0.0918 |    1 |   1 |            0 |            0 |
| monoton            | 0 |    0 |    1.533 |   0.1839 |    1 |   1 |            0 |            0 |
| monoton            | 0 |    0 |    1.975 |   0.3072 |    1 |   1 |            0 |            0 |
| pirata-one         | A |    0 |    0.741 |   0.0255 |    3 |   2 |            0 |            0 |
| pirata-one         | B |    0 |    0.599 |   0.0203 |    1 |   1 |            0 |            1 |
| pirata-one         | B |    1 |    0.564 |   0.0179 |    1 |   1 |            0 |            2 |
| pirata-one         | D |    0 |    1.227 |   0.0486 |    2 |   1 |            0 |            0 |
| pirata-one         | O |    0 |    1.279 |   0.0509 |    2 |   2 |            0 |            0 |
| pirata-one         | P |    0 |    0.851 |   0.0312 |    2 |   2 |            0 |            0 |
| pirata-one         | Q |    0 |    1.279 |   0.0509 |    3 |   2 |            0 |            2 |
| pirata-one         | R |    0 |    0.791 |   0.0285 |    3 |   2 |            0 |            0 |
| pirata-one         | a |    0 |    0.578 |   0.0185 |    2 |   2 |            0 |            1 |
| pirata-one         | b |    0 |    0.880 |   0.0324 |    2 |   2 |            0 |            0 |
| pirata-one         | d |    0 |    0.926 |   0.0350 |    2 |   1 |            0 |            0 |
| pirata-one         | e |    0 |    0.587 |   0.0189 |    2 |   1 |            0 |            0 |
| pirata-one         | g |    0 |    0.834 |   0.0303 |    2 |   1 |            0 |            0 |
| pirata-one         | o |    0 |    0.879 |   0.0329 |    2 |   2 |            0 |            0 |
| pirata-one         | p |    0 |    0.938 |   0.0350 |    2 |   1 |            0 |            0 |
| pirata-one         | q |    0 |    0.834 |   0.0303 |    3 |   1 |            0 |            0 |
| pirata-one         | 0 |    0 |    1.279 |   0.0509 |    2 |   1 |            0 |            0 |
| pirata-one         | 4 |    0 |    0.693 |   0.0181 |    3 |   2 |            0 |            2 |
| pirata-one         | 6 |    0 |    0.797 |   0.0288 |    2 |   2 |            0 |            1 |
| pirata-one         | 8 |    0 |    0.649 |   0.0226 |    1 |   1 |            0 |            3 |
| pirata-one         | 8 |    1 |    0.579 |   0.0194 |    2 |   2 |            0 |            0 |
| pirata-one         | 9 |    0 |    0.737 |   0.0261 |    2 |   2 |            0 |            0 |
| pirata-one         | @ |    0 |    0.576 |   0.0143 |    2 |   2 |            0 |            0 |
| pirata-one         | & |    0 |    0.656 |   0.0223 |    2 |   1 |            0 |            1 |
| press-start-2p     | A |    0 |    1.488 |   0.1093 |    5 |   1 |            0 |            0 |
| press-start-2p     | B |    0 |    1.244 |   0.0937 |    5 |   2 |            0 |            1 |
| press-start-2p     | B |    1 |    1.244 |   0.0937 |    5 |   2 |            0 |            1 |
| press-start-2p     | D |    0 |    1.988 |   0.2031 |    7 |   2 |            0 |            0 |
| press-start-2p     | O |    0 |    1.994 |   0.2344 |    7 |   4 |            0 |            0 |
| press-start-2p     | P |    0 |    1.494 |   0.1406 |    5 |   3 |            0 |            0 |
| press-start-2p     | Q |    0 |    2.238 |   0.1875 |    9 |   3 |            0 |            0 |
| press-start-2p     | R |    0 |    1.488 |   0.1249 |    7 |   4 |            0 |            0 |
| press-start-2p     | a |    0 |    0.994 |   0.0469 |    5 |   2 |            0 |            0 |
| press-start-2p     | b |    0 |    1.494 |   0.1406 |    6 |   3 |            0 |            1 |
| press-start-2p     | d |    0 |    1.494 |   0.1406 |    5 |   3 |            0 |            0 |
| press-start-2p     | e |    0 |    0.994 |   0.0469 |    5 |   2 |            0 |            0 |
| press-start-2p     | g |    0 |    1.244 |   0.0937 |    4 |   2 |            0 |            0 |
| press-start-2p     | o |    0 |    1.494 |   0.1406 |    6 |   3 |            0 |            1 |
| press-start-2p     | p |    0 |    1.244 |   0.0937 |    4 |   2 |            0 |            0 |
| press-start-2p     | q |    0 |    1.244 |   0.0937 |    4 |   2 |            0 |            0 |
| press-start-2p     | 0 |    0 |    1.982 |   0.2031 |    6 |   3 |            0 |            0 |
| press-start-2p     | 4 |    0 |    0.988 |   0.0468 |    5 |   1 |            0 |            2 |
| press-start-2p     | 6 |    0 |    1.244 |   0.0937 |    4 |   3 |            0 |            1 |
| press-start-2p     | 8 |    0 |    1.238 |   0.0781 |    3 |   2 |            0 |            1 |
| press-start-2p     | 8 |    1 |    1.494 |   0.0938 |    6 |   2 |            0 |            0 |
| press-start-2p     | 9 |    0 |    1.244 |   0.0937 |    4 |   3 |            0 |            1 |
| press-start-2p     | @ |    0 |    0.494 |   0.0156 |    3 |   0 |            0 |            5 |
| press-start-2p     | & |    0 |    0.744 |   0.0312 |    3 |   2 |            0 |            1 |
| press-start-2p     | & |    1 |    0.994 |   0.0468 |    5 |   0 |            0 |            1 |
| rye                | A |    0 |    1.002 |   0.0423 |    2 |   1 |            0 |            1 |
| rye                | A |    1 |    1.051 |   0.0143 |    3 |   3 |            0 |            0 |
| rye                | A |    2 |    0.006 |   0.0000 |    0 |   0 |            5 |            5 |
| rye                | B |    0 |    0.793 |   0.0432 |    1 |   1 |            0 |            0 |
| rye                | B |    1 |    0.551 |   0.0072 |    2 |   1 |            0 |            1 |
| rye                | B |    2 |    1.000 |   0.0143 |    3 |   3 |            0 |            0 |
| rye                | B |    3 |    0.883 |   0.0530 |    3 |   1 |            0 |            0 |
| rye                | B |    4 |    0.577 |   0.0073 |    2 |   1 |            0 |            2 |
| rye                | D |    0 |    1.592 |   0.1231 |    1 |   1 |            0 |            0 |
| rye                | D |    1 |    1.036 |   0.0151 |    3 |   3 |            0 |            0 |
| rye                | D |    2 |    1.000 |   0.0143 |    3 |   2 |            0 |            0 |
| rye                | O |    0 |    1.628 |   0.1244 |    3 |   1 |            0 |            0 |
| rye                | O |    1 |    1.023 |   0.0144 |    3 |   3 |            0 |            0 |
| rye                | O |    2 |    1.021 |   0.0142 |    3 |   3 |            0 |            0 |
| rye                | P |    0 |    0.946 |   0.0572 |    1 |   1 |            0 |            1 |
| rye                | P |    1 |    0.694 |   0.0085 |    2 |   1 |            0 |            0 |
| rye                | P |    2 |    1.000 |   0.0143 |    3 |   3 |            0 |            0 |
| rye                | Q |    0 |    1.628 |   0.1244 |    3 |   2 |            0 |            0 |
| rye                | Q |    1 |    1.023 |   0.0144 |    3 |   3 |            0 |            0 |
| rye                | Q |    2 |    1.021 |   0.0142 |    3 |   2 |            0 |            0 |
| rye                | R |    0 |    0.868 |   0.0514 |    1 |   1 |            0 |            0 |
| rye                | R |    1 |    0.581 |   0.0071 |    2 |   1 |            0 |            1 |
| rye                | R |    2 |    1.000 |   0.0143 |    3 |   2 |            0 |            0 |
| rye                | R |    3 |    0.470 |   0.0059 |    2 |   2 |            0 |            0 |
| rye                | a |    0 |    0.664 |   0.0083 |    2 |   2 |            0 |            0 |
| rye                | a |    1 |    0.622 |   0.0256 |    1 |   1 |            0 |            0 |
| rye                | a |    2 |    0.516 |   0.0061 |    1 |   1 |            0 |            0 |
| rye                | b |    0 |    0.980 |   0.0128 |    2 |   2 |            0 |            2 |
| rye                | b |    1 |    1.074 |   0.0673 |    1 |   1 |            0 |            1 |
| rye                | b |    2 |    0.664 |   0.0083 |    0 |   0 |            1 |            1 |
| rye                | d |    0 |    0.980 |   0.0126 |    2 |   2 |            0 |            3 |
| rye                | d |    1 |    1.076 |   0.0675 |    1 |   1 |            0 |            2 |
| rye                | d |    2 |    0.698 |   0.0090 |    2 |   1 |            0 |            0 |
| rye                | e |    0 |    0.662 |   0.0288 |    2 |   1 |            0 |            1 |
| rye                | e |    1 |    0.316 |   0.0036 |    0 |   0 |            5 |            5 |
| rye                | e |    2 |    0.699 |   0.0090 |    2 |   1 |            0 |            1 |
| rye                | g |    0 |    0.746 |   0.0323 |    3 |   2 |            0 |            2 |
| rye                | g |    1 |    0.542 |   0.0066 |    2 |   2 |            0 |            0 |
| rye                | g |    2 |    0.572 |   0.0069 |    1 |   1 |            0 |            0 |
| rye                | g |    3 |    0.915 |   0.0103 |    2 |   1 |            0 |            0 |
| rye                | g |    4 |    0.855 |   0.0329 |    2 |   2 |            0 |            0 |
| rye                | o |    0 |    1.094 |   0.0689 |    1 |   0 |            0 |            1 |
| rye                | o |    1 |    0.664 |   0.0083 |    2 |   2 |            0 |            0 |
| rye                | o |    2 |    0.699 |   0.0090 |    2 |   1 |            0 |            1 |
| rye                | p |    0 |    1.070 |   0.0669 |    1 |   1 |            0 |            0 |
| rye                | p |    1 |    0.664 |   0.0083 |    2 |   2 |            0 |            0 |
| rye                | p |    2 |    0.973 |   0.0129 |    2 |   2 |            0 |            0 |
| rye                | q |    0 |    1.076 |   0.0675 |    1 |   1 |            0 |            1 |
| rye                | q |    1 |    0.980 |   0.0127 |    2 |   2 |            0 |            0 |
| rye                | q |    2 |    0.699 |   0.0090 |    2 |   1 |            0 |            1 |
| rye                | 0 |    0 |    1.456 |   0.0984 |    1 |   0 |            0 |            1 |
| rye                | 0 |    1 |    1.002 |   0.0145 |    3 |   3 |            0 |            0 |
| rye                | 0 |    2 |    1.021 |   0.0142 |    3 |   3 |            0 |            0 |
| rye                | 4 |    0 |    0.983 |   0.0393 |    3 |   1 |            0 |            1 |
| rye                | 4 |    1 |    1.014 |   0.0135 |    2 |   2 |            0 |            0 |
| rye                | 6 |    0 |    1.013 |   0.0147 |    3 |   3 |            0 |            0 |
| rye                | 6 |    1 |    0.956 |   0.0600 |    1 |   1 |            0 |            0 |
| rye                | 6 |    2 |    0.695 |   0.0091 |    2 |   1 |            0 |            1 |
| rye                | 8 |    0 |    0.720 |   0.0368 |    1 |   1 |            0 |            0 |
| rye                | 8 |    1 |    0.552 |   0.0070 |    2 |   1 |            0 |            1 |
| rye                | 8 |    2 |    0.498 |   0.0061 |    1 |   1 |            0 |            2 |
| rye                | 8 |    3 |    0.822 |   0.0490 |    1 |   1 |            0 |            0 |
| rye                | 8 |    4 |    0.547 |   0.0072 |    2 |   1 |            0 |            0 |
| rye                | 8 |    5 |    0.570 |   0.0070 |    2 |   1 |            0 |            0 |
| rye                | 9 |    0 |    0.959 |   0.0606 |    1 |   1 |            0 |            1 |
| rye                | 9 |    1 |    0.693 |   0.0092 |    2 |   1 |            0 |            1 |
| rye                | 9 |    2 |    1.002 |   0.0145 |    3 |   3 |            0 |            0 |
| rye                | @ |    0 |    0.754 |   0.0081 |    2 |   2 |            0 |            3 |
| rye                | @ |    1 |    1.346 |   0.0178 |    3 |   2 |            0 |            1 |
| rye                | @ |    2 |    1.059 |   0.0484 |    3 |   1 |            0 |            0 |
| rye                | @ |    3 |    0.767 |   0.0083 |    1 |   0 |            0 |            5 |
| rye                | @ |    4 |    0.684 |   0.0086 |    2 |   2 |            0 |            0 |
| rye                | & |    0 |    0.460 |   0.0057 |    1 |   0 |            3 |            4 |
| rye                | & |    1 |    0.555 |   0.0049 |    2 |   2 |            0 |            0 |
| rye                | & |    2 |    0.652 |   0.0087 |    2 |   1 |            0 |            1 |
| satisfy            | A |    0 |    1.211 |   0.0696 |    3 |   2 |            0 |            0 |
| satisfy            | B |    0 |    1.095 |   0.0698 |    2 |   0 |            0 |            1 |
| satisfy            | B |    1 |    1.224 |   0.0890 |    2 |   1 |            0 |            0 |
| satisfy            | O |    0 |    1.917 |   0.1858 |    3 |   3 |            0 |            0 |
| satisfy            | P |    0 |    1.280 |   0.0940 |    2 |   2 |            0 |            0 |
| satisfy            | Q |    0 |    0.328 |   0.0066 |    0 |   0 |            5 |            5 |
| satisfy            | R |    0 |    0.128 |   0.0009 |    0 |   0 |            5 |            5 |
| satisfy            | R |    1 |    1.191 |   0.0891 |    3 |   2 |            0 |            0 |
| satisfy            | a |    0 |    0.752 |   0.0305 |    3 |   2 |            0 |            2 |
| satisfy            | d |    0 |    0.802 |   0.0408 |    3 |   1 |            0 |            1 |
| satisfy            | e |    0 |    0.451 |   0.0097 |    2 |   2 |            0 |            2 |
| satisfy            | g |    0 |    0.772 |   0.0407 |    2 |   1 |            0 |            1 |
| satisfy            | g |    1 |    0.725 |   0.0215 |    2 |   2 |            0 |            2 |
| satisfy            | o |    0 |    0.436 |   0.0140 |    1 |   0 |            0 |            3 |
| satisfy            | o |    1 |    0.502 |   0.0132 |    2 |   1 |            0 |            1 |
| satisfy            | p |    0 |    0.686 |   0.0282 |    3 |   2 |            0 |            1 |
| satisfy            | q |    0 |    0.818 |   0.0426 |    2 |   1 |            0 |            1 |
| satisfy            | 0 |    0 |    1.448 |   0.1097 |    3 |   3 |            0 |            0 |
| satisfy            | 4 |    0 |    0.883 |   0.0269 |    2 |   1 |            0 |            2 |
| satisfy            | 6 |    0 |    1.025 |   0.0546 |    4 |   2 |            0 |            0 |
| satisfy            | 8 |    0 |    0.662 |   0.0295 |    3 |   1 |            0 |            0 |
| satisfy            | 8 |    1 |    0.800 |   0.0434 |    1 |   1 |            0 |            2 |
| satisfy            | 9 |    0 |    1.015 |   0.0611 |    2 |   2 |            0 |            0 |
| satisfy            | @ |    0 |    0.872 |   0.0377 |    1 |   1 |            0 |            2 |
| satisfy            | & |    0 |    0.753 |   0.0304 |    2 |   1 |            0 |            0 |
| satisfy            | & |    1 |    0.471 |   0.0114 |    2 |   2 |            0 |            2 |
| shadows-into-light | A |    0 |    0.845 |   0.0316 |    2 |   2 |            0 |            0 |
| shadows-into-light | B |    0 |    0.804 |   0.0359 |    2 |   1 |            0 |            1 |
| shadows-into-light | O |    0 |    1.295 |   0.1006 |    3 |   3 |            0 |            0 |
| shadows-into-light | P |    0 |    1.012 |   0.0677 |    3 |   2 |            0 |            0 |
| shadows-into-light | Q |    0 |    2.001 |   0.1698 |    3 |   1 |            0 |            0 |
| shadows-into-light | R |    0 |    0.944 |   0.0498 |    2 |   1 |            0 |            2 |
| shadows-into-light | a |    0 |    0.894 |   0.0297 |    3 |   3 |            0 |            0 |
| shadows-into-light | b |    0 |    1.029 |   0.0647 |    3 |   2 |            0 |            0 |
| shadows-into-light | d |    0 |    0.941 |   0.0487 |    3 |   2 |            0 |            2 |
| shadows-into-light | e |    0 |    0.465 |   0.0125 |    1 |   0 |            0 |            4 |
| shadows-into-light | g |    0 |    0.905 |   0.0352 |    2 |   2 |            0 |            0 |
| shadows-into-light | o |    0 |    0.941 |   0.0431 |    3 |   3 |            0 |            0 |
| shadows-into-light | p |    0 |    1.013 |   0.0582 |    3 |   2 |            0 |            0 |
| shadows-into-light | q |    0 |    0.871 |   0.0431 |    2 |   1 |            0 |            0 |
| shadows-into-light | 0 |    0 |    1.031 |   0.0592 |    3 |   3 |            0 |            0 |
| shadows-into-light | 4 |    0 |    0.792 |   0.0257 |    3 |   2 |            0 |            1 |
| shadows-into-light | 6 |    0 |    0.714 |   0.0258 |    2 |   2 |            0 |            0 |
| shadows-into-light | 8 |    0 |    0.893 |   0.0379 |    3 |   1 |            0 |            0 |
| shadows-into-light | 8 |    1 |    0.519 |   0.0192 |    2 |   1 |            0 |            2 |
| shadows-into-light | 9 |    0 |    0.820 |   0.0305 |    3 |   2 |            0 |            0 |
| shadows-into-light | @ |    0 |    0.884 |   0.0275 |    3 |   2 |            0 |            0 |
| shadows-into-light | & |    0 |    0.374 |   0.0095 |    0 |   0 |            4 |            4 |
| vegapunk           | A |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | B |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | B |    1 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | D |    0 |    0.749 |   0.0214 |    2 |   1 |            0 |            0 |
| vegapunk           | O |    0 |    0.749 |   0.0214 |    2 |   2 |            0 |            0 |
| vegapunk           | P |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | Q |    0 |    0.749 |   0.0214 |    2 |   1 |            0 |            0 |
| vegapunk           | R |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | b |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | 0 |    0 |    0.189 |   0.0015 |    0 |   0 |            5 |            5 |
| vegapunk           | 0 |    1 |    0.193 |   0.0015 |    0 |   0 |            5 |            5 |
| vegapunk           | 6 |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | 8 |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | 8 |    1 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
| vegapunk           | 9 |    0 |    0.266 |   0.0051 |    0 |   0 |            5 |            5 |
