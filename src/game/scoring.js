// Stars and points for one cleared level. Pure: the session feeds it the level, the time, the falls and the par.
export function scoreLevel({ level, time, falls, parTime }) {
  const stars = falls === 0 && time <= parTime ? 3 : falls <= 1 && time <= parTime * 1.35 ? 2 : 1;
  const timeBonus = Math.round(Math.max(0, parTime - time) * 40);
  const clean = falls === 0 ? 300 : -120 * falls;
  const score = Math.max(100, 500 + 100 * level + timeBonus + clean);
  return { stars, score };
}
