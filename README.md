# F1 Live

A free Formula 1 companion in the browser: live timing, the track on a real 3D map, race control, weather, the season calendar in your own time zone, standings, full replays with car telemetry, and lap battles. No account, no ads, no tracking.

- **Website:** https://isaraapae.github.io/f1-live/

## What's in it

| Page | What it shows |
|---|---|
| **Home** | The next session with a countdown and the forecast at the circuit, a "live now" card during a session, the weekend's sessions, your driver and team (picked in Settings), the last race's podium, the championship's top five and the latest headlines. |
| **Live** | Formula 1's live timing straight from its feed: timing tower (gaps, intervals, sectors, mini sectors, tyres, pit stops), the track map, track status, weather and the chance of rain, race control with pop-up alerts, penalties, team radio, tyre strategy, race positions, pit stops and the live championship. On a phone the panels sit under sub-tabs (Timing, Track, Race control, Radio, More). |
| **Track map** | The circuit on a real map of its surroundings (streets, water, 3D buildings), tilted in 3D or seen from the top, with every car on it; or the classic flat outline. Three camera views ride with the car you follow (else the leader): **Heli** from above and behind, **Road** just behind the car as on TV, and **Driver** from the cockpit. Up close the track is drawn at its real width with white edge lines and red and white kerbs in the corners, on satellite photos (when the site has an Esri key, below) or grass, under a sky; the cars are 3D F1 cars built in code with [three.js](https://threejs.org) (smooth bodywork, wing profiles, halo, glossy paint in team colours, the race number, and a ring in the colour of the tyres each car is on), and the Driver view looks out through the halo. |
| **Calendar** | Every weekend of the season with session times in your time zone, countdowns, forecasts and winners (with their photos, every season since 2023). Each weekend has its own page with every session's results, driver photos and replays. |
| **Standings** | Drivers' and teams' championships since 2023, with that year's driver photos, team logos and cars. The season picked here and on the Calendar is the same, with a page for each driver (stats, points chart, race-by-race results, teammate head-to-head) and each team (its drivers, car, teammate head-to-head and every race). |
| **Replays** | Any session since 2023, rebuilt lap by lap, on the same timing screen, opened from a weekend's page, Home or Live. Plus analysis: fastest laps, overtakes, track dominance between drivers, and car telemetry (speed, gear, throttle, brake, RPM, DRS) for the driver you follow. |
| **Lap battle** | Two drivers' laps raced against each other round the circuit at 60 fps, with speed, throttle, brake and the time gap, in the site's dark or light look. Save it as a video to share. |
| **News** | Headlines from F1 publishers, linking to their articles. |
| **Settings** | Dark, light or device appearance, 12- or 24-hour clock, your driver and team, alerts. |

## Where the data comes from

| Source | Used for |
|---|---|
| Formula 1's live timing (`livetiming.formula1.com`) | Live timing; the browser connects to it directly |
| [OpenF1](https://openf1.org) | Replays, session times, telemetry, overtakes, pit stops, flags |
| [Jolpica](https://github.com/jolpica/jolpica-f1) | Calendar, standings and results |
| [MultiViewer](https://api.multiviewer.app) | Circuit outlines and corner numbers |
| [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data) with [MapLibre](https://maplibre.org) | The real map under the track |
| [Esri World Imagery](https://www.esri.com/en-us/arcgis/products/arcgis-location-platform/services/basemaps) (optional, free tier) | Satellite photos in the Heli, Road and Driver views. The publish adds the key from the repository secret `ESRI_KEY` (an ArcGIS Location Platform API key with only the Basemaps privilege, limited to this site's address); without it those views use the ordinary map |
| [three.js](https://threejs.org) | The 3D cars in those views |
| [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) | Circuit shapes, to place F1's track coordinates on the map |
| [Open-Meteo](https://open-meteo.com) | Forecasts at the circuit |
| Publishers' RSS feeds | Headlines (collected by `scripts/news.mjs` when the site is published) |
| `pitlanes.json` (built from OpenF1 by `scripts/pitlanes.mjs`) | Every circuit's pit lane for the Live tab: one ordinary stop's path from the circuit's latest race. OpenF1 only answers free requests between sessions, so the Live tab doesn't ask it during one |

OpenF1 allows 30 requests a minute; `js/api.js` queues requests and waits when it's busy. During a live session OpenF1 refuses free requests; the site then stops asking it for a few minutes, without the "busy" banner (the live timing comes from Formula 1's feed).

Live car positions on the map are worked out from Formula 1's mini-sector marks (exact positions are only on F1 TV): `js/livepos.js` runs each car through every mini-sector at its own pace from its last lap, and the drawn car speeds up or slows down a little to stay with the marks, so it never jumps or goes backwards (checked by `tools/check.mjs`).

## Run it on your computer

```bash
python -m http.server 8000
```

Then open http://localhost:8000. There's no build step and nothing to install. To see headlines locally, run `node scripts/news.mjs` once first (it writes `news.json`).

`index.html?feed=ws://localhost:PORT` points the Live tab at a local test feed instead of Formula 1's (only `localhost` and `127.0.0.1` are accepted).

## How the code is laid out

- `index.html`: the frame (top bar, side menu, bottom tabs).
- `js/main.js`: moves between pages using the address's `#/…`.
- `js/views/`: one file per page.
- `js/timing.js`: the timing screen for both live and replays. `js/analysis.js` has the replay analysis panels; `js/geomap.js` the real map.
- `js/api.js`, `js/season.js`, `js/util.js`: data sources, the season calendar, shared helpers.
- `css/`: `app.css` for the frame and shared pieces, then one file per area.
- `sw.js` and `manifest.webmanifest`: installing as an app.

## Publishing

`.github/workflows/pages.yml` checks the code (`node tools/check.mjs`), collects the headlines and publishes to GitHub Pages on every push to `main` and every 30 minutes. In the repository's **Settings → Pages**, the source must be **GitHub Actions**.
