import { runtime, formatNumber, matchCandidates, actionText, element, append, button, paragraph, pretty, roleName, nameOf, details, field, select, note, heading, readJSON, setURL, gameControls, roundField, promptDetails } from "./shared.js";

export function hasRetryOrFailure(attempts) {
  return attempts.length > 1 || attempts.some(attempt =>
    attempt.accepted !== true || attempt.network > 1 || attempt.correction > 0 || attempt.error || attempt.error_kind);
}

function renderAttemptDetails(turn) {
  const attempts = Array.isArray(turn.attempts) ? turn.attempts : [];
  if (!hasRetryOrFailure(attempts)) return null;
  const wrapper = details(`Request attempts (${attempts.length})`);
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
export function firstAttemptPrompt(turn) {
  return turn?.attempts?.[0]?.prompt || [];
}

function playerSide(playerId, leftPlayer, rightPlayer) {
  return playerId === leftPlayer ? "left" : playerId === rightPlayer ? "right" : "third";
}

function roundOneInputs(summary, match, players) {
  const section = element("section", "replay-inputs");
  const cards = element("div", "replay-lanes");
  const round = match.rounds.find(item => item.number === 1);
  for (const player of players) {
    const turn = round?.turns.find(item => item.player_id === player.id);
    const name = nameOf(summary, player.model_id);
    const role = turn ? `${player.id} · ${roleName(turn.role)}` : player.id;
    const card = element("article", `bubble ${player.side}`);
    append(card, append(element("div", "bubble-sender"), element("strong", "", name), element("span", "", role)));
    const messages = firstAttemptPrompt(turn);
    if (messages.length) {
      const input = promptDetails(messages, "Input prompt");
      input.open = true;
      const scroll = input.querySelector(".prompt-messages");
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", `${name} round 1 input prompt`);
      card.append(input);
    } else {
      card.append(paragraph("No round 1 input prompt was saved.", "caption"));
    }
    cards.append(card);
  }
  return append(section, element("h2", "", "Round 1 inputs"), cards);
}

function modelOutput(turn) {
  const raw = turn.raw_text ?? turn.attempts?.findLast(attempt => attempt.raw_text != null)?.raw_text;
  const label = raw != null && turn.raw_text == null ? "Model output (unaccepted)" : "Model output";
  const content = element("pre", "raw-text", raw ?? "No complete model response was saved.");
  content.tabIndex = 0;
  content.setAttribute("role", "region");
  content.setAttribute("aria-label", label);
  return append(element("div", "replay-output"), element("h3", "", label), content);
}

function bubble(summary, match, round, turn, leftPlayer, rightPlayer, stage) {
  const side = playerSide(turn.player_id, leftPlayer, rightPlayer);
  const box = element("article", `bubble ${side}`); box.setAttribute("aria-label", `${nameOf(summary, turn.model_id)} ${roleName(turn.role)}`);
  append(box, append(element("div", "bubble-sender"), element("strong", "", nameOf(summary, turn.model_id)), element("span", "", `${stage || ""}${turn.player_id} · ${roleName(turn.role)}`)));
  if (turn.observed_input) box.append(paragraph(pretty(turn.observed_input), "bubble-context"));
  box.append(modelOutput(turn));
  box.append(element("div", "bubble-action", actionText(match.game, turn.role, turn.action)));
  if (round.number !== 1) box.append(promptDetails(turn.prompt));
  else if (turn.prompt?.length && JSON.stringify(turn.prompt) !== JSON.stringify(firstAttemptPrompt(turn))) {
    box.append(promptDetails(turn.prompt, "Later request prompt"));
  }
  return append(box, renderAttemptDetails(turn));
}
function playerCards(summary, match, players) {
  const cards = element("div", "player-cards");
  for (const player of players) {
    const { side } = player;
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
  append(wrapper, heading("Battle Replay"), gameControls(summary, current, state));
  const index = await readJSON(summary.matches_path); if (version !== runtime.routeVersion) return wrapper;
  const all = index.matches || []; const ids = current.rows.map(row => row.model_id);
  const left = ids.includes(state.left) ? state.left : ids[0];
  const right = ids.includes(state.right) && state.right !== left ? state.right : ids.find(id => id !== left);
  const options = ids.map(id => ({ value: id, label: nameOf(summary, id) }));
  const controls = element("div", "replay-controls");
  const leftControl = select(options, left, value => setURL({ left: value, right: value === right ? ids.find(id => id !== value) : right, match: null, round: "all" }), "Left model");
  const rightControl = select(options.filter(item => item.value !== left), right, value => setURL({ left, right: value, match: null, round: "all" }), "Right model");
  const hasInvalidMatches = all.some(match => match.game === current.id && match.rounds === current.rounds && match.status === "invalid");
  const status = hasInvalidMatches ? state.status : "completed";
  const candidates = matchCandidates(all, { game: current.id, rounds: current.rounds, left, right, status });
  const selected = candidates.find(item => item.id === state.match) || candidates[Math.floor(Math.random() * candidates.length)];
  const random = button("↻  Random match", () => {
    const other = candidates.filter(item => item.id !== selected?.id); const pool = other.length ? other : candidates;
    const chosen = pool[Math.floor(Math.random() * pool.length)]; if (chosen) setURL({ left, right, match: chosen.id, round: "all" });
  }, "primary-button"); random.disabled = candidates.length < 2;
  append(controls, field("Left model", leftControl), field("Right model", rightControl), random); wrapper.append(controls);
  const filters = element("div", "toolbar");
  append(filters, roundField(summary, current));
  if (hasInvalidMatches) {
    const statusOptions = [
      { value: "completed", label: "Completed" },
      { value: "invalid", label: "Invalid" },
      { value: "all", label: "All saved matches" }
    ];
    const statusControl = select(statusOptions, status, value => setURL({ status: value, match: null, round: "all" }), "Match status");
    filters.append(field("Match status", statusControl));
  }
  if (filters.childElementCount) wrapper.append(filters);
  if (!selected) {
    const suggestion = hasInvalidMatches ? "Try another pair or match status." : "Try another pair.";
    wrapper.append(element("div", "empty-state", `No saved match contains this pair under these filters. ${suggestion}`));
    return wrapper;
  }
  setURL({ left, right, match: selected.id, status }, { replace: true, render: false });
  const matchOptions = candidates.map((item, index) => ({ value: item.id, label: `Match ${index + 1} · ${item.replaces_match_id ? "supplemental rerun" : item.status} · ${item.settled_rounds}/${item.rounds} rounds settled` }));
  const chooser = select(matchOptions, selected.id, match => setURL({ match, round: "all" }), "Saved match");
  append(wrapper, append(element("div", "replay-header"), field(`Saved match · ${candidates.length} available for this pair`, chooser, "match-selector")));
  const match = await readJSON(selected.path); if (version !== runtime.routeVersion) return wrapper;
  const leftPlayer = match.players.find(player => player.model_id === left)?.id;
  const rightPlayer = match.players.find(player => player.model_id === right)?.id;
  const position = id => id === leftPlayer ? 0 : id === rightPlayer ? 1 : 2;
  const players = [...match.players].sort((a, b) => position(a.id) - position(b.id))
    .map(player => ({ ...player, side: playerSide(player.id, leftPlayer, rightPlayer) }));
  if (match.status !== "completed") wrapper.append(note(`Invalid match · excluded from rankings. ${match.failure_reason || "Partial evidence is retained without a final result."}`));
  wrapper.append(playerCards(summary, match, players), roundOneInputs(summary, match, players));
  const sequential = ["ultimatum", "trust"].includes(match.game);
  if (!match.rounds.length) wrapper.append(element("div", "empty-state", "No round decisions were saved for this match."));
  for (const round of match.rounds) {
    const section = element("section");
    const title = element("h2", "", `Round ${round.number} / ${selected.rounds}`);
    title.id = `replay-round-${round.number}`;
    append(section, append(element("div", "round-heading"), title, element("span", "", sequential ? "Sequential decisions" : "Simultaneous choices · revealed together")));
    const lanes = element("div", sequential ? "replay-lanes sequential" : "replay-lanes");
    const turns = sequential ? round.turns : [...round.turns].sort((a, b) => position(a.player_id) - position(b.player_id));
    turns.forEach((turn, index) => {
      const stage = sequential ? `${index + 1} · ` : "";
      lanes.append(bubble(summary, match, round, turn, leftPlayer, rightPlayer, stage));
    });
    section.append(lanes);
    section.append(settlement(summary, match, round)); wrapper.append(section);
  }
  return wrapper;
}
