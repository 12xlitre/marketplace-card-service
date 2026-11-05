"""Excel review export with bounded sheet count and verified rich text."""
from collections import Counter
from copy import copy
from pathlib import Path
import re

from openpyxl import Workbook, load_workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from automatic_seo import characteristic_rows, normalized, occurrence, plain, SeoError

GREEN, YELLOW, RED, BLUE = 'E2F0D9', 'FFF2CC', 'FCE4D6', '17365D'


def tokens(text):
    return Counter(re.findall(r'\w+', text.casefold().replace('ё', 'е')))


def delta(before, after):
    left, right = tokens(before), tokens(after)
    render = lambda bag: '; '.join(word + (f' ×{n}' if n > 1 else '') for word, n in bag.items()) or 'Нет'
    return render(right - left), render(left - right)


def rich_description(before, after, phrases):
    spans = []
    for phrase in phrases:
        pattern = re.compile(r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', re.I)
        existing = len(list(pattern.finditer(before)))
        spans.extend((m.start(), m.end()) for m in list(pattern.finditer(after))[existing:])
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    result, cursor = CellRichText(), 0
    for start, end in merged:
        if start > cursor:
            result.append(after[cursor:start])
        result.append(TextBlock(InlineFont(b=True), after[start:end]))
        cursor = end
    if cursor < len(after):
        result.append(after[cursor:])
    return result if merged else after


def write(cell, value):
    if isinstance(value, (str, CellRichText)) and len(str(value)) > 32767:
        raise SeoError('seo_excel_cell_too_long', details={
            'sheet': cell.parent.title, 'cell': cell.coordinate, 'characters': len(str(value))})
    cell.value = value
    # External/user/model strings are always text, never executable formulas.
    if isinstance(value, str):
        cell.data_type = 's'


def append(sheet, values):
    # max_row scans every existing cell; doing it for every semantic row
    # makes a large export quadratic. These sheets are written sequentially.
    row = getattr(sheet, '_seo_next_row', None)
    if row is None:
        row = sheet.max_row + 1
    for col, value in enumerate(values, 1):
        if isinstance(value, str) and len(value) > 32767:
            parts = [value[start:start + 32767] for start in range(0, len(value), 32767)]
            columns = getattr(sheet, '_seo_continuation_columns', {})
            checks = getattr(sheet, '_seo_continuation_checks', [])
            extra_columns = []
            for part_number, part in enumerate(parts[1:], 2):
                key = (col, part_number)
                if key not in columns:
                    target = getattr(sheet, '_seo_base_columns', len(values)) + len(columns) + 1
                    columns[key] = target
                    header = sheet.cell(4, target)
                    original = sheet.cell(4, col)
                    write(header, f'{original.value} · продолжение {part_number}')
                    header.font, header.fill = copy(original.font), copy(original.fill)
                    header.alignment = copy(original.alignment)
                    sheet.column_dimensions[get_column_letter(target)].width = 65
                target = columns[key]
                write(sheet.cell(row, target), part)
                sheet.cell(row, target).alignment = Alignment(wrap_text=True, vertical='top')
                extra_columns.append(target)
            checks.append((row, [col] + extra_columns, value))
            sheet._seo_continuation_columns = columns
            sheet._seo_continuation_checks = checks
            value = parts[0]
        cell = sheet.cell(row, col)
        write(cell, value)
        cell.alignment = Alignment(wrap_text=True, vertical='top')
    sheet._seo_next_row = row + 1
    return row


def sheet(wb, name, headers, widths, note):
    ws = wb.create_sheet(name)
    ws._seo_base_columns = len(headers)
    ws.append([name]); ws.append([note]); ws.append([]); ws.append(headers)
    for r in (1, 2):
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=len(headers))
    ws.cell(1, 1).font = Font(name='Calibri', size=17, bold=True, color=BLUE)
    ws.cell(2, 1).alignment = Alignment(wrap_text=True, vertical='top')
    ws.row_dimensions[2].height = 40
    for c in ws[4]:
        c.fill, c.font = PatternFill('solid', fgColor=BLUE), Font(bold=True, color='FFFFFF')
        c.alignment = Alignment(wrap_text=True, vertical='center')
    ws.row_dimensions[4].height = 32
    for col, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(col)].width = width
    ws.freeze_panes = 'C5'
    ws.sheet_view.showGridLines = False
    ws.print_title_rows = '1:4'
    return ws


