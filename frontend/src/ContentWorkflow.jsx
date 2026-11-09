import {useEffect,useRef,useState} from 'react';
import './contentWorkflow.css';

const endpoint='/api/content-workflow';
const labels={planned:'В плане',collecting:'Подбор СЯ в фоне',review:'Проверка специалистом',partial:'Есть ошибки',
  awaiting_semantic:'Ожидает согласованного СЯ',generating:'Переоптимизация',account_review:'Передано аккаунту',
  client_review:'На согласовании клиента',approved:'Выполнено',changes_requested:'На доработке',cancelled:'Отменено',
  archived:'Архив плана',sending:'Отправляется',pending:'В очереди',sent:'Отправлено',blocked:'Ожидает настройки',uncertain:'Требует проверки доставки',superseded:'В истории',in_progress:'В работе',queued:'В очереди',ready:'Подбор готов',generated:'Проверить контент',reviewed:'Проверено',running:'Готовим',failed:'Ошибка'};
const messages={workflow_rate_limited:'Слишком много действий. Подождите минуту и повторите.',forbidden:'Нет прав на это действие.',workflow_contacts_required:'Заполните контактное лицо, email и телефон клиента.',
  workflow_schedule_required:'Сначала назначьте плановую длительность задачи в календаре.',workflow_cards_required:'Выберите от 1 до 200 карточек.',workflow_assignee_required:'Выберите исполнителя с доступом к кабинету.',
  workflow_approval_proof_required:'Укажите дату и приложите подтверждение клиента (до 2 МБ).',
  workflow_version_conflict:'Версия изменилась. Обновите задачу и проверьте актуальный файл.',
  workflow_plan_approval_required:'Сначала подтвердите план клиентом.',workflow_semantic_required:'Нужно согласованное СЯ этого набора.',
  semantic_final_missing:'Сначала сохраните итоговое СЯ в карточке.',workflow_final_snapshot_required:'Откройте карточку и заново сохраните итоговое СЯ.',
  workflow_card_not_ready:'Карточка ещё не готова к проверке.',workflow_review_all_cards:'Проверьте и подтвердите все карточки набора.',
  workflow_day_overloaded:'На этот день не хватает рабочего времени.',workflow_duration_required:'Выделите от 1 до 480 минут на один день. Большую работу разделите по дням.',
  workflow_nonworking_day:'Это нерабочий день специалиста.',workflow_outside_period:'Дата находится за границами периода.',
  workflow_mail_not_configured:'Для отправки администратор должен подключить почту. Файл можно скачать и передать клиенту вручную.',
  workflow_file_scope_mismatch:'Состав или защищённые поля файла изменены. Загрузите файл из этой задачи.',
  workflow_decision_required:'В согласовании укажите «Да» или «Нет».',workflow_formulas_forbidden:'Формулы в файле согласования запрещены.',
  workflow_task_closed:'Задача уже завершена или отменена.',semantic_card_changed:'Данные товара изменились. Создайте подбор по актуальной карточке.',
  semantic_relevance_not_configured:'Не подключена модель для проверки СЯ.',workflow_generation_failed:'Не удалось подготовить контент. Повторите проблемные карточки.',
  workflow_bitrix_mapping_required:'Для исполнителя не указан ID Б24.',workflow_bitrix_not_configured:'Подключите Б24 в настройках уведомлений.',
  workflow_delivery_unknown:'Исход доставки неизвестен. Проверьте отправку перед ручным повтором.',workflow_delivery_failed:'Отправка не выполнена. Проверьте настройки.',
  workflow_smtp_password_required:'Для первого подключения нужен пароль приложения.',workflow_invalid_email:'Проверьте адрес электронной почты.',
  workflow_invalid_smtp:'Укажите SMTP-сервер, порт и защищённый режим подключения.'};
const keyOf=c=>String(c.cardKey||c.nmID||c.sku||c.id||'');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
const shift=(day,n)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)};
const id=()=>crypto.randomUUID();
function ErrorNote({error}){return error?<p className="form-error" role="alert">{messages[error]||'Не удалось выполнить действие. Обновите данные и повторите.'}</p>:null}
function Status({value,label}){return <span className={'cw-status '+(value==='approved'||value==='reviewed'?'good':'')}>{label||labels[value]||value}</span>}
async function attachment(file,limit=2*1024*1024){
  if(file.size>limit)throw Error('workflow_approval_proof_required');
  const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
  return {name:file.name,type:file.type,size:file.size,dataUrl};
}

