import json
import unittest
from unittest.mock import patch

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

  def test_desired_keywords_are_promoted_for_direct_entry(self):
    target = server.content_reoptimization_target_keywords(
      [{"query": "оправа для очков женская круглая", "wbCount": 5000}],
      [],
      [],
    )

    prioritized = server.content_reoptimization_prioritize_desired_keywords(
      target,
      [{"query": "оправа для очков женская круглая"}],
    )

    self.assertEqual(prioritized[0]["query"], "оправа для очков женская круглая")
    self.assertEqual(prioritized[0]["semanticSource"], "desired")
    self.assertEqual(prioritized[0]["semanticOrigin"], "added")
    self.assertTrue(prioritized[0]["desired"])
    self.assertTrue(prioritized[0]["directEntry"])

  def test_direct_desired_keyword_is_inserted_into_description(self):
    card = {
      "title": "Солнцезащитные очки Polaroid мужские",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города и отдыха.",
      "characteristics": [
        {"name": "Цвет", "value": "черный"},
        {"name": "Цвет линз", "value": "серый"},
      ],
    }
    query = "очки мужские солнцезащитные стильные"

    result = server.content_reoptimization_apply_direct_desired_keywords(
      "Солнцезащитные очки Polaroid подходят для яркого дня, прогулок и поездок.",
      card,
      [{"query": query, "semanticSource": "desired", "desired": True, "directEntry": True}],
    )

    self.assertTrue(server.content_contains_exact_keyword(result, query))
    self.assertLessEqual(len(result), server.CONTENT_REOPTIMIZE_DESCRIPTION_LIMIT)

  def test_direct_desired_keyword_skips_unconfirmed_polarization(self):
    card = {
      "title": "Солнцезащитные очки Polaroid мужские",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города и отдыха.",
      "characteristics": [{"name": "Цвет линз", "value": "серый"}],
    }
    query = "очки солнцезащитные мужские поляризационные"

    result = server.content_reoptimization_apply_direct_desired_keywords(
      "Солнцезащитные очки Polaroid подходят для яркого дня, прогулок и поездок.",
      card,
      [{"query": query, "semanticSource": "desired", "desired": True, "directEntry": True}],
    )

    self.assertFalse(server.content_contains_exact_keyword(result, query))

  def test_reoptimization_result_reports_desired_direct_entry_usage(self):
    card = {
      "title": "Солнцезащитные очки Polaroid мужские",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города и отдыха.",
      "characteristics": [
        {"name": "Цвет", "value": "черный"},
        {"name": "Цвет линз", "value": "серый"},
      ],
    }
    query = "очки мужские солнцезащитные стильные"
    llm_body = {
      "title": {"value": "Солнцезащитные очки мужские Polaroid", "reason": "test"},
      "description": {
        "value": "Солнцезащитные очки Polaroid подходят для яркого дня, прогулок и поездок.",
        "reason": "test",
      },
      "characteristics": [],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "367373520",
        card,
        desired_keywords=[{"query": query}],
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    optimization = result["contentOptimization"]
    self.assertTrue(server.content_contains_exact_keyword(description, query))
    self.assertIn(query, optimization["desiredKeywordsUsed"])
    self.assertEqual(optimization["desiredKeywordsUnused"], [])
    self.assertEqual(list(result["draftContent"].keys()), ["description"])

  def test_reoptimization_passes_specialist_revision_instruction(self):
    card = {
      "title": "ТРАВЕРИН растительные леденцы для горла малина",
      "subjectName": "Леденцы",
      "description": "Растительные леденцы для горла со вкусом малины.",
      "characteristics": [{"name": "Вкус", "value": "малина"}],
    }
    llm_body = {
      "title": {"value": "ТРАВЕРИН леденцы для горла малина", "reason": "test"},
      "description": {
        "value": "ТРАВЕРИН - растительные леденцы для горла с малиновым вкусом. Формат помогает смягчить ощущение першения и сухости.",
        "reason": "Учтена инструкция специалиста.",
      },
      "characteristics": [],
      "_meta": {"warnings": []},
    }
    captured = {}

    def fake_llm(messages):
      captured["messages"] = messages
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "traverin-1",
        card,
        selected_keywords=[{"query": "леденцы для горла"}],
        draft={"description": "Старый черновик с повтором слова леденцы."},
        revision_instruction="Сделай мягче и убери медицинские обещания.",
        sections=["description"],
      )

    evidence = json.loads(captured["messages"][1]["content"])["evidenceBundle"]
    self.assertEqual(evidence["revision"]["mode"], "guided_variant")
    self.assertIn("Сделай мягче", evidence["revision"]["instruction"])
    self.assertEqual(evidence["draft"]["description"], "Старый черновик с повтором слова леденцы.")
    self.assertEqual(result["contentOptimization"]["revisionMode"], "guided_variant")
    self.assertIn("Сделай мягче", result["contentOptimization"]["revisionInstruction"])

  def test_output_leaks_and_unconfirmed_claims_are_removed(self):
    card = {
      "title": "ТРАВЕРИН растительные леденцы для горла малина",
      "subjectName": "категория не указана",
      "description": "Леденцы для горла со вкусом малины.",
      "characteristics": [
        {"name": "Вкус", "value": "малина"},
        {"name": "Возрастные ограничения", "value": "18+"},
      ],
    }
    text = (
      "ТРАВЕРИН относится к категории категория не указана. "
      "Модель МД ТРЕЙД рассчитана на прогулки и отдых. "
      "Леденцы без сахара подходят для диабетиков. "
      "Леденцы для горла помогают смягчить слизистую."
    )

    cleaned = server.content_reoptimization_remove_output_leaks(text, card=card)

    self.assertNotIn("категория не указана", cleaned)
    self.assertNotIn("Модель МД ТРЕЙД", cleaned)
    self.assertNotIn("без сахара", cleaned)
    self.assertNotIn("диабет", cleaned)
    self.assertIn("Леденцы для горла помогают смягчить слизистую", cleaned)

  def test_lozenge_medical_indications_are_removed(self):
    card = {
      "title": "ТРАВЕРИН растительные леденцы для горла лимон",
      "subjectName": "категория не указана",
      "description": "Растительные леденцы для горла со вкусом лимона.",
      "characteristics": [{"name": "Вкус", "value": "лимон"}],
    }
    text = (
      "ТРАВЕРИН лечит боль в горле. "
      "Для смягчения горла при фарингите, ларингите, трахеите, бронхите и ангине. "
      "Леденцы для горла помогают смягчить слизистую и уменьшить ощущение першения."
    )

    cleaned = server.content_reoptimization_remove_output_leaks(text, card=card)

    self.assertNotIn("лечит", cleaned.lower())
    self.assertNotIn("фарингит", cleaned.lower())
    self.assertNotIn("ларингит", cleaned.lower())
    self.assertNotIn("трахеит", cleaned.lower())
    self.assertNotIn("бронхит", cleaned.lower())
    self.assertNotIn("ангин", cleaned.lower())
    self.assertIn("першения", cleaned.lower())

  def test_traverin_lozenge_description_uses_taste_composition_and_pack(self):
    card = {
      "title": "ТРАВЕРИН растительные леденцы для горла лимон",
      "subjectName": "категория не указана",
      "description": "Растительные леденцы для горла со вкусом лимона. В составе солодка, имбирь, амла, терминалия белерика.",
      "characteristics": [
        {"name": "Вкус", "value": "лимон"},
        {"name": "Состав", "value": "солодка, имбирь, амла, терминалия белерика"},
        {"name": "Количество в упаковке", "value": "2 блистера по 8 леденцов"},
        {"name": "Способ применения", "value": "по 1 леденцу 3 раза в день после еды"},
        {"name": "Возрастные ограничения", "value": "18+"},
      ],
    }
    facts = {
      server.audit_normalized(row["name"]): row["value"].split(", ") if row["name"] == "Состав" else [row["value"]]
      for row in card["characteristics"]
    }

    description = server.content_reoptimization_lozenge_description(
      card,
      [
        {"query": "пастилки для горла"},
        {"query": "сухость в горле"},
        {"query": "для голоса"},
        {"query": "солодка"},
      ],
      facts,
    )

    self.assertIn("ТРАВЕРИН - растительные леденцы для горла", description)
    self.assertIn("голос", description.lower())
    self.assertIn("солодка", description.lower())
    self.assertIn("имбирь", description.lower())
    self.assertIn("амла", description.lower())
    self.assertIn("16 леденцов в упаковке", description)
    self.assertNotIn("лечит", description.lower())

  def test_lozenge_expansion_seeds_include_requested_buyer_queries(self):
    card = {
      "title": "ТРАВЕРИН растительные леденцы для горла малина",
      "description": "В составе солодка, имбирь, амла. Натуральный растительный состав помогает при першении в горле.",
      "subjectName": "категория не указана",
    }

    seeds = server.mpstats_expanding_seed_queries(card, "")

    self.assertIn("пастилки для горла", seeds)
    self.assertIn("сухость в горле", seeds)
    self.assertIn("першение в горле", seeds)
    self.assertIn("для голоса", seeds)
    self.assertIn("натуральный состав", seeds)
    self.assertIn("солодка", seeds)

  def test_avitabs_men_women_description_gets_adult_limit(self):
    card = {
      "title": "Авитабс Women витамины для женщин",
      "subjectName": "БАДы",
      "description": "Комплекс витаминов и минералов для женщин.",
    }

    description = server.content_reoptimization_apply_client_postprocess(
      "Авитабс Women помогает дополнить рацион витаминами и минералами.",
      card,
    )

    self.assertIn("с 18 лет", description)

  def test_lozenge_reoptimization_recovers_from_generic_template_output(self):
    card = {
      "title": "ТРАВЕРИН растительные леденцы для горла малина",
      "subjectName": "категория не указана",
      "brand": "МД ТРЕЙД",
      "description": "Растительные леденцы для горла со вкусом малины. Для взрослых старше 18 лет.",
      "characteristics": [
        {"name": "Вкус", "value": "малина"},
        {"name": "Количество в упаковке", "value": "2 блистера по 8 леденцов"},
        {"name": "Способ применения", "value": "по 1 леденцу 3 раза в день после еды"},
        {"name": "Возрастные ограничения", "value": "18+"},
      ],
    }
    llm_body = {
      "title": {"value": "Леденцы для горла ТРАВЕРИН", "reason": "test"},
      "description": {
        "value": (
          "ТРАВЕРИН относится к категории категория не указана. "
          "Модель МД ТРЕЙД рассчитана на регулярное использование, дорогу, прогулки и отдых. "
          "Назначение, материалы, цвет, комплект и размеры лучше держать в отдельных фразах. "
          "Леденцы без сахара подходят для диабетиков."
        ),
        "reason": "test",
      },
      "characteristics": [],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "936467969",
        card,
        selected_keywords=[
          {"query": "леденцы от боли в горле", "wbCount": 1000},
          {"query": "леденцы от кашля", "wbCount": 900},
        ],
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    self.assertIn("леденцы для горла", description.lower())
    self.assertNotIn("категория не указана", description)
    self.assertNotIn("Модель МД ТРЕЙД", description)
    self.assertNotIn("материалы", description.lower())
    self.assertNotIn("без сахара", description.lower())
    self.assertNotIn("диабет", description.lower())


if __name__ == "__main__":
  unittest.main()
