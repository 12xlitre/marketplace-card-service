export function workflowCalendarLabel(batch) {
  const dates = [...new Set([...(batch.schedule || []), ...(batch.plannedDays || [])].map(slot => slot.day))].sort();
  return dates.length ? `Назначено: ${dates.join(', ')}` : 'День выполнения не назначен';
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
  if (batch.kind !== 'semantic' || !cards?.length) return null;
  return {
    title: batch.title, workType: 'semantic', workTypeLabel: 'Проверка СЯ',
    workflowBatchId: batch.id, total: cards.length,
    currentIndex: Math.max(0, cards.findIndex(card => card.cardKey === cardKey)),
    items: cards.map(card => ({cardKey: card.cardKey, title: card.title, status: card.state})),
  };
}

export function workflowDeliveryText(delivery) {
  if (delivery.kind === 'bitrix') {
    const count = Number.isInteger(delivery.good) && Number.isInteger(delivery.total)
      ? `Готово ${delivery.good} из ${delivery.total} карточек.` : '';
    return ['Автоматическое уведомление о завершении подбора СЯ.', count].filter(Boolean).join(' ');
  }
  return delivery.subject ? `Тема: ${delivery.subject}` : 'Письмо клиенту';
}