def changed(cell, old, new):
    cell.fill = PatternFill('solid', fgColor=GREEN if str(old) == str(new) else YELLOW)
    if str(old) != str(new):
        cell.comment = Comment('Прежнее значение:\n' + str(old), 'OptiCards')


def jump(cell, target, row, label):
    write(cell, label)
    cell.hyperlink = f"#'{target}'!A{row}"
    cell.font = Font(color='0563C1', underline='single')


def build_workbook(path, version, previous=None):
    if version.get('workflowRevision') and (version.get('quality', {}).get('state') != 'ready'
            or len(version['results']) != len(version['cards'])
            or any(result.get('quality', {}).get('state') != 'ready' or any(i.get('blocking') for i in result.get('issues', []))
                   for result in version['results'].values())):
        raise SeoError('seo_content_repair_incomplete')
    if version.get('workflowRevision') == 5:
        from automatic_seo import AutomaticSeoService
        for card in version['cards']:
            # The verifier uses no host, network or model.
            AutomaticSeoService.verify_grounded_result(None, card, version['results'][str(card['sku'])])
        return build_clean_workbook(path, {'cards': version['cards'], 'sourceCapturedAt': version['sourceCapturedAt'],
            'period': version['period'], 'sourcesBySku': {sku: row['sources'] for sku, row in version['results'].items()},
            'version': version['number'], 'method': version['method']},
            {sku: row['_groundedReview'] for sku, row in version['results'].items()})
    mass = version.get('workflowRevision') == 4
    wb = Workbook(); wb.remove(wb.active)
    note = f"Версия {version['number']}; методика {version['method']}; данные MPStats {version['period']['d1']} — {version['period']['d2']}; свои данные {version.get('sourceCapturedAt', 'см. запуск')} ."
    if mass:
        note += ' Полное сравнение и рерайт. Семантика показывает измеренные точные вхождения и исходные показатели; решения по выбранным формулировкам приведены отдельно.'
    summary = sheet(wb, 'Итог', ['SKU', 'Артикул', 'Товар', 'Основные проблемы', 'Приоритет', 'Изменений', 'Заголовок', 'Характеристики', 'Описание', 'Вопросов', 'Видимость: начало → конец', 'Дней с наблюдением'], [17,17,40,60,20,12,16,18,16,12,35,24], note)
    sem = sheet(wb, 'Семантика', ['SKU','Запрос','count MPStats','Позиция','Динамика','Проверка вхождения' if mass else 'Релевантность','Размещение в новом тексте' if mass else 'Куда добавить','Комментарий','Источник','Решение по описанию','У конкурента','В нашем тексте','Реальное вхождение'], [17,38,15,14,30,22,22,65,25,25,65,65,45], note + ' count не объявляется месячной частотой без подтверждения единиц; отсутствие наблюдения — пустая ячейка.')
    titles = sheet(wb, 'Заголовки', ['SKU','Артикул','Текущий заголовок','Знаков','Предлагаемый заголовок','Знаков','Добавленные ключи и слова — полный состав','Удалённые слова — полный состав','Обоснование'], [17,17,60,10,70,10,55,55,65], note)
    chars = sheet(wb, 'Характеристики', ['SKU','Артикул','ID','Характеристика','Текущее значение','Предлагаемое значение','Действие','Обоснование','Источник подтверждения'], [17,17,14,32,55,55,17,65,65], note + ' Фильтр «Действие» сначала показывает правки; сохранённые значения доступны при снятии фильтра. Название/аннотация — на профильных листах.')
    descriptions = sheet(wb, 'Описания', ['SKU','Артикул','Существующее описание','Полный рерайт описания' if mass else 'Дополненное описание','Добавленные ключи','Комментарий по изменениям'], [17,17,95,95,45,70], note + ' Новые вхождения ключей выделены настоящим жирным шрифтом.')
    comps = sheet(wb, 'Конкуренты', ['SKU','SKU конкурента','Товар','Дата версии','Почему сопоставим','Исходное описание','Структура','Ключи и решения'] + (['Сравнение нашей карточки с конкурентом и основания MPStats', 'Характеристики: наша карточка и конкурент'] if mass else []), [17,17,55,23,60,95,60,95] + ([100, 95] if mass else []), note + ' Текст из сохранённой версии MPStats, не гарантированная текущая витрина.')
    issues = sheet(wb, 'Противоречия', ['SKU','Поле','Расхождение','Вопрос / решение','Блокирует принятие'], [17,35,80,80,22], note)
    changes = sheet(wb, 'Изменения версии', ['SKU','Раздел','Поле','Прежнее предложение','Новое предложение','Основание'], [17,22,32,75,75,65], 'Сравнение с предыдущим файлом. Первая версия содержит только исходные предложения на профильных листах.')
    bold_expected, counts = {}, {}
    for card in version['cards']:
        sku, article = str(card['sku']), str(card.get('offerId', ''))
        result = version['results'][sku]
        title, desc = result['title']['value'], result['description']['value']
        before_title, before_desc = card.get('title', ''), plain(card.get('description', ''))
        added, removed = delta(before_title, title)
        title_phrases = [q['query'] for q in result['sources']['semantic'] if occurrence(q['query'], title) and not occurrence(q['query'], before_title)]
        added = 'Поисковые фразы: ' + ('; '.join(title_phrases) or 'Нет нового точного вхождения; см. слова и обоснование') + '\nВсе добавленные слова: ' + added
        tr = append(titles, [sku, article, before_title, len(before_title), title, len(title), added, removed, result['title'].get('reason', '')])
        changed(titles.cell(tr, 5), before_title, title)
        titles.row_dimensions[tr].height = 150
        phrases = list(dict.fromkeys(r['outputPhrase'] for r in result['keywords'] if r['decision'] != 'исключить' and r.get('outputPhrase') and r.get('destination') != 'заголовок'))
        rich = rich_description(before_desc, desc, phrases)
        new_phrases = [p for p in phrases if len(re.findall(r'(?<!\w)' + re.escape(p) + r'(?!\w)', desc, re.I)) > len(re.findall(r'(?<!\w)' + re.escape(p) + r'(?!\w)', before_desc, re.I))]
        dr = append(descriptions, [sku, article, before_desc, rich, '; '.join(new_phrases), result['description'].get('reason', '')])
        bold_expected[dr] = rich
        changed(descriptions.cell(dr, 4), before_desc, desc)
        lines = max(sum(max(1, (len(line) + 79) // 80) for line in text.split('\n')) for text in [before_desc, desc])
        descriptions.row_dimensions[dr].height = min(409.5, max(90, lines * 15))
        proposals = {str(r['id']): r for r in result['characteristics']}
        own = characteristic_rows(card)
        existing_ids = {r['id'] for r in own}
        definitions = {str(d['id']): d for d in result['sources']['definitions']}
        all_rows = own + [{'id': aid, 'name': definitions[aid].get('name', aid), 'values': []} for aid in proposals if aid not in existing_ids]
        char_count, first_char = 0, None
        for row in all_rows:
            aid = row['id']
            if card.get('marketplace') != 'Wildberries' and aid in {'4180', '4191'}:
                continue
            proposal = proposals.get(aid)
            old = '; '.join(row['values'])
            new = '; '.join(proposal['values']) if proposal else old
            action = 'оставить' if old == new else ('дополнить' if not old or set(row['values']) < set(proposal['values']) else 'изменить')
            cr = append(chars, [sku, article, aid, row['name'], old, new, action,
                                (proposal.get('reason', '') + ('\nУдаления: ' + '; '.join(f"{r['value']}: {r['reason']}" for r in proposal['removedValues']) if proposal.get('removedValues') else '')) if proposal else 'Корректное исходное значение сохранено.',
                                json_proofs(proposal.get('evidence', [])) if proposal else result['sources'].get('ownSource', 'Свой Ozon Seller API')])
            changed(chars.cell(cr, 6), old, new)
            chars.row_dimensions[cr].height = min(200, max(45, ((max(len(old), len(new)) + 49) // 50) * 15))
            if action == 'оставить':
                chars.row_dimensions[cr].hidden = True
            else:
                char_count += 1
                first_char = first_char or cr
        source = result['sources']
        comp = source['competitor']
        append(comps, [sku, comp['sku'], comp.get('title', ''), comp.get('versionDate', ''), comp.get('reason', '') + '\n' + result.get('compatibility', {}).get('reason', ''), comp['description'], '\n'.join(result['competitorProfile']['structure']),
                       '\n'.join(f"{r['sourcePhrase']} → {r.get('outputPhrase', '')}: {r['decision']}; {r['reason']}" for r in result['keywords'])] + (['\n\n'.join('У конкурента: «' + row['competitorPhrase'] + '». У нас до рерайта: ' + row['before'] + '.\nРешение: ' + row['action'] + '; ' + row['reason'] + '\nВ новом тексте (' + row.get('destination', 'описание') + '): «' + row['after'] + '».\nОснования MPStats: ' + row['mpstats'] for row in result.get('comparison', [])), '\n'.join(row['name'] + ': у нас — ' + row['own'] + '; у конкурента — ' + row['competitor'] for row in result.get('attributeComparison', []))] if mass else []))
        decisions = {r['query']: r for r in result['semanticDecisions']}
        keyword_map = {r['sourcePhrase']: r for r in result['keywords']}
        competitor_phrases = {normalized(r['phrase']): r for r in result['competitorProfile'].get('phrases', [])}
        queries = {r['query']: r for r in source['semantic']}
        for phrase in keyword_map:
            queries.setdefault(phrase, {'query': phrase, 'source': ''})
        for query, q in queries.items():
            decision, keyword = decisions.get(query, {}), keyword_map.get(query, {})
            origin = competitor_phrases.get(normalized(query))
            origin_text = ''
            if origin:
                origin_text = ('Заголовок' if origin.get('source') == 'title' else 'Описание') + ' конкурента: ' + str(origin.get('quote') or origin['phrase'])
                if origin.get('match') == 'without_parenthetical_synonym':
                    origin_text += ' (сопоставление без вставки в скобках)'
            elif not q.get('source'):
                origin_text = 'Текст конкурента'
            source_text = '; '.join(part for part in [q.get('source', ''), f"count SKU {q['countSourceSku']}" if q.get('countSourceSku') else '', origin_text] if part)
            append(sem, [sku, query, q.get('count'), q.get('position'), q.get('dynamics'), decision.get('relevance', 'По решению из текста конкурента'), ('Нет точного вхождения' if mass and decision.get('measurementOnly') and decision.get('destination') == 'не добавлять' else decision.get('destination', 'описание' if keyword.get('decision') != 'исключить' else 'не добавлять')), decision.get('reason', keyword.get('reason', '')), source_text, keyword.get('decision', ''), keyword.get('sourcePhrase', ''), keyword.get('outputPhrase', ''), decision.get('witness', '')])
        first_issue = None
        for issue in result['issues']:
            ir = append(issues, [sku, issue.get('field', ''), issue.get('detail', ''), issue.get('question', ''), 'Да' if issue.get('blocking') else 'Нет'])
            first_issue = first_issue or ir
            for c in issues[ir]:
                c.fill = PatternFill('solid', fgColor=RED)
        count = int(before_title != title) + char_count + int(before_desc != desc)
        counts[sku] = count
        visibility = {str(row.get('data', row.get('date', ''))): row for row in source.get('visibility', []) if isinstance(row, dict) and not row.get('no_data')} if isinstance(source.get('visibility', []), list) else {}
        left = visibility.get(version['period']['d1'], {}).get('search_visibility')
        right = visibility.get(version['period']['d2'], {}).get('search_visibility')
        visibility_delta = f"{left if left is not None else 'нет наблюдения'} → {right if right is not None else 'нет наблюдения'}"
        sr = append(summary, [sku, article, before_title, '; '.join(i.get('field', '') for i in result['issues']), 'Есть вопросы' if result['issues'] else 'Проверить', count, '', '', '', len(result['issues']), visibility_delta, len(visibility)])
        summary.cell(sr, 11).comment = Comment('MPStats search_visibility — исходные единицы API, не проценты. no_data не заменяется нулём.', 'OptiCards')
        jump(summary.cell(sr, 7), 'Заголовки', tr, 'Открыть')
        if first_char:
            jump(summary.cell(sr, 8), 'Характеристики', first_char, f'Правок: {char_count}')
        else:
            write(summary.cell(sr, 8), 'Без изменений')
        jump(summary.cell(sr, 9), 'Описания', dr, 'Открыть')
        if first_issue:
            jump(summary.cell(sr, 10), 'Противоречия', first_issue, str(len(result['issues'])))
            summary.cell(sr, 10).fill = PatternFill('solid', fgColor=RED)
        summary.row_dimensions[sr].height = 48
        if previous and sku in previous.get('results', {}):
            old = previous['results'][sku]
            reason = '\n'.join(r['text'] for r in version['remarks'] if r['sku'] in {'*', sku}) or 'Повторная подготовка'
            for section in ('title', 'description'):
                left, right = old[section]['value'], result[section]['value']
                if left != right:
                    rr = append(changes, [sku, section, section, left, right, reason])
                    changed(changes.cell(rr, 5), left, right)
            old_chars = {str(r['id']): '; '.join(r['values']) for r in old['characteristics']}
            new_chars = {str(r['id']): '; '.join(r['values']) for r in result['characteristics']}
            originals = {r['id']: '; '.join(r['values']) for r in own}
            for aid in sorted(old_chars.keys() | new_chars.keys()):
                left, right = old_chars.get(aid, originals.get(aid, '')), new_chars.get(aid, originals.get(aid, ''))
                if left != right:
                    rr = append(changes, [sku, 'characteristics', aid, left, right, reason])
                    changed(changes.cell(rr, 5), left, right)
    for ws in wb:
        if version['cards'] and all(card.get('marketplace') == 'Wildberries' for card in version['cards']):
            ws.cell(4, 1).value = 'nmID'
        ws.auto_filter.ref = f'A4:{get_column_letter(ws.max_column)}{max(4, ws.max_row)}'
        jump(ws.cell(3, ws.max_column), 'Итог', 4, '← Итог')
    chars.auto_filter.add_filter_column(6, ['дополнить', 'изменить'])
    sem.column_dimensions.group('J', 'M', hidden=True)
    summary.column_dimensions['D'].hidden = True
    summary.column_dimensions['D'].outlineLevel = 1
    summary.column_dimensions.group('K', 'L', hidden=True)
    wb.active = 0
    wb.save(path)
    check = load_workbook(path, rich_text=True)
    for original in wb:
        for row, columns, expected_text in getattr(original, '_seo_continuation_checks', []):
            if ''.join(str(check[original.title].cell(row, col).value or '') for col in columns) != expected_text:
                raise SeoError('seo_export_continuation_mismatch')
    expected = [str(c['sku']) for c in version['cards']]
    if [str(check['Итог'].cell(r, 1).value) for r in range(5, 5 + len(expected))] != expected or len(set(expected)) != len(expected):
        raise SeoError('seo_export_coverage_mismatch')
    for r, value in bold_expected.items():
        saved = check['Описания'].cell(r, 4).value
        if str(saved) != str(value):
            raise SeoError('seo_export_rich_text_mismatch')
        if isinstance(value, CellRichText):
            import xml.etree.ElementTree as ET
            if not isinstance(saved, CellRichText) or ET.tostring(saved.to_tree()) != ET.tostring(value.to_tree()):
                raise SeoError('seo_export_rich_text_mismatch')
    for ws in check:
        for row in ws:
            for cell in row:
                if cell.data_type == 'f':
                    raise SeoError('seo_export_formula_not_allowed')
    if sum(check['Итог'].cell(r, 6).value for r in range(5, 5 + len(expected))) != sum(counts.values()):
        raise SeoError('seo_export_count_mismatch')


def json_proofs(proofs):
    return '\n'.join(f"{p['source']}: {p['quote']}" for p in proofs)


# Source-grounded review layout shared with the offline compiler.
from automatic_seo import CleanError, CleanRebuilder, literal

def grounded_append(sheet,values):
    row=getattr(sheet,'_next_row',5)
    for index,value in enumerate(values,1):
        if isinstance(value,str) and len(value)>32767:raise CleanError('clean_excel_cell_overflow')
        cell=sheet.cell(row,index,value)
        if isinstance(value,str):cell.data_type='s'
        cell.alignment=Alignment(wrap_text=True,vertical='top')
    sheet._next_row=row+1
    return row


def grounded_create_sheet(book,name,headers,widths,note):
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


def grounded_highlight(before,after,phrases):
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


def grounded_words_delta(before,after):
    a=Counter(re.findall(r'\w+',normalized(before)));b=Counter(re.findall(r'\w+',normalized(after)))
    render=lambda values:'; '.join(word+(f' ×{count}' if count>1 else '') for word,count in values.items()) or 'Нет'
    return render(b-a),render(a-b)


def build_clean_workbook(path,packet,results):
    expected=[str(card['sku']) for card in packet['cards']]
    if len(expected)!=len(set(expected)) or set(results)!=set(expected):raise CleanError('clean_excel_incomplete_batch')
    for card in packet['cards']:
        sku=str(card['sku']);CleanRebuilder.verify(card,packet['sourcesBySku'][sku],results[sku])
    note=((('Версия '+str(packet['version'])+'; ') if 'version' in packet else '')+'Независимая сборка, '+str(len(expected))+' карточек. Предложения для проверки специалистом; публикация не выполнялась. '
          'Исходные данные '+packet['sourceCapturedAt']+'; MPStats '+packet['period']['d1']+' — '+packet['period']['d2']+'. '
          'Релевантность оценена по правилам сверки с собственными данными. Адаптации требуют смысловой проверки специалистом. Точное вхождение и свойства на подтверждение показаны раздельно.')
    book=Workbook();book.remove(book.active)
    summary=grounded_create_sheet(book,'Итог',['SKU','Артикул','Товар','Запросов','Релевантных','Исключено','Уточнить применимость','Новых фраз для текста','Правок характеристик','Кандидатов характеристик','Вопросов к своим данным','Заголовок','Характеристики','Описание'],[18,20,55,14,18,16,24,23,23,27,25,20,22,20],note)
    sem=grounded_create_sheet(book,'Семантика',['SKU','Запрос / фраза конкурента','count MPStats','Источник count: SKU','Наблюдения: SKU → средняя позиция','Позиция в начале','Позиция в конце','Динамика','Релевантность','Решение','Куда включён','Формулировка в результате','Тип вхождения','Основание','Тип источника','Цитата из текста конкурента'],[18,43,18,22,55,20,20,38,27,32,25,80,35,100,35,90],note+' Отсутствие наблюдений не означает нулевую позицию. count не объявляется месячной частотностью. Составной запрос подтверждается несколькими настоящими цитатами, разделёнными […]; это не точное вхождение.')
    titles=grounded_create_sheet(book,'Заголовки',['SKU','Артикул','Текущий заголовок','Знаков','Заголовок конкурента','Предлагаемый заголовок','Знаков','Добавленные слова','Удалённые слова','Обоснование'],[18,20,65,12,65,70,12,65,65,100],note+' Лимит новой редакции — 59 символов.')
    chars=grounded_create_sheet(book,'Характеристики',['SKU','Артикул','ID','Характеристика','Текущее значение','У конкурента','Предлагаемое подтверждённое значение','Кандидат после подтверждения','Действие','Основание','Собственный источник'],[18,20,18,38,75,75,75,75,28,110,100],note+' Все строки открыты. Условный кандидат не внесён в подтверждённое значение.')
    descriptions=grounded_create_sheet(book,'Описания',['SKU','Артикул','Существующее описание','Новое описание','Знаков до','Знаков после','Репрезентативные запросы обязательного плана','Примечание'],[18,20,105,105,18,18,85,100],note+' Новые точные формулировки выделены жирным; адаптации показаны на листе «Семантика».')
    comps=grounded_create_sheet(book,'Конкуренты',['SKU','SKU конкурента','Дата снимка','Заголовок','Описание','Характеристики конкурента','Подтверждённые формулировки для новой карточки'],[18,23,30,70,110,110,110],note+' Снимок MPStats не объявляется текущей витриной.')
    questions=grounded_create_sheet(book,'Противоречия',['SKU','Тип','Поле','Наши данные','Источник сравнения / кандидат','Вопрос / условие'],[18,34,40,90,90,120],note+' Условие подтверждения свойства не является технической ошибкой сборки.')
    changes=grounded_create_sheet(book,'Изменения версии',['SKU','Сборка','Изменение'],[18,35,130],note)
    status={'use':'Релевантен','exclude':'Нерелевантен','confirm':'Требует подтверждения'}
    actions={'keep':'Оставить','add':'Добавить','extend':'Дополнить','confirm':'Проверить предложение'}
    own_rows_total=0
    for card in packet['cards']:
        sku=str(card['sku']);article=card.get('offerId','');source=packet['sourcesBySku'][sku];result=results[sku]
        added,removed=grounded_words_delta(card['title'],result['title'])
        tr=grounded_append(titles,[sku,article,card['title'],len(card['title']),source['competitor']['title'],result['title'],len(result['title']),added,removed,'Назначение и поисковые формулировки конкурента адаптированы под собственный товар. Факты, не поместившиеся в заголовок, сохранены в описании и характеристиках.'])
        before=plain(card.get('description',''));after=result['description']
        dr=grounded_append(descriptions,[sku,article,before,grounded_highlight(before,after,result['requiredPhrases']),len(before),len(after),'\n'.join(result['requiredPhrases']),'Собственные факты сохранены. Условные свойства конкурента не выданы за наши. Реальные расхождения собственных источников вынесены отдельно.'])
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
            cr=grounded_append(chars,[sku,article,aid,name,'; '.join(original['values']),str(comp_fields.get(normalized(name),'')),'; '.join(actual),candidate,actions[action],plan['reason'],proof])
            first_char=first_char or cr
            chars.cell(cr,7).fill=PatternFill('solid',fgColor='FFF2CC' if action in {'add','extend'} else 'E2F0D9')
            if candidate:
                chars.cell(cr,8).fill=PatternFill('solid',fgColor='FCE4D6')
                grounded_append(questions,[sku,'Подтверждение свойства',name,'; '.join(original['values']),candidate,plan['reason']])
        for name,value in comp.get('characteristics',{}).items():
            if normalized(name) not in mapped_names:
                own_value=card.get('brand','') if normalized(name)=='бренд' else ''
                grounded_append(chars,[sku,article,'',name,own_value,str(value),own_value,'','Справочно','Поле конкурента показано для сравнения; отсутствует сопоставленное поле в собственном справочнике категории. Значение не перенесено.',source.get('ownSource','')])
        for question in result['attributes']['sourceQuestions']:
            left,right=question['left'],question['right']
            grounded_append(questions,[sku,'Расхождение своих источников',question.get('question',''),left['source']+': «'+left['quote']+'»',right['source']+': «'+right['quote']+'»',question['question']])
        counts=Counter(row['status'] for row in result['semanticDecisions'])
        sr=grounded_append(summary,[sku,article,card['title'],len(source['semantic']),counts['use'],counts['exclude'],counts['confirm'],len(result['requiredPhrases']),changed,conditional,len(result['attributes']['sourceQuestions']),'Открыть','Открыть','Открыть'])
        for column,sheet,row in [(12,'Заголовки',tr),(13,'Характеристики',first_char or 5),(14,'Описания',dr)]:
            summary.cell(sr,column).hyperlink=f"#'{sheet}'!A{row}"
            summary.cell(sr,column).font=Font(color='0563C1',underline='single')
        for raw,decision in zip(source['semantic'],result['semanticDecisions']):
            left,right=raw.get('start'),raw.get('end')
            dynamics=f'{left} → {right}' if left is not None and right is not None else 'Недостаточно данных для расчёта'
            observations='; '.join(str(o.get('sku'))+' → '+str(o.get('averagePosition')) for o in raw.get('observations',[]) if o.get('averagePosition') is not None)
            action='Сохранить / включить' if decision['status']=='use' else 'Исключить из текста' if decision['status']=='exclude' else 'Уточнить применимость'
            grounded_append(sem,[sku,raw['query'],raw.get('count'),str(raw.get('countSourceSku','')),observations,left,right,dynamics,status[decision['status']],action,decision['field'],decision['witness'],decision['match'],decision['reason'],raw.get('sourceKind','MPStats'),raw.get('sourceQuote','')])
        grounded_append(comps,[sku,comp['sku'],comp.get('versionDate',''),comp['title'],comp['description'],'\n'.join(name+': '+str(value) for name,value in comp.get('characteristics',{}).items()),'\n'.join(result['requiredPhrases'])])
        grounded_append(changes,[sku,'Независимая сборка','Использованы только собственная исходная карточка, назначенный конкурент, все исходные строки MPStats и определения полей. Непроверенные предложения прежних методик не использовались.'])
    for sheet in book:
        if packet['cards'] and all(card.get('marketplace') == 'Wildberries' for card in packet['cards']):
            sheet.cell(4,1).value='nmID'
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
    for index,(sku,decision) in enumerate(((str(card['sku']),row) for card in packet['cards']
            for row in results[str(card['sku'])]['semanticDecisions']),5):
        expected_decision=[status[decision['status']],
            'Сохранить / включить' if decision['status']=='use' else 'Исключить из текста' if decision['status']=='exclude' else 'Уточнить применимость',
            decision['field'],decision['witness'],decision['match'],decision['reason']]
        if [loaded['Семантика'].cell(index,column).value or '' for column in range(9,15)]!=expected_decision:
            raise CleanError('clean_excel_decision_changed')
    for index,card in enumerate(packet['cards'],5):
        sku=str(card['sku'])
        if (loaded['Заголовки'].cell(index,3).value!=card['title']
                or loaded['Заголовки'].cell(index,6).value!=results[sku]['title']
                or loaded['Заголовки'].cell(index,7).value!=len(results[sku]['title'])):
            raise CleanError('clean_excel_title_changed')
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
    loaded.close()
    return {'cards':len(expected),'semanticRows':len(source_rows),'ownCharacteristicRows':own_rows_total,
            'exportedCharacteristicRows':loaded['Характеристики'].max_row-4,'sheets':loaded.sheetnames}
