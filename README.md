# F1 Live

Free Formula 1 live timing and replays in any browser, in a dark navy (or light) style like the broadcast timing screens. Your browser connects straight to Formula 1's live timing feed, so there's no server: the whole site is one file, [index.html](index.html).

- **Website:** https://isaraapae.github.io/f1-live/

This page started as the F1 Live page of [alert-watch](https://github.com/IsaraApae/alert-watch) and was split out (with its history) so friends can work on it. The LINE alerts stay in alert-watch.

## Run it on your computer

```bash
python -m http.server 8000
```

Then open http://localhost:8000. Any static file server works (`npx serve` too). Opening the file straight from disk mostly works, but a local server is closer to the real site.

## What's on the page

- **Header:** the country flag, session, track status (clear, yellow, safety car, VSC, red flag), lap, time left, air and track temperature, wind. In qualifying, a countdown: "Q1 ends in 12:34" (red in the last 2 minutes), then "Q2 starts in 6:52" during the 7-minute break (timed from race control's chequered flag), and so on to "Finished". During a red flag: "Q1 stopped" (live, F1's clock stops) or "Q1 restarts in" (replays). Replays use the real start and flag times and, like F1's clock, leave stoppages out; when OpenF1 leaves Q1 unlabelled (Australia, Miami, Canada in 2026), it's taken as Q1.
- **Timing tower:** the position, then each driver's car number and name as a team-colour tag (with **+5s**, **DT** or **SG** while a penalty is still to be served), interval (a green outline when catching), gap, last and best lap (purple for the fastest), sectors with mini sectors, speed trap, tyre stints, pit stops and places gained. **Settings** has a switch for each column (with Show all and Hide extras).
- **Track map:** the circuit with numbered corners, the start line and the **pit lane**, the track drawn in three colours, one per sector (S1 red, S2 blue, S3 yellow), and every car as a dot in its team colour with a label above it. Cars move at 60 frames a second: in replays exactly where their lap timing puts them. Pitting cars are drawn smaller and drive through the pit lane, and under a red flag every car parks in the pit lane in running order. When MultiViewer has no outline for a circuit (in 2026: Madrid and Kuala Lumpur), the track is drawn from one ordinary lap's car positions instead. Live positions are an estimate from the timing loops (exact positions are only on F1 TV). Sectors under a yellow flag flash yellow; under a safety car or red flag the whole track is outlined.
- **Next session:** between sessions, a banner with the next session, its start time and a countdown, plus a button to replay the last session.
- **Qualifying:** the part (Q1, Q2, Q3), a red line under the last safe place (Q1: 16th of 22, Q2: 10th), and knocked-out drivers greyed at the bottom.
- **Follow a driver:** tap a driver in the timing table, on the map or in the race positions chart. Their row is highlighted, their dot grows while the others fade, and a **Following** card shows their photo, team, position, gaps, places gained, laps, tyre, pit stops, sectors and top speed. Remembered in the browser.
- **Battles within 1 second** (races): amber bars, amber intervals, and amber rings and links on the map.
- **Fastest sectors.**
- **Race positions** (races and sprints): a lap-by-lap chart from the grid, a line per driver in team colours.
- **Tyre strategy:** a bar per driver, one block per set of tyres in its compound's colour (used sets striped).
- **Pit stops** (races): each stop's lap, driver, tyres before and after, and the time the car stood still (an estimate, shown with ≈, from the pit lane time), with the pit lane time underneath.
- **Penalties:** time penalties, drive-throughs, stop-and-gos, investigations, black-and-white flags and deleted lap times, read from race control's messages.
- **Race control:** every message with an icon, its kind, lap and time, driver tags, and filter chips.
- **Layout:** two columns on a computer, one on a phone. **Settings → Panels** moves, hides or resets panels. Saved in the browser.
- **Live championship:** drivers and teams, worked out live during sprints and races.
- **Team radio:** every message F1 publishes, as a race timeline grouped by lap, with per-driver filters, **Auto-play** and **Play next**. F1 publishes no transcripts.
- **Gaps in replays:** a car is "+1 Lap" only when the leader finished an extra lap before that car crossed the line; once the winner takes the flag, positions and gaps come from the official result.
- **Pop-up alerts:** new race control messages pop up for 8 seconds (at most 3 at a time). Settings → Pop-up alerts turns them off.
- **Replay:** any finished session since 2023, from [OpenF1](https://openf1.org), picked by season and weekend. Play, pause, skip 30 s, change speed (1×–32×), or drag the timeline, which marks safety cars, VSCs, red flags, laps and session events. If OpenF1 is busy (it allows 30 requests a minute), the page waits and tries again.
- **Track status:** live, straight from F1's feed; in replays, worked out from race control's messages.
- **Appearance:** Dark (default, navy), Light or Device, in Settings.

## Where the data comes from

| Source | Used for |
|---|---|
| `wss://livetiming.formula1.com` | Live timing (the browser connects directly) |
| [OpenF1](https://openf1.org) (`api.openf1.org`) | Replays, schedules, flags, pit lane shape |
| [MultiViewer](https://api.multiviewer.app) | Circuit outlines and corner numbers |
| [Jolpica](https://api.jolpi.ca) | Championship standings before the race |
| `media.formula1.com` | Driver photos and team logos |

## Testing live timing without a race

`index.html?feed=ws://localhost:PORT` points the page at a local test feed instead of F1's (only `localhost` and `127.0.0.1` are accepted). That's how the live code was tested, by playing F1's own recording of the 2026 Singapore race and qualifying through a local copy of the live connection.

## Publishing

The site is GitHub Pages from the `main` branch: **Settings → Pages → Deploy from a branch → `main` / `(root)`**. Every merge to `main` goes live within a minute or two.

## Checks

`node tools/check.mjs` makes sure the page's JavaScript still parses. GitHub runs it on every pull request.
