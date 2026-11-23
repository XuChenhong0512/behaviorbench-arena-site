import { overallCondition } from "./overall.js";
/* Saved-results browser. This module never calls an inference endpoint. */
const PAGES = new Set(["leaderboard", "replay", "settings"]);
const DATA_ROOT = new URL("../data/", import.meta.url);
const cache = new Map();
export const runtime = { manifest: null, routeVersion: 0, searchTerm: "", onRoute: () => {} };

export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : String(value);
}

export function getCondition(summary, id, rounds) {
  const games = summary.games || [];
  return games.find(game => game.id === id && game.rounds === Number(rounds)) || games.find(game => game.id === id) || games[0];
}

export function matchCandidates(matches, { game, rounds, left, right, status = "completed" }) {
  if (!left || !right || left === right) return [];
  return matches.filter(match => match.game === game && Number(match.rounds) === Number(rounds)
    && (status === "all" || match.status === status)
    && match.players.some(player => player.model_id === left)
    && match.players.some(player => player.model_id === right));
}

export function actionText(game, role, action) {
  if (action === null || action === undefined) return "No accepted decision";
  const name = String(role || "").toLowerCase();
  if (game === "beauty_contest") return `Choice: ${action}`;
  if (game === "public_goods") return `Contribution: ${action} / 20`;
  if (game === "ultimatum") return name.includes("proposer") ? `Offer to responder: ${action}` : `Decision: ${action}`;
  if (game === "trust") return name.includes("investor") ? `Investment: ${action}` : `Returned amount: ${action}`;
  if (game === "push_pull") return `Choice: ${action}${String(action).toLowerCase() === "push" ? " · Cooperate" : String(action).toLowerCase() === "pull" ? " · Defect" : ""}`;
  return `Decision: ${typeof action === "object" ? JSON.stringify(action) : action}`;
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
export function append(parent, ...children) { children.filter(Boolean).forEach(child => parent.append(child)); return parent; }
export function button(label, callback, className = "") {
  const node = element("button", className, label); node.type = "button"; node.addEventListener("click", callback); return node;
}
export function paragraph(text, className = "") { return element("p", className, text); }
export function pretty(value) { return typeof value === "string" ? value : value == null ? "Not recorded" : JSON.stringify(value, null, 2); }
export function roleName(role) { return String(role || "Player").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase()); }
export function model(summary, id) { return summary.models.find(item => item.id === id) || { id, name: id, provider: "" }; }
export function nameOf(summary, id) { return model(summary, id).name; }
export function details(label, ...children) {
  const node = element("details"); append(node, element("summary", "", label), ...children); return node;
}
export function field(label, control, className = "") {
  const wrapper = element("label", `field ${className}`.trim()); append(wrapper, element("span", "field-label", label), control); return wrapper;
}
export function select(options, selected, onChange, accessibleLabel) {
  const node = element("select");
  if (accessibleLabel) node.setAttribute("aria-label", accessibleLabel);
  for (const option of options) {
    const item = element("option", "", option.label); item.value = String(option.value); node.append(item);
  }
  if ([...node.options].some(item => item.value === String(selected))) node.value = String(selected);
  node.addEventListener("change", () => onChange(node.value)); return node;
}
export function note(text, type = "") { return element("div", `notice ${type}`.trim(), text); }
export function table(headers, rows, className = "data-table") {
  const wrapper = element("div", "table-wrap");
  const node = element("table", className); const head = element("thead"); const top = element("tr");
  headers.forEach(label => { const th = element("th", "", label); th.scope = "col"; top.append(th); });
  head.append(top); const body = element("tbody");
  rows.forEach(values => { const tr = element("tr"); values.forEach(value => { const td = element("td"); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? "—"))); tr.append(td); }); body.append(tr); });
  append(node, head, body); wrapper.append(node); return wrapper;
}
export function heading(title) {
  return append(element("div", "page-heading"), element("h1", "", title));
}

