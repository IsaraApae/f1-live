// Live tab: the timing screen, connected to Formula 1's live timing feed.
import { mountTiming } from "../timing.js";

export default {
  title: "Live",
  tab: "live",
  async mount(el, params, app) { return mountTiming(el, { app }); }
};
