"""Source-only facts, query bindings, and checks for offline SEO review.

No model-generated decisions or marketplace writes.
"""
from collections import Counter
from functools import lru_cache
import json
import os
from pathlib import Path
import re

import pymorphy3
from automatic_seo import (characteristic_rows, factual_evidence, fingerprint,
    plain, source_phrase, unsupported_numeric_values, unsupported_text_properties,
    unconfirmed_origin_mentions, confirmed_composition)

REVISION = 'source-grounded-review-v1'
MORPH = pymorphy3.MorphAnalyzer()
NUMBER_WORDS = dict(zip(['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять','десять',
    'одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать','двадцать'],map(str,range(21))))
NUMBER_WORDS.update({'двое':'2','трое':'3','четверо':'4','пятеро':'5','шестеро':'6','семеро':'7','восьмеро':'8'})
STOP = {'на','в','во','из','для','с','со','и','по','от','к','ко','а','или'}
INTENT = {'купить','цена','недорого','все','wildberries','вайлдберриз','wb'}
DERIVATIONS = [ {'сталь','стальной'}, {'керамика','керамический'}, {'фарфор','фарфоровый'},
    {'стеклокерамика','стеклокерамический'}, {'стекло','стеклянный'}, {'пластик','пластиковый'},
    {'силикон','силиконовый'}, {'кухня','кухонный'}, {'чай','чайный'}, {'кофе','кофейный'},
    {'обед','обеденный'}, {'сервировка','сервировочный'}, {'сервис','сервиз'},
    {'шт','штука'}, {'пр','предмет'}, {'мл','миллилитр'}, {'л','литр'},
    {'см','сантиметр'}, {'мм','миллиметр'}, {'blanche','бланш'},
    {'мыть','мытье','моющий'},{'дочь','дочка'},{'мама','мать'},{'папа','отец'},{'кафель','плитка'},
    {'металл','металлический'},{'железо','железный'},
    {'подарок','подарочный','подарить'},{'стиль','стильный'},
    {'приготовление','готовка'},{'половник','поварешка'},
    {'рождение','рожденье'},{'моп','mop'},
    {'женщина','женский'},{'мужчина','мужской'},{'семья','семейный'},
    {'дом','домашний'},{'микроволновка','микроволновый'},{'утварь','принадлежность'},
    {'учитель','преподаватель'},{'мясо','мясной'} ]
SPELLING_WORDS={'швабра','тарелка','посуда','кружка','сервиз','нож','набор','комплект','столовый',
    'кухонный','бокал','супница','бульонница','подставка','салатник','фарфор','керамика',
    'микрофибра','телескопический','обеденный','стеклокерамика','подарок'}


def one_edit(left,right):
    if abs(len(left)-len(right))>1:return False
    if len(left)==len(right):return sum(a!=b for a,b in zip(left,right))==1
    short,long=(left,right) if len(left)<len(right) else (right,left)
    return any(long[:index]+long[index+1:]==short for index in range(len(long)))


class CleanError(RuntimeError):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.details = details or {}


def save_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w') as handle:
        os.chmod(temp, 0o600)
        json.dump(value, handle, ensure_ascii=False, indent=2)
    temp.replace(path)


def normalized(text):
    return re.sub(r'\s+', ' ', str(text).casefold().replace('ё','е')).strip()


@lru_cache(maxsize=32768)
def word_forms(word):
    forms = {p.normal_form.replace('ё','е') for p in MORPH.parse(word)}
    if len(word)>=4 and not MORPH.word_is_known(word):
        matches=[known for known in SPELLING_WORDS if one_edit(word,known)]
        if len(matches)==1:forms.add(matches[0])
    forms |= {NUMBER_WORDS[form] for form in list(forms) if form in NUMBER_WORDS}
    for family in DERIVATIONS:
        if forms & family:
            forms |= family
    return frozenset(forms)


@lru_cache(maxsize=32768)
def components(text):
    text=re.sub(r'\bновы\s+год\b','новый год',normalized(text))
    text=re.sub(r'\bнов(?:ый|ого|ому|ым|ом)\s+год(?:а|у|ом|е)?\b|\bнг\b','новогодний',normalized(text))
    if 'новогодн' in text:text=re.sub(r'\bновый\b\s*$','',text)
    words = re.findall(r'\d+(?:[.,]\d+)?|[a-zа-яё]+', text)
    return tuple(word_forms(w.replace(',','.')) for w in words if w not in STOP | INTENT)


