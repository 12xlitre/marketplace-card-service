"""Adapters to existing account access, read-only Seller API and MPStats clients."""
from copy import deepcopy
import json
import re
import time
from urllib.parse import urlencode

from automatic_seo import SeoError, characteristic_rows, normalized, plain


class OzonSeoHost:
    def __init__(self, server):
        self.server = server

    def __getattr__(self, name):
        return getattr(self.server, name)

    def automatic_seo_context(self, portal, batch, user, edit=False):
        h = self.server
        portal = h.ensure_ozon_portal_access(portal, user, edit=edit)
        if not batch or len(batch) > 160:
            raise SeoError('seo_invalid_batch')
        with h.connect_db() as db:
            rows = db.execute('SELECT * FROM ozon_tasks WHERE portal_id = ? ORDER BY created_at, id', (portal,)).fetchall()
        tasks = []
        for row in rows:
            payload = json.loads(row['payload_json'] or '{}')
            if payload.get('batchId') == batch and payload.get('optimizationMode') == 'automatic':
                tasks.append(h.public_ozon_task(row))
        if not tasks:
            raise SeoError('seo_task_not_found', 404)
        tasks.sort(key=lambda task: int(task.get('batchPosition') or 0))
        if len(tasks) > 200 or len({t['sku'] for t in tasks}) != len(tasks) or not all(t['sku'] for t in tasks):
            raise SeoError('seo_invalid_task_scope')
        roles = h.portal_team_roles(portal)
        login = h.user_login_value(user)
        admin = h.user_is_admin(user)
        return {'tasks': tasks, 'marketplace': 'Ozon', 'capabilities': {'prepare': admin or roles.get('tech') == login,
                                                'review': admin or roles.get('manager') == login}}

    def automatic_seo_set_task_status(self, portal, batch, tasks, status, user):
        h = self.server
        current = self.automatic_seo_context(portal, batch, user, edit=True)
        if [(t['id'], t['cardKey'], t['sku']) for t in current['tasks']] != [(t['id'], t['cardKey'], t['sku']) for t in tasks]:
            raise SeoError('seo_task_scope_changed', 409)
        with h.connect_db() as db:
            for task in tasks:
                db.execute('UPDATE ozon_tasks SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE portal_id = ? AND task_id = ?',
                           (status, user['login'], int(portal), task['id']))
                db.execute('INSERT INTO ozon_task_events (portal_id, task_id, card_key, action, label, actor_login, event_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                           (int(portal), task['id'], task['cardKey'], status, 'SEO-файл: ' + h.OZON_TASK_STATUS_LABELS.get(status, status), user['login'], h.utc_now().isoformat()))
            h.sync_work_period_task_statuses_for_batch_in_db(db, int(portal), batch, user)

    def credentials(self, portal):
        h = self.server
        row = h.ozon_connection_row(int(portal))
        if not row:
            raise SeoError('seo_seller_api_not_connected')
        try:
            value = h.decrypt_secret(row['token_nonce'], row['token_ciphertext'], h.integration_aad(int(portal), 'ozon'))
            return h.ozon_credentials_from_payload(json.loads(value))
        except Exception:
            raise SeoError('seo_seller_credentials_unavailable') from None

    def automatic_seo_preflight(self, portal):
        if not self.server.content_reoptimization_configured():
            raise SeoError('seo_llm_not_configured')
        if not self.server.get_service_integration_secret(self.server.MPSTATS_PROVIDER):
            raise SeoError('seo_mpstats_not_connected')
        self.credentials(portal)

    def automatic_seo_chat_completion(self, messages, schema):
        return self.server.audit_llm_chat_completion(messages, response_schema=schema)

    def automatic_seo_chat_text(self, messages):
        return self.server.audit_llm_chat_completion(messages, plain_text=True)

    def automatic_seo_own_cards(self, portal, tasks, user):
        h = self.server
        h.ensure_ozon_portal_access(portal, user, edit=True)
        cards = h.fetch_ozon_seller_cards(self.credentials(portal), scope='selected', manual_source=', '.join(t['sku'] for t in tasks), context={'portalId': int(portal), 'user': user})['cards']
        by_sku = {str(c['sku']): c for c in cards}
        if set(by_sku) != {t['sku'] for t in tasks}:
            raise SeoError('seo_own_coverage_mismatch')
        return [by_sku[t['sku']] for t in tasks]

    def mp(self, path, cache):
        key = 'mp:' + path
        if key not in cache:
            if cache.get('_readOnlyReplay'):
                raise SeoError('seo_recheck_sources_missing')
            token = self.server.get_service_integration_secret(self.server.MPSTATS_PROVIDER)
            if not token:
                raise SeoError('seo_mpstats_not_connected')
            try:
                cache[key] = self.server.mpstats_get_json(token, path, attempts=3)
            except self.server.MpstatsApiError:
                raise SeoError('seo_mpstats_request_failed') from None
        return deepcopy(cache[key])

    def queries(self, sku, period, cache):
        path = f'/analytics/v1/oz/items/{sku}/keywords?{urlencode(period)}'
        data = self.mp(path, cache)
        if isinstance(data, dict) and data.get('no_data'):
            return []
        if not isinstance(data, list):
            raise SeoError('seo_invalid_semantic_response')
        return data

    def automatic_seo_sources(self, portal, card, mapping, period, cache, user):
        self.server.ensure_ozon_portal_access(portal, user, edit=True)
        own_sku, comp_sku = str(card['sku']), mapping['sku']
        comp_key = 'competitor:' + comp_sku
        if comp_key not in cache:
            full = self.mp(f'/analytics/v1/oz/items/{comp_sku}/full?{urlencode(period)}', cache)
            versions = self.mp(f'/analytics/v1/oz/items/{comp_sku}/versions', cache)
            if not isinstance(versions, list) or not versions:
                raise SeoError('seo_competitor_description_missing')
            latest = max(versions, key=lambda row: str(row.get('date', '')))
            version_hash = str(latest.get('version', ''))
            if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', version_hash):
                raise SeoError('seo_invalid_competitor_version')
            version = self.mp(f'/analytics/v1/oz/items/{comp_sku}/versions/{version_hash}', cache)
            description = plain(version.get('description', ''))
            if not description:
                raise SeoError('seo_competitor_description_missing')
            cache[comp_key] = {'sku': comp_sku, 'title': version.get('name') or full.get('name', ''),
                               'description': description, 'versionDate': latest.get('date', ''),
                               'characteristics': dict(zip(version.get('param_names', []), version.get('param_values', []))),
                               'seller': full.get('seller', {})}
        competitor = dict(cache[comp_key], reason=mapping['reason'])
        queries = {}
        for sku in (own_sku, comp_sku):
            rows = self.queries(sku, period, cache)
            for row in rows:
                query = str(row.get('query', '')).strip()
                if query:
                    # Keep separate own and competitor observations; never substitute
                    # competitor's average rank for our current rank.
                    target = queries.setdefault(query, {'query': query, 'source': 'MPStats'})
                    target.setdefault('observations', []).append({'sku': sku, 'count': row.get('count'), 'averagePosition': row.get('avg_position')})
                    if sku == own_sku or 'count' not in target:
                        target['count'], target['countSourceSku'] = row.get('count'), sku
        start = {r['query']: r for r in self.queries(own_sku, {'d1': period['d1'], 'd2': period['d1']}, cache)}
        end = {r['query']: r for r in self.queries(own_sku, {'d1': period['d2'], 'd2': period['d2']}, cache)}
        def position(row):
            if not row or row.get('no_data'):
                return None
            positions = row.get('positions')
            return positions[-1] if isinstance(positions, list) and positions else row.get('position')
        for query, row in queries.items():
            left, right = position(start.get(query)), position(end.get(query))
            row['position'] = right
            row['dynamics'] = f"{left if left is not None else 'нет наблюдения'} → {right if right is not None else 'нет наблюдения'}"
        visibility = self.mp(f'/analytics/v1/oz/items/{own_sku}/by_period?{urlencode(dict(period, withSearchStats="true"))}', cache)
        definitions = card.get('rawFields', {}).get('attributeDefinitions', [])
        if not definitions:
            raise SeoError('seo_official_definitions_missing')
        return {'competitor': competitor, 'semantic': list(queries.values()), 'definitions': definitions,
                'visibility': visibility, 'period': period, 'ownSource': 'Ozon Seller API',
                'ownCharacteristics': characteristic_rows(card)}

    def dictionary(self, portal, card, definition, cache):
        category, type_id = card.get('descriptionCategoryId'), card.get('typeId')
        key = f'dictionary:{category}:{type_id}:{definition["id"]}'
        if key not in cache:
            credentials, output, last = self.credentials(portal), [], 0
            deadline = time.monotonic() + 60
            for _ in range(20):
                data = self.server.ozon_request_json(credentials['clientId'], credentials['apiKey'],
                    '/v1/description-category/attribute/values',
                    {'description_category_id': category, 'type_id': type_id, 'attribute_id': definition['id'],
                     'language': 'RU', 'limit': 1000, 'last_value_id': last}, deadline=deadline, context={'portalId': int(portal)})
                rows = data.get('result')
                if not isinstance(rows, list):
                    raise SeoError('seo_invalid_dictionary_response')
                output.extend(rows)
                if not data.get('has_next'):
                    cache[key] = output
                    break
                next_id = rows[-1].get('id') if rows else None
                if not next_id or next_id == last:
                    raise SeoError('seo_incomplete_dictionary')
                last = next_id
            else:
                raise SeoError('seo_incomplete_dictionary')
        return cache[key]

    def automatic_seo_verify_characteristics(self, portal, card, result, cache, user):
        self.server.ensure_ozon_portal_access(portal, user, edit=True)
        definitions = {str(d['id']): d for d in result['sources']['definitions']}
        own = {r['id']: r for r in characteristic_rows(card)}
        seen = set()
        for proposal in result['characteristics']:
            aid = str(proposal.get('id', ''))
            if aid in seen or aid not in definitions or aid in {'4180', '4191'}:
                raise SeoError('seo_invalid_characteristic_id')
            seen.add(aid)
            values = proposal.get('values')
            if not isinstance(values, list) or not values or not all(isinstance(v, str) and v.strip() for v in values):
                raise SeoError('seo_invalid_characteristic_values')
            if len({normalized(v) for v in values}) != len(values):
                raise SeoError('seo_duplicate_characteristic_values')
            if aid == '23171':
                new_tags = re.findall(r'#\w+', ' '.join(values))
                if len({normalized(v) for v in new_tags}) != len(new_tags):
                    raise SeoError('seo_duplicate_hashtags')
                old_tags = set(re.findall(r'#\w+', ' '.join(own.get(aid, {}).get('values', []))))
                removed = {normalized(r.get('value')) for r in proposal.get('removedValues', []) if r.get('reason')}
                if {normalized(v) for v in old_tags} - {normalized(v) for v in new_tags} - removed:
                    raise SeoError('seo_tag_removal_reason_missing')
            definition = definitions[aid]
            if aid in own and own[aid].get('complexId'):
                raise SeoError('seo_complex_attribute_not_supported')
            maximum = definition.get('max_value_count')
            count = len(new_tags) if aid == '23171' else len(values)
            if maximum and count > int(maximum):
                raise SeoError('seo_characteristic_value_limit')
            if definition.get('dictionary_id'):
                allowed = {normalized(r.get('value')) for r in self.dictionary(portal, card, definition, cache)}
                if any(normalized(v) not in allowed for v in values):
                    raise SeoError('seo_dictionary_value_not_allowed')
            elif definition.get('type') in {'Integer', 'Decimal'}:
                if any(not re.fullmatch(r'-?\d+(?:[.,]\d+)?', v) for v in values):
                    raise SeoError('seo_invalid_numeric_characteristic')


class WbSeoHost(OzonSeoHost):
    def automatic_seo_context(self, portal, batch, user, edit=False):
        h = self.server
        portal = h.wb_automatic_task_scope(portal, user)
        tasks = [t for t in h.list_wb_automatic_tasks(portal, user)['tasks'] if t['batchId'] == batch]
        if not tasks:
            raise SeoError('seo_task_not_found', 404)
        tasks.sort(key=lambda t: int(t['batchPosition']))
        if len(tasks) > 200 or len({t['sku'] for t in tasks}) != len(tasks):
            raise SeoError('seo_invalid_task_scope')
        roles = h.portal_team_roles(portal)
        login, admin = h.user_login_value(user), h.user_is_admin(user)
        return {'marketplace': 'Wildberries', 'tasks': tasks,
                'capabilities': {'prepare': admin or roles.get('tech') == login,
                                 'review': admin or roles.get('manager') == login}}

    def credentials(self, portal):
        token, source = self.server.get_wb_token_for_portal(portal)
        if not token or source != 'encrypted':
            raise SeoError('seo_wb_api_not_connected')
        return token

    def automatic_seo_set_task_status(self, portal, batch, tasks, status, user):
        current = self.automatic_seo_context(portal, batch, user, edit=True)
        if [(t['id'], t['cardKey'], t['sku']) for t in current['tasks']] != [(t['id'], t['cardKey'], t['sku']) for t in tasks]:
            raise SeoError('seo_task_scope_changed', 409)
        with self.server.connect_db() as db:
            db.execute('UPDATE automatic_seo_tasks SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE portal_id=? AND batch_id=?',
                       (status, user['login'], int(portal), batch))
            self.server.sync_work_period_task_statuses_for_batch_in_db(db, int(portal), batch, user)

    def automatic_seo_own_cards(self, portal, tasks, user):
        h = self.server
        h.wb_automatic_task_scope(portal, user)
        cards = h.fetch_wb_content_cards_for_publication(self.credentials(portal))
        by_id = {str(c['nmID']): c for c in cards}
        if not {t['sku'] for t in tasks} <= set(by_id):
            raise SeoError('seo_own_coverage_mismatch')
        output = []
        for task in tasks:
            card = deepcopy(by_id[task['sku']])
            card.update(sku=task['sku'], offerId=card.get('vendorCode', ''), marketplace='Wildberries')
            for row in card.get('characteristics', []):
                row['id'] = row.get('id') or row.get('charcID') or row.get('charcId')
            output.append(card)
        return output

    def queries(self, sku, period, cache):
        h = self.server
        path = f'/analytics/v1/wb/items/{sku}/keywords'
        key = 'wb-keywords:' + sku + ':' + json.dumps(period, sort_keys=True)
        if key not in cache:
            if cache.get('_readOnlyReplay'):
                raise SeoError('seo_recheck_sources_missing')
            output = []
            for start in range(0, 10000, 500):
                try:
                    payload = h.mpstats_post_body_json(h.get_service_integration_secret(h.MPSTATS_PROVIDER), path,
                        body={'startRow': start, 'endRow': start + 500, 'filterModel': {}, 'sortModel': []}, params=period, attempts=2)
                except h.MpstatsApiError:
                    raise SeoError('seo_mpstats_request_failed') from None
                if isinstance(payload, dict) and payload.get('no_data'):
                    break
                rows = payload.get('data', {}).get('words') if isinstance(payload, dict) and isinstance(payload.get('data'), dict) else None
                if rows is None:
                    rows = payload.get('words') if isinstance(payload, dict) else None
                if rows is None:
                    rows = h.audit_extract_list(payload)
                if not isinstance(rows, list):
                    raise SeoError('seo_invalid_semantic_response')
                output.extend(rows)
                if len(rows) < 500:
                    break
            else:
                raise SeoError('seo_semantic_response_too_large')
            cache[key] = output
        return deepcopy(cache[key])

    def automatic_seo_sources(self, portal, card, mapping, period, cache, user):
        h = self.server
        h.wb_automatic_task_scope(portal, user)
        comp = mapping['sku']
        key = 'wb-competitor:' + comp
        if key not in cache:
            versions = h.mpstats_full_page_version_rows(self.mp(f'/wb/get/item/{comp}/full_page/versions', cache))
            if not versions:
                raise SeoError('seo_competitor_description_missing')
            latest = max(versions, key=lambda r: str(r.get('changedAt', '')))
            if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', str(latest['version'])):
                raise SeoError('seo_invalid_competitor_version')
            full = self.mp(f'/wb/get/item/{comp}/full_page?{urlencode({"version": latest["version"]})}', cache)
            if not isinstance(full, dict) or not plain(full.get('description')):
                raise SeoError('seo_competitor_description_missing')
            characteristics = {r['name']: r['value'] for r in h.mpstats_full_page_characteristics(full)}
            if full.get('brand'):
                characteristics['Бренд'] = full['brand']
            cache[key] = {'sku': comp, 'title': full.get('full_name') or full.get('name', ''),
                'description': plain(full['description']), 'versionDate': latest.get('changedAt', ''),
                'characteristics': characteristics}
        def_key = 'wb-definitions:' + str(card.get('subjectID'))
        if def_key not in cache:
            if cache.get('_readOnlyReplay'):
                raise SeoError('seo_recheck_sources_missing')
            cache[def_key] = h.fetch_wb_subject_characteristics(self.credentials(portal), card['subjectID'])['characteristics']
        definitions = [dict(r, id=r['charcID'], max_value_count=r.get('maxCount'),
            type='Decimal' if r.get('charcType') == 4 else 'String') for r in cache[def_key]
            if r.get('charcID') and r.get('charcType') in {1, 4} and not r.get('existNamedField')]
        if not definitions:
            raise SeoError('seo_official_definitions_missing')
        queries = {}
        for sku in (card['sku'], comp):
            for row in self.queries(sku, period, cache):
                query = str(row.get('query') or row.get('keyword') or row.get('word') or '').strip()
                if not query:
                    continue
                target = queries.setdefault(query, {'query': query, 'source': 'MPStats', 'position': None,
                    'dynamics': 'нет наблюдения → нет наблюдения'})
                if sku == card['sku'] or 'countSourceSku' not in target:
                    target.update(count=row.get('count', row.get('query_count')), countSourceSku=sku)
                target.setdefault('observations', []).append({'sku': sku, 'averagePosition': row.get('avg_position')})
        # A period average is not a current rank. Fetch both boundary dates separately.
        for date, field in ((period['d1'], 'start'), (period['d2'], 'end')):
            for row in self.queries(card['sku'], {'d1': date, 'd2': date}, cache):
                query = str(row.get('query') or row.get('keyword') or row.get('word') or '').strip()
                if query in queries:
                    queries[query][field] = row.get('position', row.get('avg_position'))
        for row in queries.values():
            left, right = row.get('start'), row.get('end')
            row['position'] = right
            row['dynamics'] = f'{left if left is not None else "нет наблюдения"} → {right if right is not None else "нет наблюдения"}'
        return {'marketplace': 'Wildberries', 'competitor': dict(cache[key], reason=mapping['reason']),
                'semantic': list(queries.values()), 'definitions': definitions, 'visibility': [], 'period': period,
                'ownSource': 'WB Content API', 'ownCharacteristics': characteristic_rows(card)}

    def automatic_seo_verify_characteristics(self, portal, card, result, cache, user):
        self.server.wb_automatic_task_scope(portal, user)
        definitions = {str(r['id']): r for r in result['sources']['definitions']}
        seen = set()
        for row in result['characteristics']:
            aid, values = str(row.get('id', '')), row.get('values')
            if aid not in definitions or aid in seen:
                raise SeoError('seo_invalid_characteristic_id')
            seen.add(aid)
            if not isinstance(values, list) or not values or not all(isinstance(v, str) and v.strip() for v in values):
                raise SeoError('seo_invalid_characteristic_values')
            if len({normalized(v) for v in values}) != len(values):
                raise SeoError('seo_duplicate_characteristic_values')
            definition = definitions[aid]
            maximum = definition.get('max_value_count') or (1 if definition.get('charcType') == 4 else 0)
            if maximum and len(values) > int(maximum):
                raise SeoError('seo_characteristic_value_limit')
            if definition.get('charcType') == 4 and any(not re.fullmatch(r'-?\d+(?:[.,]\d+)?', v) for v in values):
                raise SeoError('seo_invalid_numeric_characteristic')
            if definition.get('strictValues'):
                allowed = {normalized(v.get('value') or v.get('name')) if isinstance(v, dict) else normalized(v)
                           for v in definition.get('valueOptions', [])}
                if not allowed or any(normalized(v) not in allowed for v in values):
                    raise SeoError('seo_dictionary_value_not_allowed')


class MarketplaceSeoHost:
    def __init__(self, server):
        self.server = server
        self.ozon, self.wb = OzonSeoHost(server), WbSeoHost(server)

    def adapter(self, portal):
        row = self.server.get_portal_row(portal)
        if not row:
            raise SeoError('seo_task_not_found', 404)
        if normalized(row['marketplace']) in {'wildberries', 'wb'}:
            return self.wb
        if normalized(row['marketplace']) == 'ozon':
            return self.ozon
        raise SeoError('seo_unsupported_marketplace')

    def __getattr__(self, name):
        if name in {'automatic_seo_context', 'automatic_seo_set_task_status', 'automatic_seo_preflight',
                    'automatic_seo_own_cards', 'automatic_seo_sources', 'automatic_seo_verify_characteristics'}:
            return lambda portal, *args, **kwargs: getattr(self.adapter(portal), name)(portal, *args, **kwargs)
        return getattr(self.ozon, name)
