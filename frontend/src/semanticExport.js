export const semanticExportColors = ['E3EBF5', 'E2F0E9', 'F8E8E3'];
export const semanticExportWidths = [42, 42, 22, 42, 24, 64, 22, 42, 54, 22];

export function semanticExportHeaders(marketplace) {
  return ['Ключи в карточке (действующие)', 'Ранжируемые ключи', 'Позиция ранжируемого ключа',
    'Ключ к добавлению', `Частота ${marketplace === 'Ozon' ? 'Ozon' : 'WB'} ключа к добавлению`,
    'Обоснование добавления', 'Согласование добавления', 'Ключ к удалению из карточки',
    'Причина удаления', 'Согласование удаления'];
}

export function semanticAdditionExplanation(row) {
  const reason = String(row?.relevanceReason || row?.reason || '').trim();
  const quote = row?.relevanceEvidence?.[0]?.quote;
  return [reason, quote ? `В карточке: «${quote}»` : ''].filter(Boolean).join('\n');
}

export function semanticExportRows(current, ranked, selected, removed, marketplace, appendRows = 0) {
  const empty = () => ({value: '', style: 11});
  const rows = [semanticExportHeaders(marketplace).map((value, index) => ({value, style: index < 3 ? 6 : index < 7 ? 7 : 8}))];
  const count = Math.max(current.length, ranked.length, selected.length, removed.length, 1) + appendRows;
  for (let i = 0; i < count; i++) {
    const add = selected[i], remove = removed[i], rank = ranked[i];
    const frequency = Number(add?.[marketplace === 'Ozon' ? 'ozonCount' : 'wbCount']);
    rows.push([
      {value: current[i]?.query || '', style: 10}, {value: rank?.query || '', style: 10}, {value: rank?.position || '', style: 10},
      add?.query ? {value: add.query, style: 10} : empty(),
      add?.query ? {value: Number.isFinite(frequency) && frequency > 0 ? frequency : '', style: 10} : empty(),
      {value: semanticAdditionExplanation(add), style: 10},
      {value: add?.query ? 'Да' : '', style: 9},
      remove?.query ? {value: remove.query, style: 10} : empty(),
      {value: remove?.removalReason || remove?.reason || '', style: 11},
      {value: remove?.query ? 'Да' : '', style: 9},
    ]);
  }
  return rows;
}

export function semanticExportRowHeight(row, widths) {
  const lines = row.map((cell, index) => String(cell?.value ?? cell ?? '').split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, widths[index] - 4))), 0));
  return Math.min(409, Math.max(30, 6 + Math.max(...lines) * 16));
}

export function ozonFinalExportCore(data) {
  const final = data.finalSelection || data;
  const core = data.semanticCore || {};
  const samePeriod = final.period?.d1 === core.period?.d1 && final.period?.d2 === core.period?.d2;
  const ranking = Object.hasOwn(final, 'rankedKeywords') ? final : samePeriod ? core : {};
  return {marketplace: 'Ozon', current: final.current || [], period: final.period || core.period,
    rankedKeywords: ranking.rankedKeywords || [], rankingSource: ranking.rankingSource || '',
    rankingPeriod: ranking.rankingPeriod || null, rankingWarning: ranking.rankingWarning || '',
    allKeywords: samePeriod ? core.allKeywords || [] : []};
}