@lru_cache(maxsize=32768)
def relation_roles(text):
    family={'мама','мать','папа','отец','бабушка','дедушка','дочь','дочка','сын','сестра','брат',
            'жена','муж','женщина','мужчина','девушка','парень','коллега','внучка','внук','семья'}
    words=re.findall(r'[а-яё]+',normalized(text));givers=set();receivers=set()
    for index,word in enumerate(words):
        known=word_forms(word)&family
        if not known:continue
        before=words[index-1] if index else ''
        if before=='от':givers|=known
        elif before=='для' or any(p.tag.case=='datv' for p in MORPH.parse(word)):
            receivers|=known
    return frozenset(givers),frozenset(receivers)


def contains_components(query, wording):
    available = components(wording)
    if not all(any(word & other for other in available) for word in components(query)):return False
    def absent_objects(text):
        heads=[]
        for match in re.finditer(r'\bбез\s+([^,;.!?\n]+)',normalized(text)):
            words=re.findall(r'[а-яa-z]+',match.group(1))[:3]
            noun=next((word for word in words if any(p.tag.POS=='NOUN' for p in MORPH.parse(word))),None)
            if noun:heads.append(word_forms(noun))
        return heads
    if any(not any(q & t for t in absent_objects(wording)) for q in absent_objects(query)):return False
    source_givers,source_receivers=relation_roles(query)
    target_givers,target_receivers=relation_roles(wording)
    if not (source_givers<=target_givers and source_receivers<=target_receivers):return False
    if source_givers and source_receivers:
        # A giver and recipient must occur in the same clause. Occasions can
        # follow in a comma-separated list in the containing sentence.
        return any(source_givers<=relation_roles(part)[0] and source_receivers<=relation_roles(part)[1]
                   for part in re.split(r'[,;.!?\n]',wording))
    return True


def literal(phrase, text):
    pattern = r'\s+'.join(re.escape(w) for w in str(phrase).split())
    match = re.search(r'(?<!\w)' + pattern + r'(?!\w)', text, re.I) if pattern else None
    return match.group() if match else ''


def component_witness(query,fields):
    has_roles=any(relation_roles(query))
    for field,text in fields.items():
        direct=literal(query,text)
        if direct:return field,direct
        sentences=[s.strip() for s in re.split(r'(?<=[.!?])\s+|\n',text) if s.strip()]
        candidates=sentences+[part.strip() for part in text.split('\n\n') if part.strip()]
        found=next((part for part in candidates if len(part)<=1500 and contains_components(query,part)),None)
        if found:return field,found
    return '',''


def distributed_witness(query,fields):
    """Return real quotes for a multi-part query; never call this an exact match."""
    for field,text in fields.items():
        if not contains_components(query,text):continue
        candidates=[s.strip() for s in re.split(r'(?<=[.!?])\s+|\n',text) if s.strip()]
        missing=list(components(query));selected=[]
        while missing:
            best=max(candidates,key=lambda p:sum(any(a & b for b in components(p)) for a in missing),default='')
            covered=[a for a in missing if any(a & b for b in components(best))]
            if not covered:break
            selected.append(best);missing=[a for a in missing if a not in covered];candidates.remove(best)
        if missing:continue
        # A separated giver/receiver pair is not evidence of a direction.
        if not contains_components(query,'\n'.join(selected)):continue
        return field,selected
    return '',[]


def query_groups(sources):
    groups = {}
    for index, row in enumerate(sources['semantic']):
        # Word order variants remain listed; negations, materials, numbers,
        # brands, unit words and quantities are never removed from this key.
        signature = (tuple(sorted(min(forms) for forms in components(row['query']))),relation_roles(row['query']))
        entry = groups.setdefault(signature, {'queries': [], 'rowIndices': [], 'counts': []})
        if row['query'] not in entry['queries']:
            entry['queries'].append(row['query'])
        entry['rowIndices'].append(index)
        entry['counts'].append(row.get('count'))
    return {'R' + str(index): group for index, group in enumerate(groups.values())}


