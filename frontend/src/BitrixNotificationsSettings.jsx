import { useEffect, useState } from "react";

const errors = {
  bitrix_notifications_invalid_webhook: "Нужен входящий вебхук портала weboptimize.bitrix24.ru.",
  bitrix_notifications_im_scope_required: "У вебхука должно быть разрешение «Чат и уведомления (im)».",
  bitrix_notifications_auth_error: "Битрикс24 не принял вебхук. Проверьте его доступ и разрешения.",
};

export default function BitrixNotificationsSettings({ apiRequest }) {
  const [integration, setIntegration] = useState(null);
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = "/api/integrations/bitrix-notifications";
  useEffect(() => {
    let active = true;
    apiRequest(endpoint).then((value) => { if (active) setIntegration(value.integration); })
      .catch(() => { if (active) setError("Не удалось прочитать настройки уведомлений."); });
    return () => { active = false; };
  }, [apiRequest]);
  async function save(event, action = "connect") {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const value = await apiRequest(endpoint, { method: "POST", body: JSON.stringify({ action, webhook: webhook.trim() }) });
      setIntegration(value.integration); setWebhook("");
    } catch (e) { setError(errors[e.message] || "Не удалось настроить уведомления Битрикс24. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  return <form className="panel integration-form" onSubmit={save}>
    <div><h2>Уведомления Битрикс24</h2>
      <p>Настя · weboptimize.bitrix24.ru · сотрудник 91. Одно уведомление по завершении автоматической оптимизации в кабинетах, где она назначена техническим специалистом.</p>
      <p role="status">{integration ? integration.enabled ? "Подключено: уведомления отправляются с сервера, даже когда страница закрыта." : "Уведомления не подключены." : "Загружаем настройки…"}</p>
    </div>
    {(integration?.deliveries?.error || integration?.deliveries?.uncertain || integration?.deliveries?.sending) ? <p className="form-error" role="alert">Есть уведомления с ошибкой или неподтверждённой доставкой. Требуется проверить отправку; повторно автоматически они не рассылаются.</p> : null}
    <label className="field-label">Входящий вебхук Битрикс24
      <input type="password" value={webhook} onChange={(event) => setWebhook(event.target.value)} autoComplete="off" disabled={busy} placeholder="https://weboptimize.bitrix24.ru/rest/…/…/" />
    </label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="task-batch-actions">
      <button className="btn primary" type="submit" disabled={busy || !webhook.trim()}>{busy ? "Проверяем…" : "Проверить и подключить"}</button>
      {integration?.connected ? <button className="btn" type="button" disabled={busy} onClick={(event) => save(event, "disconnect")}>Отключить уведомления</button> : null}
    </div>
  </form>;
}
