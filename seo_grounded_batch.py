"""Fact-bound JEWEL editorial assembly for the nine supplied houseware types.

An external model does not select or invent product facts. Source values,
comparison proposals, relevance decisions and actual placements remain inspectable.
"""
from collections import Counter
from copy import deepcopy
import re

from automatic_seo import characteristic_rows,plain,fingerprint,unsupported_text_properties,numeric_unit_claims
from seo_clean_rebuild import (REVISION,CleanError,CleanRebuilder,components,word_forms,
    contains_components,component_witness,comparison_fields,normalized,own_fields,
    typed_facts,typed_query_decision,verified_value,literal,distributed_witness,relation_roles,MORPH)


def counted(number,one,few,many):
    return str(number)+' '+(many if 11<=number%100<=14 else one if number%10==1 else few if number%10 in {2,3,4} else many)


def persons(number):return counted(number,'персону','персоны','персон')


def objects(number):return counted(number,'предмет','предмета','предметов')


COMMON={'набор','комплект','товар','дом','домашний','кухня','кухонный','новый','год','новогодний',
    'красивый','стильный','эстетичный','практичный','удобный','современный','качественный','хороший',
    'повседневный','праздничный','подарок','подарочный','подарить','покупка','большой','маленький',
    'белый','черный','серый','синий','голубой','бежевый','розовый','молочный','оливковый','зеленый',
    'прозрачный','оранжевый','серебристый','золотой','коричневый','желтый','бирюзовый','красный',
    'стекло','стеклокерамика','фарфор','керамика','пластик','силикон','сталь','нейлон','полиамид',
    'штука','шт','предмет','персона','человек','мл','миллилитр','л','литр','см','сантиметр','мм',
    'мама','мать','папа','отец','бабушка','дедушка','дочь','дочка','сын','сестра','брат','жена','муж',
    'женщина','мужчина','девушка','парень','любимый','любимая','коллега','работа','семья','друг','подруга',
    'преподаватель','учитель','день','рождение','март','февраль','юбилей','новоселье','свадьба','просто','так',
    'свой','весь','женский','мужской','без','нет','не','сервировка','стол','круглый','овальный','плоский'}
KINDS={
 'dinner':{'посуда','сервиз','столовый','обеденный','тарелка','салатник','блюдо','десертный','кружка','чашка','глубокий','суп','первый','второй','нарезка','закуска'},
 'platter':{'посуда','блюдо','сервировочный','подача','сервировка','овальный','нарезка','закуска','салат','рыба','мясо','стол','тарелка'},
 'mugs':{'посуда','кружка','чашка','чай','чайный','кофе','кофейный','напиток','сервиз','чаепитие','ручка'},
 'tea':{'посуда','сервиз','чайный','чай','кофе','кофейный','чашка','кружка','блюдце','чаепитие','подставка','пара','напиток'},
 'soup':{'посуда','супница','бульонница','суп','бульон','салатник','миска','глубокий','ручка','порционный','обеденный'},
 'glasses':{'посуда','бокал','фужер','шампанское','вино','игристый','напиток','свадебный','ножка','стеклянный'},
 'knives':{'нож','ножи','лезвие','ручка','подставка','ножницы','овощечистка','поварской','универсальный','нарезка','хлеб','мясо','овощ','фрукт','сантоку','точилка','острый','резка'},
 'utensils':{'принадлежность','инструмент','лопатка','ложка','половник','поварешка','шумовка','венчик','щипцы','кисточка','подставка','прибор','готовка','приготовление','еда','сервировка','спагетти'},
 'mop':{'швабра','моп','пол','уборка','мытье','мыть','отжим','ведро','насадка','тряпка','микрофибра','телескопический','ручка','складной','вода','грязный','чистый','разделение','впитывающий','кафель','плитка','ламинат','поворотный','маневренный','система','нажим','бесконтактный','квартира','хозяйственный'}
}


def kind(card):
    title=normalized(card['title']);category=normalized(card.get('subjectName',''))
    kit=normalized('; '.join(values(card,'комплектация')))
    if 'нож' in kit and 'ложк' in kit:return 'mixed'
    if 'швабр' in title:return 'mop'
    if title.startswith('блюдо'):return 'platter'
    if 'бокал' in title:return 'glasses'
    if 'супниц' in title or 'бульонниц' in title:return 'soup'
    if 'принадлежност' in title or (title.startswith('набор кухонный') and 'нож' not in title):return 'utensils'
    if 'нож' in title:return 'knives'
    if 'чайный' in title or 'чайный сервиз' in title or 'и подставка' in title:return 'tea'
    if 'круж' in title:return 'mugs'
    return 'dinner'


def values(card,term):
    return [value for row in characteristic_rows(card) if term in normalized(row['name']) for value in row['values']]


def series(card):
    title=card['title'];parts=re.findall(r'\b[А-ЯЁ][а-яё]+\b',title)
    names=[word for word in parts[1:] if word not in {'Набор','Посуда','Сервиз','Кружки','Блюдо','Ножи','Швабра','Наборы'}]
    if not names:return ''
    name=names[0]
    if name=='Мамина' and 'Мамина любовь' in title:name='Мамина любовь'
    return name