def select_phrases(groups, decisions):
    remaining = {key for key, row in decisions.items() if row['status'] == 'use'}
    candidates = list(dict.fromkeys(decisions[key]['wording'] for key in remaining))
    coverage = {phrase: {key for key in remaining if all(contains_components(q, phrase)
                 for q in groups[key]['queries'])} for phrase in candidates}
    chosen, bindings = [], {}
    while remaining:
        best = max(candidates, key=lambda phrase: (len(coverage[phrase] & remaining),
                    -len(phrase)), default='')
        covered = coverage.get(best, set()) & remaining
        if not covered:
            raise CleanError('clean_plan_coverage_missing', {'groups': sorted(remaining)})
        chosen.append(best)
        for key in covered:
            bindings[key] = best
        remaining -= covered
    return chosen, bindings


def own_fields(card):
    fields = factual_evidence(card)
    if card.get('brand'):
        fields['brand'] = card['brand']
    if card.get('subjectName'):
        fields['category'] = card['subjectName']
    return fields






def comparison_fields(card, sources):
    own = {row['id']: row for row in characteristic_rows(card)}
    competitors = {normalized(name): value for name, value in sources['competitor'].get('characteristics',{}).items()}
    definitions = {str(row['id']): row for row in sources['definitions']}
    result = {}
    for aid, definition in definitions.items():
        original = own.get(aid)
        competitor = competitors.get(normalized(definition['name']))
        if original or competitor is not None:
            result[aid] = {'name': definition['name'], 'own': original['values'] if original else [],
                'competitor': competitor, 'maxValues': definition.get('maxCount') or definition.get('max_value_count'),
                'type': definition.get('type')}
    for aid,row in own.items():
        result.setdefault(aid, {'name':row['name'],'own':row['values'],'competitor':competitors.get(normalized(row['name']))})
    return result


def typed_facts(card):
    rows=characteristic_rows(card);own='\n'.join(own_fields(card).values())
    materials='; '.join('; '.join(r['values']) for r in rows if 'материал' in normalized(r['name']))
    colors='; '.join('; '.join(r['values']) for r in rows if 'цвет' in normalized(r['name']))
    quantities=set();persons=set()
    for row in rows:
        name=normalized(row['name']);value='; '.join(row['values'])
        if 'количество предмет' in name or 'количество в упаковке' in name:
            quantities |= {int(v) for v in re.findall(r'\b\d+\b',value)}
        if 'количество персон' in name:
            persons |= {int(v) for v in re.findall(r'\b\d+\b',value)}
    title_persons={int(v) for v in re.findall(r'(\d+)\s*персон',card['title'],re.I)}
    title_totals={int(v) for v in re.findall(r'(\d+)\s*предмет',card['title'],re.I)}
    component_counts=Counter()
    heads={'нож','чашка','кружка','блюдце','супница','бульонница','бокал','подставка'}
    for row in rows:
        if 'комплектац' not in normalized(row['name']):continue
        for value in row['values']:
            for part in re.split(r'[;,\n]',value):
                count=re.findall(r'\b(\d+)\s*(?:шт\b|штук\w*)',part,re.I)
                head=next((next(iter(forms & heads)) for forms in components(part) if forms & heads),None)
                if head and len(count)==1:component_counts[head]+=int(count[0])
    return {'own':own,'materials':materials,'colors':colors,'quantities':quantities or title_totals,'componentCounts':dict(component_counts),
        'persons':persons or title_persons,'titleQuantities':title_totals,'titlePersons':title_persons,'brand':card.get('brand','')}


