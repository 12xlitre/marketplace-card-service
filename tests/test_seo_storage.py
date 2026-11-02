import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from automatic_seo import AutomaticSeoService, CardCache, SeoCache, SeoError, SeoObjects


class SeoStorageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.service = AutomaticSeoService(None, self.directory)

    def legacy(self):
        return {'versions': [{'number': 1, 'taskHash': 'scope', 'status': 'review', 'issues': [],
            'cards': [{'sku': '1', 'description': 'Собственные факты'}],
            'results': {'1': {'title': 'Товар'}},
            'cache': {str(i): {'text': str(i) + 'я' * 4096} for i in range(80)}}]}

    def test_legacy_migration_roundtrip_and_checkpoint_does_not_read_old_values(self):
        original = self.legacy()
        raw = json.dumps(original, ensure_ascii=False).encode()
        (self.directory / 'state.json').write_bytes(raw)
        self.service.save(self.directory, self.service.load(self.directory))
        self.assertEqual((self.directory / 'state-before-object-storage.json').read_bytes(), raw)
        self.assertLess((self.directory / 'state.json').stat().st_size, len(raw) // 8)
        state = self.service.load(self.directory)
        state['versions'].append({'number': 2, 'taskHash': 'scope', 'status': 'running', 'issues': [], 'cache': {}})
        objects = {p.name: p.stat().st_mtime_ns for p in (self.directory / 'objects').glob('*.json')}
        with patch.object(SeoObjects, 'get', side_effect=AssertionError('Historical values loaded during checkpoint')):
            self.service.save(self.directory, state)
        self.assertEqual(objects, {p.name: p.stat().st_mtime_ns for p in (self.directory / 'objects').glob('*.json')})
        loaded = self.service.load(self.directory)
        self.assertEqual(loaded['versions'][0]['cards'], original['versions'][0]['cards'])
        self.assertEqual(loaded['versions'][0]['cache']['79'], original['versions'][0]['cache']['79'])
        self.assertEqual((self.directory / 'objects').stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in (self.directory / 'objects').glob('*.json')))

    def test_cache_snapshots_and_card_caches_isolate_nested_changes(self):
        self.service.save(self.directory, self.legacy())
        first = self.service.load(self.directory)['versions'][0]['cache']
        self.assertIsInstance(first, SeoCache)
        second = deepcopy(first)
        card = CardCache(first)
        card['0']['text'] = 'changed'
        self.assertNotEqual(first['0'], card['0'])
        first['0'] = card['0']
        first.flush()
        self.assertNotEqual(first['0'], second['0'])
        self.assertEqual(second['0']['text'], '0' + 'я' * 4096)

    def test_corrupt_or_escaped_reference_is_rejected(self):
        store = SeoObjects(self.directory)
        digest = store.put({'private': 'fact'})
        (store.directory / (digest + '.json')).write_text('{}')
        with self.assertRaisesRegex(SeoError, 'seo_snapshot_invalid'):
            store.get(digest)
        with self.assertRaisesRegex(SeoError, 'seo_snapshot_invalid'):
            store.get('../../outside')

    def test_missing_object_never_reads_data_from_another_batch(self):
        one, two = SeoObjects(self.directory / 'one'), SeoObjects(self.directory / 'two')
        one.directory.parent.mkdir()
        two.directory.parent.mkdir()
        digest = one.put({'fact': 'tenant one'})
        with self.assertRaisesRegex(SeoError, 'seo_snapshot_missing'):
            two.get(digest)
