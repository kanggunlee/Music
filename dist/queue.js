export function shuffled(ids, random = Math.random) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function moveItem(items, from, to) {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length)
    return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
export function nextDecision(
  { queue, current, library, repeat, shuffle, autoplay },
  ended = false,
  random = Math.random,
) {
  if (ended && repeat === "one" && current)
    return { id: current, queue: [...queue], restart: true };
  if (ended && !autoplay) return null;
  if (queue.length)
    return { id: queue[0], queue: queue.slice(1), restart: false };
  if (repeat === "all" && library.length) {
    let ids = shuffle ? shuffled(library, random) : [...library];
    if (shuffle && ids.length > 1 && ids[0] === current)
      [ids[0], ids[1]] = [ids[1], ids[0]];
    return { id: ids[0], queue: ids.slice(1), restart: ids[0] === current };
  }
  return null;
}