def typed_query_decision(card,query,facts=None):
    facts=dict(facts or typed_facts(card));text=normalized(query)
    for key in ('colors','materials'):
        if isinstance(facts[key],list):facts[key]='; '.join(facts[key])
    people={int(v) for v in re.findall(r'(\d+)\s*(?:персон|человек)',text)}
    quantities={int(v) for v in re.findall(r'(\d+)\s*(?:предмет|шт\b|штук)',text)}
    quantity_basis=facts['quantities']
    if re.search(r'шт\b|штук',text) and not re.search(r'предмет',text):
        for word in ('нож','чашка','кружка','блюдце','супница','бульонница','бокал'):
            if not any(word in forms for forms in components(query)):continue
            count=facts.get('componentCounts',{}).get(word)
            if count is None and word in {'чашка','кружка'}:
                count=facts.get('componentCounts',{}).get('чашка') or facts.get('componentCounts',{}).get('кружка')
            if count is not None:quantity_basis={count};break
    if quantities and facts['quantities'] and facts['titleQuantities'] and facts['quantities']!=facts['titleQuantities']:
        return 'confirm','Собственное число предметов в заголовке и характеристиках расходится; нельзя выбрать значение по догадке.'
    if people and facts['persons'] and not people <= facts['persons']:
        return 'exclude','В запросе '+', '.join(map(str,sorted(people)))+' персон; собственный набор — '+', '.join(map(str,sorted(facts['persons'])))+' персон.'
    if quantities and quantity_basis and not quantities <= quantity_basis:
        return 'exclude','Число в запросе ('+', '.join(map(str,sorted(quantities)))+') не совпадает с подтверждённым количеством указанного предмета/комплекта: '+', '.join(map(str,sorted(quantity_basis)))+'.'
    colors={'белый','черный','серый','бежевый','молочный','зеленый','оливковый','синий','голубой','розовый','красный','оранжевый','фиолетовый','прозрачный','золотой','серебристый','коричневый','желтый','бирюзовый','бронзовый'}
    query_forms=set().union(*components(query)) if components(query) else set()
    own_color_forms=set().union(*components(facts['colors'])) if facts['colors'] else set()
    color_hits=query_forms & colors
    if color_hits and own_color_forms and not color_hits <= own_color_forms:
        return 'exclude','Цвет запроса ('+', '.join(sorted(color_hits))+') отличается от собственного: '+facts['colors']+'.'
    if color_hits and not own_color_forms:return 'confirm','Цвет в запросе требует собственного подтверждения.'
    for brand in ('luminarc','люминарк','люминар','luminark','kuchenland','кухенленд','taller','attribute','артибут','vellessa','vileda','виледа'):
        if re.search(r'(?<!\w)'+re.escape(brand)+r'(?!\w)',text) and not re.search(r'(?<!\w)'+re.escape(brand)+r'(?!\w)',normalized(facts['brand'])):
            return 'exclude','В запросе чужой бренд '+brand+'; собственный бренд — '+facts['brand']+'.'
    material_roots={'стекло','стеклокерамика','фарфор','керамика','пластик','силикон','сталь','бамбук','дерево'}
    hits=query_forms & material_roots
    supported=set().union(*components(facts['materials'])) if facts['materials'] else set()
    if hits and not hits <= supported:
        return 'confirm','Материал запроса ('+', '.join(sorted(hits))+') не подтверждён собственным полем материалов: '+facts['materials']+'.'
    for pattern,claim in [(r'микроволн|\bсвч\b','использование в СВЧ'),(r'посудомо|посудомой','мытьё в посудомоечной машине'),
                          (r'ударопроч|небьющ','ударопрочность'),(r'термостой','термостойкость'),
                          (r'гравиров|\bименной\b','гравировка или именное оформление')]:
        if re.search(pattern,text) and not re.search(pattern,normalized(facts['own'])):
            return 'confirm','Для свойства «'+claim+'» нужно собственное подтверждение; материал сам по себе его не доказывает.'
    for pattern,claim in [(r'япон|япони','японское происхождение или специальный японский тип'),
                          (r'франц','французское происхождение'),(r'немец|герман','немецкое происхождение')]:
        if re.search(pattern,text) and not re.search(pattern,normalized(facts['own'])):
            return 'confirm','Для запроса нужно подтвердить '+claim+' именно нашего товара; название материала этого не доказывает.'
    if re.search(r'тарел',text) and (re.search(r'глубок|супов|для\s+суп',text)):
        own_plates=re.search(r'(?:глубок\w*|супов\w*)\s+тарел|тарел\w*\s+(?:для\s+суп|глубок|супов)',normalized(facts['own']))
        if not own_plates:return 'confirm','В собственном составе нет подтверждённых глубоких суповых тарелок. Салатники для супа не переименовываются в тарелки автоматически.'
    kit='; '.join('; '.join(r['values']) for r in characteristic_rows(card) if 'комплектац' in normalized(r['name']))
    for pattern,part in [(r'без\s+подставк','подставка'),(r'без\s+круж','кружка'),(r'без\s+чаш','чашка'),(r'без\s+ведр','ведро')]:
        title_proof=(part=='подставка' and re.search(r'(?:с|на)\s+подставк',normalized(card['title'])))
        if re.search(pattern,text) and (title_proof or any(word_forms(part)&forms for forms in components(kit))):
            return 'exclude','Запрос предполагает отсутствие компонента «'+part+'», а собственная комплектация его включает.'
    gift_words={'подарок','подарочный','новогодний','новый','год','день','рождение','рожденье','мать','матери',
        'мама','папа','бабушка','дедушка','дочь','дочка','сын','сестра','брат','жена','муж','женщина','мужчина',
        'девушка','парень','любимый','любимая','коллега','работа','семья','дом','женский','мужской','свой','весь',
        'красивый','хороший','лучший','практичный','полезный','интересный','оригинальный','недорогой','бюджетный',
        'марта','март','февраль','февраля','сентябрь','декабрь','юбилей','папочка','мамочка','взрослый'}
    if re.search(r'подар',text) and re.search(r'подар',normalized(facts['own'])):
        if all(bool(forms & gift_words) or any(form.isdigit() for form in forms) for forms in components(query)):
            return 'use','Подарочный сценарий для взрослого получателя; свой товар уже позиционируется как подарок. Это не утверждение о специальном декоре или новых технических свойствах.'
    if not re.search(r'подар',text) and re.search(r'д[её]нь\s+рожден|днем\s+рожден|дн[её]м\s+матер',text):
        return 'confirm','Поздравительный запрос без указания товара или подарка; нужно отличить поиск поздравления от покупки посуды.'
    tokens=re.findall(r'[а-яёa-z]+',text)
    if len(tokens)==1 and not MORPH.word_is_known(tokens[0]) and not contains_components(query,facts['own']):
        return 'confirm','Термин «'+query+'» не даёт однозначного вида товара; нужно уточнить поисковое намерение или написание.'
    return None


