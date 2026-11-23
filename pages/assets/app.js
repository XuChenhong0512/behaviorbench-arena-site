import { overallCondition } from "./overall.js";
import { runtime, formatNumber, getCondition, matchCandidates, actionText, element, append, button, paragraph, pretty, roleName, model, nameOf, details, field, select, note, table, heading, readJSON, stateFromURL, setURL, gameControls, roundField, metadata, modelCell, promptDetails, definitions } from "./shared.js";

import { renderLeaderboard } from "./leaderboard.js";
import { renderReplay } from "./replay.js";
import { renderSettings } from "./settings.js";

let routeQueued = false;
function queueRoute() { if (!routeQueued) { routeQueued = true; queueMicrotask(() => { routeQueued = false; route(); }); } }
runtime.onRoute = queueRoute;

async function route() {
  const version = ++runtime.routeVersion; const main = document.getElementById("main"); main.setAttribute("aria-busy", "true");
  main.replaceChildren(element("div", "loading-state", "Loading saved results…"));
  try {
    const state = stateFromURL();
    const requestedDataset = state.page === "settings" ? runtime.manifest.default_dataset : state.dataset;
    const dataset = runtime.manifest.datasets.find(item => item.id === requestedDataset) || runtime.manifest.datasets.find(item => item.id === runtime.manifest.default_dataset) || runtime.manifest.datasets[0];
    if (!dataset) throw new Error("No saved result dataset is available."); state.dataset = dataset.id;
    const summary = await readJSON(dataset.path); if (version !== runtime.routeVersion) return;
    const overall = state.page === "leaderboard" && (!state.game || state.game === "overall") ? overallCondition(summary) : null;
    const current = overall || getCondition(summary, state.game, state.rounds);
    if (!current || !summary.models?.length) throw new Error("The saved result summary has no game or model records.");
    state.game = current.id; state.rounds = current.rounds;
    setURL({ page: state.page, dataset: state.dataset, game: state.game, rounds: state.rounds }, { replace: true, render: false });
    document.querySelectorAll("[data-page]").forEach(link => {
      const active = link.dataset.page === state.page;
      if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
      const params = new URLSearchParams({ page: link.dataset.page, dataset: state.dataset, game: state.game, rounds: state.rounds }); link.href = `#${params}`;
    });
    const view = state.page === "settings" ? await renderSettings(summary, current, state, version) : state.page === "replay" ? await renderReplay(summary, current, state, version) : renderLeaderboard(summary, current, state);
    if (version !== runtime.routeVersion) return; main.replaceChildren(view); document.title = `${state.page === "replay" ? "Battle Replay" : state.page === "settings" ? "Game Settings" : "Leaderboard"} · BehaviorBench Arena`;
    if (state.page === "replay" && state.round !== "all") {
      document.getElementById(`replay-round-${state.round}`)?.scrollIntoView();
    }
  } catch (error) {
    if (version !== runtime.routeVersion) return; showError(error);
  } finally { if (version === runtime.routeVersion) main.removeAttribute("aria-busy"); }
}
function showError(error) {
  const main = document.getElementById("main"); const wrapper = element("section", "error-state");
  append(wrapper, element("h1", "", "Saved results could not be loaded"), paragraph(error.message || "Please reload the page to try again."), button("Try again", () => bootstrap())); main.replaceChildren(wrapper);
}
async function bootstrap() {
  try {
    runtime.manifest = await readJSON("manifest.json");
    if (runtime.manifest.schema_version !== 1 || !Array.isArray(runtime.manifest.datasets)) throw new Error("This result bundle uses an unsupported format.");
    await route();
  } catch (error) { showError(error); }
}
if (typeof document !== "undefined") {
  document.querySelector(".skip-link")?.addEventListener("click", event => {
    event.preventDefault();
    const main = document.getElementById("main");
    main.focus({ preventScroll: true });
    main.scrollIntoView({ behavior: "auto", block: "start" });
  });
  document.querySelectorAll("[data-page]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); if (runtime.manifest) setURL({ page: link.dataset.page }); }));
  document.querySelector(".brand")?.addEventListener("click", event => { event.preventDefault(); if (runtime.manifest) setURL({ page: "leaderboard" }); });
  window.addEventListener("popstate", queueRoute); window.addEventListener("hashchange", queueRoute); bootstrap();
}
