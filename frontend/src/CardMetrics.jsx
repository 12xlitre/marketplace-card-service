import {useEffect,useState} from 'react';

const format=(value,money=false)=>new Intl.NumberFormat('ru-RU',money?{style:'currency',currency:'RUB',maximumFractionDigits:2}:{maximumFractionDigits:2}).format(value);
const date=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T12:00:00Z'));
const sourceStatus={access_denied:'нет доступа к статистике — проверьте права API',rate_limited:'достигнут лимит запросов, повторите позже',unavailable:'источник временно недоступен',invalid_response:'источник вернул неполные данные',not_connected:'источник не подключён',no_data:'нет данных по этому товару',incomplete:'получена только часть данных; используем резервный источник'};

export default function CardMetrics({portal,card,apiRequest}){
  const cardKey=String(card?.cardKey||card?.nmID||card?.sku||card?.id||'');
  const identity=String(portal?.id)+':'+cardKey;
  const [data,setData]=useState(null),[state,setState]=useState('loading'),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let active=true;setState('loading');setData(null);if(!portal?.id||portal.isDemo||!cardKey){setState('empty');return()=>{active=false}}
    apiRequest('/api/portals/'+encodeURIComponent(portal.id)+'/card-metrics?'+new URLSearchParams({card_key:cardKey})).then(result=>{if(active){setData({identity,...result});setState('ready')}}).catch(()=>{if(active)setState('error')});return()=>{active=false};
  },[portal?.id,cardKey,refresh]);
  const current=data?.identity===identity?data:null;
  const metrics=current?.metrics||{};
  const rows=[['rating','Рейтинг покупателей'],['feedbacks','Отзывы'],['sales',current?.salesLabel||'Продажи'],['revenue',current?.revenueLabel||'Выручка']];
  return <section className="workspace-strip card-metrics" aria-label="Показатели товара">
    <div className="strip-head"><div><h2>Рейтинг, отзывы и продажи</h2><p>{current?'Продажи и выручка за 30 дней: '+date(current.period.start)+' — '+date(current.period.end)+'. Рейтинг и отзывы — на дату обновления.':'Продажи и выручка за последние 30 завершённых дней.'}</p></div><button className="btn mini" disabled={state==='loading'} onClick={()=>setRefresh(n=>n+1)}>{state==='loading'?'Загружаем…':'Обновить показатели'}</button></div>
    <div className="commerce-summary">{rows.map(([key,label])=>{const metric=metrics[key];return <div key={key}><span>{metric?.label||label}</span><strong>{metric?format(metric.value,key==='revenue'):'—'}</strong><small>{metric?.source||(state==='loading'?'Загружаем…':'Нет данных')}</small></div>})}</div>
    {state==='error'?<p className="form-error" role="alert">Не удалось загрузить показатели. Повторите обновление.</p>:null}
    {current?.sources.filter(s=>s.status!=='ok').map(s=><p className="status-note" key={s.name}>{s.name}: {sourceStatus[s.status]||'данные недоступны'}.</p>)}
    {current?.updatedAt?<p className="status-note">Обновлено {new Date(current.updatedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК.</p>:null}
  </section>;
}