export async function readJSON(path) {
  const url = new URL(path, DATA_ROOT);
  if (url.origin !== DATA_ROOT.origin || !url.pathname.startsWith(DATA_ROOT.pathname)) throw new Error("The saved data path is outside this result bundle.");
  if (!cache.has(url.href)) {
    const task = fetch(url.href, { credentials: "same-origin" }).then(response => {
      if (!response.ok) throw new Error(`Saved data could not be loaded (${response.status}).`);
      return response.json();
    }).catch(error => { cache.delete(url.href); throw error; });
    cache.set(url.href, task);
  }
  return cache.get(url.href);
}
export function stateFromURL() {
  const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const page = params.get("page") || "leaderboard";
  return { page: PAGES.has(page) ? page : "leaderboard", dataset: params.get("dataset") || runtime.manifest.default_dataset,
    game: params.get("game"), rounds: params.get("rounds"), method: params.get("method") === "elo" ? "elo" : "bt",
    left: params.get("left"), right: params.get("right"), match: params.get("match"), status: ["all", "invalid"].includes(params.get("status")) ? params.get("status") : "completed",
    round: params.get("round") || "all" };
}
export function setURL(change, { replace = false, render = true } = {}) {
  const state = { ...stateFromURL(), ...change }; const params = new URLSearchParams();
  for (const key of ["page", "dataset", "game", "rounds", "method", "left", "right", "match", "status", "round"]) {
    if (state[key] !== null && state[key] !== undefined && state[key] !== "") params.set(key, state[key]);
  }
  const url = new URL(location.href); url.hash = params.toString(); url.search = "";
  history[replace ? "replaceState" : "pushState"](null, "", url);
  if (render) runtime.onRoute();
}
export function gameControls(summary, current, state) {
  const wrapper = element("div"); const tabs = element("div", "game-tabs"); tabs.setAttribute("aria-label", "Game");
  if (state.page === "leaderboard" && overallCondition(summary)) {
    const overall = button("Overall", () => setURL({ game: "overall", rounds: 6, match: null, round: "all" }));
    overall.setAttribute("aria-pressed", String(current.id === "overall")); tabs.append(overall);
  }
  const seen = new Set();
  for (const game of summary.games) {
    if (seen.has(game.id)) continue; seen.add(game.id);
    const node = button(game.name, () => {
      const next = getCondition(summary, game.id, state.rounds);
      setURL({ game: game.id, rounds: next.rounds, match: null, round: "all" });
    });
    node.setAttribute("aria-pressed", String(current.id === game.id)); tabs.append(node);
  }
  wrapper.append(tabs); return wrapper;
}
export function roundField(summary, current) {
  const choices = summary.games.filter(item => item.id === current.id).map(item => ({ value: item.rounds, label: `${item.rounds} rounds` }));
  if (choices.length < 2) return null;
  const control = select(choices, current.rounds, rounds => setURL({ rounds, match: null, round: "all" }), "Rounds per match");
  return field("Rounds per match", control);
}
export function metadata(current, summary) {
  const context = element("div", "context-line");
  context.append(element("span", "", `${current.name} · ${current.rounds} rounds`));
  if (summary.id !== "v7" && summary.label) context.append(element("span", "muted", summary.label));
  const hideInvalidCount = summary.id === "expansion-v5" && current.id === "trust" && [6, 8].includes(current.rounds);
  const line = element("div", "meta-line");
  for (const value of [`${current.valid_matches} valid matches`, current.ranking_matches != null && current.ranking_matches !== current.valid_matches ? `${current.ranking_matches} ranked matches` : null,
    current.comparisons != null ? `${current.comparisons} comparisons` : null, current.invalid_matches && !hideInvalidCount ? `${current.invalid_matches} invalid` : null]) {
    if (value) line.append(element("span", "", value));
  }
  return append(element("div"), context, line);
}
export function modelCell(summary, id) {
  const info = model(summary, id); const cell = element("div", "model-cell");
  const mark = element("span", "model-monogram", info.provider ? info.provider[0] : info.name[0]); mark.setAttribute("aria-hidden", "true");
  append(cell, mark, append(element("span"), element("span", "model-name", info.name), element("span", "model-provider", info.provider))); return cell;
}
export function promptDetails(messages, label = "Full prompt") {
  const content = element("div", "prompt-messages");
  if (!Array.isArray(messages) || !messages.length) return details(label, paragraph("No prompt was saved for this attempt.", "caption"));
  for (const message of messages) append(content, append(element("section"), element("div", "message-role", message.role), element("pre", "raw-text", typeof message.content === "string" ? message.content : pretty(message.content))));
  const copy = button("Copy prompt", async () => {
    try { await navigator.clipboard.writeText(messages.map(message => `${String(message.role).toUpperCase()}\n${pretty(message.content)}`).join("\n\n")); copy.textContent = "Copied"; }
    catch { copy.textContent = "Copy unavailable"; }
  }, "quiet-button");
  return details(label, content, copy);
}
export function definitions(entries) {
  const node = element("dl", "definition-list");
  for (const [label, value] of entries) append(node, element("dt", "", label), element("dd", "", pretty(value)));
  return node;
}