def verified_value(value,field,card):
    name=normalized(field['name']);facts=typed_facts(card)
    if 'количество персон' in name:
        values={int(v) for v in re.findall(r'\b\d+\b',value)}
        if not values or not values <= facts['persons']:return None
    elif 'количество предмет' in name:
        values={int(v) for v in re.findall(r'\b\d+\b',value)}
        if not values or not values <= facts['quantities']:return None
    if 'комплектац' in name and facts['persons'] and facts['quantities']:
        people={int(v) for v in re.findall(r'(\d+)\s*персон',value,re.I)}
        counts={int(v) for v in re.findall(r'(\d+)\s*предмет',value,re.I)}
        if people and counts and people<=facts['persons'] and counts<=facts['quantities']:
            other=re.sub(r'\d+|сервиз|набор|комплект|персон\w*|предмет\w*|для|из|на',' ',normalized(value)).strip()
            if not other:return {'source':'title','quote':card['title']}
    if 'цвет' in name:
        if not facts['colors'] or not contains_components(value,facts['colors']):return None
    if 'особенност' in name:
        mode='microwave' if re.search(r'микроволн|\bсвч\b',normalized(value)) else 'dishwasher' if re.search(r'посудомо|посудомой|\bпмм\b',normalized(value)) else ''
        if mode:
            expression=r'микроволн|\bсвч\b' if mode=='microwave' else r'посудомо|посудомой|\bпмм\b'
            for source,text in own_fields(card).items():
                for part in re.split(r'[\n;]|(?<=[.!?])\s+',text):
                    if re.search(expression,normalized(part)) and not re.search(r'\b(?:не|нельзя|запрещено)\b',normalized(part)):
                        return {'source':source,'quote':part.strip()}
    dimension=any(word in name for word in ('длина','ширина','высота','диаметр','вес','объем'))
    for source,text in own_fields(card).items():
        for part in re.split(r'[\n;]|(?<=[.!?])\s+',text):
            if dimension and not contains_components(field['name'],part):continue
            if contains_components(value,part) and not re.search(r'\b(?:не|нельзя|запрещено)\b',normalized(part)):
                return {'source':source,'quote':part.strip()}
    return None