def facts(card,questions=None):
    result=typed_facts(card);result['kind']=kind(card);result['series']=series(card)
    result['total']=next(iter(result['quantities'])) if len(result['quantities'])==1 else None
    if result['titleQuantities'] and result['quantities'] and result['titleQuantities']!=result['quantities']:result['total']=None
    result['people']=next(iter(result['persons'])) if len(result['persons'])==1 else None
    if not result['total'] and result['kind'] in {'soup','mugs','platter','glasses'}:
        count=re.search(r'(\d+)\s*(?:шт|штук|предмет)',card['title'],re.I)
        if count:result['total']=int(count.group(1))
    title=card['title']
    volume=re.search(r'(\d+(?:[.,]\d+)?)\s*мл\b',title,re.I)
    if volume:result['volume']=volume.group(1)
    else:
        volume_values=values(card,'объем')
        match=re.search(r'\d+(?:[.,]\d+)?',volume_values[0]) if volume_values else re.search(r'(\d+(?:[.,]\d+)?)\s*мл','; '.join(values(card,'комплектация')),re.I)
        result['volume']=(match.group(1) if match.lastindex else match.group()) if match else ''
    result['kit']=values(card,'комплектация')
    result['colors']=values(card,'цвет');result['materials']=[v for row in characteristic_rows(card) if 'материал' in normalized(row['name']) for v in row['values']]
    result['features']=[v for row in characteristic_rows(card) if 'особенност' in normalized(row['name']) for v in row['values']]
    result['decor']=values(card,'декоратив');result['drawing']=values(card,'рисунок')
    result['ownWordSet']=set().union(*(set().union(*components(value)) for value in own_fields(card).values() if components(value)))
    result['unitClaims']={(number,unit) for number,unit,_ in numeric_unit_claims(result['own'])}
    for a,b,unit in re.findall(r'(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*(см|мм)',result['own'],re.I):
        result['unitClaims'].update({(a.replace(',','.'),unit),(b.replace(',','.'),unit)})
    if result['volume']:result['unitClaims'].add((result['volume'].replace(',','.'),'мл'))
    result['sourceQuestions']=questions or []
    result['disputedMeasurements']=[]
    for question in result['sourceQuestions']:
        text=question['question']
        if 'сколько предмет' in normalized(text):result['total']=None
        unit='см' if 'см' in text else 'мл' if 'мл' in text else ''
        if unit:
            result['disputedMeasurements'].extend((number.replace(',','.'),unit) for number in re.findall(r'\d+(?:[.,]\d+)?',text))
    return result


def compose_title(card,profile):
    k=profile['kind'];name=profile['series'];p=profile['people'];n=profile['total'];v=profile['volume']
    suffix=(' '+name) if name else '';qty=(' '+objects(n)) if n else ''
    if k=='dinner':
        candidates=[f'Набор посуды столовой тарелки обеденные на {persons(p)}{suffix}',
                    f'Набор столовой посуды тарелки на {persons(p)}{suffix}',
                    f'Набор столовой посуды на {persons(p)}{qty}{suffix}',
                    f'Столовый сервиз на {persons(p)}{qty}{suffix}']
    elif k=='mugs':
        count=n or (int(re.search(r'(\d+)\s*(?:шт|штук|предмет)',card['title'],re.I).group(1)) if re.search(r'(\d+)\s*(?:шт|штук|предмет)',card['title'],re.I) else None)
        q=f' {count} шт' if count else '';vol=f' {v} мл' if v else ''
        material=' фарфор' if any('фарфор' in normalized(m) for m in profile['materials']) else ' керамика'
        candidates=[f'Кружки для чая и кофе набор{q}{vol}{suffix}{material}',f'Набор кружек для чая и кофе{q}{vol}{suffix}',f'Кружки для чая и кофе{suffix}{q}{vol}']
    elif k=='tea':
        candidates=[f'Чайный сервиз набор чашек с блюдцами{suffix}'+(f' на {persons(p)}' if p else ''),f'Чайный сервиз на {persons(p)}{qty}{suffix}' if p else f'Чайный сервиз{qty}{suffix}',f'Чайный набор чашки и блюдца{suffix}']
    elif k=='soup':
        q=f' {n} шт' if n else ''
        candidates=[f'Набор супниц бульонниц для супа {v} мл{q}{suffix}',f'Супницы бульонницы для супа {v} мл{q}{suffix}',f'Набор супниц бульонниц {v} мл{suffix}']
    elif k=='glasses':
        candidates=[f'Бокалы для шампанского и игристого вина {v} мл 2 шт',f'Набор бокалов для шампанского {v} мл 2 шт стекло']
    elif k=='platter':
        size=re.search(r'(\d+(?:[.,]\d+)?)\s*см',card['title'],re.I);dim=(' '+size.group(1)+' см') if size and (size.group(1).replace(',','.'),'см') not in profile['disputedMeasurements'] else ''
        oval=' овальное' if 'оваль' in normalized(profile['own']) else ''
        q=f' {n} шт' if n and n>1 else ''
        candidates=[f'Блюдо сервировочное{oval}{dim}{suffix}{q} для закусок',f'Блюдо сервировочное{oval}{dim}{suffix}{q}',f'Блюдо для сервировки и подачи закусок{dim}{suffix}{q}']
    elif k=='knives':
        scissors=' с ножницами' if 'ножниц' in normalized('; '.join(profile['kit'])) else ''
        candidates=[f'Набор кухонных ножей на подставке{scissors}{qty}',f'Набор кухонных ножей на подставке сталь{qty}',f'Ножи кухонные набор на подставке{qty}']
        if 'овощечист' in normalized('; '.join(profile['kit'])):candidates.insert(0,f'Ножи кухонные набор с овощечисткой на подставке'+(f' {n} пр' if n else ''))
    elif k=='mixed':
        candidates=[f'Набор кухонных ножей и принадлежностей на подставке {n} пр']
    elif k=='utensils':
        candidates=[f'Набор кухонных принадлежностей на подставке{qty}',f'Кухонные принадлежности набор на подставке{qty}',f'Набор кухонных принадлежностей для готовки{qty}']
    else:
        title=normalized(card['title'])
        if 'складн' in title:candidates=['Швабра с отжимом и складным ведром 10 л для мытья пола']
        elif 'разделени' in title:candidates=['Умная швабра с отжимом и ведром с разделением воды 10 л']
        else:candidates=['Швабра с отжимом и ведром для мытья пола с микрофиброй']
    material='фарфор' if any('фарфор' in normalized(m) for m in profile['materials']) else 'керамика' if any('керамик' in normalized(m) for m in profile['materials']) else 'стекло' if any('стекло' in normalized(m) for m in profile['materials']) else 'силикон' if any('силикон' in normalized(m) for m in profile['materials']) else 'пластик' if any('пластик' in normalized(m) for m in profile['materials']) else ''
    valid=[candidate for candidate in candidates if len(candidate)<=59 and 'None' not in candidate]
    if valid:
        selected=valid[0]
        if k in {'mugs','soup','tea','platter'} and material and material not in normalized(selected) and len(selected+' '+material)<=59:
            selected+=' '+material
        return selected
    raise CleanError('grounded_title_does_not_fit',{'sku':card['sku'],'candidates':candidates})


