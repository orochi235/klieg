---
title: klieg
tagline: Shiny extruded 3D type, overlaid on your app
tags: [webgl, graphics, typescript]
featured: true
order: 10
demo: https://orochi235.github.io/klieg/show/
media: { kind: embed, src: https://orochi235.github.io/klieg/show/#JTdCJTIydGV4dCUyMiUzQSUyMmtsaWVnJTIyJTJDJTIybG9va3MlMjIlM0ElNUIlMjJ0dWJpbmclMjIlMkMlMjJnb2xkJTIyJTJDJTIyY2hyb21lJTIyJTJDJTIyZ2VtJTIyJTVEJTJDJTIyY3ljbGVNcyUyMiUzQTIwMDAwJTdE, span: 2, aspect: "32/9" }
---

A transparent WebGL overlay that renders shiny extruded type over an existing web app, for
game-show celebration moments. Framework-agnostic three.js — React appears only in the dev labs.

Motion is three independent slots — `enter`, `active`, `exit` — composing additively over a rest
pose. Fonts parse at runtime through opentype.js so kerning survives, and the environment map is
generated rather than shipped as an HDRI: the movable light bars *are* the sweep effect.

Bloom is opt-in rather than the default. The direct render path antialiases natively, and a stock
bloom pass destroys canvas transparency — which an overlay cannot afford.
