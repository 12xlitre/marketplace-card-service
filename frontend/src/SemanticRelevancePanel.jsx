import { useEffect, useState } from "react";
import { relevanceQueryKey } from "./semanticRelevance";

const groups = [
  ["relevant", "Релевантные", "Включены в СЯ. Можно исключить отдельные запросы."],
  ["disputed", "Спорные", "Проверьте обоснование. Добавление — по решению специалиста."],
  ["irrelevant", "Нерелевантные", "Не входят в СЯ: содержание карточки не подтверждает запрос."],
];

export default function SemanticRelevancePanel({ core, selected = [], existingKeys, removalKeys, search = "", subjectFilter = "", excludeWords = "", readOnly, onInclude, onExclude, onToggleRemoval, formatMeta }) {
  const [limits, setLimits] = useState({});
  useEffect(() => setLimits({}), [core?.seedQuery, search, subjectFilter, excludeWords]);
  const selectedKeys = new Set(selected.map(relevanceQueryKey));
  const needle = search.trim().toLowerCase();
  const stopWords = excludeWords.toLowerCase().split(/[\s,;]+/).filter(Boolean).slice(0, 10);
  const rows = core.allKeywords || [];
  return (
    <div className="semantic-relevance-panel">
      <p>Проверено {rows.length} запросов по названию, описанию и характеристикам карточки. Решения и частотность сохраняются вместе с подборкой.</p>
      {groups.map(([status, title, hint]) => {
        const all = rows.filter((row) => row.relevance === status);
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
                const demand = Number(row.wbCount) > 0 || Number(row.ozonCount) > 0;
                return (
                  <div className={"semantic-keyword " + (included ? "selected" : "")} key={key}>
                    <div className="semantic-keyword-main">
                      <strong>{row.query}</strong>
                      <em>{formatMeta(row) || "Прямая частотность не подтверждена"}</em>
                      <span>{row.relevanceReason}</span>
                      {row.relevanceEvidence?.length ? <em>В карточке: «{row.relevanceEvidence[0].quote}»</em> : null}
                      <em>{existing ? (included ? "Уже в карточке или ранжируется" : "Предложен к исключению из карточки") : included ? "Включён в СЯ" : row.manualDecision === "excluded" ? "Исключён специалистом" : !demand ? "Для включения нужна прямая частотность" : "Не включён в СЯ"}</em>
                    </div>
                    {status !== "irrelevant" ? (
                      <button className={"btn mini" + (included ? " danger" : "")} type="button" disabled={readOnly || (!existing && !demand)}
                        onClick={() => existing ? onToggleRemoval(row) : included ? onExclude(row) : onInclude(row)}>
                        {included ? "Исключить" : existing ? "Оставить" : status === "disputed" ? "Добавить в СЯ" : "Вернуть в СЯ"}
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
