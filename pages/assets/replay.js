import { runtime, formatNumber, getCondition, matchCandidates, actionText, element, append, button, paragraph, pretty, roleName, model, nameOf, details, field, select, note, table, heading, readJSON, stateFromURL, setURL, gameControls, roundField, metadata, modelCell, promptDetails, definitions } from "./shared.js";

function renderAttemptDetails(turn) {
  const attempts = Array.isArray(turn.attempts) ? turn.attempts : [];
  const wrapper = details(`Request attempts (${attempts.length})`);
  if (!attempts.length) wrapper.append(paragraph("No separate attempt evidence is available.", "caption"));
  for (const attempt of attempts) {
    const label = `Network ${attempt.network ?? "—"} · correction ${attempt.correction ?? 0}${attempt.accepted ? " · accepted" : ""}`;
    append(wrapper, element("h3", "", label));
    if (attempt.error) append(wrapper, paragraph(pretty(attempt.error), "caption"));
    if (attempt.error_kind) append(wrapper, paragraph(`Recorded error: ${attempt.error_kind}`, "caption"));
    if (attempt.raw_text != null) append(wrapper, element("pre", "raw-text", attempt.raw_text));
    else append(wrapper, paragraph("No complete response was saved.", "caption"));
  }
  return wrapper;
}
function bubble(summary, match, turn, leftPlayer, rightPlayer, stage) {
  const side = turn.player_id === leftPlayer ? "left" : turn.player_id === rightPlayer ? "right" : "third";
  const box = element("article", `bubble ${side}`); box.setAttribute("aria-label", `${nameOf(summary, turn.model_id)} ${roleName(turn.role)}`);
  append(box, append(element("div", "bubble-sender"), element("strong", "", nameOf(summary, turn.model_id)), element("span", "", `${stage || ""}${turn.player_id} · ${roleName(turn.role)}`)));
  if (turn.observed_input) box.append(paragraph(pretty(turn.observed_input), "bubble-context"));
  box.append(paragraph(turn.explanation != null ? turn.explanation : "No explanation was saved for this decision.", "bubble-reason"));
  box.append(element("div", "bubble-action", actionText(match.game, turn.role, turn.action)));
  box.append(details("Full model response", turn.raw_text != null ? element("pre", "raw-text", turn.raw_text) : paragraph("No complete model response was saved.", "caption")));
  box.append(promptDetails(turn.prompt)); box.append(renderAttemptDetails(turn)); return box;
}
function playerCards(summary, match, leftPlayer, rightPlayer) {
  const cards = element("div", "player-cards");
  const ordered = [...match.players].sort((a, b) => (a.id === leftPlayer ? -2 : a.id === rightPlayer ? -1 : 0) - (b.id === leftPlayer ? -2 : b.id === rightPlayer ? -1 : 0));
  for (const player of ordered) {
    const side = player.id === leftPlayer ? "left" : player.id === rightPlayer ? "right" : "third";
    const card = element("div", `player-card ${side}`);
    const outcome = (match.winner_ids || []).includes(player.id) ? ((match.winner_ids || []).length > 1 ? " · Tied highest return" : " · Highest return") : "";
    append(card, element("span", "side-label", `${side === "third" ? "Third participant" : `${side[0].toUpperCase()}${side.slice(1)} model`} · ${player.id}`),
      element("strong", "", nameOf(summary, player.model_id)), element("small", "", match.status === "completed" ? `Final return: ${formatNumber(match.totals?.[player.id], 2)}${outcome}` : "No final match result"));
    cards.append(card);
  }
  return cards;
}
function settlement(summary, match, round) {
  const wrapper = element("div", "settlement");
  if (round.summary) wrapper.append(paragraph(pretty(round.summary)));
  if (!round.settled) { wrapper.append(paragraph("This round was not settled. No round payoff or final result is imputed.")); return wrapper; }
  for (const player of match.players) {
    const text = `${nameOf(summary, player.model_id)}: ${formatNumber(round.payoffs?.[player.id], 2)} this round · ${formatNumber(round.cumulative_returns?.[player.id], 2)} cumulative`;
    wrapper.append(paragraph(text));
  }
  return wrapper;
}
export async function renderReplay(summary, current, state, version) {
  const wrapper = element("section");
  append(wrapper, heading("Battle Replay", "Read the decisions, explanations, and public outcomes from a real saved match."), gameControls(summary, current, state));
  const index = await readJSON(summary.matches_path); if (version !== runtime.routeVersion) return wrapper;
  const all = index.matches || []; const ids = current.rows.map(row => row.model_id);
  const left = ids.includes(state.left) ? state.left : ids[0];
  const right = ids.includes(state.right) && state.right !== left ? state.right : ids.find(id => id !== left);
  const options = ids.map(id => ({ value: id, label: nameOf(summary, id) }));
  const controls = element("div", "replay-controls");
  const leftControl = select(options, left, value => setURL({ left: value, right: value === right ? ids.find(id => id !== value) : right, match: null, round: "all" }), "Left model");
  const rightControl = select(options.filter(item => item.value !== left), right, value => setURL({ left, right: value, match: null, round: "all" }), "Right model");
  const candidates = matchCandidates(all, { game: current.id, rounds: current.rounds, left, right, status: state.status });
  const selected = candidates.find(item => item.id === state.match) || candidates[Math.floor(Math.random() * candidates.length)];
  const random = button("↻  Random match", () => {
    const other = candidates.filter(item => item.id !== selected?.id); const pool = other.length ? other : candidates;
    const chosen = pool[Math.floor(Math.random() * pool.length)]; if (chosen) setURL({ left, right, match: chosen.id, round: "all" });
  }, "primary-button"); random.disabled = candidates.length < 2;
  append(controls, field("Left model", leftControl), field("Right model", rightControl), random); wrapper.append(controls);
  const filters = element("div", "toolbar");
  append(filters, roundField(summary, current), field("Match status", select([{ value: "completed", label: "Completed" }, { value: "invalid", label: "Invalid" }, { value: "all", label: "All saved matches" }], state.status, value => setURL({ status: value, match: null, round: "all" }), "Match status")));
  wrapper.append(filters);
  if (!selected) { wrapper.append(element("div", "empty-state", "No saved match contains this pair under these filters. Try another pair or match status.")); return wrapper; }
  setURL({ left, right, match: selected.id }, { replace: true, render: false });
  const matchOptions = candidates.map((item, index) => ({ value: item.id, label: `Match ${index + 1} · ${item.replaces_match_id ? "supplemental rerun" : item.status} · ${item.settled_rounds}/${item.rounds} rounds settled` }));
  const chooser = select(matchOptions, selected.id, match => setURL({ match, round: "all" }), "Saved match");
  append(wrapper, append(element("div", "replay-header"), field(`Saved match · ${candidates.length} available for this pair`, chooser, "match-selector"), element("span", "badge", `${current.name} · ${current.rounds} rounds`)));
  const match = await readJSON(selected.path); if (version !== runtime.routeVersion) return wrapper;
  const leftPlayer = match.players.find(player => player.model_id === left)?.id;
  const rightPlayer = match.players.find(player => player.model_id === right)?.id;
  if (match.status !== "completed") wrapper.append(note(`Invalid match · excluded from rankings. ${match.failure_reason || "Partial evidence is retained without a final result."}`));
  wrapper.append(playerCards(summary, match, leftPlayer, rightPlayer));
  const nav = element("div", "round-nav"); nav.setAttribute("aria-label", "View rounds");
  const validRound = state.round === "all" || match.rounds.some(item => String(item.number) === state.round) ? state.round : "all";
  for (const value of ["all", ...match.rounds.map(item => String(item.number))]) {
    const node = button(value === "all" ? "All rounds" : `Round ${value}`, () => setURL({ round: value })); node.setAttribute("aria-pressed", String(validRound === value)); nav.append(node);
  }
  wrapper.append(nav);
  const sequential = ["ultimatum", "trust"].includes(match.game);
  if (!match.rounds.length) wrapper.append(element("div", "empty-state", "No round decisions were saved for this match."));
  for (const round of match.rounds) {
    if (validRound !== "all" && String(round.number) !== validRound) continue;
    const section = element("section");
    append(section, append(element("div", "round-heading"), element("h2", "", `Round ${round.number} / ${selected.rounds}`), element("span", "", sequential ? "Sequential decisions" : "Simultaneous choices · revealed together")));
    if (sequential) {
      round.turns.forEach((turn, index) => section.append(append(element("div", "replay-lanes"), bubble(summary, match, turn, leftPlayer, rightPlayer, `${index + 1} · `))));
    } else {
      const lanes = element("div", "replay-lanes");
      [...round.turns].sort((a, b) => (a.player_id === leftPlayer ? -2 : a.player_id === rightPlayer ? -1 : 0) - (b.player_id === leftPlayer ? -2 : b.player_id === rightPlayer ? -1 : 0)).forEach(turn => lanes.append(bubble(summary, match, turn, leftPlayer, rightPlayer)));
      section.append(lanes);
    }
    section.append(settlement(summary, match, round)); wrapper.append(section);
  }
  return wrapper;
}