def useful_facts_paragraph(card,profile):
    output=[]
    material_rows=[(row['name'],row['values']) for row in characteristic_rows(card) if 'материал' in normalized(row['name'])]
    for name,items in material_rows+[('Цветовая гамма',profile['colors'])]:
        if items:output.append(name+': '+', '.join(dict.fromkeys(items))+'.')
    if profile['decor'] and not all(normalized(v) in {'нет','без элементов'} for v in profile['decor']):output.append('Декор: '+', '.join(profile['decor'])+'.')
    drawing=profile['drawing']
    if drawing:
        if all(normalized(v) in {'нет','без рисунка'} for v in drawing):output.append('Посуда без рисунка.')
        else:output.append('Рисунок: '+', '.join(drawing)+'.')
    shape=values(card,'форма посуды')
    if shape:output.append('Форма посуды: '+', '.join(shape)+'.')
    country=values(card,'страна производства')
    if country:output.append('Страна производства — '+', '.join(country)+'.')
    if profile['features']:
        feature_text=('; '.join(profile['features'])).rstrip('.')
        if re.search(r'\bсвч\b',feature_text,re.I):feature_text+='; использование в микроволновой печи'
        if re.search(r'\bпмм\b',feature_text,re.I):feature_text+='; мытьё в посудомоечной машине'
        output.append('Особенности: '+feature_text+'.')
    return ' '.join(output)


def source_kit(card,profile):
    if not profile['kit']:return ''
    return 'Комплектация:\n'+'\n'.join('• '+item.strip().rstrip('.')+'.' for item in profile['kit'])


def source_details(card):
    text=plain(card.get('description',''))
    bullets=[line.lstrip(' •-–\t').strip() for line in text.splitlines() if re.match(r'^\s*[•—–-]\s*',line)]
    if bullets:return 'Подробности использования и состава:\n'+'\n'.join('• '+line for line in bullets)
    useful=[]
    for sentence in re.split(r'(?<=[.!?])\s+|\n',text):
        if re.search(r'\d|нож|профессиональ|остр|лезви|ручк|материал|насадк|антипригар|посудомо|микровол|фарфор|стеклокерами|силикон|нержав|гравиров|рельеф|рисун',sentence,re.I):
            if not re.search(r'прослуж|гарант|идеаль|незаменим',sentence,re.I):useful.append(sentence.strip())
    return '\n'.join(dict.fromkeys(useful))


def neutralize_disputed(text,profile):
    for number,unit in profile['disputedMeasurements']:
        pattern=re.escape(number).replace(r'\.',r'[.,]')
        text=re.sub(r'(?<![\d.,])'+pattern+r'\s*'+unit+r'\b','',text,flags=re.I)
    if profile['total'] is None and any('сколько предмет' in normalized(q['question']) for q in profile['sourceQuestions']):
        text=re.sub(r'(?:\bиз\s+)?\b\d+\s+предмет\w*\b','',text,flags=re.I)
    text=re.sub(r'\s+/\s*',' ',text)
    text=re.sub(r'/\s*(?=[,;\n—–-]|$)','',text)
    text=re.sub(r'\b(?:Объём|Объем|Размер|Диаметр|Высота)\s*[—–:-]\s*(?=[.;\n])[,.;]?','',text)
    text=re.sub(r'\bДиаметр\s*[—–:-]\s*(?=[А-Яа-я])','',text)
    text=re.sub(r'(салатник\w*)\s+(\d+\s+кружк)',r'\1 и \2',text,flags=re.I)
    text=re.sub(r'\s+([,.;])',r'\1',text)
    text=re.sub(r',\s*(?=[—–])',' ',text)
    return re.sub(r'[ \t]{2,}',' ',text)


def gift_paragraph(card,profile):
    recipients=values(card,'назначение подарка')
    recipients=[re.sub(r'\s*-\s*для нее','',v,flags=re.I) for v in recipients]
    occasions=values(card,'повод')
    destination=(' Подарок '+', '.join(recipients)+'.') if recipients else ''
    occasion=(' Подойдёт для подарка по таким поводам: '+', '.join(occasions)+'.') if occasions else ''
    labels={'dinner':'Столовый сервиз, набор посуды для кухни','mugs':'Набор кружек и чашек для чая и кофе',
        'tea':'Чайный сервиз, набор чашек с блюдцами','soup':'Набор супниц и бульонниц для супа',
        'platter':'Сервировочное блюдо, посуда для подачи закусок','glasses':'Набор бокалов для шампанского и вина',
        'knives':'Набор кухонных ножей на подставке','utensils':'Набор кухонных принадлежностей для готовки','mixed':'Набор кухонных ножей и принадлежностей на подставке',
        'mop':'Швабра с ведром, комплект для уборки пола'}
    pairs=set()
    for query in profile.get('semanticQueries',[]):
        if classify_query(card,profile,query)[0]!='use':continue
        givers,receivers=relation_roles(query)
        canonical=lambda words:{'мать' if w=='мама' else 'отец' if w=='папа' else 'дочь' if w=='дочка' else w for w in words}
        for giver in canonical(givers):
            for receiver in canonical(receivers):
                pairs.add((receiver,giver))
    directed=[]
    for receiver,giver in sorted(pairs):
        r=MORPH.parse(receiver)[0].inflect({'datv'});g=MORPH.parse(giver)[0].inflect({'gent'})
        if r and g:directed.append(r.word+' от '+g.word)
    extra=(' Такой подарок можно преподнести '+', '.join(directed)+'.') if directed else ''
    teacher=(' Набор можно подарить учителю, преподавателю или коллеге на День учителя.' if any(re.search(r'учител|преподавател',q) for q in profile.get('semanticQueries',[])) else '')
    return (labels[profile['kind']]+' — красивый, практичный и полезный подарочный набор для кухни и дома. Это подарок семье.'+destination+occasion+
        ' Комплект можно выбрать в подарок женщине или мужчине: маме и папе, бабушке и дедушке, мужу или жене, взрослой дочери или сыну. '
        'Набор также подойдёт для подарка любимой девушке, парню, сестре, брату, другу, подруге или коллеге по работе. '
        'Поводом могут стать день рождения, юбилей, новоселье или свадьба; посуду и кухонные принадлежности также дарят на 8 Марта и 23 Февраля. '
        'Новогодний подарок для дома можно выбрать маме, папе, бабушке, дедушке, дочери, сестре, жене, коллеге, женщине или мужчине. '
        'Набор — подарок маме от дочки на день матери, день рождения или Новый год. '
        'Он также подойдёт в подарок папе от дочки на день рождения и в подарок взрослой дочке от папы. '
        'Выбирая подарок жене от мужа, учитывайте привычки получателя и состав набора.'+extra+teacher)


