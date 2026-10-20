import { useEffect, useState } from "react";

const messages = {
  forbidden: "Для этого действия нужны права назначенного специалиста или аккаунта.",
  seo_card_failed: "Не удалось обработать товар. Проверьте источники и повторите подготовку этого SKU.",
  seo_generation_failed: "Подготовка файла прервана. Повторите запуск; готовые результаты будут использованы повторно.",
  seo_characteristic_evidence_missing: "Для предлагаемой характеристики не найдено подтверждение в собственных данных товара.",
  seo_competitor_witness_missing: "Выбранная формулировка не подтверждается фактическим текстом конкурента.",
  seo_keyword_decisions_incomplete: "Не для всех формулировок конкурента объяснён выбор. Требуется доработка.",
  seo_semantic_decisions_incomplete: "Не для всех запросов объяснено решение. Требуется повторная подготовка.",
  seo_semantic_witness_missing: "Заявленный ключ не найден в указанном разделе результата. Требуется доработка.",
  seo_official_definitions_missing: "Не получен официальный справочник характеристик категории.",
  seo_incomplete_dictionary: "Не удалось полностью проверить официальный словарь. Повторите подготовку.",
  seo_text_exceeds_review_limit: "Подготовленный текст превышает рабочий предел. Укажите замечание для доработки.",
  seo_task_scope_changed: "Состав задачи изменился после подготовки. Создайте новую задачу для актуального набора карточек.",
  seo_tag_removal_reason_missing: "Удаление существующего хештега не обосновано. Нужна доработка.",
  seo_competitor_confirmation_required: "Для каждого SKU укажите конкурента и объяснение сопоставимости (от 10 символов).",
  seo_version_conflict: "Версия изменилась. Обновите задачу и проверьте актуальный файл.",
  seo_blocking_issues: "Сначала устраните блокирующие вопросы через замечания и пересборку.",
  seo_review_issues_required: "Подтвердите проверку вопросов к источникам.",
  seo_already_running: "Подготовка этой задачи уже выполняется.",
  seo_capacity_busy: "Сейчас готовятся другие файлы. Повторите запуск после их завершения.",
  seo_seller_api_not_connected: "Подключите Ozon Seller API в настройках кабинета.",
  seo_mpstats_not_connected: "Подключите MPStats в настройках сервиса.",
  seo_llm_not_configured: "Не настроен доступ к модели генерации.",
  seo_competitor_description_missing: "MPStats не вернул описание конкурента. Укажите другой сопоставимый товар.",
  seo_mpstats_request_failed: "Не удалось получить данные MPStats. Повторите подготовку.",
  seo_keyword_lost_after_editing: "После редактуры потерян выбранный ключ. Нужна повторная подготовка.",
  seo_dictionary_value_not_allowed: "Предложенное значение отсутствует в официальном словаре. Укажите замечание и пересоберите.",
  seo_task_not_found: "Задача ещё не сохранена или уже удалена.",
};
const statusNames = { running: "Подготовка", review: "Файл на проверке", partial: "Часть SKU требует повтора", failed: "Ошибка подготовки", interrupted: "Подготовка прервана", submitted: "На согласовании у аккаунта", approved: "Согласовано аккаунтом", returned: "Возвращено аккаунтом" };
const sectionNames = { title: "Заголовок", characteristics: "Характеристики", description: "Описание", semantic: "Семантика", competitor: "Конкурент" };

function errorText(error) {
  const code = error?.message || String(error);
  return messages[code] || "Не удалось выполнить действие. Обновите задачу и повторите; готовые версии сохраняются.";
}

