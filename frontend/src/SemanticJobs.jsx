import { useEffect, useRef, useState } from 'react';

export const semanticJobActive = job => ['queued', 'collecting', 'classifying', 'saving'].includes(job?.status);
const messages = {
  semantic_relevance_not_configured: 'Для проверки подключите языковую модель.',
  semantic_relevance_busy: 'Очередь заполнена. Повторите позже.',
  semantic_card_busy: 'Для этой карточки уже выполняется подбор.',
  semantic_relevance_failed: 'Подбор прервался. Продолжите его: проверенные запросы сохранены.',
  semantic_card_content_missing: 'Для проверки нужны название, описание или характеристики.',
  semantic_card_not_found: 'Карточка больше не найдена в кабинете.',
  semantic_card_changed: 'Исходные данные карточки изменились. Запустите новый подбор по актуальным данным.',
  semantic_model_changed: 'Настройки модели изменились. Запустите новый подбор.',
  semantic_report_creation_unknown: 'MPStats не подтвердил создание отчёта. Автоматический повтор остановлен, чтобы не создавать платный отчёт дважды. Проверьте подключение перед новым подбором.',
  semantic_report_timeout: 'MPStats долго готовит отчёт. Продолжение использует уже созданный отчёт.',
  semantic_relevance_too_many_queries: 'Больше 5 000 запросов. Уточните стартовую фразу.',
  forbidden: 'Нет доступа к этому заданию.',
};

async function request(url, data) {
  const response = await fetch(url, { credentials: 'same-origin',
    ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'request_failed');
  return payload;
}

export function useSemanticJob({ portalId, cardKey, enabled = true, onReady }) {
  const [job, setJob] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const callback = useRef(onReady);
  const sequence = useRef(0);
  const observedActive = useRef(false);
  const delivered = useRef('');
  callback.current = onReady;
  const accept = async (next, generation) => {
    if (generation !== sequence.current) return;
    setJob(next);
    if (semanticJobActive(next)) observedActive.current = true;
    if (next?.status === 'ready' && observedActive.current && delivered.current !== next.jobId) {
      const detail = next.result ? next : (await request(`/api/semantic-jobs?portal_id=${encodeURIComponent(portalId)}&job_id=${encodeURIComponent(next.jobId)}`)).job;
      if (generation !== sequence.current) return;
      const apply = await callback.current?.(detail);
      if (generation === sequence.current) {
        if (typeof apply === 'function') apply();
        delivered.current = next.jobId;
      }
    }
  };
  useEffect(() => {
    const generation = ++sequence.current;
    let stopped = false;
    let timer;
    setJob(null); setError(''); setPollError(''); setPending(false);
    observedActive.current = false; delivered.current = '';
    if (!enabled || !portalId || !cardKey) return;
    const poll = async () => {
      const pollGeneration = sequence.current;
      try {
        const payload = await request(`/api/semantic-jobs?portal_id=${encodeURIComponent(portalId)}&card_key=${encodeURIComponent(cardKey)}`);
        if (!stopped && pollGeneration === sequence.current) { await accept(payload.jobs[0] || null, pollGeneration); setPollError(''); }
      } catch (error) {
        if (!stopped && pollGeneration === sequence.current) setPollError(messages[error.message] || 'Не удалось обновить состояние подбора. Прогресс сохраняется на сервере.');
      }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); sequence.current++; };
  }, [portalId, cardKey, enabled]);
  const action = async (data) => {
    const generation = ++sequence.current;
    setPending(true); setError('');
    try {
      const payload = await request('/api/semantic-jobs', { portalId, ...data });
      if (data.action === 'start' || data.action === 'retry') observedActive.current = true;
      await accept(payload.job, generation);
      return payload.job;
    } catch (error) {
      if (generation === sequence.current) setError(messages[error.message] || 'Не удалось выполнить действие с подбором.');
      return null;
    } finally { if (generation === sequence.current) setPending(false); }
  };
  return { job, error: error || pollError || messages[job?.error] || job?.error || '', busy: pending || semanticJobActive(job),
    start: data => action({ action: 'start', ...data }), cancel: () => action({ action: 'cancel', jobId: job?.jobId }),
    retry: () => action({ action: 'retry', jobId: job?.jobId }) };
}

const labels = { queued: 'В очереди', collecting: 'Получаем запросы MPStats', classifying: 'Проверяем запросы', saving: 'Сохраняем черновик',
  ready: 'Подбор завершён и сохранён в рабочий черновик', failed: 'Подбор остановился', cancelled: 'Подбор отменён' };

export function SemanticJobStatus({ controller }) {
  const { job, error, busy, cancel, retry } = controller;
  if (!job && !error) return null;
  return <div className="semantic-save-banner" role="status">
    {job ? <><strong>{labels[job.status] || job.status}</strong>
      <span>{job.total ? `${job.completed} из ${job.total} запросов проверено. ` : ''}
        {semanticJobActive(job) ? 'Можно перейти к другим карточкам или закрыть браузер — задание продолжится.' : ''}
        {job.status === 'ready' ? 'Итоговое СЯ формируется отдельной кнопкой.' : ''}</span>
      {job.etaHighSeconds ? <span>Осталось примерно {Math.max(1, Math.ceil(job.etaLowSeconds / 60))}–{Math.max(1, Math.ceil(job.etaHighSeconds / 60))} мин.</span>
        : semanticJobActive(job) ? <span>Оценка времени уточняется после первой проверенной порции.</span> : null}
      {semanticJobActive(job) ? <button type="button" className="btn mini" onClick={cancel}>Отменить подбор</button> : null}
      {['failed','cancelled'].includes(job.status) && !['semantic_report_creation_unknown','semantic_card_changed','semantic_model_changed','semantic_card_not_found','forbidden'].includes(job.error)
        ? <button type="button" className="btn mini" onClick={retry} disabled={busy}>Продолжить подбор</button> : null}
    </> : null}
    {error ? <span role="alert">{error}</span> : null}
  </div>;
}

export function SemanticJobsList({ portalId, onOpen }) {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false, timer;
    const poll = async () => {
      try {
        const data = await request(`/api/semantic-jobs?portal_id=${encodeURIComponent(portalId)}`);
        if (!stopped) { setJobs(data.jobs); setError(''); }
      } catch { if (!stopped) setError('Не удалось загрузить фоновые подборы СЯ.'); }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [portalId]);
  if (!jobs.length && !error) return null;
  return <section className="workspace-strip"><div className="strip-head"><h2>Фоновые подборы СЯ</h2></div>
    {error ? <p role="alert">{error}</p> : null}
    {jobs.slice(0, 20).map(job => <div className="semantic-save-banner" key={job.jobId}>
      <strong>{job.title || job.cardKey} · {job.query}</strong><span>{labels[job.status]} · {job.completed}/{job.total || '…'}</span>
      {job.error ? <span>{messages[job.error] || 'Подбор прервался.'}</span> : null}
      <button type="button" className="btn mini" onClick={() => onOpen(job.cardKey)}>Открыть карточку</button>
    </div>)}
  </section>;
}
