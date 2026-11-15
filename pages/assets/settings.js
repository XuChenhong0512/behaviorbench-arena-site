import { runtime, formatNumber, getCondition, matchCandidates, actionText, element, append, button, paragraph, pretty, roleName, model, nameOf, details, field, select, note, table, heading, readJSON, stateFromURL, setURL, gameControls, roundField, metadata, modelCell, promptDetails, definitions } from "./shared.js";

export async function renderSettings(summary, current, state, version) {
  const wrapper = element("section");
  append(wrapper, heading("Game Settings", "The rules, model settings, and exact saved prompts behind these results."));
  const experiment = select(runtime.manifest.datasets.map(item => ({ value: item.id, label: item.label })), state.dataset, dataset => {
    runtime.searchTerm = ""; setURL({ dataset, game: null, rounds: null, left: null, right: null, match: null, round: "all" });
  }, "Experiment");
  append(wrapper, append(element("div", "toolbar"), field("Experiment", experiment)));
  append(wrapper, gameControls(summary, current, state), append(element("div", "toolbar"), roundField(summary, current)));
  const grid = element("div", "settings-grid");
  const rules = element("section", "setting-section"); append(rules, element("h2", "", "Game rules"));
  for (const [label, value] of [["Decisions", current.rules?.rules], ["Payoffs", current.rules?.payoffs], ["Round feedback", current.rules?.feedback]]) {
    if (value != null) append(rules, element("h3", "", label), paragraph(Array.isArray(value) ? value.join("\n") : pretty(value), "rules-text"));
  }
  const scope = element("section", "setting-section");
  append(scope, element("h2", "", "Experiment scope"), definitions([["Players per match", current.players], ["Rounds per match", current.rounds], ["Planned matches", current.planned_matches], ["Valid matches", current.valid_matches], ["Invalid matches", current.invalid_matches], ["Ranked matches", current.ranking_matches], [current.status === "historical" ? "Recorded groups" : "Complete ranking blocks", current.ranking_blocks]]));
  if (current.ranking_note) scope.append(paragraph(current.ranking_note, "caption"));
  append(grid, rules, scope);
  const generation = element("section", "setting-section");
  append(generation, element("h2", "", "Model settings"), paragraph(summary.settings.generation_policy === "provider_defaults" ? "Provider defaults. Sampling, reasoning, and output length were not overridden." : pretty(summary.settings.generation_policy)));
  if (summary.settings.omitted_parameters?.length) generation.append(paragraph(`Omitted request parameters: ${summary.settings.omitted_parameters.join(", ")}.`));
  const controls = summary.settings.controls;
  if (controls) append(generation, definitions(Object.entries(controls).map(([key, value]) => [roleName(key), value])));
  append(generation, definitions([["Prompt version", summary.settings.prompt_version], ["Decision protocol", summary.settings.protocol]]));
  const response = summary.settings.response || {};
  if (Object.hasOwn(response, "word_limit")) generation.append(paragraph(response.word_limit === null ? "No word limit was imposed." : `Historical explanation limit: ${response.word_limit} words.`, "caption"));
  if (response.goal_sentence) generation.append(paragraph(response.goal_sentence));
  if (response.terminal_field) generation.append(paragraph(`The saved response protocol ends with ${response.terminal_field} followed by the action.`, "caption"));
  generation.append(paragraph("Models do not share private explanations with opponents. The prompt determines what completed-round information each player sees.", "caption"));
  const sampling = element("section", "setting-section");
  append(sampling, element("h2", "", "Sampling & ranking"));
  const policy = summary.settings.sampling || {};
  const ranking = summary.settings.ranking || {};
  const samplingRows = [["Experiment seed", summary.settings.seed], ["Group selection", policy.strategy === "coverage" ? "Coverage-first sampling with uniform exploration" : policy.strategy || "Saved schedule"]];
  if (policy.blocks_per_game != null) samplingRows.push(["Blocks per game", policy.blocks_per_game]);
  if (policy.batch_size != null) samplingRows.push(["Blocks per game / batch", policy.batch_size]);
  if (policy.warmup_blocks != null) samplingRows.push(["Warm-up blocks", policy.warmup_blocks]);
  if (policy.exploration != null) samplingRows.push(["Uniform exploration", `${formatNumber(100 * policy.exploration, 0)}%`]);
  if (policy.coverage_share != null) samplingRows.push(["Coverage share", `${formatNumber(100 * policy.coverage_share, 0)}%`]);
  if (policy.checkpoints) samplingRows.push(["Ranking checkpoints", `${policy.checkpoints.join(" / ")} blocks`]);
  if (policy.execution_order) samplingRows.push(["Execution order", policy.execution_order]);
  if (policy.invalid_replacements != null) samplingRows.push(["Replace invalid matches", policy.invalid_replacements ? "Yes" : "No"]);
  samplingRows.push(["Primary ranking", ranking.primary || "Regularized Bradley–Terry"]);
  if (ranking.bt_l2 != null) samplingRows.push(["BT L2 coefficient", ranking.bt_l2]);
  if (ranking.elo_initial != null) samplingRows.push(["Elo starting rating", ranking.elo_initial]);
  if (ranking.elo_k != null) samplingRows.push(["Elo K factor", ranking.elo_k]);
  append(sampling, definitions(samplingRows));
  if (ranking.elo_note) sampling.append(paragraph(ranking.elo_note, "caption"));
  if (ranking.uncertainty) sampling.append(paragraph(ranking.uncertainty, "caption"));
  const transport = summary.settings.transport;
  if (transport) sampling.append(details("Request timing & retries", definitions([
    ["Total request deadline", `${transport.request_deadline_seconds} seconds`],
    ["Network attempts per format", transport.network_attempts_per_format],
    ["Format corrections", transport.format_corrections],
    ["Retry waits", `${(transport.retry_wait_seconds || []).join(" / ")} seconds`]
  ]), paragraph("A local timeout does not prove that the upstream request was cancelled or free. Original failure evidence is retained.", "caption")));
  append(grid, generation, sampling);
  const identifiers = element("section", "setting-section span-all");
  const requestCounts = new Map((summary.settings.request_counts || []).map(item => [item.model_id, item.requests]));
  append(identifiers, details("Model IDs & request counts", table(["Model", "API model ID", "Saved requests"], summary.models.map(item => [item.name, item.id, formatNumber(requestCounts.get(item.id), 0)])), paragraph("Request counts include retries and corrections; they are not counts of valid game turns.", "caption")));
  const routing = summary.settings.routing;
  if (routing && Array.isArray(routing.models)) {
    const routingDetails = details("Request / response controls");
    append(routingDetails, paragraph("Fixed API model IDs were used with no cross-model fallback. The provider controls below are copied from saved request payloads.", "caption"));
    routingDetails.append(table(["Model", "Provider fallback", "Require parameters", "Max input USD / M tokens", "Max output USD / M tokens", "Max request USD", "Observed variants"], routing.models.map(item => [
      nameOf(summary, item.model_id), typeof item.allow_fallbacks === "boolean" ? String(item.allow_fallbacks) : "Not recorded",
      typeof item.require_parameters === "boolean" ? String(item.require_parameters) : "Not recorded",
      formatNumber(item.max_price?.prompt, 2), formatNumber(item.max_price?.completion, 2), formatNumber(item.max_price?.request, 2), formatNumber(item.observed_variants, 0)
    ])));
    routingDetails.append(paragraph("These are public routing price ceilings, not actual charges or private billing records.", "caption"));
    routingDetails.append(definitions([["Preserve original response text", response.preserve_original_text == null ? "Not recorded" : String(response.preserve_original_text)], ["Action field", response.terminal_field || "See the saved prompt"], ["Explanation word limit", Object.hasOwn(response, "word_limit") ? response.word_limit === null ? "None" : response.word_limit : "Not recorded"]]));
    identifiers.append(routingDetails);
  }
  grid.append(identifiers);
  const roles = element("section", "setting-section span-all"); append(roles, element("h2", "", "Roles & participation"));
  const counts = current.role_counts || [];
  if (counts.length) {
    roles.append(table(["Model", "Role", "Planned turns", "Valid-match turns", "Accepted turns"], counts.map(item => [nameOf(summary, item.model_id), roleName(item.role), formatNumber(item.planned_turns, 0), formatNumber(item.valid_turns, 0), formatNumber(item.accepted_turns, 0)])));
    roles.append(paragraph("Turns are individual round decisions. Planned counts come from the saved schedule; valid-match counts exclude failed matches. Accepted counts can include the preserved partial history of an invalid match.", "caption"));
  } else roles.append(paragraph("Role counts are not available for this experiment.", "caption"));
  grid.append(roles); wrapper.append(grid);
  const provenance = details("Sources & experiment notes");
  for (const source of summary.settings.sources || []) {
    const url = new URL(source.url, location.href);
    if (!["https:", "http:"].includes(url.protocol)) continue;
    const link = element("a", "", source.name); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
    provenance.append(paragraph("")); provenance.lastChild.append(link);
  }
  if (summary.notes) provenance.append(paragraph(Array.isArray(summary.notes) ? summary.notes.join(" ") : pretty(summary.notes), "caption"));
  provenance.append(paragraph(summary.counts?.billing_complete === false ? "Reported costs are not fully reconciled. Unknown fee records remain preserved in the research ledger." : "Saved experiment records are retained separately for each protocol.", "caption"));
  wrapper.append(provenance);
  const examples = (summary.settings.prompt_examples || []).filter(item => item.game === current.id && (item.total_rounds == null && item.rounds == null || Number(item.total_rounds ?? item.rounds) === Number(current.rounds)));
  const prompts = element("section", "setting-section section-gap"); append(prompts, element("h2", "", "Actual prompts"), paragraph("Complete messages from saved requests, including their real round history and current offer or investment when applicable.", "caption"));
  if (!examples.length) { prompts.append(paragraph("No saved prompt example is available for this condition.", "caption")); wrapper.append(prompts); return wrapper; }
  const promptSelect = select(examples.map((item, index) => ({ value: index, label: `${roleName(item.role)} · ${nameOf(summary, item.model_id)} · round ${item.round}` })), 0, value => loadPrompt(Number(value)), "Saved prompt example");
  const promptHost = element("div"); append(prompts, field("Saved request", promptSelect), promptHost); wrapper.append(prompts);
  let promptVersion = 0;
  async function loadPrompt(index) {
    const requestVersion = ++promptVersion; promptHost.replaceChildren(element("div", "loading-state", "Loading complete saved prompt…"));
    try {
      const example = examples[index]; const match = await readJSON(example.match_path);
      if (requestVersion !== promptVersion || version !== runtime.routeVersion) return;
      const round = match.rounds.find(item => item.number === example.round);
      const turn = round?.turns.find(item => item.player_id === example.player_id);
      if (!turn) throw new Error("The saved prompt reference could not be matched to its decision.");
      const body = element("div", "section-gap");
      const full = promptDetails(turn.prompt, `${roleName(turn.role)} · complete prompt`); full.open = true;
      append(body, paragraph(`${current.name} · ${nameOf(summary, turn.model_id)} · ${roleName(turn.role)} · Round ${round.number}`, "caption"), full);
      promptHost.replaceChildren(body);
    } catch (error) { if (requestVersion === promptVersion) promptHost.replaceChildren(note(error.message)); }
  }
  await loadPrompt(0); return wrapper;
}
