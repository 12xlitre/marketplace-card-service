function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export function formatSeoDuration(seconds) {
  if (seconds < 60) return "меньше минуты";
  const minutes = Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} ч ${minutes % 60} мин` : `${hours} ч`;
}

export function seoProgress(version, now = Date.now()) {
  if (!version) return null;
  const total = count(version.total);
  const done = Math.min(total, count(version.done));
  const running = version.status === "running";
  const complete = ["review", "submitted", "approved", "returned"].includes(version.status) && Boolean(version.sha256);
  const percentage = total ? Math.min(running ? 99 : 100, Math.floor(done / total * 100)) : 0;
  const started = Date.parse(version.createdAt);
  const finished = Date.parse(version.finishedAt);
  const elapsedSeconds = Number.isFinite(started) ? Math.max(0, ((Number.isFinite(finished) ? finished : now) - started) / 1000) : null;
  const timings = (version.cardDurations || []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  let remaining = null;
  if (running && done >= 2 && done < total && elapsedSeconds > 0) {
    const average = timings.length >= 2
      ? timings.slice(-8).reduce((sum, value) => sum + value, 0) / Math.min(timings.length, 8)
      : elapsedSeconds / done;
    const lanes = timings.length >= 2 ? Math.max(1, Math.min(4, count(version.workers) || 1)) : 1;
    const estimate = average * (total - done) / lanes;
    remaining = [Math.max(60, estimate * 0.65), Math.max(120, estimate * 1.5)];
  }
  const match = String(version.stage || "").match(/^(Проверка запросов|Проверка неприменённых запросов) (\d+)[–—-](\d+) из (\d+)/);
  const query = running && match && count(match[4]) > 0 ? {
    label: match[1], done: Math.min(count(match[4]), Math.max(0, count(match[2]) - 1)),
    total: count(match[4]), from: count(match[2]), to: Math.min(count(match[3]), count(match[4])),
  } : null;
  return { done, total, percentage: complete ? 100 : percentage, elapsedSeconds, remaining, query,
    running, complete, assembling: running && total > 0 && done === total };
}
