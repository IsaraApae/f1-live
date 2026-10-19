# Contributing

Thanks for helping! The whole site is [index.html](index.html): the HTML, CSS (in `<style>`) and JavaScript (in `<script>`) all live in that one file. There's no build step and nothing to install.

## Getting started

1. Ask to be added as a collaborator, or fork the repo.
2. Clone it and start a local server:
   ```bash
   git clone https://github.com/IsaraApae/f1-live
   cd f1-live
   python -m http.server 8000
   ```
3. Open http://localhost:8000 and reload after each change.

## Making a change

1. Make a branch: `git checkout -b my-change`.
2. Edit `index.html`.
3. Check it in the browser:
   - a **replay** (pick a recent race in the Replay panel, it works any day of the week);
   - **Dark** and **Light** in Settings;
   - a **phone-sized** window (your browser's device toolbar).
4. Run `node tools/check.mjs` (needs [Node.js](https://nodejs.org)) to make sure the JavaScript still parses.
5. Commit, push, and open a pull request saying what you changed and how you tested it. A screenshot helps.

## Finding your way around index.html

Search the file for these to jump to the right place:

| Search for | What's there |
|---|---|
| `:root, [data-mode="dark"]` | Colours for dark and light mode |
| `const FEED` | The live timing connection |
| `OPENF1` | Replay data from OpenF1 |
| `api.multiviewer.app` | Circuit outlines for the track map |
| `localStorage` / `store.` | Settings saved in the browser |

## Good to know

- **OpenF1 allows 30 requests a minute.** The page already waits and retries; avoid adding calls in loops.
- **Live timing only runs during a session.** To work on live features between race weekends, use a replay or a local test feed (`?feed=ws://localhost:PORT`, see the README).
- **Keep it one file** unless there's a good reason. It's what makes the site easy to host and copy.
- Settings are saved in `localStorage` under keys starting with `f1.`; keep new ones in that style so old settings keep working.
