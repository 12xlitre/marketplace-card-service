export function visibleWorkflowBatches(batches, mode) {
  return batches.filter(batch => mode !== 'tasks' || !batch.periodId || batch.status !== 'planned');
}
