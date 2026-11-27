import { esc, lapText } from "./util.js";

export const lapComparisonMarkup = replay => `
  <div class="lap-controls">
    <div class="lap-pick"><label for="lap-driver">Driver</label><select id="lap-driver" class="pick" data-pick="driver"></select></div>
    <div class="lap-pick"><label for="lap-opponent">Compare with</label><select id="lap-opponent" class="pick" data-pick="opponent"></select></div>
    <div class="lap-pick"><label for="lap-number">Driver lap</label><select id="lap-number" class="pick" data-pick="lap"></select></div>
    <div class="lap-pick" data-comparison><label for="lap-other">Comparison lap</label><select id="lap-other" class="pick" data-pick="otherLap"></select></div>
    ${replay ? `<label class="switch lap-all"><input type="checkbox" data-pick="all"> Show all replay laps</label>` : ""}
  </div>
  <div class="lap-difference" data-results hidden></div>
  <div class="lap-history scroll" data-history></div>
  <p class="lap-note">${replay ? "By default, times appear as the replay reaches each lap." : "Live history records laps while the Live tab is open. Earlier laps are available in the replay."}</p>`;

const metrics = ["Lap time", "S1", "S2", "S3"];
const values = lap => [lap?.time, ...(lap?.sectors || [null, null, null])];
const format = value => Number.isFinite(value) && value > 0 ? lapText(value) : "–";
const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
const lapOptions = laps => laps.map(row => option(row.number, `Lap ${row.number}`)).join("");

export function mountLapComparison(panel) {
  const get = key => panel.querySelector(`[data-pick="${key}"]`);
  const first = get("driver"), second = get("opponent"), firstLap = get("lap"), secondLap = get("otherLap"), all = get("all");
  const comparison = panel.querySelector("[data-comparison]"), results = panel.querySelector("[data-results]");
  const history = panel.querySelector("[data-history]");
  let inputs, driver = "", opponent = null, lap = "", otherLap = "";
  let driverPicked = false, opponentPicked = false;

  function html(el, markup) {
    if (el._html === markup) return;
    el.innerHTML = markup;
    el._html = markup;
  }

  function render(next) {
    inputs = next;
    const { drivers, preferred, getLaps } = next;
    if (!drivers.has(driver) || (!driverPicked && drivers.has(preferred) && preferred !== driver)) {
      driver = drivers.has(preferred) ? preferred : drivers.keys().next().value || "";
      lap = "";
    }
    if (!opponentPicked && drivers.size && (!drivers.has(opponent) || opponent === driver)) {
      opponent = [...drivers.keys()].find(n => n !== driver) || "";
      otherLap = "";
    }
    if (opponent && !drivers.has(opponent)) opponent = "";

    const choices = [...drivers].map(([n, info]) => option(n, info.name)).join("");
    html(first, choices || option("", "Waiting for drivers"));
    html(second, option("", "No comparison") + choices);
    first.value = driver; second.value = opponent || "";
    first.disabled = second.disabled = !drivers.size;

    const lapsFor = n => n ? getLaps(n, !!all?.checked).slice().sort((a, b) => b.number - a.number) : [];
    const laps = lapsFor(driver), others = lapsFor(opponent);
    if (lap && !laps.some(x => String(x.number) === lap)) lap = "";
    if (otherLap && !others.some(x => String(x.number) === otherLap)) otherLap = "";
    const left = lap ? laps.find(x => String(x.number) === lap) : laps[0];
    const right = others.find(x => x.number === (otherLap ? +otherLap : left?.number));
    html(firstLap, option("", "Latest lap") + lapOptions(laps));
    html(secondLap, option("", left ? `Same lap (${left.number})` : "Same lap") + lapOptions(others));
    firstLap.value = lap; secondLap.value = otherLap;
    firstLap.disabled = !laps.length;
    secondLap.disabled = !others.length;
    comparison.hidden = !opponent;

    const base = drivers.get(driver)?.code || "", target = drivers.get(opponent)?.code || "";
    results.hidden = !opponent || (!left && !right);
    if (!results.hidden) {
      const a = values(left), b = values(right);
      const rows = metrics.map((metric, i) => {
        const delta = Number.isFinite(a[i]) && a[i] > 0 && Number.isFinite(b[i]) && b[i] > 0 ? Math.round((b[i] - a[i]) * 1000) : null;
        const text = delta === null ? "–" : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${(Math.abs(delta) / 1000).toFixed(3)}`;
        return `<tr><th scope="row">${metric}</th><td>${format(a[i])}</td><td>${format(b[i])}</td>
          <td class="${delta === null ? "dim" : delta < 0 ? "t-green" : delta > 0 ? "down" : ""}">${text}</td></tr>`;
      }).join("");
      html(results, `<table aria-label="Lap and sector comparison"><thead><tr><th scope="col">Time</th>
        <th scope="col">${esc(base)}${left ? ` <small>L${left.number}</small>` : ""}</th>
        <th scope="col">${esc(target)}${right ? ` <small>L${right.number}</small>` : ""}</th><th scope="col">Diff (s)</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <p class="lap-note">Positive means ${esc(target)} was slower than ${esc(base)}.</p>`);
    }

    html(history, laps.length ? `<table aria-label="${esc(base)} completed laps"><caption>${esc(base)} completed laps</caption><thead><tr>
      <th scope="col">Lap</th>${metrics.map(metric => `<th scope="col">${metric}</th>`).join("")}</tr></thead><tbody>
      ${laps.map(row => `<tr${row === left ? ' class="lap-selected"' : ""}><th scope="row">${row.number}</th>
        ${values(row).map(value => `<td>${format(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<p class="empty">${drivers.size ? "Completed lap times will appear here." : "Waiting for driver data…"}</p>`);
  }

  first.addEventListener("change", () => { driverPicked = true; driver = first.value; lap = ""; render(inputs); });
  second.addEventListener("change", () => { opponentPicked = true; opponent = second.value; otherLap = ""; render(inputs); });
  firstLap.addEventListener("change", () => { lap = firstLap.value; render(inputs); });
  secondLap.addEventListener("change", () => { otherLap = secondLap.value; render(inputs); });
  all?.addEventListener("change", () => render(inputs));
  return render;
}
