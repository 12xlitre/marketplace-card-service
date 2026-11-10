import {useEffect,useRef,useState} from 'react';
import {Mail,Send,RefreshCw,ExternalLink,Link2,ArrowDownLeft,ArrowUpRight,Paperclip,Search,Check,X} from 'lucide-react';
import './clientMail.css';
const endpoint='/api/content-workflow';
export const mailError=error=>({forbidden:'Переписка доступна аккаунту кабинета и руководителю.',crm_scope_required:'В настройках существующего вебхука Б24 добавьте право «CRM». Пароль почты сервису не нужен.',crm_deal_owner_required:'Эту сделку должен привязать администратор. Аккаунт может выбирать свои сделки после настройки его ID Б24 в администрировании.',crm_access_denied:'Б24 не разрешил доступ. Проверьте право CRM у вебхука и доступ его владельца к сделке.',crm_not_configured:'Подключите существующий вебхук Б24 в администрировании.',crm_deal_required:'Сначала привяжите сделку во вкладке «Почта» этого кабинета.',crm_invalid_deal:'Введите ID или ссылку на сделку вашего Б24.',crm_deal_not_found:'Сделка не найдена или недоступна владельцу вебхука.',crm_portal_changed:'Адрес Б24 изменился. Проверьте привязку кабинета заново.',crm_delivery_pending:'Сначала дождитесь отправки писем и проверьте отправления с неопределённым результатом.',crm_unavailable:'Б24 временно недоступен. Обновите переписку немного позже.',crm_request_rejected:'Б24 отклонил запрос. Проверьте доступ к сделке и подключение ящика к CRM.',workflow_version_conflict:'Данные изменились. Обновите страницу и проверьте сделку и файл.',workflow_delivery_unknown:'Отправка не подтверждена. Проверьте письмо в сделке Б24; автоматический повтор отключён.',workflow_invalid_email:'Проверьте адрес, тему и текст письма.'})[error]||'Не удалось выполнить действие. Обновите страницу и повторите.';
const statusLabel={pending:'В очереди',sending:'Передаём в Б24',sent:'Передано в Б24',failed:'Ошибка отправки',uncertain:'Нужно проверить отправку'};
const date=value=>{const d=new Date(value?.includes('T')?value:value?.replace(' ','T')+'Z');return isNaN(d)?value:d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})};
const newId=()=>globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);
const dealError=error=>({crm_account_mapping_required:'Для вашего профиля ещё не указан ID Б24. Попросите администратора указать его в разделе «Клиентские письма и исполнители». После настройки здесь появятся ваши сделки.',crm_deal_category_required:'Выберите сделку из воронки «Аккаунтинг». Возможно, выбранную сделку перенесли в другую воронку.',crm_invalid_search:'Введите название или номер сделки, не более 160 символов.'})[error]||mailError(error);