export default function ContentWorkflow({portal,cards=[],onOpenCard,apiRequest,onExportReport,mode='periods'}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(()=>new URLSearchParams(location.search).get('workflow')||sessionStorage.getItem('workflow:'+portal.id)||''),[detail,setDetail]=useState(null);
  const [create,setCreate]=useState(null),[approval,setApproval]=useState(null),[editor,setEditor]=useState(null),[mail,setMail]=useState(null),[incoming,setIncoming]=useState(null);
  const [calendar,setCalendar]=useState(false),[suggestions,setSuggestions]=useState(null);
  const generation=useRef(0);
  useEffect(()=>{if(selected)sessionStorage.setItem('workflow:'+portal.id,selected)},[portal.id,selected]);
  const base=endpoint+'?portal_id='+encodeURIComponent(portal.id);
  useEffect(()=>{const open=event=>{if(String(event.detail.portalId)===String(portal.id)){setDetail(null);setSelected(event.detail.batchId)}};window.addEventListener('opticards-open-workflow',open);return()=>window.removeEventListener('opticards-open-workflow',open)},[portal.id]);
  const download=file=>{location.assign(endpoint+'/file?portal_id='+encodeURIComponent(portal.id)+'&id='+encodeURIComponent(file))};
  async function reload(){
    const next=await apiRequest(base);setData(next);
    if(selected)setDetail((await apiRequest(base+'&batch_id='+encodeURIComponent(selected))).batch);
  }
  useEffect(()=>{
    const current=++generation.current;let timer,stopped=false;
    setData(null);setDetail(null);setError('');
    const poll=async()=>{try{const next=await apiRequest(base);if(!stopped&&current===generation.current)setData(next);
      if(selected){const value=await apiRequest(base+'&batch_id='+encodeURIComponent(selected));if(!stopped&&current===generation.current)setDetail(value.batch)}
    }catch(e){if(!stopped)setError(e.message)}if(!stopped)timer=setTimeout(poll,5000)};
    poll();return()=>{stopped=true;clearTimeout(timer);generation.current++};
  },[portal.id,selected]);
  async function act(action,payload={}){
    setBusy(true);setError('');
    try{const result=await apiRequest(endpoint,{method:'POST',body:JSON.stringify({portalId:portal.id,action,...payload})});await reload();return result}
    catch(e){setError(e.message);if(e.message==='workflow_day_overloaded')setSuggestions({...e.payload,batchId:payload.batchId,minutes:payload.minutes,day:payload.day});throw e}
    finally{setBusy(false)}
  }
  const safe=(action,payload)=>act(action,payload).catch(()=>null);
  if(!data)return <section className="workspace-strip"><h2>План, задачи и согласование</h2><p>Загружаем рабочий процесс…</p><ErrorNote error={error}/></section>;
  const plans=data.plans,batches=data.batches,byId=new Map(batches.map(b=>[b.id,b]));
  const current=detail?.id===selected?detail:null;
  const canWork=current && (data.canManage||current.assignee===data.login) && current.status!=='archived';
  const choose=batch=>{setDetail(null);setSelected(batch.id)};
  const fileButtons=file=><div className="cw-file" key={file.id}><div><strong>{file.name}</strong><p>Версия {file.version} · <Status value={file.status}/></p></div><div className="task-batch-actions">
    <button className="btn mini" onClick={()=>download(file.id)}>Скачать</button>
    {data.canManage&&file.current?<><button className="btn mini" disabled={busy} onClick={()=>act('mail_draft',{fileId:file.id}).then(value=>setMail({...value,requestId:id()})).catch(()=>{})}>Письмо клиенту</button>
      {file.status!=='approved'&&file.status!=='superseded'?<>
        <button className="btn mini" disabled={busy} onClick={()=>setIncoming({file,body:'',preview:null})}>Клиент внёс правки</button>
        <button className="btn mini primary" disabled={busy} onClick={()=>safe('approve_file',{fileId:file.id})}>Принять без изменений</button>
      </>:null}</>:null}
  </div></div>;
  return <section className="workspace-strip cw-workspace">
    <div className="strip-head"><div><h2>{mode==='periods'?'Периоды, план и задачи':'Наборы СЯ и контента'}</h2><p>План → подготовка СЯ → проверка → клиентское согласование → контент.</p></div>
      <div className="task-batch-actions"><button className="btn" onClick={()=>setCalendar(v=>!v)}>Календарь нагрузки</button>
      {data.canManage&&mode==='periods'?<button className="btn primary" onClick={()=>setCreate({kind:'plan'})}>Создать период и план</button>:null}
      {data.canManage||data.team.tech===data.login?<button className="btn" onClick={()=>setCreate({kind:'standalone'})}>Набор СЯ без периода</button>:null}</div></div>
    <ErrorNote error={error}/>
    {calendar?<WorkflowCalendar portal={portal} people={data.people} login={data.team.tech||data.login} apiRequest={apiRequest} refreshKey={data.events[0]?.id} onOpen={(batch,portalId)=>{if(String(portalId)===String(portal.id))setSelected(batch);else location.assign('/?portal='+portalId+'&tab=tasks&workflow='+batch)}}/>:null}
    {mode==='periods'&&plans.length?<div className="cw-plans">{plans.map(plan=><article className="cw-plan" key={plan.id}>
      <div className="strip-head"><div><h3>{plan.title}</h3><p>{plan.start} — {plan.end} · {plan.cardKeys.length} карточек · версия {plan.version}</p></div><Status value={plan.status} label={plan.status==='approved'?'Клиент согласовал план':'План ждёт подтверждения'}/></div>
      <p>{plan.tasks.map(t=>t.label).join(' · ')}</p><div className="task-batch-actions">
        <button className="btn mini" disabled={busy} onClick={()=>act('export_plan',{periodId:plan.id}).then(r=>download(r.fileId)).catch(()=>{})}>Скачать PDF плана</button>
        {data.canManage&&onExportReport?<button className="btn mini" disabled={plan.end>=today()} title="Доступен после окончания периода" onClick={()=>onExportReport(plan)}>Итоговый отчёт</button>:null}
        {data.canManage?<button className="btn mini" onClick={()=>setCreate({kind:'plan',plan})}>Изменить план</button>:null}
        {data.canManage&&plan.status!=='approved'?<button className="btn mini" onClick={()=>setApproval({plan,day:today(),proof:null,comment:''})}>Клиент согласовал план</button>:null}
        {plan.approval?.proof?<a className="btn mini" href={endpoint+'/proof?portal_id='+portal.id+'&periodId='+plan.id}>Подтверждение клиента</a>:null}
        {data.canManage?<button className="btn mini" disabled={busy} onClick={()=>act('export_plan',{periodId:plan.id}).then(r=>act('mail_draft',{fileId:r.fileId})).then(value=>setMail({...value,requestId:id()})).catch(()=>{})}>Письмо с планом</button>:null}
      </div>{plan.versions?.length>1?<details><summary>Предыдущие версии плана</summary>{plan.versions.filter(v=>v.version!==plan.version).map(v=><p key={v.version}>Версия {v.version} {v.pdfId?<button className="btn mini" onClick={()=>download(v.pdfId)}>PDF</button>:null} {v.proof?<a className="btn mini" href={endpoint+'/proof?portal_id='+portal.id+'&periodId='+plan.id+'&version='+v.version}>Подтверждение</a>:null}</p>)}</details>:null}<p className="status-note">Подбор СЯ начинается при создании периода. Автоматическая работа модели не занимает 8 часов специалиста.</p>
      <div className="cw-plan-tasks">{batches.filter(b=>b.periodId===plan.id&&b.planVersion===plan.version).map(b=><button key={b.id} className="btn" onClick={()=>choose(b)}>{b.title} · {labels[b.status]||b.status}</button>)}</div>
    </article>)}</div>:null}
    <div className="cw-task-grid">{batches.filter(b=>b.status!=='archived'&&(mode!=='periods'||!b.periodId)).map(b=><button key={b.id} className={'cw-task '+(selected===b.id?'selected':'')} onClick={()=>choose(b)}>
      <strong>{b.title}</strong><span>{b.cards.length} карточек · {data.people.find(p=>p.login===b.assignee)?.name||b.assignee}</span><Status value={b.status}/><small>{b.schedule.length?b.schedule.reduce((n,r)=>n+r.minutes,0)+' мин запланировано':'Нужно оценить длительность'}</small>
    </button>)}</div>
    {!batches.length?<p className="cw-empty">Создайте период с выбранными карточками или отдельный набор СЯ. Прежние задачи остаются в своих разделах.</p>:null}
    {current?<article className="cw-detail"><div className="strip-head"><div><h2>{current.title}</h2><p>{current.cards.length} карточек · исполнитель {current.assignee}</p></div><Status value={current.status}/></div>
      {current.parentId?<p className="status-note">СЯ: {byId.get(current.parentId)?.title||current.parentId}. Переоптимизация использует согласованный файл, а не новый рабочий подбор.</p>:null}
      <div className="task-batch-actions">
        {canWork&&!['approved','cancelled'].includes(current.status)?<>
          <button className="btn primary" disabled={busy||['collecting','generating','awaiting_semantic'].includes(current.status)||!current.cards.some(c=>['queued','failed','cancelled'].includes(c.state))} onClick={()=>safe('start',{batchId:current.id})}>{current.kind==='semantic'?'Запустить / продолжить подбор по набору':current.kind==='content'?'Работать · переоптимизировать набор':'Работать'}</button>
          <button className="btn" disabled={busy} onClick={()=>safe('cancel',{batchId:current.id})}>Отменить</button>
        </>:canWork&&current.status==='cancelled'?<button className="btn" disabled={busy} onClick={()=>safe('start',{batchId:current.id})}>Продолжить</button>:null}
        {canWork&&current.kind!=='work'?<button className="btn" disabled={busy||current.cards.some(c=>!c.reviewed)||current.status==='approved'} onClick={()=>safe('export_files',{batchId:current.id})}>Подготовить файл и передать аккаунту</button>:null}
        {current.kind==='semantic'&&data.canManage&&current.status!=='archived'?<button className="btn" onClick={()=>setCreate({kind:'content',parentId:current.id})}>Создать задачу на контент</button>:null}
        {canWork&&current.kind==='content'&&current.cards.some(c=>c.result)&&!['generating','awaiting_semantic'].includes(current.status)?<button className="btn" disabled={busy} onClick={()=>safe('regenerate',{batchId:current.id})}>Переоптимизировать набор · новая версия</button>:null}
        {canWork&&current.kind==='work'&&current.status!=='approved'?<button className="btn" disabled={busy} onClick={()=>safe('start',{batchId:current.id,complete:true})}>Работа выполнена</button>:null}
      </div><ErrorNote error={current.error}/>
      {!current.schedule.length&&canWork?<p className="status-note">Перед проверкой карточек назначьте длительность задачи в календаре.</p>:null}
      <ScheduleForm batch={current} busy={busy||!canWork} onSave={p=>safe('schedule',p)} onRemove={p=>safe('unschedule',p)}/>
      <div className="cw-card-list">{current.cards.map(card=><div className="cw-card" key={card.cardKey}><div><strong>{card.title}</strong><p>{card.cardKey} · <Status value={card.state}/>{card.job?.total?' · '+card.job.completed+'/'+card.job.total+' запросов':''}</p><ErrorNote error={card.error}/></div>
        <div className="task-batch-actions"><button className="btn mini" onClick={()=>{const source=cards.find(c=>keyOf(c)===card.cardKey);if(source)onOpenCard?.(source)}}>Открыть карточку</button>
        {current.kind==='semantic'?<button className="btn mini" disabled={busy||!canWork||!['ready','reviewed'].includes(card.state)||current.status==='approved'} onClick={()=>safe('review_card',{batchId:current.id,cardKey:card.cardKey,generation:current.generation})}>Итог карточки проверен</button>
          :current.kind==='content'&&card.result?<button className="btn mini" disabled={!canWork||current.status==='approved'} onClick={()=>setEditor({card,batch:current,content:structuredClone(card.result)})}>Проверить и исправить контент</button>:null}</div></div>)}</div>
      {current.kind==='semantic'?<p className="status-note">Откройте карточку, проверьте запросы и сохраните итоговое СЯ. Затем подтвердите проверку здесь — в файл попадёт именно этот итог.</p>:null}
      {current.files.map(fileButtons)}
    </article>:selected?<p>Загружаем задачу…</p>:null}
    {batches.some(b=>b.status==='archived')?<details><summary>Задачи прежних версий плана</summary>{batches.filter(b=>b.status==='archived').map(b=><button className="btn mini" key={b.id} onClick={()=>choose(b)}>{b.title} · план v{b.planVersion}</button>)}</details>:null}
    {data.deliveries?.length?<details><summary>Уведомления и доставка писем</summary>{data.deliveries.map(d=><p key={d.id}>{d.kind==='bitrix'?'Б24':'Письмо'} · {labels[d.status]||d.status} · {messages[d.error]||d.error}</p>)}</details>:null}
    {data.events.length?<details className="cw-events"><summary>История: файлы, передачи и согласование</summary>{data.events.map(e=><p key={e.id}><time>{new Date(e.created_at.replace(' ','T')+'Z').toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</time> · {e.actor||'Сервис'} · {eventLabel(e.action)} {e.details.name||e.details.version&&'· версия '+e.details.version||''}</p>)}</details>:null}
    {create?<CreateWorkflow portal={portal} error={error} data={data} cards={cards} initial={create} busy={busy} onClose={()=>setCreate(null)} onSubmit={async payload=>{try{const r=await act(create.kind==='plan'?(create.plan?'revise_plan':'create_plan'):create.kind==='content'?'content_task':'standalone',payload);setCreate(null);if(r.batchId)setSelected(r.batchId)}catch{}}}/>:null}
    {approval?<Modal title={'Клиент согласовал план · версия '+approval.plan.version} onClose={()=>setApproval(null)}><form onSubmit={async e=>{e.preventDefault();try{await act('approve_plan',{periodId:approval.plan.id,version:approval.plan.version,day:approval.day,proof:approval.proof,comment:approval.comment});setApproval(null)}catch{}}}>
      <label className="field-label">Дата согласования<input type="date" required value={approval.day} onChange={e=>setApproval({...approval,day:e.target.value})}/></label>
      <label className="field-label">Подтверждение клиента · до 2 МБ<input type="file" required onChange={async e=>{try{if(e.target.files[0])setApproval({...approval,proof:await attachment(e.target.files[0])})}catch(e){setError(e.message)}}}/></label>
      <label className="field-label">Комментарий<textarea value={approval.comment} onChange={e=>setApproval({...approval,comment:e.target.value})}/></label>
      <ErrorNote error={error}/><button className="btn primary" disabled={busy||!approval.proof}>Сохранить подтверждение</button></form></Modal>:null}
    {editor?<Modal title={'Проверка · '+editor.card.title} onClose={()=>setEditor(null)}><form onSubmit={async e=>{e.preventDefault();try{await act('review_card',{batchId:editor.batch.id,cardKey:editor.card.cardKey,generation:editor.batch.generation,content:editor.content});setEditor(null)}catch{}}}>
      {editor.batch.fields.includes('title')?<label className="field-label">Наименование<textarea required value={editor.content.title||''} onChange={e=>setEditor({...editor,content:{...editor.content,title:e.target.value}})}/></label>:null}
      {editor.batch.fields.includes('description')?<label className="field-label">Описание<textarea required rows={12} value={editor.content.description||''} onChange={e=>setEditor({...editor,content:{...editor.content,description:e.target.value}})}/></label>:null}
      {(editor.content.characteristics||[]).map((c,i)=><label className="field-label" key={i}>{c.name}<input value={c.value} onChange={e=>setEditor({...editor,content:{...editor.content,characteristics:editor.content.characteristics.map((v,n)=>n===i?{...v,value:e.target.value}:v)}})}/></label>)}
      <ErrorNote error={error}/><button className="btn primary" disabled={busy}>Проверено · сохранить</button></form></Modal>:null}
    {mail?<Modal title="Письмо клиенту на согласование" onClose={()=>setMail(null)}><form onSubmit={async e=>{e.preventDefault();try{await act('send_mail',mail);setMail(null)}catch{}}}>
      <p>Вложение: {mail.fileName}</p><label className="field-label">Кому<input type="email" required value={mail.to} onChange={e=>setMail({...mail,to:e.target.value})}/></label>
      <label className="field-label">Тема<input required value={mail.subject} onChange={e=>setMail({...mail,subject:e.target.value})}/></label>
      <label className="field-label">Текст<textarea rows={8} required value={mail.body} onChange={e=>setMail({...mail,body:e.target.value})}/></label>
      {!mail.configured?<p className="status-note">Почта ещё не подключена. Реквизиты добавлены в список необходимых материалов.</p>:null}
      <ErrorNote error={error}/><button className="btn primary" disabled={busy||!mail.configured}>Отправить клиенту</button></form></Modal>:null}
    {incoming?<Modal title="Клиент внёс правки" onClose={()=>setIncoming(null)}><p>{incoming.file.name}. Загрузите возвращённый XLSX из этой задачи.</p>
      <input type="file" accept=".xlsx" onChange={async e=>{try{const file=e.target.files[0];if(!file)return;const value=await attachment(file,8*1024*1024);const body=value.dataUrl.split(',')[1];const preview=await act('import_preview',{fileId:incoming.file.id,body});setIncoming({...incoming,body,preview})}catch(e){setError(e.message)}}}/>
      {incoming.preview?<><p>Изменений: {incoming.preview.changeCount}. {incoming.preview.rejected?'Есть отказы: результат вернётся на доработку.':''}</p>
        <div className="cw-import-changes">{incoming.preview.changes.map((c,i)=><p key={i}>{c.cardKey}: {c.before} → {c.after}</p>)}</div>
        <button className="btn primary" disabled={busy} onClick={()=>act('import_apply',{fileId:incoming.file.id,body:incoming.body,previewHash:incoming.preview.hash}).then(()=>setIncoming(null)).catch(()=>{})}>Применить показанные изменения</button></>:null}<ErrorNote error={error}/></Modal>:null}
    {suggestions?<Modal title="Лимит рабочего дня превышен" onClose={()=>setSuggestions(null)}><p>Занято {suggestions.used} мин, нужно ещё {suggestions.requested} мин. Лимит 480 мин.</p>
      {suggestions.suggestions?.length?<><p>Перенести на свободный день:</p>{suggestions.suggestions.map(s=><button className="btn" key={s.day} disabled={busy} onClick={()=>act('schedule',{batchId:suggestions.batchId,day:s.day,minutes:suggestions.minutes,moveFrom:suggestions.day}).then(()=>setSuggestions(null)).catch(()=>{})}>{s.day} · свободно {s.free} мин</button>)}</>:<p>В пределах периода подходящего дня нет. Разделите работу или скорректируйте даты периода.</p>}</Modal>:null}
  </section>;
}

function Modal({title,onClose,children}){return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal cw-modal"><div className="modal-head"><h2>{title}</h2><button className="btn mini" onClick={onClose} aria-label="Закрыть">×</button></div><div className="modal-body">{children}</div></section></div>}
function CreateWorkflow({data,cards,initial,error,busy,onClose,onSubmit}){
  const [form,setForm]=useState({requestId:id(),title:'',start:today(),end:shift(today(),29),tasks:['semantic_core_collection','content'],cardKeys:[],assignee:data.team.tech||(data.people.find(p=>p.login===data.login&&p.canExecute)||data.people.find(p=>p.canExecute))?.login||'',contact:data.contact,parentId:initial.parentId,fields:['title','characteristics','description'],...(initial.plan?{...initial.plan,periodId:initial.plan.id,tasks:initial.plan.tasks.map(t=>t.key)}:{})});
  const [search,setSearch]=useState('');
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const toggle=(key,value)=>{
    let next=form[key].includes(value)?form[key].filter(v=>v!==value):[...form[key],value];
    if(key==='tasks'&&!form.tasks.includes(value)){if(value==='content')next=next.filter(v=>!['optimized_product_title','optimized_characteristics','optimized_description'].includes(v));else if(['optimized_product_title','optimized_characteristics','optimized_description'].includes(value))next=next.filter(v=>v!=='content')}
    set(key,next);
  };
  return <Modal title={initial.kind==='plan'?(initial.plan?'Новая версия плана':'Новый период и план'):initial.kind==='content'?'Контент по этому набору СЯ':'Набор СЯ без периода'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit(form)}}>
    <label className="field-label">Название<input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Работы на отчётный период"/></label>
    <label className="field-label">Исполнитель<select required value={form.assignee} onChange={e=>set('assignee',e.target.value)}>{data.people.filter(p=>p.canExecute).map(p=><option key={p.login} value={p.login}>{p.name}</option>)}</select></label>
    {initial.kind==='plan'?<><div className="form-two"><label className="field-label">Начало<input type="date" required value={form.start} onChange={e=>set('start',e.target.value)}/></label><label className="field-label">Окончание<input type="date" required value={form.end} min={form.start} onChange={e=>set('end',e.target.value)}/></label></div>
      <fieldset><legend>Контакты клиента</legend>{[['name','Контактное лицо'],['email','Email'],['phone','Телефон']].map(([key,label])=><label className="field-label" key={key}>{label}<input required type={key==='email'?'email':'text'} value={form.contact?.[key]||''} onChange={e=>set('contact',{...form.contact,[key]:e.target.value})}/></label>)}</fieldset>
      <details open><summary>Работы на период</summary><div className="cw-options">{Object.entries(data.taskOptions).map(([key,label])=><label key={key}><input type="checkbox" checked={form.tasks.includes(key)} onChange={()=>toggle('tasks',key)}/>{label}</label>)}</div></details></>:null}
    {initial.kind==='content'?<div className="cw-options">{[['title','Наименование'],['characteristics','Характеристики'],['description','Описание']].map(([key,label])=><label key={key}><input type="checkbox" checked={form.fields.includes(key)} onChange={()=>toggle('fields',key)}/>{label}</label>)}</div>:<>
      <h3>Карточки набора · выбрано {form.cardKeys.length}</h3><input aria-label="Поиск карточек для плана" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Артикул или название"/>
      <div className="task-batch-actions"><button className="btn mini" type="button" onClick={()=>set('cardKeys',cards.slice(0,200).map(keyOf))}>{cards.length>200?'Выбрать первые 200':'Выбрать все'}</button><button className="btn mini" type="button" onClick={()=>set('cardKeys',[])}>Снять выбор</button></div>
      <div className="cw-card-picker">{cards.filter(c=>(c.title+' '+keyOf(c)).toLowerCase().includes(search.toLowerCase())).map(card=><label key={keyOf(card)}><input type="checkbox" checked={form.cardKeys.includes(keyOf(card))} disabled={form.cardKeys.length>=200&&!form.cardKeys.includes(keyOf(card))} onChange={()=>toggle('cardKeys',keyOf(card))}/><span>{card.title}<small>{keyOf(card)}</small></span></label>)}</div></>}
    <p className="status-note">{initial.kind==='content'?'Будет использован согласованный файл СЯ этого набора.':'Подбор запросов начнётся на сервере для выбранного набора после создания. Можно закрыть страницу.'}</p>
    {initial.plan?<p className="status-note">Новая версия потребует повторного подтверждения клиента. Результаты и файлы сохранятся в истории. Подходящие записи календаря перенесутся, остальные освободятся.</p>:null}
    <ErrorNote error={error}/><button className="btn primary" disabled={busy||(initial.kind!=='content'&&!form.cardKeys.length)||(initial.kind==='plan'&&!form.tasks.length)||(initial.kind==='content'&&!form.fields.length)}>{busy?'Сохраняем…':initial.plan?'Сохранить новую версию':'Создать'}</button>
  </form></Modal>;
}

function ScheduleForm({batch,busy,onSave,onRemove}){
  const [day,setDay]=useState(today()),[minutes,setMinutes]=useState(60);
  return <details className="cw-schedule"><summary>Плановая длительность · {batch.schedule.length?batch.schedule.reduce((v,s)=>v+s.minutes,0)+' мин':'нужно оценить'}</summary>
    <form className="cw-schedule-form" onSubmit={e=>{e.preventDefault();onSave({batchId:batch.id,day,minutes:Number(minutes)})}}><label className="field-label">День<input type="date" required value={day} onChange={e=>setDay(e.target.value)}/></label><label className="field-label">Минут на день<input type="number" required min="1" max="480" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><button className="btn" disabled={busy}>Назначить время</button></form>
    <p className="status-note">Работу больше 8 часов распределите на несколько дней. Учитываются все проекты исполнителя.</p>
    {batch.schedule.map(s=><p key={s.id}>{s.day} · {s.minutes} мин <button className="btn mini" disabled={busy} onClick={()=>onRemove({batchId:batch.id,scheduleId:s.id})}>Убрать</button></p>)}
  </details>;
}

function WorkflowCalendar({portal,people,login,apiRequest,onOpen,refreshKey}){
  const [assignee,setAssignee]=useState(login),[start,setStart]=useState(today()),[data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;apiRequest(endpoint+'/calendar?assignee='+encodeURIComponent(assignee)+'&start='+start+'&end='+shift(start,6)).then(r=>{if(active){setData(r);setError('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[assignee,start,portal.id,refreshKey]);
  return <section className="cw-calendar"><div className="strip-head"><h3>Нагрузка по всем клиентам · МСК</h3><div className="task-batch-actions"><select aria-label="Исполнитель в календаре" value={assignee} onChange={e=>setAssignee(e.target.value)}>{people.filter(p=>p.canExecute).map(p=><option key={p.login} value={p.login}>{p.name}</option>)}</select><input type="date" aria-label="Начало недели" value={start} onChange={e=>setStart(e.target.value)}/></div></div><ErrorNote error={error}/>
    <div className="cw-week">{Array.from({length:7},(_,i)=>{const day=shift(start,i),value=data?.days.find(d=>d.day===day);return <div className="cw-day" key={day}><strong>{day.slice(5)}</strong><p>{value?.used||0} / 480 мин</p><progress value={value?.used||0} max={480}/>{value?.tasks.map(t=><button className="cw-calendar-task" key={t.id} onClick={()=>onOpen(t.batch_id,t.portal_id)}>{t.title}<small>{t.minutes} мин</small></button>)}{value&&value.used>value.tasks.reduce((n,t)=>n+t.minutes,0)?<p>Другая занятость: {value.used-value.tasks.reduce((n,t)=>n+t.minutes,0)} мин</p>:null}</div>})}</div>
  </section>;
}

const eventLabel=action=>({content_regenerated:'Создана новая версия контента',plan_revised:'План изменён, требуется новое подтверждение',plan_created:'План создан',plan_approved:'Клиент согласовал план',plan_pdf_created:'PDF плана подготовлен',task_created:'Задача создана',task_started:'Задача запущена',task_cancelled:'Задача отменена',task_scheduled:'Назначено время',schedule_removed:'Время освобождено',card_reviewed:'Карточка проверена',file_created:'Файл подготовлен',file_approved:'Клиент принял файл',file_returned:'Применены клиентские правки',account_downloaded:'Аккаунт забрал файл',file_downloaded:'Файл скачан',mail_queued:'Письмо поставлено в очередь',mail_sent:'Письмо принято почтовым сервером',bitrix_sent:'Уведомление Б24 доставлено'})[action]||action;

export function ContentWorkflowSettings({apiRequest}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState({host:'',port:465,tls:'ssl',from:'',fromName:'',login:'',password:'',replyTo:'',cc:'',signature:''});
  useEffect(()=>{apiRequest(endpoint+'/settings').then(value=>{setData(value);setForm(f=>({...f,...value.smtp,password:''}))}).catch(e=>setError(e.message))},[]);
  async function save(payload){setBusy(true);setError('');try{const next=await apiRequest(endpoint+'/settings',{method:'POST',body:JSON.stringify(payload)});setData(next);setForm(f=>({...f,...next.smtp,password:''}))}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <section className="panel cw-settings"><h2>Клиентские письма и исполнители</h2><p>Секрет почты хранится зашифрованно. Подключение проверяется при отправке; автоматических тестовых писем нет.</p><ErrorNote error={error}/>
    <details><summary>Подключить SMTP · {data?.configured?'настройки сохранены':'не подключено'}</summary><form onSubmit={e=>{e.preventDefault();save({action:'smtp',...form})}}><div className="form-two">{[['host','SMTP-сервер'],['port','Порт'],['login','Логин'],['password','Пароль приложения'],['from','Адрес отправителя'],['fromName','Имя отправителя'],['replyTo','Reply-To'],['cc','Копия письма']].map(([key,label])=><label className="field-label" key={key}>{label}<input type={key==='password'?'password':key==='port'?'number':'text'} autoComplete="off" required={['host','port','login','from'].includes(key)} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}</div><label className="field-label">Защита<select value={form.tls} onChange={e=>setForm({...form,tls:e.target.value})}><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option></select></label><label className="field-label">Подпись<textarea value={form.signature} onChange={e=>setForm({...form,signature:e.target.value})}/></label><button className="btn primary" disabled={busy}>Сохранить подключение</button></form></details>
    <details><summary>Б24 и рабочие дни исполнителей</summary><button className="btn" disabled={busy} onClick={()=>save({action:'retry_blocked_bitrix'})}>Повторить уведомления, ожидавшие настройки</button><p>Укажите действительный ID сотрудника в Б24. Рабочая неделя по умолчанию — понедельник–пятница.</p>{data?.people.map(person=><PersonSettings key={person.login} person={person} busy={busy} onSave={p=>save({action:'person',...p})}/>)}</details>
  </section>;
}
function PersonSettings({person,busy,onSave}){
  const [bitrixId,setBitrix]=useState(person.bitrixId||''),[weekdays,setDays]=useState(person.weekdays);
  return <form className="cw-person" onSubmit={e=>{e.preventDefault();onSave({login:person.login,bitrixId,weekdays})}}><strong>{person.name}</strong><input type="number" aria-label={'ID Б24 · '+person.name} placeholder="ID Б24" min="1" value={bitrixId} onChange={e=>setBitrix(e.target.value)}/><div className="cw-options">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((day,i)=><label key={day}><input type="checkbox" checked={weekdays.includes(i)} onChange={()=>setDays(v=>v.includes(i)?v.filter(n=>n!==i):[...v,i])}/>{day}</label>)}</div><button className="btn mini" disabled={busy||!weekdays.length}>Сохранить сотрудника</button></form>;
}

export function LegacySemanticBatchButton({portalId,group,apiRequest}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function start(){
    setBusy(true);setError('');
    try{
      const cardKeys=[...new Set((group.tasks||[]).map(task=>String(task.cardKey||task.nmID||task.sku||'')).filter(Boolean))];
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cardKeys.slice().sort().join('|')+'|'+(group.batchId||group.key)));
      const requestId='legacy-'+[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
      const value=await apiRequest(endpoint,{method:'POST',body:JSON.stringify({action:'standalone',portalId,requestId,cardKeys,title:group.title||group.batchTitle||'СЯ по набору карточек'})});
      window.dispatchEvent(new CustomEvent('opticards-open-workflow',{detail:{portalId,batchId:value.batchId}}));
      document.querySelector('.cw-workspace')?.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <div><button className="btn" disabled={busy||!group.tasks?.length} onClick={start}>{busy?'Ставим в очередь…':'Подобрать запросы по всем карточкам'}</button><ErrorNote error={error}/></div>;
}
