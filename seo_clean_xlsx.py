"""Readable source-only SEO review workbook; no hidden source or decision rows."""
from collections import Counter
from pathlib import Path
import re

from openpyxl import Workbook,load_workbook
from openpyxl.cell.rich_text import CellRichText,TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.styles import Alignment,Font,PatternFill
from openpyxl.utils import get_column_letter

from automatic_seo import characteristic_rows,plain
from seo_clean_rebuild import CleanError,CleanRebuilder,literal,normalized


def append(sheet,values):
    row=getattr(sheet,'_next_row',5)
    for index,value in enumerate(values,1):
        if isinstance(value,str) and len(value)>32767:raise CleanError('clean_excel_cell_overflow')
        cell=sheet.cell(row,index,value)
        if isinstance(value,str):cell.data_type='s'
        cell.alignment=Alignment(wrap_text=True,vertical='top')
    sheet._next_row=row+1
    return row


def create_sheet(book,name,headers,widths,note):
    sheet=book.create_sheet(name)
    sheet.append([name]);sheet.append([note]);sheet.append([]);sheet.append(headers)
    sheet.merge_cells(start_row=2,start_column=1,end_row=2,end_column=len(headers))
    sheet.cell(2,1).alignment=Alignment(wrap_text=True,vertical='top')
    sheet.row_dimensions[2].height=65
    for cell in sheet[4]:
        cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='17365D')
        cell.alignment=Alignment(wrap_text=True,vertical='top')
    for index,width in enumerate(widths,1):sheet.column_dimensions[get_column_letter(index)].width=width
    sheet.freeze_panes='C5'
    return sheet


def highlight(before,after,phrases):
    spans=[]
    for phrase in phrases:
        if literal(phrase,before):continue
        spans.extend((m.start(),m.end()) for m in re.finditer(r'(?<!\w)'+re.escape(phrase)+r'(?!\w)',after,re.I))
    merged=[]
    for start,end in sorted(spans):
        if merged and start<=merged[-1][1]:merged[-1]=(merged[-1][0],max(end,merged[-1][1]))
        else:merged.append((start,end))
    if not merged:return after
    rich=CellRichText();cursor=0
    for start,end in merged:
        if cursor<start:rich.append(after[cursor:start])
        rich.append(TextBlock(InlineFont(b=True),after[start:end]));cursor=end
    if cursor<len(after):rich.append(after[cursor:])
    return rich


def words_delta(before,after):
    a=Counter(re.findall(r'\w+',normalized(before)));b=Counter(re.findall(r'\w+',normalized(after)))
    render=lambda values:'; '.join(word+(f' ×{count}' if count>1 else '') for word,count in values.items()) or 'Нет'
    return render(b-a),render(a-b)


