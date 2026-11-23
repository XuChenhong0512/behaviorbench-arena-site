import { overallRows } from "./overall.js";
import { runtime, formatNumber, element, append, button, paragraph, model, nameOf, details, field, note, table, heading, setURL, gameControls, roundField, metadata, modelCell } from "./shared.js";

// Keep the table structure tied to the complete condition, not the search result.
export function hasBTIntervals(current, method) {
  return method === "bt" && current.id !== "overall" && (current.rows || []).some(item =>
    Number.isFinite(item.bt) && Number.isFinite(item.ci_low) && Number.isFinite(item.ci_high));
}

export function renderLeaderboard(summary, current, state) {
  const wrapper = element("section");
  append(wrapper, heading("Economic Game Leaderboard"), gameControls(summary, current, state));
  const isOverall = current.id === "overall";
  const showIntervals = hasBTIntervals(current, state.method);
  const toolbar = element("div", "toolbar"); const methods = element("div", "method-control"); methods.setAttribute("role", "group"); methods.setAttribute("aria-label", "Ranking method");
  for (const method of ["bt", "elo"]) {
    const node = button(method === "bt" ? "BT" : "Elo", () => setURL({ method })); node.setAttribute("aria-pressed", String(state.method === method)); methods.append(node);
  }
  const search = element("input"); search.type = "search"; search.placeholder = "Search models or providers…"; search.value = runtime.searchTerm;
  append(toolbar, isOverall ? null : roundField(summary, current), field("Ranking method", methods), field("Find a model", search, "search-field"));
  append(wrapper, toolbar, isOverall ? null : metadata(current, summary));
  if (current.status === "provisional") wrapper.append(note(current.ranking_note || "Provisional point estimates. A role-balanced match block is incomplete, so statistical intervals are unavailable."));
  const rankingHost = element("div");
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
      const cells = [element("span", "rank", rows.indexOf(item) + 1), modelCell(summary, item.model_id), element("span", "score", formatNumber(item[state.method]))];
      if (showIntervals) {
        const uncertainty = element("div", "uncertainty");
        if (Number.isFinite(item.ci_low) && Number.isFinite(item.ci_high)) {
          uncertainty.append(element("div", "numeric", `Score ${formatNumber(item.ci_low)}–${formatNumber(item.ci_high)}`));
          if (Number.isFinite(item.rank_low) && Number.isFinite(item.rank_high)) {
            uncertainty.append(element("div", "", `Rank range ${item.rank_low}–${item.rank_high}`));
          }
        } else uncertainty.textContent = current.status === "provisional" ? "Provisional · no interval" : "Not estimated";
        cells.push(uncertainty);
      }
      cells.push(element("span", "numeric", formatNumber(item.ranking_matches ?? item.matches, 0)));
      return cells;
    });
    const headers = ["RANK", "MODEL", state.method === "bt" ? "BT RATING ↓" : "ELO RATING ↓", ...(showIntervals ? ["95% BT INTERVAL"] : []), "MATCHES"];
    const node = table(headers, cells, "ranking-table");
    node.querySelector("table").setAttribute("aria-label", `${current.name} ${state.method.toUpperCase()} rankings`); rankingHost.append(node);
  };
  search.addEventListener("input", () => { runtime.searchTerm = search.value; drawTable(); }); drawTable();
  if (isOverall) {
    const ultimatumNote = current.includes_provisional ? " Includes provisional Ultimatum ratings." :
      current.includes_ultimatum_rerun ? " Includes updated Ultimatum ratings from the supplemental rerun." : "";
    append(wrapper, rankingHost, details("How this average is calculated",
      paragraph(`Arithmetic mean of the five saved game ratings, with each game weighted 20%.${ultimatumNote} No overall confidence interval is estimated.`, "caption"),
      paragraph("Average rating = (Beauty Contest + Ultimatum + Trust + Public Goods + Push/Pull) / 5. BT and Elo are calculated separately from unrounded saved scores, not from earnings, ranks or match counts. A missing game score leaves the overall score unavailable.", "caption"),
      paragraph("This equal-weight index is not a new pooled BT fit. Compare the individual games and their uncertainty before interpreting small differences. Historical experiments with different round conditions are kept separate.", "caption")));
    return wrapper;
  }
  const context = element("p", "caption");
  context.textContent = state.method === "bt" ? (current.status === "historical" ? "Saved regularized BT ratings; intervals were not estimated for this historical experiment." : showIntervals ? "Saved IPW block-normalized BT ratings. Rank ranges use joint comparisons between models." : "Saved IPW block-normalized BT point estimates. No score interval or rank range is available for this condition.") : "Chronological Elo is supplementary and is not corrected for sampling probabilities. No Elo interval or rank range is estimated.";
  if (current.status === "supplemental") {
    context.textContent = state.method === "bt" ? "IPW BT ratings include the supplemental rerun. No interval is estimated for this analysis." :
      "Elo uses the original schedule order with the supplemental rerun in its assigned slot. No Elo interval or rank range is estimated.";
  }
  append(wrapper, rankingHost, context);
  if (current.ranking_note && current.status !== "estimated_asymptotic") {
    wrapper.append(details("About this ranking", paragraph(current.ranking_note, "caption")));
  }
  return wrapper;
}