export default function AutomaticSeoTask({ portalId, group, apiRequest, onTasksUpdated }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState(null);
  const [remark, setRemark] = useState({ sku: "*", section: "description", text: "", attributeId: "" });
  const [acknowledged, setAcknowledged] = useState(false);
  const endpoint = `/api/portals/${encodeURIComponent(portalId)}/automatic-seo/${encodeURIComponent(group.batchId)}`;
  const latest = report?.versions?.at(-1);
  const running = latest?.status === "running";
  const submitted = latest?.status === "submitted";
  const canPrepare = Boolean(report?.capabilities?.prepare);
  const canReview = Boolean(report?.capabilities?.review);

  useEffect(() => { setReport(null); setMapping(null); setAcknowledged(false); setError(""); }, [endpoint]);

  useEffect(() => {
    let active = true;
    let timer;
    async function load() {
      try {
        const value = await apiRequest(endpoint);
        if (!active) return;
        setReport(value);
        setError("");
        const current = value.versions.at(-1);
        setMapping((text) => text ?? group.tasks.map((task) => {
          const row = current?.competitors?.[task.sku];
          return `${task.sku}; ${row?.sku || ""}; ${row?.reason || ""}`;
        }).join("\n"));
        if (current?.status === "running") timer = setTimeout(load, 3000);
      } catch (e) {
        if (active) setError(errorText(e));
      }
    }
    load();
    return () => { active = false; clearTimeout(timer); };
  }, [endpoint, running]);

  function competitors() {
    const rows = {};
    for (const line of String(mapping || "").split("\n").filter((v) => v.trim())) {
      const [own, other, ...reason] = line.split(/[;\t]/);
      if (rows[own?.trim()]) throw new Error("Повтор нашего SKU в сопоставлении");
      rows[own?.trim()] = { sku: other?.trim() || "", reason: reason.join("; ").trim() };
    }
    return rows;
  }

  async function act(action, refreshSources = false) {
    setBusy(true); setError("");
    try {
      const payload = { action, version: latest?.number || 0, acknowledgeIssues: acknowledged, refreshSources };
      if (["generate", "revise"].includes(action)) payload.competitors = competitors();
      if (["revise", "return"].includes(action)) payload.remarks = remark.text.trim() ? [remark] : [];
      const value = await apiRequest(endpoint, { method: "POST", body: JSON.stringify(payload) });
      setReport(value); setAcknowledged(false);
      onTasksUpdated?.(value.tasks);
      if (["revise", "return"].includes(action)) setRemark((r) => ({ ...r, text: "" }));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const mayGenerate = canPrepare && !running && !["submitted", "approved"].includes(latest?.status);
  const mayRemark = (mayGenerate && latest) || (canReview && submitted);
  return (
    <section className="automatic-seo-task" aria-label="Автоматическая оптимизация">
      <div className="task-batch-main"><strong>Автоматическая оптимизация</strong><span>{statusNames[latest?.status] || "Подготовка ещё не запускалась"}</span></div>
      {latest ? <p role="status">Версия {latest.number} · {latest.stage} · обработано {latest.done} из {latest.total}</p> : <p>Подготовка заголовков, характеристик и описаний с Excel для проверки.</p>}
      {latest?.sourceCapturedAt ? <p className="status-note">Свои данные получены {new Date(latest.sourceCapturedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}. Период MPStats: {latest.period?.d1} — {latest.period?.d2}.</p> : null}
      <details open={!latest}>
        <summary>Прямые конкуренты для выбранных SKU</summary>
        <label className="field-label">Одна строка: наш SKU; SKU конкурента; почему товары сопоставимы
          <textarea rows={Math.min(10, group.tasks.length + 1)} value={mapping || ""} onChange={(e) => setMapping(e.target.value)} disabled={!mayGenerate || busy} placeholder="5318115666; 194446985; Смеситель для раковины с сопоставимым монтажом и высотой" />
        </label>
        <p className="status-note">Сверьте назначение, конструкцию, материал и комплектацию. Анализ общего конкурента используется повторно; факты проверяются отдельно по каждому нашему SKU.</p>
      </details>
      {error ? <p className="status-note error" role="alert">{error}</p> : null}
      {latest?.errors?.length ? <ul>{latest.errors.map((row, i) => <li key={`${row.sku}-${i}`}>{row.sku}: {errorText({ message: row.code })}</li>)}</ul> : null}
      {latest?.issues?.length ? <details><summary>Вопросы к проверке: {latest.issues.length}</summary><ul>{latest.issues.map((row, i) => <li key={i}><strong>{row.sku} · {row.field}{row.blocking ? " · блокирует принятие" : ""}</strong>: {row.detail} {row.question}</li>)}</ul></details> : null}
      {mayRemark ? <div className="automatic-seo-remark">
        <strong>{canReview && submitted ? "Замечание аккаунта" : "Замечание для доработки"}</strong>
        <div className="task-batch-actions">
          <label className="field-label">Товар<select aria-label="Товар для замечания" value={remark.sku} onChange={(e) => setRemark({ ...remark, sku: e.target.value })}><option value="*">Вся пачка</option>{group.tasks.map((t) => <option key={t.sku} value={t.sku}>{t.sku} · {t.offerId}</option>)}</select></label>
          <label className="field-label">Раздел<select aria-label="Раздел для замечания" value={remark.section} onChange={(e) => setRemark({ ...remark, section: e.target.value })}>{Object.entries(sectionNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {remark.section === "characteristics" ? <label className="field-label">ID характеристики<input value={remark.attributeId} onChange={(e) => setRemark({ ...remark, attributeId: e.target.value })} /></label> : null}
        </div>
        <textarea aria-label="Текст замечания" rows={3} maxLength={4000} value={remark.text} onChange={(e) => setRemark({ ...remark, text: e.target.value })} placeholder="Что уточнить или изменить. Для изменения факта укажите подтверждение из собственных данных товара." />
      </div> : null}
      {latest?.status === "review" && canPrepare && latest.issues?.length ? <label className="work-type-option"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />Проверил вопросы к источникам; предлагаемые значения подтверждены, оставшиеся замечания не мешают согласованию.</label> : null}
      <div className="task-batch-actions">
        {mayGenerate ? <button type="button" className="btn primary" disabled={busy || mapping === null} onClick={() => act("generate")}>{!latest ? "Подготовить файл" : ["partial", "failed", "interrupted"].includes(latest.status) ? "Повторить проблемные SKU" : latest.status === "returned" ? "Доработать по возврату" : "Пересобрать файл"}</button> : null}
        {mayGenerate && latest ? <button type="button" className="btn" disabled={busy || !remark.text.trim()} onClick={() => act("revise")}>Пересобрать по замечанию</button> : null}
        {mayGenerate && latest ? <button type="button" className="btn" disabled={busy} onClick={() => act("generate", true)}>Обновить источники и пересобрать всё</button> : null}
        {latest?.status === "review" && canPrepare ? <button type="button" className="btn primary" disabled={busy || latest.issues?.some((i) => i.blocking) || (latest.issues?.length > 0 && !acknowledged)} onClick={() => act("accept")}>Принять файл и передать аккаунту</button> : null}
        {canReview && submitted ? <><button type="button" className="btn primary" disabled={busy} onClick={() => act("approve")}>Согласовать файл</button><button type="button" className="btn" disabled={busy || !remark.text.trim()} onClick={() => act("return")}>Вернуть с замечанием</button></> : null}
      </div>
      {report?.versions?.length ? <details open><summary>Файлы и история версий</summary><ul>{[...report.versions].reverse().map((version) => <li key={version.number}>
        <span>Версия {version.number} · {statusNames[version.status]} · {new Date(version.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} </span>
        {version.sha256 ? <a className="btn mini" href={`${endpoint}/file?version=${version.number}`}>Скачать Excel</a> : null}
        {version.remarks?.map((r, i) => <p key={i}>{r.sku === "*" ? "Вся пачка" : r.sku} · {sectionNames[r.section] || "Замечание"}: {r.text}</p>)}
      </li>)}</ul></details> : null}
    </section>
  );
}