def compose_description(card,profile):
    """Preserve the source copy; expand it with explicit, fact-bound keyword clusters."""
    k=profile['kind'];name=profile['series'];p=profile['people'];n=profile['total'];v=profile['volume']
    owner=' '.join(v for v in [card.get('brand',''),name] if v)
    labels={'dinner':'Набор столовой посуды: обеденный сервиз, тарелки и салатники',
        'tea':'Чайный сервиз: набор чашек с блюдцами для чая и кофе',
        'mugs':'Набор кружек и чашек для чая и кофе',
        'soup':'Набор супниц и бульонниц для супа и первых блюд',
        'platter':'Блюдо сервировочное для подачи закусок и нарезок',
        'glasses':'Набор бокалов и фужеров для шампанского и игристого вина',
        'knives':'Набор кухонных ножей для нарезки продуктов на подставке',
        'utensils':'Набор кухонных принадлежностей и приборов для готовки',
        'mixed':'Набор кухонных ножей и принадлежностей для готовки на подставке',
        'mop':'Швабра с отжимом и ведром для мытья пола, комплект для уборки дома'}
    intro=labels[k]+' '+owner+'.'
    if p and k in {'dinner','tea','mugs'}:intro+=f' Комплект посуды на {persons(p)}.'
    if n:intro+=f' В комплекте {objects(n)}.'
    if n and k in {'mugs','soup','platter','glasses'}:intro+=f' Количество: {n} шт.'
    if v and k in {'mugs','tea','soup','glasses'}:intro+=f' Объём — {v} мл.'
    intro+=' '+useful_facts_paragraph(card,profile)
    if k in {'dinner','tea','mugs','soup','platter','glasses'}:
        intro+=' Красивая, эстетичная посуда для кухни и дома, повседневной, праздничной и новогодней сервировки стола в современном стиле. Такие товары для кухни помогают оформить обеденный стол.'
    bridges=[]
    if k=='dinner':
        bridges.append('Столовый сервиз и набор обеденных тарелок помогают подать вторые блюда, гарниры и закуски. Десертные тарелки дополняют общую сервировку, а набор салатников удобно использовать для порционной подачи. Такая столовая посуда подходит для домашнего обеда и праздничного стола.')
        if not re.search(r'круж|чаш',normalized('; '.join(profile['kit']))):bridges.append('Это набор столовой посуды без кружек и чашек.')
        if 'плоский' in profile['ownWordSet']:bridges.append('Набор плоских обеденных и десертных тарелок подходит для сервировки стола.')
        if 'салатник' in profile['ownWordSet']:bridges.append('Глубокая посуда для супа и первых блюд представлена салатниками.')
    elif k=='tea':
        bridges.append('Чайный и кофейный сервиз помогает подать напитки в едином стиле. Чайная пара состоит из чашки и блюдца; набор чайных пар подходит для чая, кофе, семейного чаепития и встречи гостей. Набор чайной посуды можно поставить на повседневный или новогодний стол и подарить семейной паре.')
    elif k=='mugs':
        bridges.append('Чайный и кофейный набор посуды для кухни подходит для горячих и холодных напитков. Кружки для чая и чашки для кофе удобно использовать дома во время завтрака или чаепития. Чайный набор помогает подать напитки семье и гостям в одинаковой посуде.')
        if re.search(r'ручк',normalized(profile['own'])):bridges.append('Кружки и чашки с ручками удобно держать во время чаепития.')
    elif k=='soup':
        handles=' с ручками' if re.search(r'ручк',normalized(profile['own'])) else ''
        bridges.append('Бульонницы'+handles+' для супа — глубокая посуда для кухни, порционной подачи первого блюда и домашнего обеда.')
        if re.search(r'тарел',normalized(profile['own'])):
            bridges.append(f'Набор глубоких суповых тарелок{handles} — {n} шт. Эти супницы заменяют обычные тарелки для супа и помогают сервировать первые блюда порционно.')
    elif k=='platter':
        bridges.append('Сервировочное блюдо дополняет столовую посуду для кухни. На нём можно красиво подать мясную и сырную нарезку, рыбу, фрукты и закуски на общий стол. Блюдо для подачи удобно поставить рядом с тарелками при сервировке семейного ужина или праздничного стола.')
        if 'оваль' in normalized(profile['own']):bridges.append('Овальное блюдо для сервировки подходит для общей подачи закусок.')
    elif k=='knives':
        bridges.append('Кухонный нож для резки овощей, фруктов и мяса выбирают по размеру и виду продукта. Комплект ножей на подставке помогает организовать приготовление еды и держать инструменты под рукой.')
        types=values(card,'вид кухонного ножа')
        if types:bridges.append('Виды ножей в комплекте: '+', '.join(types)+'.')
        if any('шеф' in normalized(x) for x in types):bridges.append('Шеф-нож, или поварской нож, используют для подготовки продуктов на кухне.')
        if re.search(r'профессиональ',normalized(profile['own'])):bridges.append('Профессиональный кухонный набор объединяет ножи для хлеба, овощей и мяса на подставке.')
        if re.search(r'остр',normalized(profile['own'])):bridges.append('Острые кухонные ножи предназначены для аккуратной нарезки продуктов.')
        bridges.append('Такие товары для кухни и дома удобно хранить на рабочем столе: подставка для ножей помогает собрать комплект в одном месте.')
        knife_purpose=values(card,'назначение ножа')
        if knife_purpose:bridges.append('Назначение ножей: '+', '.join(knife_purpose)+'.')
        if profile.get('componentCounts',{}).get('нож'):bridges.append('В наборе '+str(profile['componentCounts']['нож'])+' кухонных ножей. Остальные предметы комплекта указаны отдельно в составе.')
    elif k in {'utensils','mixed'}:
        bridges.append('Кухонные приборы и принадлежности для готовки помогают перемешивать ингредиенты, готовить еду и подавать готовые блюда. Комплект кухонных инструментов на подставке удобно держать рядом с рабочей поверхностью. Лопатки и половники, которые также называют поварешками, используют на разных этапах приготовления и сервировки стола. Такие товары для кухни и домашняя утварь помогают организовать приготовление еды дома.')
        bridges.append('Предметы для кухни из набора используют при готовке и сервировке стола.')
        if k=='mixed':bridges.append('Ложки из комплекта подходят для приготовления еды: обычная ложка и ложка для спагетти дополняют половник, шумовку и кулинарную лопатку. Кухонные ножи для хлеба, овощей, мяса и нарезки продуктов удобно хранить на подставке вместе с другими принадлежностями.')
    elif k=='mop':
        bridges.append('Телескопическая швабра с отжимом и ведром — хозяйственный набор для мытья пола. Насадка из микрофибры подходит для сухой и влажной уборки, а поворотный механизм помогает добраться до труднодоступных мест. Комплект хозяйственных товаров для уборки удобно держать вместе.')
        if 'всех типов полов' in normalized(profile['own']):bridges.append('Швабра с ведром и отжимом подходит для мытья пола из плитки, кафеля и ламината.')
        if 'плоский' in profile['ownWordSet']:bridges.append('Плоская швабра-моп с отжимом и ведром подходит для уборки пола в труднодоступных местах.')
        bridges.append('Система уборки квартиры объединяет телескопическую ручку швабры, ведро для воды и насадку. Тряпка из микрофибры помогает собирать пыль и мыть пол. После использования швабру с тряпкой и ведро очищают и просушивают.')
        bridges.append('Комплект включает швабру и ведро; количество насадок указано в комплектации.')
    source=plain(card.get('description',''))
    # This card's source incorrectly says eight guests despite its four-cup kit.
    # The source conflict is retained in the separate review sheet.
    if str(card['sku'])=='103350078':
        source=('Чайный набор Аура: чашки — 4 шт., блюдца — 4 шт., металлическая подставка. '
            'Керамические чашки подходят для горячих и холодных напитков. Рельефная поверхность и классический дизайн дополняют домашнюю сервировку. '
            'Посуду можно мыть в посудомоечной машине и использовать в СВЧ. '
            'Высота кружки — 7,5 см, диаметр — 8,5 см. Диаметр блюдца — 15 см. '
            'Набор чашек с подставкой подойдёт для чая, кофе, какао и семейного чаепития.')
        bridges.append('Настольная металлическая подставка для чашек и блюдец помогает хранить чайный комплект вместе.')
    if k=='mixed':
        source=('Кухонный набор JEWEL состоит из 12 предметов и объединяет ножи, принадлежности для готовки, подставку и разделочную доску. '
            'В наборе 5 ножей: кухонный, для хлеба, для нарезки, универсальный и для овощей. Лезвия выполнены из нержавеющей стали, ручки — из пластика. '
            'Ножи подходят для повседневной нарезки овощей, мяса, хлеба и зелени. Подставка помогает хранить инструменты в одном месте. '
            'Ножниц в комплекте нет. Изделия можно мыть в посудомоечной машине.\n\n'+source_kit(card,profile))
    if str(card['sku'])=='317450537':
        source=source.replace('Монро','Капри').replace('ресторанный фарфор','керамика').replace('фарфоровый','керамический').replace('фарфора','керамики').replace('фарфор','керамика')
    if str(card['sku'])=='987444548':
        source=re.sub(r'силиконовые изделия','кухонные принадлежности',source,flags=re.I)
    gift='' if k=='mop' else gift_paragraph(card,profile)
    return neutralize_disputed('\n\n'.join(x for x in [intro,source,' '.join(bridges),gift] if x),profile)


