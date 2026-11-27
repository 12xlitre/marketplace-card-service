export function workflowCalendarLabel(batch) {
  const dates = [...new Set([...(batch.schedule || []), ...(batch.plannedDays || [])].map(slot => slot.day))].sort();
  return dates.length ? `Назначено: ${dates.join(', ')}` : 'День выполнения не назначен';
}

export function workflowCalendarTaskHref({id, assignee}) {
  const query = new URLSearchParams({screen:'calendar', calendarTask:id});
  if (assignee) query.set('calendarAssignee', assignee);
  return '/?'+query;
}

export function workflowSemanticProgress(cards) {
  const pending = [];
  const finalized = [];
  for (const card of cards) {
    (card.hasSemanticFinal ? finalized : pending).push(card);
  }
  return {pending, finalized};
}

export function workflowCardRun(batch, cardKey, cards = batch.cards) {
  if (!['semantic','content'].includes(batch.kind) || !cards?.length) return null;
  return {
    title: batch.title, workType: batch.kind, workTypeLabel: batch.kind === 'semantic' ? 'Проверка СЯ' : 'Проверка контента',
    workflowBatchId: batch.id, total: cards.length,
    currentIndex: Math.max(0, cards.findIndex(card => card.cardKey === cardKey)),
    items: cards.map(card => ({cardKey: card.cardKey, title: card.title, status: card.state})),
  };
}

export function ozonWorkflowReviewStatus(review, relatedState) {
  if (review?.reviewedAt) {
    const date = new Date(review.reviewedAt);
    if (Number.isFinite(date.getTime())) {
      const day = date.toLocaleDateString('ru-RU', {day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'});
      const time = date.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
      return ['Сохранено '+day+' в '+time+' МСК', review.taskTitle].filter(Boolean).join(' · ');
    }
  }
  return ({
    planned:'Задача на изменение не запускалась', queued:'Готовится в другой задаче', running:'Готовится в другой задаче',
    ready:'Черновик готов в другой задаче', generated:'Черновик готов в другой задаче',
    reviewed:'Проверено в другой задаче', failed:'Ошибка подготовки в другой задаче',
  })[relatedState] || 'Без изменений в этой задаче';
}

export function nextWorkflowContentCard(cards, afterCardKey) {
  const index = afterCardKey == null ? -1 : cards.findIndex(card => card.cardKey === afterCardKey);
  if (afterCardKey != null && index === -1) return null;
  return cards.slice(index + 1).find(card => card.state === 'generated' && !card.reviewed && card.result) ?? null;
}

export function workflowDeliveryText(delivery) {
  if (delivery.kind === 'bitrix') {
    const count = Number.isInteger(delivery.good) && Number.isInteger(delivery.total)
      ? `Готово ${delivery.good} из ${delivery.total} карточек.` : '';
    return ['Автоматическое уведомление о завершении подбора СЯ.', count].filter(Boolean).join(' ');
  }
  return delivery.subject ? `Тема: ${delivery.subject}` : 'Письмо клиенту';
}
