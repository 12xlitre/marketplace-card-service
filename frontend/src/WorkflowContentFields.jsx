import {useEffect, useState} from 'react';
import {cardDescriptionText} from './cardDescription';
import {contentTextDiff, titleMeasurementChanges} from './workflowContentReview';

function DiffValue({parts, removed = false}) {
  return <p className="cw-comparison-value">
    {parts.some(part => part.text) ? parts.map(({text, changed}, index) => changed
      ? removed ? <del key={index}>{text}</del> : <ins key={index}>{text}</ins>
      : <span key={index}>{text}</span>) : 'Пусто'}
  </p>;
}

function TextComparison({field, original, draft, reason, edited, facts, expanded}) {
  const diff = contentTextDiff(original, draft);
  const measurements = field === 'title' ? titleMeasurementChanges(original, draft) : null;
  const showMeasurements = measurements && (measurements.removed.length || measurements.added.length);
  const values = showMeasurements ? [...measurements.removed, ...measurements.added] : [];
  const numbers = new Set(values.flatMap(value => value.match(/\d+(?:[.,]\d+)?/g) || []));
  const relevantFacts = facts.filter(row => (row.value.match(/\d+(?:[.,]\d+)?/g) || []).some(value => numbers.has(value)));
  return <details className="cw-comparison" open={expanded || field === 'title' || undefined}>
    <summary>{diff.changed ? 'Что изменилось' : 'Текст совпадает с исходным'}</summary>
    {diff.changed ? <>
      <div className="cw-comparison-columns">
        <div><strong>Было</strong><DiffValue parts={diff.before} removed /></div>
        <div><strong>Стало</strong><DiffValue parts={diff.after} /></div>
      </div>
      {showMeasurements ? <div className="cw-comparison-facts">
        {measurements.removed.length ? <p>Убрано <b>{measurements.removed.join(', ')}</b>.</p> : null}
        {measurements.added.length ? <p>Добавлено <b>{measurements.added.join(', ')}</b>.</p> : null}
        {relevantFacts.length ? <><strong>В исходной карточке</strong><dl>{relevantFacts.map(({name,value,unit},index)=><div key={index}>
          <dt>{name}</dt><dd>{value}{unit?' '+unit:''}</dd>
        </div>)}</dl></> : null}
      </div> : null}
      {reason && !edited ? <p className="cw-comparison-reason"><strong>Пояснение генератора</strong> {reason}</p>
        : <p className="status-note">{edited ? 'Текущая версия отредактирована вручную.' : 'Пояснение генератора для этой версии не сохранено.'}</p>}
    </> : null}
  </details>;
}

export default function WorkflowContentFields({editor,base,apiRequest,onChange,loadedComparison,sectionStatus={},readOnly=false}) {
  const {batch, card, content} = editor;
  const [comparison,setComparison]=useState(null);
  const [loadError,setLoadError]=useState(false);
  useEffect(()=>{
    if(loadedComparison)return;
    let obsolete=false;
    const url=base.replace('?', '/comparison?')+'&batch_id='+encodeURIComponent(batch.id)+'&card_key='+encodeURIComponent(card.cardKey);
    apiRequest(url).then(value=>{if(!obsolete)setComparison(value)})
      .catch(()=>{if(!obsolete)setLoadError(true)});
    return ()=>{obsolete=true};
  },[base,batch.id,card.cardKey,apiRequest,Boolean(loadedComparison)]);

  const info=loadedComparison || comparison;
  const original=info?.original || {};
  const reasons=(info?.generation===batch.generation && info?.reasons) || {};
  const originalCharacteristics=new Map((original.characteristics||[]).map(row=>[row.name.trim().toLowerCase(),row.value]));
  return <>
    {!info?<p className="status-note">{loadError?'Не удалось загрузить исходные данные для сравнения.':'Загружаем исходные данные для сравнения…'}</p>:null}
    {batch.fields.filter(field=>field==='title'||field==='description').map(field=>{
      const label=field==='title'?(loadedComparison?'Заголовок':'Наименование'):'Описание';
      const draft=content[field]||'';
      return <div key={field} className="cw-review-field">
        <label className="field-label">{label}<textarea required rows={field==='description'?12:undefined} value={draft} readOnly={readOnly}
          maxLength={loadedComparison?(field==='title'?300:6000):undefined}
          onChange={e=>onChange({...content,[field]:e.target.value})}/></label>
        {sectionStatus[field]?<p className="cw-field-status">{sectionStatus[field]}</p>:null}
        {info?<TextComparison field={field} original={cardDescriptionText(original[field])}
          draft={cardDescriptionText(draft)} reason={reasons[field]} edited={draft!==card.result[field]} facts={info.facts||[]} expanded={Boolean(loadedComparison)}/>:null}
      </div>;
    })}
    {loadedComparison&&batch.fields.includes('characteristics')?<div className="cw-review-field">
      <strong>Характеристики</strong>
      {sectionStatus.characteristics?<p className="cw-field-status">{sectionStatus.characteristics}</p>:null}
      {!content.characteristics?.length?<p className="status-note">Предложений по характеристикам нет.</p>:null}
    </div>:null}
    {batch.fields.includes('characteristics')?(content.characteristics||[]).map((row,index)=>{
      const before=originalCharacteristics.get(row.name.trim().toLowerCase()) || '';
      const changed=Boolean(info)&&before!==row.value;
      const edited=row.value!==card.result.characteristics?.[index]?.value;
      const reason=!edited&&reasons.characteristics?.[row.name];
      return <div className="cw-review-field" key={index}>
        <label className="field-label">{row.name}<input value={row.value} readOnly={readOnly} maxLength={loadedComparison?500:undefined}
          onChange={e=>onChange({...content,characteristics:content.characteristics.map((item,i)=>i===index?{...item,value:e.target.value}:item)})}/></label>
        {changed?<p className="cw-comparison-reason"><strong>Было</strong> {before||'Не заполнено'}.{reason?<> <strong>Пояснение генератора</strong> {reason}</>:null}</p>:null}
      </div>;
    }):null}
  </>;
}
