import { overallRows } from "./overall.js";
import { runtime, formatNumber, element, append, button, paragraph, pretty, model, nameOf, details, field, note, table, heading, setURL, gameControls, roundField, metadata, modelCell } from "./shared.js";

export function renderLeaderboard(summary, current, state) {
  const wrapper = element("section");
  append(wrapper, heading("Economic Game Leaderboard", "Compare models by total returns across repeated economic games."), gameControls(summary, current, state));
  const isOverall = current.id === "overall";
  const toolbar = element("div", "toolbar"); const methods = element("div", "method-control"); methods.setAttribute("role", "group"); methods.setAttribute("aria-label", "Ranking method");
  for (const method of ["bt", "elo"]) {
    const node = button(method === "bt" ? "BT" : "Elo", () => setURL({ method })); node.setAttribute("aria-pressed", String(state.method === method)); methods.append(node);
  }
  const search = element("input"); search.type = "search"; search.placeholder = "Search models or providers…"; search.value = runtime.searchTerm;
  append(toolbar, isOverall ? null : roundField(summary, current), field("Ranking method", methods), field("Find a model", search, "search-field"));
  append(wrapper, toolbar, isOverall ? paragraph("Overall · Five games · Equal game weights", "context-line") : metadata(current, summary));
  if (current.status === "provisional") wrapper.append(note(current.ranking_note || "Provisional point estimates. A role-balanced match block is incomplete, so statistical intervals are unavailable."));
  const rankingHost = element("div"); const context = element("p", "caption");
  const drawTable = () => {
    rankingHost.replaceChildren();
    if (isOverall) {
      const rows = overallRows(current, state.method);
      const filtered = rows.filter(item => `${nameOf(summary, item.model_id)} ${model(summary, item.model_id).provider}`.toLowerCase().includes(runtime.searchTerm.toLowerCase()));
      if (!filtered.length) { rankingHost.append(element("div", "empty-state", "No saved models match this search.")); return; }
      const cells = filtered.map(item => [
        element("span", "rank", Number.isFinite(item[state.method]) ? rows.indexOf(item) + 1 : "—"),
        modelCell(summary, item.model_id), element("span", "score", formatNumber(item[state.method])),
        ...current.constituent_games.map(game => element("span", "numeric", formatNumber(item.game_scores[game.id][state.method])))
      ]);
      const headers = ["RANK", "MODEL", `AVG. ${state.method.toUpperCase()} ↓`, ...current.constituent_games.map(game => game.name)];
      const node = table(headers, cells, "ranking-table overall-ranking-table");
      node.querySelector("table").setAttribute("aria-label", `Overall ${state.method.toUpperCase()} rankings`); rankingHost.append(node);
      return;
    }
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
  if (isOverall) {
    const ultimatumNote = current.includes_provisional ? " Includes provisional Ultimatum ratings." :
      current.includes_ultimatum_rerun ? " Includes updated Ultimatum ratings from the supplemental rerun." : "";
    context.textContent = `Arithmetic mean of the five saved game ratings, with each game weighted 20%.${ultimatumNote} No overall confidence interval is estimated.`;
    append(wrapper, rankingHost, context, details("How this average is calculated",
      paragraph("Average rating = (Beauty Contest + Ultimatum + Trust + Public Goods + Push/Pull) / 5. BT and Elo are calculated separately from unrounded saved scores, not from earnings, ranks or match counts. A missing game score leaves the overall score unavailable.", "caption"),
      paragraph("This equal-weight index is not a new pooled BT fit. Compare the individual games and their uncertainty before interpreting small differences. Historical experiments with different round conditions are kept separate.", "caption")));
    return wrapper;
  }
  context.textContent = state.method === "bt" ? (current.status === "historical" ? "Higher is better. Saved regularized BT ratings; intervals were not estimated for this historical experiment." : "Higher is better. Saved IPW block-normalized BT ratings. Intervals, when available, are 95% joint asymptotic intervals.") : "Higher is better. Chronological Elo is supplementary and is not corrected for sampling probabilities.";
  if (current.status === "supplemental") {
    context.textContent = state.method === "bt" ? "Higher is better. IPW BT ratings include the supplemental rerun. No interval is estimated for this analysis." :
      "Higher is better. Elo uses the original schedule order with the supplemental rerun in its assigned slot.";
  }
  append(wrapper, rankingHost, context);
  const about = details("About this ranking", paragraph(current.ranking_note || "Each match is ranked by total return across all rounds. Ties are retained. No results from different games or protocols are pooled.", "caption"));
  if (summary.notes) append(about, paragraph(Array.isArray(summary.notes) ? summary.notes.join(" ") : pretty(summary.notes), "caption"));
  wrapper.append(about); return wrapper;
}