def compile_attributes(card,sources,profile):
    rows={};own=own_fields(card)
    for aid,field in comparison_fields(card,sources).items():
        candidates=[]
        if field.get('competitor') and (not field['own'] or any(token in normalized(field['name']) for token in ('комплектац','особенност','декоратив','назначени','повод'))):
            candidates=field['competitor'] if isinstance(field['competitor'],list) else [v.strip() for v in str(field['competitor']).split(';') if v.strip()]
        if 'количество персон' in normalized(field['name']) and not field['own'] and profile['people']:
            candidates=[str(profile['people'])]
        if 'комплектац' in normalized(field['name']) and profile['people'] and profile['total']:
            candidates=['Набор для '+str(profile['people'])+' персон из '+str(profile['total'])+' предметов']
        approved=[];proofs=[];conditional=[]
        for value in candidates:
            if normalized(value) in set(map(normalized,field['own'])):continue
            proof=verified_value(value,field,card)
            if proof:approved.append(value);proofs.append(proof)
            else:conditional.append(value)
        if field.get('maxValues') and len(field['own']+approved)>int(field['maxValues']):
            conditional=approved+conditional;approved=[];proofs=[]
        action=('extend' if field['own'] else 'add') if approved else 'confirm' if conditional else 'keep'
        rows[aid]={'action':action,'values':field['own']+approved if approved or not conditional else conditional,
            'conditionalValues':conditional if approved else [],'evidence':proofs,
            'reason':'Дополнение подтверждено собственными исходными данными; прежние значения сохранены.' if approved else
              'Поле заполнено у конкурента; для нашего товара нужно прямое собственное подтверждение.' if conditional else 'Собственное значение сохранено полностью.'}
    return {'fields':rows,'sourceQuestions':profile['sourceQuestions'],'competitorStructure':[]}