function CrmDealPicker({portalId,apiRequest,busy,onChoose}){
 const [query,setQuery]=useState(''),[closed,setClosed]=useState(false),[result,setResult]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[preview,setPreview]=useState(null),[choosing,setChoosing]=useState(false),[selected,setSelected]=useState(null);
 const sequence=useRef(0),selectionSequence=useRef(0);
 async function load(start=0,append=false,stamp=++sequence.current){
  setLoading(true);setError('');
  try{
   const params=new URLSearchParams({portalId:String(portalId),q:query,start:String(start),closed:closed?'1':'0'});
   const next=await apiRequest(endpoint+'/crm-deals?'+params);
   if(stamp!==sequence.current)return;
   setResult(prev=>append&&prev?{...next,deals:[...new Map([...prev.deals,...next.deals].map(v=>[v.dealId,v])).values()]}:next);
  }catch(e){if(stamp===sequence.current)setError(e.message)}finally{if(stamp===sequence.current)setLoading(false)}
 }
 useEffect(()=>{
  const stamp=++sequence.current;selectionSequence.current++;setPreview(null);setSelected(null);setChoosing(false);setResult(null);setLoading(true);setError('');
  const timer=setTimeout(()=>load(0,false,stamp),query?350:0);
  return()=>{clearTimeout(timer);sequence.current++;selectionSequence.current++};
 },[portalId,query,closed]);
 function changeSearch(value){selectionSequence.current++;sequence.current++;setPreview(null);setSelected(null);setChoosing(false);setResult(null);setQuery(value)}
 async function choose(deal){
  const stamp=++selectionSequence.current;setSelected(deal.dealId);setPreview(null);setChoosing(true);setError('');
  try{
   const next=await apiRequest(endpoint,{method:'POST',body:JSON.stringify({portalId,action:'preview_deal',dealId:deal.dealId})});
   if(stamp===selectionSequence.current)setPreview(next);
  }catch(e){if(stamp===selectionSequence.current){setError(e.message);setSelected(null)}}finally{if(stamp===selectionSequence.current)setChoosing(false)}
 }
 return <div className="cm-deal-picker">
  <div className="cm-deal-heading"><div><strong>Сделки · Аккаунтинг</strong><p>{result?.ownOnly===false?'Администратору доступны все сделки этой воронки.':'Здесь только сделки, где вы ответственный в Б24.'}</p></div><button className="btn mini" disabled={busy||loading||choosing} onClick={()=>{selectionSequence.current++;setPreview(null);setSelected(null);setResult(null);load()}}><RefreshCw size={14}/>Обновить сделки</button></div>
  <label className="cm-deal-search"><Search size={18}/><input type="search" aria-label="Найти сделку в Аккаунтинге" placeholder="Название или номер сделки" maxLength={160} value={query} disabled={busy} onChange={e=>changeSearch(e.target.value)}/></label>
  <label className="cm-deal-closed"><input type="checkbox" checked={closed} disabled={busy} onChange={e=>{selectionSequence.current++;sequence.current++;setPreview(null);setSelected(null);setResult(null);setChoosing(false);setClosed(e.target.checked)}}/>Показать также завершённые сделки</label>
  {error?<p className="cm-error" role="alert">{dealError(error)}</p>:null}
  <div className="cm-deal-grid" aria-label="Сделки воронки Аккаунтинг" aria-busy={loading}>
   {result?.deals.map(deal=><button type="button" key={deal.dealId} className={'cm-deal-card '+(selected===deal.dealId?'selected':'')} aria-pressed={selected===deal.dealId} disabled={busy||loading||choosing} onClick={()=>choose(deal)}><span className="cm-deal-number">№{deal.dealId}{selected===deal.dealId?<Check size={16}/>:<Link2 size={15}/>}</span><strong>{deal.title||'Сделка без названия'}</strong><span className={'cm-deal-status '+deal.status}>{({active:'В работе',won:'Успешно завершена',closed:'Завершена'})[deal.status]}</span></button>)}
  </div>
  {loading?<p className="cm-muted" role="status">Загружаем сделки…</p>:!error&&!result?.deals.length?<div className="cm-deal-empty">{query?'По этому запросу сделок не найдено. Попробуйте другое название или номер.':'Активных сделок пока нет. Можно включить завершённые или проверить ответственного в Б24.'}</div>:null}
  {result?.next!=null?<button className="btn cm-older" disabled={busy||loading||choosing} onClick={()=>load(result.next,true)}>Показать ещё сделки</button>:null}
  {choosing?<p className="cm-muted" role="status">Проверяем выбранную сделку…</p>:null}
  {preview?<div className="cm-preview"><span className="cm-muted">Связать с кабинетом</span><strong>{preview.title} · №{preview.dealId}</strong><p>{preview.email||'Адрес клиента возьмём из контактов кабинета.'}</p><div className="cm-actions"><button className="btn primary" disabled={busy||loading||choosing} onClick={()=>onChoose(preview)}><Link2 size={16}/>Привязать эту сделку</button><button className="btn" disabled={busy} onClick={()=>{selectionSequence.current++;setPreview(null);setSelected(null)}}>Отмена</button></div></div>:null}
 </div>
}

export function MailComposer({draft,portalId,apiRequest,onClose,onSent}){
 const [form,setForm]=useState(()=>({...draft,requestId:newId()})),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function send(e){e.preventDefault();setBusy(true);setError('');try{await apiRequest(endpoint,{method:'POST',body:JSON.stringify({...form,portalId,action:'send_mail'})});onSent?.();onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <form className="cm-compose" onSubmit={send}>
  {form.deal?<p>Из сделки: <a href={form.deal.url} target="_blank" rel="noopener noreferrer">{form.deal.title} · №{form.deal.dealId}</a></p>:<p className="cm-note">Сначала откройте <a href={'/?portal='+portalId+'&tab=mail'}>«Почту»</a> и привяжите сделку Б24.</p>}
  <p className="cm-muted">Отправитель — подключённый к CRM ящик Б24. Письмо появится в сделке.</p>
  {form.fileName?<div className="cm-attachment"><Paperclip size={16}/>{form.fileName}</div>:null}
  <label className="field-label">Кому<input type="email" required value={form.to} onChange={e=>setForm({...form,to:e.target.value})}/></label>
  <label className="field-label">Тема<input required maxLength={300} value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})}/></label>
  <label className="field-label">Текст<textarea aria-label="Текст" required maxLength={14000} rows={9} value={form.body} onChange={e=>setForm({...form,body:e.target.value})}/></label>
  {error?<p className="cm-error" role="alert">{mailError(error)}</p>:null}
  <div className="cm-actions"><button className="btn" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="btn primary" disabled={busy||!form.configured}><Send size={16}/>{busy?'Отправляем…':'Отправить через Б24'}</button></div>
 </form>
}

