import { useEffect, useState } from "react";
import { formatSeoDuration, seoProgress } from "./seoProgress";

export default function SeoGenerationProgress({ version }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (version?.status !== "running") return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [version?.status, version?.createdAt]);
  const progress = seoProgress(version, now);
  if (!progress) return null;
  const { done, total, percentage, query, running, remaining, elapsedSeconds, assembling } = progress;
  return (
    <div className="seo-generation-progress">
      <div className="seo-progress-heading">
        <strong>{progress.complete ? "Файл готов к проверке" : assembling ? "Собираем и проверяем Excel" : `Обработано ${done} из ${total} карточек`}</strong>
        <span>{percentage}%</span>
      </div>
      <progress aria-label="Прогресс обработки карточек" max="100" value={percentage} />
      {query ? <div className="seo-query-progress">
        <span>{query.label}: проверено {query.done} из {query.total}, сейчас {query.from}–{query.to}</span>
        <progress aria-label="Прогресс проверки запросов текущей карточки" max={query.total} value={query.done} />
      </div> : null}
      <div className="seo-progress-time">
        {elapsedSeconds !== null ? <span>{running ? "Прошло" : "Затрачено"}: {formatSeoDuration(elapsedSeconds)}</span> : null}
        {running ? <span>{assembling ? "Осталась подготовка файла" : remaining
          ? `Осталось примерно ${formatSeoDuration(remaining[0])} – ${formatSeoDuration(remaining[1])}`
          : "Оценим оставшееся время после первых двух карточек"}</span> : null}
      </div>
      {running ? <p className="status-note">Можно перейти в другой раздел или закрыть страницу — подготовка продолжится на сервере. Оценка времени уточняется по скорости обработки.</p> : null}
    </div>
  );
}