class CleanRebuilder:
    """Source and coverage checks for an offline specialist review."""

    @staticmethod
    def final_fields(card, attributes, title='',description=''):
        own={row['id']:row['values'] for row in characteristic_rows(card)}
        for aid,row in attributes['fields'].items():
            if row['action'] in {'add','extend'}:own[aid]=row['values']
        return {'заголовок':title,'описание':description,
                'характеристики':'\n'.join('; '.join(v) for v in own.values())}


    @classmethod
    def text_problems(cls,card,attributes,required,text):
        fields=cls.final_fields(card,attributes,text['title'],text['description'])
        issues=[]
        if len(text['title'])>59:issues.append('Заголовок длиннее 59 символов')
        protected=[word for word in re.findall(r'\b[А-ЯЁ][а-яё]{2,}\b',card['title'])[1:]
                   if word not in {'Набор','Посуда','Сервиз','Кружки','Блюдо','Ножи','Швабра','Наборы'}]
        for name in protected:
            if not literal(name,text['title']):issues.append('В заголовке потеряно собственное название серии: '+name)
        title_guard=typed_query_decision(card,text['title'])
        if title_guard:issues.append('Заголовок: '+title_guard[1])
        for phrase in required:
            if not component_witness(phrase,fields)[1]:
                issues.append('Не найдено применение всех значимых слов/уточнений запроса: '+phrase)
        if len(text['description'])<len(plain(card.get('description',''))):issues.append('Описание сокращено относительно исходного')
        if len(text['description'])>5000:issues.append('Описание длиннее 5000 знаков')
        own='\n'.join(own_fields(card).values());final=text['title']+'\n'+text['description']
        facts=typed_facts(card)
        for match in re.finditer(r'\b(?:набор|комплект|сервиз)[^.;!?\n]{0,65}?(\d+)\s+предмет',text['description'],re.I):
            if facts['quantities'] and int(match.group(1)) not in facts['quantities']:
                issues.append('Неверное общее число предметов: '+match.group())
        counts=confirmed_composition(card)
        for match in re.finditer(r'\b(\d+)\s+(нож\w*|тарел\w*|инструмент\w*)',final,re.I):
            head=next(iter(MORPH.parse(match.group(2)))).normal_form
            if head in counts and counts[head]!=int(match.group(1)):
                issues.append('Количество относится к неверному предмету: '+match.group())
        numeric_text=re.sub(r'\b(?:8\s+марта|23\s+февраля|14\s+февраля|1\s+сентября|31\s+декабря)\b','',final,flags=re.I)
        numbers=unsupported_numeric_values(numeric_text,card)
        if numbers:issues.append('Неподтверждённые числа: '+', '.join(sorted(numbers)))
        for claim in unsupported_text_properties(final,own,card):issues.append('Неподтверждённое свойство: '+str(claim))
        for claim in unconfirmed_origin_mentions(final,own):issues.append('Неподтверждённая страна: '+str(claim))
        if re.search(r'\*\*|ownFields|sourceQuestions|в нашей карточке|в собственном описании',final,re.I):issues.append('Редакторские/технические вставки в товарном тексте')
        return issues


    @classmethod
    def verify(cls,card,sources,result):
        if result.get('revision')!=REVISION or result.get('inputHash')!=fingerprint({'revision':REVISION,'card':card,'sources':sources}):
            raise CleanError('clean_source_hash_mismatch')
        if result.get('outputHash')!=fingerprint({key:value for key,value in result.items() if key!='outputHash'}):
            raise CleanError('clean_output_hash_mismatch')
        if [row['query'] for row in result['semanticDecisions']]!=[row['query'] for row in sources['semantic']]:
            raise CleanError('clean_source_rows_lost')
        if len(result['title'])>59 or cls.text_problems(card,result['attributes'],result['requiredPhrases'],result):
            raise CleanError('clean_final_requirements_failed')
        fields=cls.final_fields(card,result['attributes'],result['title'],result['description'])
        fact_profile=typed_facts(card)
        for row in result['semanticDecisions']:
            if row['status'] not in {'use','exclude','confirm'}:raise CleanError('clean_decision_invalid')
            guard=typed_query_decision(card,row['query'],fact_profile) if row['status']=='use' else None
            if guard and guard[0]!='use':raise CleanError('clean_query_fact_mismatch',{'query':row['query'],'reason':guard[1]})
            parts=row.get('witnessParts') or [row.get('witness','')]
            if row['status']=='use' and (not all(part and literal(part,fields.get(row['field'],'')) for part in parts) or not contains_components(row['query'],'\n'.join(parts))):
                raise CleanError('clean_relevant_query_unplaced',{'query':row['query']})
        if not result['quality'].get('audited'):raise CleanError('clean_final_audit_missing')
