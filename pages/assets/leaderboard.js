import { runtime, formatNumber, getCondition, matchCandidates, actionText, element, append, button, paragraph, pretty, roleName, model, nameOf, details, field, select, note, table, heading, readJSON, stateFromURL, setURL, gameControls, roundField, metadata, modelCell, promptDetails, definitions } from "./shared.js";

export function renderLeaderboard(summary, current, state) {
  const wrapper = element("section");
  append(wrapper, heading("Economic Game Leaderboard", "Compare models by total returns across repeated economic games."), gameControls(summary, current, state));
  const toolbar = element("div", "toolbar"); const methods = element("div", "method-control"); methods.setAttribute("role", "group"); methods.setAttribute("aria-label", "Ranking method");
  for (const method of ["bt", "elo"]) {
    const node = button(method === "bt" ? "BT" : "Elo", () => setURL({ method })); node.setAttribute("aria-pressed", String(state.method === method)); methods.append(node);
  }
  const search = element("input"); search.type = "search"; search.placeholder = "Search models or providers…"; search.value = runtime.searchTerm;
  append(toolbar, roundField(summary, current), field("Ranking method", methods), field("Find a model", search, "search-field"));
  append(wrapper, toolbar, metadata(current, summary));
  if (current.status === "provisional") wrapper.append(note(current.ranking_note || "Provisional point estimates. A role-balanced match block is incomplete, so statistical intervals are unavailable."));
  const rankingHost = element("div"); const context = element("p", "caption");
  const drawTable = () => {
    rankingHost.replaceChildren();
    const rows = [...current.rows].filter(item => typeof item[state.method] === "number").sort((a, b) => b[state.method] - a[state.method]);
    const filtered = rows.filter(item => `${nameOf(summary, item.model_id)} ${model(summary, item.model_id).provider}`.toLowerCase().includes(runtime.searchTerm.toLowerCase()));
    if (!filtered.length) { rankingHost.append(element("div", "empty-state", "No saved models match this search.")); return; }
    const cells = filtered.map(item => {
      const uncertainty = element("div", "uncertainty");
      if (state.method === "bt" && Number.isFinite(item.ci_low) && Number.isFinite(item.ci_high)) {
        append(uncertainty, element("div", "numeric", `${formatNumber(item.ci_low)}–${formatNumber(item.ci_high)}`), element("div", "", item.rank_low != null ? `Rank ${item.rank_low}–${item.rank_high}` : "95% interval"));
      } else uncertainty.textContent = current.status === "provisional" && state.method === "bt" ? "Provisional · no interval" : "Not estimated";
      return [element("span", "rank", rows.indexOf(item) + 1), modelCell(summary, item.model_id), element("span", "score", formatNumber(item[state.method])), uncertainty,
        element("span", "numeric", formatNumber(item.ranking_matches ?? item.matches, 0))];
    });
    const node = table(["RANK", "MODEL", state.method === "bt" ? "BT RATING ↓" : "ELO RATING ↓", "UNCERTAINTY", "MATCHES"], cells, "ranking-table");
    node.querySelector("table").setAttribute("aria-label", `${current.name} ${state.method.toUpperCase()} rankings`); rankingHost.append(node);
  };
  search.addEventListener("input", () => { runtime.searchTerm = search.value; drawTable(); }); drawTable();
  context.textContent = state.method === "bt" ? (current.status === "historical" ? "Higher is better. Saved regularized BT ratings; intervals were not estimated for this historical experiment." : "Higher is better. Saved IPW block-normalized BT ratings. Intervals, when available, are 95% joint asymptotic intervals.") : "Higher is better. Chronological Elo is supplementary and is not corrected for sampling probabilities.";
  append(wrapper, rankingHost, context);
  const detail = details("Behavior & returns");
  const rows = [...current.rows].sort((a, b) => (b[state.method] ?? -Infinity) - (a[state.method] ?? -Infinity));
  const keys = [...new Set(rows.flatMap(item => Object.keys(item.behavior || {})))];
  if (keys.length) {
    append(detail, table(["Model", ...keys], rows.map(item => [nameOf(summary, item.model_id), ...keys.map(key => formatNumber(item.behavior?.[key], 2))])),
      paragraph("Descriptive averages from complete valid matches; not adjusted for opponent mix. These are game returns, not API costs. Trust returned shares omit zero investments.", "caption"));
  } else detail.append(paragraph("Behavior statistics are not available in this saved bundle.", "caption"));
  wrapper.append(detail);
  const about = details("About this ranking", paragraph(current.ranking_note || "Each match is ranked by total return across all rounds. Ties are retained. No results from different games or protocols are pooled.", "caption"));
  if (summary.notes) append(about, paragraph(Array.isArray(summary.notes) ? summary.notes.join(" ") : pretty(summary.notes), "caption"));
  wrapper.append(about); return wrapper;
}