export default function ClientMail({portal,apiRequest}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[linkEdit,setLinkEdit]=useState(false),[selected,setSelected]=useState(null),[draft,setDraft]=useState(null),[filter,setFilter]=useState('all'),[query,setQuery]=useState('');
 const scope=useRef(0),loading=useRef(false);
 async function action(action,values={}){return apiRequest(endpoint,{method:'POST',body:JSON.stringify({portalId:portal.id,action,...values})})}
 async function load(older=false){
  if(loading.current)return;loading.current=true;const current=scope.current;setBusy(true);
  try{const next=await apiRequest(endpoint+'/mail?portalId='+portal.id+(older&&data?.before?'&before='+data.before:''));if(current!==scope.current)return;setError('');setData(prev=>prev&&prev.link?.id===next.link?.id&&!next.error?{...next,hasMore:older?next.hasMore:prev.messages.length>50?prev.hasMore:next.hasMore,before:older?next.before:prev.before||next.before,messages:[...new Map([...(prev?.messages||[]),...next.messages].map(v=>[v.id,v])).values()].sort((a,b)=>Number(b.id)-Number(a.id))}:next)}catch(e){if(current===scope.current)setError(e.message)}finally{if(current===scope.current){setBusy(false);loading.current=false}}
 }
 useEffect(()=>{scope.current++;setData(null);setSelected(null);setDraft(null);setLinkEdit(false);loading.current=false;load();const timer=setInterval(()=>{if(!document.hidden)load()},45000);return()=>{scope.current++;clearInterval(timer);loading.current=false}},[portal.id]);
 async function bind(unlink=false,choice=null){const current=scope.current;setBusy(true);setError('');try{await action(unlink?'unlink_deal':'link_deal',{dealId:choice?.dealId,previousLinkId:data?.link?.id||''});if(current!==scope.current)return;setLinkEdit(false);setSelected(null);await load()}catch(e){if(current===scope.current)setError(e.message)}finally{if(current===scope.current)setBusy(false)}}
 async function compose(reply){setError('');try{const value=await action('mail_draft');if(reply){value.to=reply.direction==='in'&&reply.addresses[0]?reply.addresses[0]:value.to;value.subject=/^re:/i.test(reply.subject)?reply.subject:'Re: '+reply.subject;value.body='\n\n'+date(reply.date)+', '+reply.addresses.join(', ')+':\n'+reply.body.split('\n').map(s=>'> '+s).join('\n').slice(0,9000)}setDraft(value)}catch(e){setError(e.message)}}
 const messages=data?.messages.filter(m=>(filter==='all'||m.direction===filter)&&(!query||(m.subject+' '+m.body+' '+m.addresses.join(' ')).toLowerCase().includes(query.toLowerCase())))||[];
 const message=data?.messages.find(m=>m.id===selected)||messages[0];
 return <section className="panel cm-workspace">
  <div className="cm-heading"><div><div className="cm-eyebrow"><Mail size={16}/>ПОЧТА КЛИЕНТА</div><h2>Почта</h2><p className="cm-muted">Письма из сделки Б24 · {portal.name}</p></div><div className="cm-actions"><button className="btn" disabled={busy} onClick={()=>load()}><RefreshCw size={16}/>Обновить</button>{data?.canManage&&data.link?<button className="btn primary" disabled={busy||Boolean(data.error)} onClick={()=>compose()}><Send size={16}/>Написать письмо</button>:null}</div></div>
  {error||data?.error?<p className="cm-error" role="alert">{dealError(error||data.error)}</p>:null}
  {data?.link?<div className="cm-binding"><Link2 size={18}/><div><span className="cm-muted">Связанная сделка</span><strong>{data.link.title} · №{data.link.dealId}</strong></div><a className="btn mini" href={data.link.url} target="_blank" rel="noopener noreferrer">В Б24<ExternalLink size={14}/></a>{data.canManage?<button className="btn mini" disabled={busy} onClick={()=>setLinkEdit(!linkEdit)}>{linkEdit?'Закрыть выбор':'Изменить'}</button>:null}</div>:null}
  {data&&(!data.link||linkEdit)?<div className="cm-connect"><h3>{data.link?'Изменить привязку':'Связать кабинет со сделкой'}</h3><p>Здесь будет вся почтовая переписка выбранной сделки. Проверьте клиента перед привязкой. Ящик должен быть подключён к Б24 с интеграцией в CRM.</p>
   {data.canManage?<><CrmDealPicker key={portal.id+':'+(data.link?.id||'new')} portalId={portal.id} apiRequest={apiRequest} busy={busy} onChoose={choice=>bind(false,choice)}/>{data.link?<button className="btn mini" disabled={busy} onClick={()=>bind(true)}>Снять привязку</button>:null}</>:<p>Привязку выполняет аккаунт кабинета.</p>}
  </div>:null}
  {data?.deliveries.length?<details className="cm-deliveries"><summary>Отправления из сервиса · {data.deliveries.length}</summary>{data.deliveries.map(d=><div key={d.id}><span>{date(d.created_at)} · {statusLabel[d.status]||d.status}</span>{d.error?<p className="cm-muted">{mailError(d.error)}</p>:null}{d.status==='uncertain'&&data.canManage?<button className="btn mini" disabled={busy} onClick={async()=>{setBusy(true);try{await action('reconcile_mail',{deliveryId:d.id});await load()}catch(e){setError(e.message)}finally{setBusy(false)}}}>Проверить отправку в Б24</button>:null}</div>)}</details>:null}
  {data?.link?<><div className="cm-toolbar"><div className="cm-filters" role="group" aria-label="Направление писем">{[['all','Все'],['in','Входящие'],['out','Исходящие']].map(([value,label])=><button className={'btn mini '+(filter===value?'active':'')} key={value} onClick={()=>{setFilter(value);setSelected(null)}}>{label}</button>)}</div><input type="search" aria-label="Поиск в загруженных письмах" placeholder="Найти в письмах" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <div className="cm-reader"><div className="cm-list" aria-label="Список писем">{messages.map(m=><button className={'cm-letter '+(message?.id===m.id?'selected':'')} key={m.id} onClick={()=>setSelected(m.id)}><span className={'cm-direction '+m.direction}>{m.direction==='in'?<ArrowDownLeft size={14}/>:<ArrowUpRight size={14}/>} {m.direction==='in'?'Входящее':'Исходящее'}<time>{date(m.date)}</time></span><strong>{m.subject||'Без темы'}</strong><span className="cm-snippet">{m.body.slice(0,110)}</span></button>)}{!messages.length?<div className="cm-empty"><Mail size={26}/><p>{data.error?'Не удалось загрузить письма.':'Писем пока нет.'}</p><span>Здесь появляются письма, привязанные в Б24 к этой сделке.</span></div>:null}{data.hasMore?<button className="btn cm-older" disabled={busy} onClick={()=>load(true)}>Загрузить предыдущие</button>:null}</div>
    <article className="cm-message">{message?<><div className="cm-message-head"><span className={'cm-direction '+message.direction}>{message.direction==='in'?'Входящее':'Исходящее'} · {date(message.date)}</span><h3>{message.subject||'Без темы'}</h3><p>{message.addresses.join(', ')}</p></div><div className="cm-body">{message.body||'Текст письма недоступен в CRM. Откройте сделку в Б24.'}</div>{message.hasAttachments?<p className="cm-attachment"><Paperclip size={16}/>Вложения доступны в сделке Б24</p>:null}{data.canManage?<button className="btn" disabled={busy||Boolean(data.error)} onClick={()=>compose(message)}>Ответить</button>:null}</>:<div className="cm-empty">Выберите письмо для просмотра</div>}</article>
   </div><p className="cm-footnote">Обновление каждые 45 секунд, пока вкладка открыта. {data.error?'Последняя попытка: ':'Проверено: '}{date(data.checkedAt)}. Ответ появится после синхронизации почты с CRM. Если письма нет, проверьте его привязку к этой сделке в Б24.</p></>:null}
  {!data&&!error?<p>Загружаем переписку…</p>:null}
  {draft?<div className="cm-overlay"><div className="cm-modal" role="dialog" aria-modal="true" aria-label="Новое письмо"><div className="cm-heading"><h3>Письмо из сделки</h3><button className="btn mini" aria-label="Закрыть письмо" onClick={()=>setDraft(null)}><X size={18}/></button></div><MailComposer draft={draft} portalId={portal.id} apiRequest={apiRequest} onClose={()=>setDraft(null)} onSent={()=>load()}/></div></div>:null}
 </section>
}
