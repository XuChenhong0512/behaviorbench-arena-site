/* Descriptive, equally weighted averages of saved ratings; no new BT fit. */
export const OVERALL_GAMES = ["beauty_contest", "ultimatum", "trust", "public_goods", "push_pull"];

export function overallCondition(summary) {
  if (summary.id !== "v7" || summary.games?.length !== OVERALL_GAMES.length) return null;
  const games = OVERALL_GAMES.map(id => summary.games.filter(game => game.id === id));
  if (games.some(matches => matches.length !== 1 || matches[0].rounds !== 6)) return null;
  const conditions = games.map(matches => matches[0]);
  const rows = summary.models.map(model => {
    const scores = conditions.map(game => {
      const matches = game.rows.filter(row => row.model_id === model.id);
      return matches.length === 1 ? matches[0] : null;
    });
    const result = { model_id: model.id, game_scores: {} };
    for (const method of ["bt", "elo"]) {
      const values = scores.map(row => row?.[method]);
      result[`${method}_games`] = values.filter(Number.isFinite).length;
      result[method] = values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) / conditions.length : null;
    }
    conditions.forEach((game, index) => { result.game_scores[game.id] = { bt: scores[index]?.bt ?? null, elo: scores[index]?.elo ?? null }; });
    return result;
  });
  return { id: "overall", name: "Overall", rounds: 6, status: "descriptive", rows,
    constituent_games: conditions, includes_provisional: conditions.some(game => game.status === "provisional") };
}

export function overallRows(condition, method) {
  if (!["bt", "elo"].includes(method)) throw new Error("Select BT or Elo.");
  return [...condition.rows].sort((a, b) => {
    const av = Number.isFinite(a[method]) ? a[method] : -Infinity;
    const bv = Number.isFinite(b[method]) ? b[method] : -Infinity;
    return av === bv ? 0 : bv - av;
  });
}
