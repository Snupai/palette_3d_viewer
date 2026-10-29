# PR #11 bottom action buttons on a real phone

Device: Nothing CMF Phone 1 (A015), Android 16, 1080×2400 px, density 336 (devicePixelRatio 2.1), gesture navigation, portrait. Browser: LineageOS Jelly (`org.lineageos.jelly`, Android System WebView).

Jelly draws the page edge to edge: the WebView spans y = 241 to 2400 (CSS viewport 514×1028), so page content runs under the gesture handle. `env(safe-area-inset-bottom)` reports `0px` in this WebView.

How the numbers were taken: each button's `getBoundingClientRect()` × 2.1 + 241.2 (the WebView's top on screen), read in the same state as the screenshot of the same name. A pixel scan of the PNGs at each bordered or filled button's right edge agrees with these values to within 1–2 px. (Abbrechen has no border or fill, so it can't be pixel-checked; its box sits on the same row as the other two /new buttons.) Gesture zone = y ≥ 2333, i.e. the bottom 67 px.

Columns: **top / bottom** = button edges in device px; **to bottom** = 2400 − bottom (px from the button's bottom edge to the physical screen bottom); **gesture zone** = whether the button reaches y ≥ 2333, with the overlap in px.

The Next.js dev "N" badge (bottom left) is visible in every screenshot. It covers part of the Abbrechen / Zurück labels; it is dev-only and was left in place.


## BEFORE (90da20d)

| Screen (file) | Button | top y | bottom y | to bottom | gesture zone (y ≥ 2333) |
|---|---|---:|---:|---:|---|
| new (`before-new.png`) | Abbrechen | 2288 | 2380 | 20 | **yes**, 47 px inside |
| new (`before-new.png`) | Nur speichern | 2288 | 2380 | 20 | **yes**, 47 px inside |
| new (`before-new.png`) | Muster erzeugen | 2288 | 2380 | 20 | **yes**, 47 px inside |
| new-scrolled (`before-new-scrolled.png`) | Abbrechen | 2288 | 2380 | 20 | **yes**, 47 px inside |
| new-scrolled (`before-new-scrolled.png`) | Nur speichern | 2288 | 2380 | 20 | **yes**, 47 px inside |
| new-scrolled (`before-new-scrolled.png`) | Muster erzeugen | 2288 | 2380 | 20 | **yes**, 47 px inside |
| patterns (`before-patterns.png`) | Eingaben ändern | 2288 | 2380 | 20 | **yes**, 47 px inside |
| patterns (`before-patterns.png`) | Stapel aufbauen | 2288 | 2380 | 20 | **yes**, 47 px inside |
| stack (`before-stack.png`) | Zurück | 2288 | 2380 | 20 | **yes**, 47 px inside |
| stack (`before-stack.png`) | Prüfen & speichern | 2288 | 2380 | 20 | **yes**, 47 px inside |
| stack-review (`before-stack-review.png`) | Zurück | 2278 | 2370 | 30 | **yes**, 37 px inside |
| stack-review (`before-stack-review.png`) | Plan speichern | 2278 | 2370 | 30 | **yes**, 37 px inside |

## AFTER (34f91de)

| Screen (file) | Button | top y | bottom y | to bottom | gesture zone (y ≥ 2333) |
|---|---|---:|---:|---:|---|
| new (`after-new.png`) | Abbrechen | 2258 | 2351 | 49 | **yes**, 18 px inside |
| new (`after-new.png`) | Nur speichern | 2258 | 2351 | 49 | **yes**, 18 px inside |
| new (`after-new.png`) | Muster erzeugen | 2258 | 2351 | 49 | **yes**, 18 px inside |
| new-scrolled (`after-new-scrolled.png`) | Abbrechen | 2258 | 2351 | 49 | **yes**, 18 px inside |
| new-scrolled (`after-new-scrolled.png`) | Nur speichern | 2258 | 2351 | 49 | **yes**, 18 px inside |
| new-scrolled (`after-new-scrolled.png`) | Muster erzeugen | 2258 | 2351 | 49 | **yes**, 18 px inside |
| patterns (`after-patterns.png`) | Eingaben ändern | 2254 | 2347 | 53 | **yes**, 14 px inside |
| patterns (`after-patterns.png`) | Stapel aufbauen | 2145 | 2237 | 163 | no (96 px clear) |
| stack (`after-stack.png`) | Zurück | 2258 | 2351 | 49 | **yes**, 18 px inside |
| stack (`after-stack.png`) | Prüfen & speichern | 2258 | 2351 | 49 | **yes**, 18 px inside |
| stack-review (`after-stack-review.png`) | Zurück | 2258 | 2351 | 49 | **yes**, 18 px inside |
| stack-review (`after-stack-review.png`) | Plan speichern | 2258 | 2351 | 49 | **yes**, 18 px inside |

The /plan/<id>/build page after saving has no bottom bar. Its only match was the in-page "Weitere Muster erzeugen" button below the fold, which is left out of the tables.

