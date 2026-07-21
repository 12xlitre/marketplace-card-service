import unittest

import server


class SemanticCoreFilteringTest(unittest.TestCase):
  def test_characteristic_fragments_are_not_current_keywords(self):
    card = {
      "title": "Леденцы без сахара со вкусом малины",
      "subjectName": "Леденцы",
      "description": "Леденцы без сахара подходят для диабетиков без сахара и ежедневного ухода за рационом.",
      "characteristics": [
        {"name": "Назначение", "value": "при нарушениях углеводного обмена"},
        {"name": "Комплектация", "value": "в одной упаковке блистера леденцов"},
      ],
    }
    rows = [
      {"query": "нарушения углеводного обмена", "wbCount": 12000, "source": "mpstats-expanding"},
      {"query": "одной упаковке блистера леденцов", "wbCount": 3000, "source": "mpstats-expanding"},
      {"query": "леденцы без сахара", "wbCount": 15000, "source": "mpstats-expanding"},
      {"query": "для диабетиков без сахара", "wbCount": 8000, "source": "mpstats-expanding"},
    ]

    current = server.semantic_current_rows_from_card_and_mpstats(card, rows)
    queries = {item["query"] for item in current}

    self.assertIn("леденцы без сахара", queries)
    self.assertIn("для диабетиков без сахара", queries)
    self.assertNotIn("нарушения углеводного обмена", queries)
    self.assertNotIn("одной упаковке блистера леденцов", queries)

  def test_card_content_candidates_require_mpstats_demand(self):
    card = {
      "title": "Леденцы без сахара",
      "subjectName": "Леденцы",
      "description": "Ягодные леденцы без сахара с натуральным вкусом малины.",
      "characteristics": [{"name": "Вкус", "value": "малина натуральная"}],
    }
    rows = [
      {"query": "леденцы без сахара", "wbCount": 9000, "source": "mpstats-expanding"},
    ]

    current = server.semantic_current_rows_from_card_and_mpstats(card, rows)
    queries = {item["query"] for item in current}

    self.assertEqual(queries, {"леденцы без сахара"})

  def test_sunglasses_do_not_accept_frame_queries(self):
    card = {
      "title": "Солнцезащитные очки Polaroid",
      "subjectName": "Солнцезащитные очки",
      "description": "Очки солнцезащитные женские с поляризацией.",
    }
    rows = [
      {"query": "оправа для очков женская", "wbCount": 15000, "source": "mpstats-expanding"},
      {"query": "очки солнцезащитные женские", "wbCount": 18000, "source": "mpstats-expanding"},
    ]

    filtered = server.semantic_filter_mpstats_rows(card, rows)
    queries = {item["query"] for item in filtered}

    self.assertEqual(queries, {"очки солнцезащитные женские"})

  def test_mpstats_keyword_frequency_does_not_fallback_to_cluster(self):
    payload = {
      "data": {
        "words": [
          {
            "query": "мультивитамин c",
            "wb_count": 0,
            "wb_cluster_count": 6053,
            "count": 2,
          }
        ]
      }
    }

    rows = server.audit_keywords_from_payload(payload)

    self.assertEqual(rows[0]["wbCount"], 0)
    self.assertEqual(rows[0]["wbClusterCount"], 6053)
    self.assertEqual(rows[0]["queryCount"], 2)

  def test_mpstats_expansion_does_not_label_wbcount_as_direct_frequency(self):
    row = server.normalize_mpstats_expanding_query({
      "word": "витамины для женщин",
      "wbcount": 40990,
      "norm_query_count": 45349,
      "count": 5772,
    })

    self.assertEqual(row["wbCount"], 0)
    self.assertEqual(row["wbExpansionCount"], 40990)
    self.assertEqual(row["wbClusterCount"], 45349)
    self.assertEqual(row["ozonCount"], 5772)

  def test_semantic_import_preserves_ozon_frequency(self):
    item = server.semantic_import_keyword_item(
      "витамины для женщин",
      "selected",
      {"frequency": "", "ozonFrequency": "5772"},
    )

    self.assertNotIn("wbCount", item)
    self.assertEqual(item["ozonCount"], 5772)


if __name__ == "__main__":
  unittest.main()
