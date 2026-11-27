import {useCallback, useEffect, useState} from 'react';
import WorkflowContentFields from './WorkflowContentFields';
import {ozonWorkflowReviewStatus} from './workflowPresentation';

const sectionLabels = {title:'Заголовок',description:'Описание',characteristics:'Характеристики'};
const waitingStates = {
  planned:'Работа по этой карточке пока не запускалась.',
  queued:'Черновик для этой карточки в очереди.',
  running:'Черновик для этой карточки готовится.',
  failed:'Черновик подготовить не удалось.',
};
const errorText = {
  workflow_schedule_required:'Чтобы сохранить проверку, назначьте время задачи в календаре.',
  workflow_version_conflict:'Версия задачи изменилась. Обновите данные карточки.',
  workflow_content_review_conflict:'Это поле уже изменили. Обновите данные карточки, чтобы сверить версии.',
  workflow_task_closed:'Задача закрыта.',
  workflow_ozon_description_too_long:'Описание должно быть не длиннее 6000 символов.',
  workflow_ozon_characteristic_too_long:'Значение характеристики должно быть не длиннее 500 символов.',
  forbidden:'У вас нет прав на сохранение этой задачи.',
};

export default function OzonWorkflowReview({portalId,taskRun,apiRequest,onNavigate,onBack,onDraftSaved,onDirtyChange,onSavingChange}) {
  const {items,currentIndex,workflowBatchId}=taskRun;
  const cardKey=items[currentIndex].cardKey;
  const [comparison,setComparison]=useState(null);
  const [content,setContent]=useState(null);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [reloading,setReloading]=useState(false);
  const work=comparison?.work;
  const dirty=content&&JSON.stringify(content)!==JSON.stringify(work?.card.result);
  const fetchComparison=useCallback(()=>apiRequest('/api/content-workflow/comparison?'+new URLSearchParams({
    portal_id:portalId,batch_id:workflowBatchId,card_key:cardKey,work:'1',
  })),[apiRequest,portalId,workflowBatchId,cardKey]);

  useEffect(()=>{
    let stopped=false;
    let timer;
    function load(){
      fetchComparison().then(value=>{
        if(stopped)return;
        setComparison(value);
        setContent(value.work.card.result);
        setReloading(false);
        if(!value.work.card.result&&['generating','awaiting_semantic'].includes(value.work.batch.status)){
          timer=setTimeout(load,5000);
        }
      }).catch(failure=>{
        if(!stopped){
          setError(failure.message);
          setReloading(false);
        }
      });
    }
    load();
    return ()=>{stopped=true;clearTimeout(timer);};
  },[fetchComparison,refresh]);
  useEffect(()=>{onDirtyChange?.(Boolean(dirty));},[dirty,onDirtyChange]);
  useEffect(()=>{onSavingChange?.(saving);},[saving,onSavingChange]);
  useEffect(()=>()=>{onDirtyChange?.(false);onSavingChange?.(false);},[onDirtyChange,onSavingChange]);
  useEffect(()=>{
    if(!dirty&&!saving)return;
    const warn=event=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty,saving]);

  const canLeave=()=>!saving&&(!dirty||window.confirm('Правки этой карточки не сохранены. Продолжить без сохранения?'));
  function reload(){
    if(!canLeave())return;
    setError('');
    setReloading(true);
    setRefresh(value=>value+1);
  }

  async function save(event){
    event.preventDefault();
    if(!work?.batch.canReview||!content||saving||reloading)return;
    const advance=event.nativeEvent.submitter?.value==='next';
    setSaving(true);
    setError('');
    let result;
    try{
      result=await apiRequest('/api/content-workflow',{
        method:'POST',body:JSON.stringify({portalId,action:'review_card',batchId:workflowBatchId,cardKey,
          generation:work.batch.generation,reviewRevision:work.reviewRevision,content}),
      });
    }catch(failure){
      setError(failure.message);
      setSaving(false);
      return;
    }
    onDraftSaved?.(result.ozonDraft);
    onDirtyChange?.(false);
    if(advance){
      const nextIndex=items.findIndex(item=>item.cardKey===result.nextCardKey);
      if(nextIndex>currentIndex&&onNavigate?.(nextIndex-currentIndex))return;
      setSaving(false);
      onBack?.();
      return;
    }
    setComparison({...comparison,work:{...work,card:{...work.card,state:'reviewed',result:content},
      workflowReview:result.ozonDraft?.draft?.workflowReview||{}}});
    setSaving(false);
    setReloading(true);
    setRefresh(value=>value+1);
  }

  const mark=work?.workflowReview||{};
  const fields=work?.batch.fields||[];
  const statuses=Object.fromEntries(fields.filter(field=>mark[field]).map(field=>{
    const current=mark[field].batchId===workflowBatchId&&work.card.state==='reviewed'
      && JSON.stringify(content?.[field])===JSON.stringify(work.card.result?.[field]);
    return [field,(current?'':'В черновике карточки · ')+ozonWorkflowReviewStatus(mark[field])];
  }));
  const nextReady=work?.cards.slice(currentIndex+1).some(card=>card.state==='generated'&&card.hasResult);
  const message=error&&(errorText[error]||'Не удалось выполнить действие. Обновите данные и повторите.');
  return <section className="workspace-strip">
    <div className="strip-head">
      <div><h2>Черновик карточки</h2>{work?.card.state==='reviewed'?<p>Проверено</p>:null}</div>
    </div>
    <section className="task-run-strip">
      <div className="task-run-copy"><span>Карточка {currentIndex+1} из {items.length}</span><strong>{taskRun.title}</strong></div>
      <div className="task-run-progress" aria-label={`Карточка ${currentIndex+1} из ${items.length}`}><span style={{width:`${Math.round((currentIndex+1)/items.length*100)}%`}}/></div>
      <div className="task-run-actions">
        <button className="btn" type="button" disabled={saving||currentIndex===0} onClick={()=>{if(canLeave())onNavigate?.(-1);}}>Предыдущая</button>
        <button className="btn" type="button" disabled={saving||currentIndex===items.length-1} onClick={()=>{if(canLeave())onNavigate?.(1);}}>Следующая</button>
      </div>
    </section>
    {!work&&!message?<p className="status-note">Загружаем черновик…</p>:null}
    {work&&!content?<p className="status-note">{waitingStates[work.batch.status==='planned'?'planned':work.card.state]||'Черновик для этой карточки пока недоступен.'}</p>:null}
    {work&&content?<form onSubmit={save}>
      <WorkflowContentFields editor={{batch:work.batch,card:work.card,content}} loadedComparison={comparison}
        sectionStatus={statuses} readOnly={!work.batch.canReview||saving||reloading} onChange={setContent}/>
      {work.batch.canReview?<>
        {!work.batch.scheduled?<p className="status-note">{errorText.workflow_schedule_required}</p>:null}
        <div className="task-batch-actions">
          {nextReady?<button className="btn primary" type="submit" value="next" disabled={saving||reloading}>Сохранить и следующая</button>:null}
          <button className={nextReady?'btn':'btn primary'} type="submit" disabled={saving||reloading}>Проверено · сохранить</button>
        </div>
      </>:null}
    </form>:null}
    {message?<div className="cw-review-field">
      <p className="form-error" role="alert">{message}</p>
      <button className="btn mini" type="button" disabled={saving||reloading} onClick={reload}>Обновить данные карточки</button>
    </div>:null}
    {work?<div className="cw-inactive-sections" aria-label="Остальные разделы">
      {Object.entries(sectionLabels).filter(([field])=>!fields.includes(field)).map(([field,label])=>
        <div key={field}><strong>{label}</strong><span>{ozonWorkflowReviewStatus(mark[field],work.related[field])}</span></div>)}
    </div>:null}
  </section>;
}
