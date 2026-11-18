import { useEffect, useRef, useState } from "react";
import { expandSemanticShortlist, hasSemanticDemand, hasSemanticShortlist, mergeSemanticShortlist, reconcileSemanticRelevance, relevanceQueryKey } from "./semanticRelevance";

const groups = [
  ["relevant", "Релевантные", "Можно исключить отдельные запросы."],
  ["disputed", "Спорные", "Проверьте обоснование. Добавление — по решению специалиста."],
  ["irrelevant", "Нерелевантные", "Не входят в СЯ: содержание карточки не подтверждает запрос."],
];

export default function SemanticRelevancePanel({ core, selected = [], existingKeys, removalKeys, search = "", subjectFilter = "", excludeWords = "", readOnly, onInclude, onExclude, onToggleRemoval, formatMeta, shortlistKey, onPrepareShortlist, onChangeShortlist }) {
  const [limits, setLimits] = useState({});
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const selectionIdentity = JSON.stringify([selected.map(relevanceQueryKey), [...removalKeys],
    (core.allKeywords || []).filter(row => row.manualDecision).map(row => [relevanceQueryKey(row), row.manualDecision])]);
  useEffect(() => { requestVersion.current += 1; setPreparing(false); setError(""); return () => { requestVersion.current += 1; }; }, [shortlistKey, selectionIdentity]);
  useEffect(() => setLimits({}), [core?.seedQuery, search, subjectFilter, excludeWords]);
  const selectedKeys = new Set(selected.map(relevanceQueryKey));
  const needle = search.trim().toLowerCase();
  const stopWords = excludeWords.toLowerCase().split(/[\s,;]+/).filter(Boolean).slice(0, 10);
  const rows = core.allKeywords || [];
  const short = hasSemanticShortlist(core);
  const currentGroups = new Set(rows.filter(row => existingKeys.has(relevanceQueryKey(row))).map(row => row.selectionGroup).filter(Boolean));
  const currentRepresentatives = new Set();
  const seenCurrentGroups = new Set();
  [...rows].sort((a,b) => (a.selectionStatus === "candidate" ? -1 : 1) - (b.selectionStatus === "candidate" ? -1 : 1))
    .filter(row => existingKeys.has(relevanceQueryKey(row))).forEach(row => {
      const group = row.selectionGroup || relevanceQueryKey(row);
      if (!seenCurrentGroups.has(group)) { seenCurrentGroups.add(group); currentRepresentatives.add(relevanceQueryKey(row)); }
    });
  const removal = [...removalKeys].map(query => ({ query }));
  const expanded = expandSemanticShortlist(core, selected, existingKeys, removal);
  const extraCount = expanded ? expanded.selected.filter(row => !selectedKeys.has(relevanceQueryKey(row))).length : 0;
  const displayGroups = short ? [
    ["relevant", "Релевантные · в работу", "Один вариант каждого смысла. Ручные добавления сохраняются сверх стартового отбора."],
    ["reserve", "Резерв", "Следующие разные запросы. Добавляйте по одному или расширьте отбор кнопкой выше."],
    ["current", "Уже в карточке", "Действующие запросы и позиции остаются в карточке. Они не занимают места среди новых добавлений; словоформы здесь объединены."],
    ["duplicate", "Объединённые варианты", "Словоформы и перестановки сохранены здесь; их частотность не складывается."],
    ["review", "Проверить написание", "Ошибки, ненормальные словоформы и сомнительное написание не включаются автоматически. Исходные запросы сохранены."],
    ["nodemand", "Без прямой частотности", "Данные источника сохранены; для добавления нужна подтверждённая частота своей площадки."],
    ...groups.slice(1),
  ] : groups;
  async function prepare() {
    const ticket = ++requestVersion.current;
    setPreparing(true); setError("");
    try {
      const prepared = await onPrepareShortlist();
      if (ticket !== requestVersion.current) return;
      const nextCore = mergeSemanticShortlist(core, prepared);
      const next = reconcileSemanticRelevance(nextCore, selected, [core], existingKeys, removal);
      onChangeShortlist(next.core, next.selected);
    } catch (failure) {
      if (ticket === requestVersion.current) setError(failure.message?.startsWith("Подборка изменилась") ? failure.message
        : failure.message === "semantic_shortlist_source_missing" ? "Сначала сохраните исходную подборку и повторите отбор."
        : "Не удалось подготовить отбор. Попробуйте ещё раз.");
    } finally { if (ticket === requestVersion.current) setPreparing(false); }
  }
  return (
    <div className="semantic-relevance-panel">
      <p>Проверено {rows.length} запросов по названию, описанию и характеристикам карточки. Решения и частотность сохраняются вместе с подборкой.</p>
      {onChangeShortlist ? <div className="semantic-shortlist-controls">
        <p>{short ? `В работе ${selected.length} запросов к добавлению · ${selected.reduce((sum, row) => sum + row.query.length + 1, 0)} символов в самих фразах. Остальные смыслы доступны в резерве.`
          : "Для компактного описания отберите до 30 новых разных запросов без ошибок и повторяющихся словоформ. Изменится рабочий выбор; сохранённое итоговое СЯ останется прежним."}
          {" "}Для описания на 3000 символов число запросов — ориентир: общие слова можно использовать один раз, а свойства раскрыть естественно.</p>
        {!short && onPrepareShortlist ? <button type="button" className="btn mini primary" disabled={readOnly || preparing} onClick={prepare}>{preparing ? "Готовим отбор…" : "Отобрать до 30 запросов"}</button> : null}
        {short ? <button type="button" className="btn mini" disabled={readOnly || !extraCount} onClick={() => onChangeShortlist(expanded.core, expanded.selected)}>
          {extraCount ? `Добавить ещё ${extraCount} из резерва` : "Все доступные запросы уже рассмотрены"}</button> : null}
        {error ? <span className="status-note">{error}</span> : null}
      </div> : null}
      {displayGroups.map(([status, title, hint]) => {
        const all = rows.filter((row) => {
          const key = relevanceQueryKey(row);
          if (!short || ["disputed", "irrelevant"].includes(status)) return row.relevance === status;
          if (row.relevance !== "relevant") return false;
          if (status === "relevant") return selectedKeys.has(key);
          if (status === "current") return currentRepresentatives.has(key);
          if (status === "reserve") return row.selectionStatus === "candidate" && !selectedKeys.has(key) && !existingKeys.has(key)
            && !currentGroups.has(row.selectionGroup) && hasSemanticDemand(row, core);
          if (status === "nodemand") return row.selectionStatus === "candidate" && !existingKeys.has(key) && !hasSemanticDemand(row, core);
          return row.selectionStatus === status && !selectedKeys.has(key);
        }).sort((a,b) => short ? Number(a.selectionRank || 5001) - Number(b.selectionRank || 5001) : 0);
        const filtered = all.filter((row) => (!subjectFilter || row.prioritySubject === subjectFilter)
          && (!needle || (row.query + " " + (row.relevanceReason || "")).toLowerCase().includes(needle))
          && !stopWords.some((word) => row.query.toLowerCase().includes(word)));
        const limit = limits[status] || 50;
        return (
          <details key={status} open={status === "relevant"} className={"semantic-relevance-group relevance-" + status}>
            <summary>{title} · {all.length}</summary>
            <p>{hint}{filtered.length !== all.length ? " По фильтрам: " + filtered.length + "." : ""}</p>
            <div className="semantic-keyword-list">
              {filtered.slice(0, limit).map((row) => {
                const key = relevanceQueryKey(row);
                const existing = existingKeys.has(key);
                const included = existing ? !removalKeys.has(key) : selectedKeys.has(key);
                const equivalentCurrent = !existing && currentGroups.has(row.selectionGroup);
                const demand = hasSemanticDemand(row, core);
                return (
                  <div className={"semantic-keyword " + (included ? "selected" : "")} key={key}>
                    <div className="semantic-keyword-main">
                      <strong>{row.query}</strong>
                      <em>{formatMeta(row) || "Прямая частотность не подтверждена"}</em>
                      {row.selectionReason ? <span>{row.selectionReason}</span> : null}
                      <span>{row.relevanceReason}</span>
                      {row.relevanceEvidence?.length ? <em>В карточке: «{row.relevanceEvidence[0].quote}»</em> : null}
                      <em>{existing ? (included ? "Уже в карточке или ранжируется" : "Предложен к исключению из карточки") : included ? "Включён в СЯ" : equivalentCurrent ? "Этот смысл уже учтён в карточке" : row.manualDecision === "excluded" ? "Исключён специалистом" : !demand ? "Для включения нужна прямая частотность" : "Не включён в СЯ"}</em>
                    </div>
                    {status !== "irrelevant" ? (
                      <button className={"btn mini" + (included ? " danger" : "")} type="button" disabled={readOnly || preparing || (!included && equivalentCurrent) || (!existing && !demand)}
                        onClick={() => existing ? onToggleRemoval(row) : included ? onExclude(row) : onInclude(row)}>
                        {included ? "Исключить" : existing ? "Оставить" : equivalentCurrent ? "Уже учтён" : status === "review" ? "Добавить после проверки" : status === "duplicate" ? "Выбрать этот вариант" : row.manualDecision === "excluded" ? "Вернуть в СЯ" : "Добавить в СЯ"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {!filtered.length ? <p>Запросов нет.</p> : null}
              {filtered.length > limit ? <button className="btn mini" type="button" onClick={() => setLimits((value) => ({ ...value, [status]: limit + 100 }))}>Показать ещё · осталось {filtered.length - limit}</button> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}