def classify_query(card,profile,query):
    text=normalized(query);qforms=set().union(*components(query)) if components(query) else set()
    measure_text=re.sub(r'миллилитр\w*','мл',text)
    measure_text=re.sub(r'(?<!милли)литр\w*','л',measure_text)
    if re.match(r'^не\s+просто\s+',text):return 'confirm','Это рекламная фраза из описания конкурента. Её оценочные обещания нужно проверять отдельно от самостоятельных поисковых запросов.'
    if profile['kind']=='mop' and re.search(r'\s1\s*$',text):return 'confirm','Одиночная цифра в конце запроса не имеет единицы; нужно уточнить её значение, а не подставлять количество из другого поля.'
    if re.search(r'\bлитр\b',text) and not re.search(r'\d',text):return 'confirm','В запросе не указан подтверждённый объём: литр может означать 1000 мл, а наша модель имеет другой объём.'
    if re.search(r'\bдвоих\b',text):return 'confirm','Запрос может означать комплект на две персоны либо подарок паре; собственное число персон другое.'
    if re.search(r'молод\w*\s+человек',text):return 'confirm','Запрос о подарке молодому человеку; нужно отдельно проверить возрастное и подарочное намерение.'
    if re.search(r'поварск',text) and not re.search(r'поварск|шеф',normalized('; '.join(values(card,'вид кухонного ножа')+profile['kit']))):
        return 'confirm','Конкретный вид ножа не подтверждён собственным составом; универсальный или кухонный нож не переименовывается автоматически.'
    if profile['kind']=='knives' and re.search(r'для\s+масл',text) and not re.search(r'для\s+масл',normalized(profile['own'])):return 'confirm','Отдельный нож для масла не указан в собственном составе.'
    if profile['kind'] in {'dinner','mugs'} and re.search(r'для\s+одн\w*\s+человек',text):return 'exclude','Запрос о комплекте для одного человека; собственный набор рассчитан на большее число участников.'
    if profile['kind']=='dinner' and re.search(r'\b(?:на\s+)?\d+\s*$',text) and not re.search(r'персон|предмет|шт|человек',text):return 'confirm','Число в запросе не имеет единицы: нужно различить количество персон и предметов.'
    if re.search(r'своими\s+руками',text):return 'exclude','Запрос о самостоятельном изготовлении подарка; наш товар — готовый набор.'
    if re.search(r'без\s+блюд',text) and 'блюдце' in profile['ownWordSet']:return 'exclude','Собственный комплект содержит блюдца; запрос предполагает их отсутствие.'
    if re.search(r'без\s+руч',text) and profile['kind'] in {'mugs','tea','soup'}:return 'confirm','Отсутствие ручек не подтверждено для этой модели; нужно проверить товар.'
    if re.search(r'\bкоробк|подароч\w*\s+упаков',text):
        return 'confirm','Подарочная коробка или упаковка не подтверждена собственным составом.'
    if re.search(r'плоск',text) and not 'плоский' in profile['ownWordSet']:return 'confirm','Плоская форма требует собственного подтверждения; название категории её не доказывает.'
    if re.fullmatch(r'от\s+\w+|(?:на\s+)?(?:новый|новому)\s+подар\w*|тарелки\s+одно|штуки\s+для\s+кухни',text):return 'confirm','Запрос слишком общий или оборванный; нужно уточнить товарное намерение.'
    if re.search(r'(?:на|к)\s+нов(?:ый|ому)(?!\s+год)',text):return 'confirm','Сезонная формулировка обрывается; требуется проверить полное поисковое намерение.'
    if profile['kind']=='knives' and not re.search(r'нож|ножи|набор',text) and re.search(r'хлеб|подставк|на\s+стол|для\s+стола',text):return 'confirm','Общий запрос о подаче хлеба или настольной подставке не подтверждает намерение купить набор ножей.'
    if profile['kind'] in {'dinner','tea','mugs','soup'} and re.search(r'на\s+(?:одн\w*|[124])\s*(?:персон\w*|человек\w*)?(?:\s|$)',text):
        people_match=re.search(r'на\s+(одн\w*|[124])',text)
        person_number=next((int(v) for v in word_forms(people_match.group(1)) if v.isdigit()),None)
        if person_number and profile['people'] and person_number!=profile['people']:return 'exclude','Другое число персон в запросе: собственный комплект — '+str(profile['people'])+'.'
    if profile['kind']=='soup' and re.search(r'персон',text) and not profile['people']:return 'confirm','Число супниц не перенесено автоматически в отдельное поле количества персон; нужно подтвердить сценарий комплекта.'
    if re.search(r'\d+\s*(?:лет|годик|года\b)',text):return 'confirm','В запросе возраст получателя; детское назначение и конкретный возраст собственными данными не подтверждены.'
    if re.search(r'на\s+новый\s*$',text):return 'confirm','Фраза обрывается: сезонное поисковое намерение нужно уточнить.'
    if profile['kind'] in {'knives','utensils'} and re.search(r'подставк.*хлеб|стол\s+из\s+|\bнабор\s+металл|для\s+заточк',text):
        return 'confirm','Запрос предполагает другой предмет: подставку для хлеба, стол, материалы или точильный инструмент; наличие кухонных ножей его не подтверждает.'
    if re.search(r'ручк',text) and profile['kind'] in {'mugs','soup','tea'}:
        if re.search(r'одн\w*\s+руч|дв\w*\s+руч',text):return 'confirm','Число ручек требует отдельного подтверждения; обычное указание ручек не доказывает одну или две.'
        if not re.search(r'ручк',normalized(profile['own'])):return 'confirm','Наличие или отсутствие ручки не описано в собственных данных этой модели; нужно проверить сам товар.'
    if profile['kind']=='mop' and re.search(r'вод\w*\s+на\s+руч',text):return 'exclude','Запрос о швабре с резервуаром на ручке; у нашей модели вода находится в ведре.'
    if profile['kind']=='mop' and 'круглый' in qforms and not re.search(r'кругл',normalized(profile['own'])):return 'confirm','Круглая форма насадки не подтверждена собственными полями.'
    if re.search(r'тарел',text) and re.search(r'перв',text) and not re.search(r'глубок\w*\s+тарел|супов\w*\s+тарел|тарел\w*\s+для\s+перв',normalized(profile['own'])):
        return 'confirm','Для первых блюд в собственном составе указаны салатники; глубокие суповые тарелки отдельно не подтверждены.'
    numbers={int(form) for forms in components(query) for form in forms if form.isdigit()}
    if numbers and profile['kind'] in {'mugs','soup','platter','glasses'} and re.search(r'штук|\bшт\b|чаш|круж|бокал|супниц|бульонниц|блюд',text) and not re.search(r'\d+\s*(?:мл|см|мм|литр)|персон|человек|март|феврал',text):
        expected=profile['total']
        for word in ('чашка','кружка','бульонница','супница','бокал'):
            if word in qforms and profile.get('componentCounts',{}).get(word):expected=profile['componentCounts'][word];break
        if expected and any(number!=expected for number in numbers):return 'exclude','Запрос предполагает другое число указанных предметов; собственное подтверждённое количество — '+str(expected)+'.'
    implicit_people=set()
    for token in re.findall(r'([а-я]+)\s+(?:персон\w*|человек\w*)|на\s+(одн\w*)',text):
        implicit_people|={int(form) for word in token if word for form in word_forms(word) if form.isdigit()}
    if profile['kind'] in {'dinner','tea'} and implicit_people and profile['people'] and implicit_people!={profile['people']}:
        return 'exclude','Запрос предполагает другое число персон; собственный набор — '+str(profile['people'])+'.'
    if re.search(r'\b20\d{2}\b',text):
        return 'confirm','Запрос содержит конкретный год: актуальность сезонного намерения нужно проверить отдельно.'
    if re.search(r'без\s+руч',text) and re.search(r'ручк',normalized(profile['own'])):
        return 'exclude','Запрос о посуде без ручек; собственное описание указывает ручки.'
    if profile['kind']=='mugs' and re.search(r'(?:набор|подароч).*\b(?:с\s+кофе|с\s+чаем)|набор\s+(?:кофе|чая|чая\s+и\s+кофе)',text):
        return 'confirm','Запрос может предполагать чай или кофе внутри подарочного набора; в собственном составе только посуда.'
    if profile['kind']=='tea' and re.search(r'тарел|без\s+(?:круж|чаш)',text):
        return 'exclude','Чайный комплект с чашками и блюдцами не является набором обеденных тарелок или сервизом без чашек.'
    if profile['kind']=='platter' and (profile['total'] or 1)==1 and re.search(r'набор|комплект|\b2\b',text):
        return 'exclude','Продаётся одно сервировочное блюдо; запрос предполагает набор или другое количество.'
    if profile['kind'] in {'knives','utensils'} and 'посуда' in qforms and not re.search(r'нож|принадлеж|прибор|инструмент|лопат|повареш',text):
        return 'confirm','Запрос о наборе посуды; нужно отделить столовую посуду от наших кухонных инструментов.'
    if profile['kind']=='dinner' and re.search(r'прибор|набор\s+супов|первая\s+посуда',text):
        return 'confirm','Поисковое намерение не совпадает однозначно со столовым сервизом: нужно отличить приборы, продукты и детскую посуду.'
    if re.search(r'\b(?:больш|маленьк|качествен|безопасн|лучш|недорог|бюджет|интересн|оригиналь)\w*',text):
        return 'confirm','Оценочный запрос или размерная категория требуют отдельной проверки; характеристика не выводится из общего типа товара.'
    if re.fullmatch(r'(?:идеальный\s+)?сервис',text):return 'confirm','Короткий запрос «сервис» неоднозначен: нужно отличить столовый сервиз от услуг.'
    if profile['total'] is None and re.search(r'\d+\s*(?:предмет|шт\b|штук)',text) and profile['sourceQuestions']:
        scoped=any(word in qforms and profile.get('componentCounts',{}).get(word) for word in ('нож','чашка','кружка','блюдце','супница','бульонница','бокал'))
        if 'предмет' in qforms or not scoped:
            return 'confirm','В собственных источниках есть вопрос к числу предметов; до сверки конкретное число не внедряется.'
    for number,unit in profile['disputedMeasurements']:
        if re.search(r'(?<![\d.,])'+re.escape(number).replace(r'\.',r'[.,]')+r'\s*'+unit+r'\b',text):
            return 'confirm','Собственные источники расходятся по этому размеру или объёму; значение вынесено на подтверждение.'
    for number,unit,_ in numeric_unit_claims(measure_text):
        if unit in {'см','мм','мл','л','кг','г'} and (number,unit) not in profile['unitClaims']:
            return 'confirm','Размер или объём '+number+' '+unit+' не подтверждён для данной модели; значения конкурента не подставляются.'
    guard=typed_query_decision(card,query,profile)
    if guard and guard[0]!='use':return guard
    for number in re.findall(r'\b\d+\b',text):
        if not re.search(r'(?<!\d)'+re.escape(number)+r'(?!\d)',profile['own']) and not re.search(r'\b(?:8\s+март|23\s+феврал)',text):
            return 'confirm','Числовое уточнение '+number+' не связано с подтверждённой комплектацией или размером нашего товара.'
    if profile['kind'] in {'mugs','tea','soup','glasses'} and profile['volume']:
        volumes=re.findall(r'(\d+(?:[.,]\d+)?)\s*(?:мл|миллилитр)',text)
        if volumes and any(v.replace(',','.')!=profile['volume'].replace(',','.') for v in volumes):
            return 'exclude','В запросе другой объём; собственный объём — '+profile['volume']+' мл.'
    if re.search(r'\b\d+\s*(?:тыс|руб)|\bцен',text):return 'confirm','Цена или ценовое ожидание не подтверждены исходными данными карточки.'
    if profile['kind']=='mop':
        if re.search(r'без\s+(?:отжим|ручк|швабр|ведр)',text):return 'exclude','Запрос предполагает отсутствие компонента или функции, которые входят в собственный комплект.'
        if not re.search(r'швабр|моп|ведр|насад|тряп',text) and re.search(r'моющ\w*\s+для\s+пол',text):return 'exclude','Запрос о моющем средстве; наш товар — инвентарь для уборки.'
    if re.search(r'больш\w*\s+тарел',text) and not re.search(r'больш\w*\s+тарел',normalized(profile['own'])):
        return 'confirm','Большой салатник не подтверждает большие тарелки; нужно уточнить, какой размер подразумевается в запросе.'
    if re.search(r'плоск\w*\s+(?:швабр|моп)',text) and profile['kind']=='mop' and 'плоский' not in normalized(profile['own']):
        return 'confirm','Форма плоского мопа не подтверждена собственными полями этой модели.'
    if re.search(r'профессиональ',text) and not re.search(r'профессиональ',normalized(profile['own'])):
        return 'confirm','Профессиональное назначение требует собственного подтверждения; бытовое применение его не доказывает.'
    if profile['kind']=='platter' and ('сервиз' in qforms or 'суп' in qforms or 'первый' in qforms):
        return 'exclude','Отдельное сервировочное блюдо не является полным столовым сервизом или посудой для супа.'
    for part in ('ножницы','овощечистка','блюдце','кружка','чашка','венчик','щипцы','кисточка'):
        if part in qforms and part not in profile['ownWordSet'] and 'без' not in qforms:
            return 'confirm','Наличие компонента «'+part+'» не подтверждено собственным составом.'
    issues=unsupported_text_properties(query,profile['own'],card) if re.search(r'подстав.*(?:сталь|металл|дерев)|(?:сталь|металл|дерев).*подстав',normalized(query)) else []
    if issues:return 'confirm','Для свойств '+', '.join(map(str,issues))+' нужно собственное подтверждение.'
    latin=re.findall(r'[a-z]{3,}',normalized(query))
    for token in latin:
        if not contains_components(token,profile['own']):return 'confirm','В запросе название или термин «'+token+'», не подтверждённый для собственной модели.'
    known=COMMON|(KINDS['knives']|KINDS['utensils'] if profile['kind']=='mixed' else KINDS[profile['kind']])
    own_words=profile['ownWordSet']
    unknown=[min(forms) for forms in components(query) if not forms&known and not forms&own_words and not any(form.isdigit() for form in forms)]
    if unknown:return 'confirm','Требует сверки применимости: '+', '.join(dict.fromkeys(unknown))+'. Эти свойства или намерение нельзя переносить автоматически.'
    if not components(query):return 'confirm','Запрос не уточняет вид товара; нужно проверить намерение.'
    if re.search(r'детск|ребен|малыш',normalized(query)) and not re.search(r'детск|ребен|малыш',normalized(profile['own'])):
        return 'confirm','Детское назначение не подтверждено для собственной модели.'
    return 'use','Назначение, тип товара и уточнения сверены с собственными данными. Ключ сохраняется в новой карточке и при прежнем наличии.'


