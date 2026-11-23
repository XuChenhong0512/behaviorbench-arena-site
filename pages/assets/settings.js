import { runtime, formatNumber, element, append, paragraph, pretty, roleName, nameOf, details, field, select, note, table, heading, readJSON, gameControls, roundField, promptDetails, definitions } from "./shared.js";

export async function renderSettings(summary, current, state, version) {
  const wrapper = element("section");
  append(wrapper, heading("Game Settings"), gameControls(summary, current, state));
  const rounds = roundField(summary, current);
  if (rounds) wrapper.append(append(element("div", "toolbar"), rounds));
  const grid = element("div", "settings-grid");
  const rules = element("section", "setting-section"); append(rules, element("h2", "", "Game rules"));
  for (const [label, value] of [["Decisions", current.rules?.rules], ["Payoffs", current.rules?.payoffs], ["Round feedback", current.rules?.feedback]]) {
    if (value != null) append(rules, element("h3", "", label), paragraph(Array.isArray(value) ? value.join("\n") : pretty(value), "rules-text"));
  }
  const scope = element("section", "setting-section");
  const generationPolicy = summary.settings.generation_policy;
  append(scope, element("h2", "", "Experiment scope"), definitions([
    ["Players per match", current.players], ["Rounds per match", current.rounds], ["Planned matches", current.planned_matches],
    ["Valid matches", current.valid_matches], ["Invalid matches", current.invalid_matches], ["Ranked matches", current.ranking_matches],
    [current.status === "historical" ? "Recorded groups" : "Complete ranking blocks", current.ranking_blocks],
    ["Model settings", generationPolicy === "provider_defaults" ? "Provider defaults" : pretty(generationPolicy)],
  ]));
  if (current.ranking_note) scope.append(paragraph(current.ranking_note, "caption"));
  const rerun = current.ultimatum_rerun;
  if (rerun?.archived_match_path === "v7/matches/v7-ultimatum-r6-m0236.json") {
    const archive = element("a", "", "Archived original match record (JSON)");
    archive.href = `./data/${rerun.archived_match_path}`;
    scope.append(details("Supplemental Ultimatum rerun", definitions([
      ["Replacement match", rerun.replacement_match_id], ["Original paired match", rerun.paired_match_id],
      ["Completed", rerun.completed_at], ["Rerun requests", rerun.request_count],
    ]), archive));
  }
  append(grid, rules, scope);
  const sampling = element("section", "setting-section span-all");
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
  grid.append(sampling);
  const roles = element("section", "setting-section span-all"); append(roles, element("h2", "", "Roles & participation"));
  const counts = current.role_counts || [];
  if (counts.length) {
    roles.append(table(["Model", "Role", "Planned turns", "Valid-match turns", "Accepted turns"], counts.map(item => [nameOf(summary, item.model_id), roleName(item.role), formatNumber(item.planned_turns, 0), formatNumber(item.valid_turns, 0), formatNumber(item.accepted_turns, 0)])));
    roles.append(paragraph("Turns are individual round decisions. Planned counts come from the saved schedule; valid-match counts exclude failed matches. Accepted counts can include the preserved partial history of an invalid match.", "caption"));
  } else roles.append(paragraph("Role counts are not available for this experiment.", "caption"));
  grid.append(roles); wrapper.append(grid);
  const sources = details("Sources");
  for (const source of summary.settings.sources || []) {
    const url = new URL(source.url, location.href);
    if (!["https:", "http:"].includes(url.protocol)) continue;
    const link = element("a", "", source.name); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
    sources.append(append(element("p"), link));
  }
  if (sources.children.length > 1) wrapper.append(sources);
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
      const full = promptDetails(turn.prompt); full.open = true;
      promptHost.replaceChildren(append(element("div", "section-gap"), full));
    } catch (error) { if (requestVersion === promptVersion) promptHost.replaceChildren(note(error.message)); }
  }
  await loadPrompt(0); return wrapper;
}