def build_clean_workbook(path,packet,results):
    expected=[str(card['sku']) for card in packet['cards']]
    if len(expected)!=len(set(expected)) or set(results)!=set(expected):raise CleanError('clean_excel_incomplete_batch')
    for card in packet['cards']:
        sku=str(card['sku']);CleanRebuilder.verify(card,packet['sourcesBySku'][sku],results[sku])
    note=('Новая независимая сборка JEWEL, '+str(len(expected))+' карточек. Предложения для проверки специалистом; публикация не выполнялась. '
          'Исходные данные '+packet['sourceCapturedAt']+'; MPStats '+packet['period']['d1']+' — '+packet['period']['d2']+'. '
          'Релевантность оценена по правилам сверки с собственными данными. Адаптации требуют смысловой проверки специалистом. Точное вхождение и свойства на подтверждение показаны раздельно.')
    book=Workbook();book.remove(book.active)
    summary=create_sheet(book,'Итог',['nmID','Артикул','Товар','Запросов','Релевантных','Исключено','Уточнить применимость','Новых фраз для текста','Правок характеристик','Кандидатов характеристик','Вопросов к своим данным','Заголовок','Характеристики','Описание'],[18,20,55,14,18,16,24,23,23,27,25,20,22,20],note)
    sem=create_sheet(book,'Семантика',['nmID','Запрос / фраза конкурента','count MPStats','Источник count: SKU','Наблюдения: SKU → средняя позиция','Позиция в начале','Позиция в конце','Динамика','Релевантность','Решение','Куда включён','Формулировка в результате','Тип вхождения','Основание','Тип источника','Цитата из текста конкурента'],[18,43,18,22,55,20,20,38,27,32,25,80,35,100,35,90],note+' Отсутствие наблюдений не означает нулевую позицию. count не объявляется месячной частотностью. Составной запрос подтверждается несколькими настоящими цитатами, разделёнными […]; это не точное вхождение.')
    titles=create_sheet(book,'Заголовки',['nmID','Артикул','Текущий заголовок','Знаков','Заголовок конкурента','Предлагаемый заголовок','Знаков','Добавленные слова','Удалённые слова','Обоснование'],[18,20,65,12,65,70,12,65,65,100],note+' Лимит новой редакции — 59 символов.')
    chars=create_sheet(book,'Характеристики',['nmID','Артикул','ID','Характеристика','Текущее значение','У конкурента','Предлагаемое подтверждённое значение','Кандидат после подтверждения','Действие','Основание','Собственный источник'],[18,20,18,38,75,75,75,75,28,110,100],note+' Все строки открыты. Условный кандидат не внесён в подтверждённое значение.')
    descriptions=create_sheet(book,'Описания',['nmID','Артикул','Существующее описание','Новое описание','Знаков до','Знаков после','Репрезентативные запросы обязательного плана','Примечание'],[18,20,105,105,18,18,85,100],note+' Новые точные формулировки выделены жирным; адаптации показаны на листе «Семантика».')
    comps=create_sheet(book,'Конкуренты',['nmID','SKU конкурента','Дата снимка','Заголовок','Описание','Характеристики конкурента','Подтверждённые формулировки для новой карточки'],[18,23,30,70,110,110,110],note+' Снимок MPStats не объявляется текущей витриной.')
    questions=create_sheet(book,'Противоречия',['nmID','Тип','Поле','Наши данные','Источник сравнения / кандидат','Вопрос / условие'],[18,34,40,90,90,120],note+' Условие подтверждения свойства не является технической ошибкой сборки.')
    changes=create_sheet(book,'Изменения версии',['nmID','Сборка','Изменение'],[18,35,130],note)
    status={'use':'Релевантен','exclude':'Нерелевантен','confirm':'Требует подтверждения'}
    actions={'keep':'Оставить','add':'Добавить','extend':'Дополнить','confirm':'Проверить предложение'}
    own_rows_total=0
    for card in packet['cards']:
        sku=str(card['sku']);article=card.get('offerId','');source=packet['sourcesBySku'][sku];result=results[sku]
        added,removed=words_delta(card['title'],result['title'])
        tr=append(titles,[sku,article,card['title'],len(card['title']),source['competitor']['title'],result['title'],len(result['title']),added,removed,'Назначение и поисковые формулировки конкурента адаптированы под собственный товар. Факты, не поместившиеся в заголовок, сохранены в описании и характеристиках.'])
        before=plain(card.get('description',''));after=result['description']
        dr=append(descriptions,[sku,article,before,highlight(before,after,result['requiredPhrases']),len(before),len(after),'\n'.join(result['requiredPhrases']),'Собственные факты сохранены. Условные свойства конкурента не выданы за наши. Реальные расхождения собственных источников вынесены отдельно.'])
        comp=source['competitor'];comp_fields={normalized(name):value for name,value in comp.get('characteristics',{}).items()}
        own={row['id']:row for row in characteristic_rows(card)};own_rows_total+=len(own)
        definitions={str(row['id']):row for row in source['definitions']}
        all_ids=list(own)+[aid for aid in result['attributes']['fields'] if aid not in own]
        first_char=None;changed=0;conditional=0;mapped_names=set()
        for aid in all_ids:
            original=own.get(aid,{'name':definitions.get(aid,{}).get('name',aid),'values':[]})
            plan=result['attributes']['fields'].get(aid,{'action':'keep','values':original['values'],'reason':'Исходное собственное поле сохранено.','evidence':[]})
            name=original['name'];mapped_names.add(normalized(name));action=plan['action']
            actual=plan['values'] if action in {'add','extend'} else original['values']
            candidate='; '.join(plan['values'] if action=='confirm' else plan.get('conditionalValues',[]))
            changed+=action in {'add','extend'};conditional+=bool(candidate)
            proof='\n'.join(p['source']+': «'+p['quote']+'»' for p in plan.get('evidence',[])) or source.get('ownSource','Собственная карточка')
            cr=append(chars,[sku,article,aid,name,'; '.join(original['values']),str(comp_fields.get(normalized(name),'')),'; '.join(actual),candidate,actions[action],plan['reason'],proof])
            first_char=first_char or cr
            chars.cell(cr,7).fill=PatternFill('solid',fgColor='FFF2CC' if action in {'add','extend'} else 'E2F0D9')
            if candidate:
                chars.cell(cr,8).fill=PatternFill('solid',fgColor='FCE4D6')
                append(questions,[sku,'Подтверждение свойства',name,'; '.join(original['values']),candidate,plan['reason']])
        for name,value in comp.get('characteristics',{}).items():
            if normalized(name) not in mapped_names:
                own_value=card.get('brand','') if normalized(name)=='бренд' else ''
                append(chars,[sku,article,'',name,own_value,str(value),own_value,'','Справочно','Поле конкурента показано для сравнения; отсутствует сопоставленное поле в собственном справочнике категории. Значение не перенесено.',source.get('ownSource','')])
        for question in result['attributes']['sourceQuestions']:
            left,right=question['left'],question['right']
            append(questions,[sku,'Расхождение своих источников',question.get('question',''),left['source']+': «'+left['quote']+'»',right['source']+': «'+right['quote']+'»',question['question']])
        counts=Counter(row['status'] for row in result['semanticDecisions'])
        sr=append(summary,[sku,article,card['title'],len(source['semantic']),counts['use'],counts['exclude'],counts['confirm'],len(result['requiredPhrases']),changed,conditional,len(result['attributes']['sourceQuestions']),'Открыть','Открыть','Открыть'])
        for column,sheet,row in [(12,'Заголовки',tr),(13,'Характеристики',first_char or 5),(14,'Описания',dr)]:
            summary.cell(sr,column).hyperlink=f"#'{sheet}'!A{row}"
            summary.cell(sr,column).font=Font(color='0563C1',underline='single')
        for raw,decision in zip(source['semantic'],result['semanticDecisions']):
            left,right=raw.get('start'),raw.get('end')
            dynamics=f'{left} → {right}' if left is not None and right is not None else 'Недостаточно данных для расчёта'
            observations='; '.join(str(o.get('sku'))+' → '+str(o.get('averagePosition')) for o in raw.get('observations',[]) if o.get('averagePosition') is not None)
            action='Сохранить / включить' if decision['status']=='use' else 'Исключить из текста' if decision['status']=='exclude' else 'Уточнить применимость'
            append(sem,[sku,raw['query'],raw.get('count'),str(raw.get('countSourceSku','')),observations,left,right,dynamics,status[decision['status']],action,decision['field'],decision['witness'],decision['match'],decision['reason'],raw.get('sourceKind','MPStats'),raw.get('sourceQuote','')])
        append(comps,[sku,comp['sku'],comp.get('versionDate',''),comp['title'],comp['description'],'\n'.join(name+': '+str(value) for name,value in comp.get('characteristics',{}).items()),'\n'.join(result['requiredPhrases'])])
        append(changes,[sku,'Независимая сборка','Использованы только собственная исходная карточка, назначенный конкурент, все исходные строки MPStats и определения полей. Старые сгенерированные предложения v1–v13 не использовались.'])
    for sheet in book:
        sheet.auto_filter.ref=f'A4:{get_column_letter(sheet.max_column)}{sheet.max_row}'
        for row in range(5,sheet.max_row+1):sheet.row_dimensions[row].height=60 if sheet.title not in {'Описания','Конкуренты'} else 409
    path=Path(path);book.save(path)
    loaded=load_workbook(path,rich_text=True)
    for name in ('Итог','Заголовки','Описания','Конкуренты','Изменения версии'):
        if [str(loaded[name].cell(row,1).value) for row in range(5,loaded[name].max_row+1)]!=expected:raise CleanError('clean_excel_card_order')
    source_rows=[(str(card['sku']),row) for card in packet['cards'] for row in packet['sourcesBySku'][str(card['sku'])]['semantic']]
    if loaded['Семантика'].max_row!=len(source_rows)+4:raise CleanError('clean_excel_query_count')
    for index,(sku,row) in enumerate(source_rows,5):
        actual=loaded['Семантика']
        if (str(actual.cell(index,1).value),actual.cell(index,2).value,actual.cell(index,3).value,str(actual.cell(index,4).value or ''))!=(sku,row['query'],row.get('count'),str(row.get('countSourceSku',''))):
            raise CleanError('clean_excel_source_values_lost')
        if (actual.cell(index,15).value,actual.cell(index,16).value or '')!=(row.get('sourceKind','MPStats'),row.get('sourceQuote','')):
            raise CleanError('clean_excel_source_origin_lost')
    for index,card in enumerate(packet['cards'],5):
        sku=str(card['sku'])
        if str(loaded['Описания'].cell(index,4).value)!=results[sku]['description']:raise CleanError('clean_excel_description_changed')
    if any(d.hidden for sheet in loaded for d in sheet.row_dimensions.values()):raise CleanError('clean_excel_hidden_rows')
    if any(d.hidden for sheet in loaded for d in sheet.column_dimensions.values()):raise CleanError('clean_excel_hidden_columns')
    own_expected={(str(c['sku']),r['id']):(r['name'],'; '.join(r['values'])) for c in packet['cards'] for r in characteristic_rows(c)}
    own_found={}
    for row in loaded['Характеристики'].iter_rows(min_row=5,values_only=True):
        key=(str(row[0]),str(row[2] or ''))
        if key in own_expected:own_found[key]=(row[3],row[4] or '')
    if own_found!=own_expected:raise CleanError('clean_excel_own_characteristics_lost')
    if any(cell.data_type=='f' for sheet in loaded for row in sheet for cell in row):raise CleanError('clean_excel_formula')
    return {'cards':len(expected),'semanticRows':len(source_rows),'ownCharacteristicRows':own_rows_total,
            'exportedCharacteristicRows':loaded['Характеристики'].max_row-4,'sheets':loaded.sheetnames}