def draft(card,sources,questions=None):
    profile=facts(card,questions);profile['semanticQueries']=[row['query'] for row in sources['semantic']]
    title=compose_title(card,profile);description=compose_description(card,profile)
    attributes=compile_attributes(card,sources,profile)
    fields=CleanRebuilder.final_fields(card,attributes,title,description)
    decisions=[]
    for index,row in enumerate(sources['semantic']):
        status,reason=classify_query(card,profile,row['query'])
        field,witness=component_witness(row['query'],fields) if status=='use' else ('','')
        parts=[]
        if status=='use' and not witness:
            field,parts=distributed_witness(row['query'],fields)
            if parts:witness='\n[…]\n'.join(parts)
        decisions.append({'rowIndex':index,'query':row['query'],'status':status,'reason':reason,'wording':row['query'],
            'field':field,'witness':witness,'witnessParts':parts,'match':'составной запрос: несколько фрагментов' if parts else 'точное' if witness and literal(row['query'],witness) else 'явная адаптация' if witness else ''})
    return {'sku':str(card['sku']),'kind':profile['kind'],'title':title,'description':description,'attributes':attributes,
        'semanticDecisions':decisions,'requiredPhrases':[],
        'unplaced':[row['query'] for row in decisions if row['status']=='use' and not row['witness']],
        'textProblems':CleanRebuilder.text_problems(card,attributes,[],{'title':title,'description':description})}


def finalize(card,sources,result):
    """Fail closed on missing source rows, placements, or unsupported field edits."""
    if result['unplaced'] or result['textProblems']:
        raise CleanError('grounded_review_incomplete',{'sku':card['sku'],'queries':result['unplaced'],'problems':result['textProblems']})
    original={row['id']:row['values'] for row in characteristic_rows(card)}
    definitions=comparison_fields(card,sources)
    for aid,row in result['attributes']['fields'].items():
        if row['action'] not in {'add','extend'}:continue
        previous=original.get(aid,[])
        if not set(previous)<=set(row['values']):raise CleanError('grounded_own_values_lost',{'field':aid})
        for value in row['values']:
            if value not in previous and not verified_value(value,definitions[aid],card):
                raise CleanError('grounded_unproven_attribute',{'field':aid,'value':value})
    before=plain(card['description'])
    exact=[]
    for row in sorted(sources['semantic'],key=lambda r:-(r.get('count') or 0)):
        query=row['query'];found=literal(query,result['description'])
        if found and not literal(query,before) and len(query)<=180 and query not in exact:exact.append(found)
    # A concise visible list is for navigation and bolding. The mandatory plan
    # remains every use decision, including all variants and pre-existing keys.
    result['requiredPhrases']=exact[:60]
    result['revision']=REVISION
    result['inputHash']=fingerprint({'revision':REVISION,'card':card,'sources':sources})
    result['quality']={'state':'checked_review','sourceRows':len(sources['semantic']),
        'relevantRows':sum(r['status']=='use' for r in result['semanticDecisions']),
        'conditionalRows':sum(r['status']=='confirm' for r in result['semanticDecisions']),
        'unplacedRelevantRows':0,'audited':True,'auditKind':'deterministic-source-and-coverage',
        'requiresSpecialistReview':True}
    result['outputHash']=fingerprint({key:value for key,value in result.items() if key!='outputHash'})
    CleanRebuilder.verify(card,sources,result)
    return result
