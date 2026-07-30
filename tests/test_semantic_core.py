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

  def test_direct_desired_male_frame_keywords_ignore_unconfirmed_female_text(self):
    card = {
      "title": "Оправа для очков женская Optimist",
      "subjectName": "Оправы",
      "brand": "Optimist",
      "description": "Женская оправа для очков подходит для установки линз.",
      "characteristics": [
        {"name": "Материал оправы", "value": "пластик"},
      ],
    }
    desired = [
      {"query": "оправа для очков мужская", "semanticSource": "desired", "desired": True, "directEntry": True},
      {"query": "оправы для очков мужские", "semanticSource": "desired", "desired": True, "directEntry": True},
      {"query": "оправа для очков", "semanticSource": "desired", "desired": True, "directEntry": True},
    ]

    result = server.content_reoptimization_apply_direct_desired_keywords(
      "Женская оправа для очков Optimist подходит для установки линз.",
      card,
      desired,
    )

    self.assertTrue(server.content_contains_exact_keyword(result, "оправа для очков мужская"))
    self.assertTrue(server.content_contains_exact_keyword(result, "оправы для очков мужские"))

  def test_direct_desired_male_keyword_respects_confirmed_female_fact(self):
    card = {
      "title": "Оправа для очков Optimist",
      "subjectName": "Оправы",
      "description": "Оправа для очков подходит для установки линз.",
      "characteristics": [
        {"name": "Пол", "value": "женский"},
      ],
    }

    result = server.content_reoptimization_apply_direct_desired_keywords(
      "Оправа для очков Optimist подходит для установки линз.",
      card,
      [{"query": "оправа для очков мужская", "semanticSource": "desired", "desired": True, "directEntry": True}],
    )

    self.assertFalse(server.content_contains_exact_keyword(result, "оправа для очков мужская"))

  def test_characteristic_fallback_uses_mpstats_market_values(self):
    card = {
      "title": "Солнцезащитные очки женские",
      "subjectName": "Солнцезащитные очки",
      "characteristics": [],
    }

    draft = server.content_reoptimization_characteristic_fallback(
      card,
      [{"query": "очки женские"}],
      available_characteristics=[
        {"name": "Пол", "charcID": 123, "hasFilter": True, "maxCount": 1, "charcType": 1},
      ],
      mpstats_characteristics=[
        {"name": "Пол", "values": [{"value": "мужской", "score": 100}, {"value": "женский", "score": 72}]},
      ],
    )

    self.assertIn("charc:123", draft)
    self.assertEqual(draft["charc:123"]["values"], ["женский"])
    self.assertIn("MPStats", draft["charc:123"]["reason"])

  def test_characteristic_normalization_preserves_current_wb_ids(self):
    fallback_rows = server.audit_card_characteristics({
      "characteristics": [
        {"charcId": 101, "name": "Вкус", "value": ["имбирь", "мёд"]},
        {"charcId": 102, "name": "Форма выпуска", "value": "леденцы"},
        {"charcId": 103, "name": "Количество капсул/таблеток", "value": "16"},
      ],
    })

    draft = server.normalize_content_reoptimization_characteristics(
      [
        {"name": "Вкус", "values": ["имбирь", "мёд"], "reason": "test"},
        {"name": "Форма выпуска", "values": ["Леденцы"], "reason": "test"},
        {"name": "Количество", "values": ["16 шт."], "reason": "test"},
      ],
      fallback_rows=fallback_rows,
      strict_fallback=True,
    )

    self.assertIn("charc:101", draft)
    self.assertIn("charc:102", draft)
    self.assertEqual(draft["charc:101"]["label"], "Вкус")
    self.assertEqual(draft["charc:101"]["values"], ["имбирь", "мёд"])
    self.assertEqual(draft["charc:102"]["values"], ["Леденцы"])
    self.assertNotIn("charc-name:количество", draft)
    self.assertNotIn("charc:103", draft)

  def test_card_characteristics_fallback_reads_raw_fields(self):
    rows = server.audit_card_characteristics({
      "characteristics": [],
      "rawFields": {
        "characteristics": [
          {"charcId": 301, "name": "Вкус", "value": "имбирь"},
        ],
      },
    })

    self.assertEqual(rows[0]["key"], "charc:301")
    self.assertEqual(rows[0]["values"], ["имбирь"])

  def test_wb_content_reoptimization_keeps_approval_card_characteristics(self):
    raw_card = {
      "nmID": 262693847,
      "title": "ТРАВЕРИН растительные леденцы для горла имбирь мед",
      "subjectName": "БАД",
      "description": "Растительные леденцы для горла.",
      "characteristics": [
        {"charcId": 201, "name": "Вкус", "value": ["имбирь", "мёд"]},
        {"charcId": 202, "name": "Форма выпуска", "value": "леденцы"},
        {"charcId": 203, "name": "Состав", "value": ["экстракт корневищ имбиря лекарственного", "экстракт корней солодки голой"]},
      ],
    }
    llm_body = {
      "title": {"value": "ТРАВЕРИН леденцы для горла имбирь мед", "reason": "test"},
      "description": {"value": "ТРАВЕРИН помогает смягчить горло.", "reason": "test"},
      "characteristics": [
        {"name": "Вкус", "values": ["имбирь", "мёд"], "reason": "test"},
        {"name": "Количество", "values": ["16 шт."], "reason": "test"},
      ],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "content_reoptimization_expand_description", side_effect=lambda description, *_args, **_kwargs: description), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "262693847",
        raw_card,
        selected_keywords=[{"query": "леденцы от боли", "wbCount": 1000}],
        sections=["description", "characteristics"],
      )

    description = result["draftContent"]["description"]["value"].lower()
    characteristics = result["draftContent"]["characteristics"]
    self.assertIn("по характеристикам текущей карточки", description)
    self.assertIn("вкус - имбирь и мёд", description)
    self.assertIn("форма выпуска - леденцы", description)
    self.assertIn("состав - экстракт корневищ имбиря лекарственного", description)
    self.assertIn("charc:201", characteristics)
    self.assertNotIn("charc-name:количество", characteristics)

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

  def test_reoptimization_try_include_desired_frame_keywords_changes_description(self):
    card = {
      "title": "Оправа для очков женская Optimist",
      "subjectName": "Оправы",
      "brand": "Optimist",
      "description": "Женская оправа для очков Optimist подходит для установки линз.",
      "characteristics": [{"name": "Материал оправы", "value": "пластик"}],
    }
    desired = [
      {"query": "оправа для очков мужская"},
      {"query": "оправы для очков мужские"},
      {"query": "оправа для очков"},
    ]
    llm_body = {
      "title": {"value": "Оправа для очков Optimist", "reason": "test"},
      "description": {
        "value": "Женская оправа для очков Optimist подходит для установки линз.",
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
        "391030226",
        card,
        selected_keywords=[{"query": "оправа для очков", "wbCount": 1000}],
        desired_keywords=desired,
        draft={"description": "Женская оправа для очков Optimist подходит для установки линз."},
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    self.assertTrue(server.content_contains_exact_keyword(description, "оправа для очков мужская"))
    self.assertTrue(server.content_contains_exact_keyword(description, "оправы для очков мужские"))
    self.assertIn("оправа для очков мужская", result["contentOptimization"]["desiredKeywordsUsed"])

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

  def test_guided_title_revision_is_not_overwritten_by_sunglasses_rule(self):
    card = {
      "title": "Солнцезащитные очки Polaroid",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid с поляризационными линзами.",
      "characteristics": [{"name": "Поляризация", "value": "да"}],
    }
    llm_body = {
      "title": {"value": "Солнцезащитные очки детские Polaroid", "reason": "Учтена просьба специалиста."},
      "description": {
        "value": "Солнцезащитные очки Polaroid подходят для яркого дня и поездок.",
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
        "367374601",
        card,
        selected_keywords=[{"query": "солнцезащитные очки женские", "wbCount": 1000}],
        draft={"title": "Солнцезащитные очки женские поляризационные Polaroid"},
        revision_instruction="замени женские на детские",
        sections=["title"],
      )

    title = result["draftContent"]["title"]["value"]
    self.assertIn("детские", title.lower())
    self.assertNotIn("женские", title.lower())
    self.assertFalse(result["contentOptimization"]["titleRuleApplied"])

  def test_guided_shape_revision_is_not_overwritten_by_frame_rule(self):
    card = {
      "title": "Оправа для очков Polaroid",
      "subjectName": "Оправы",
      "brand": "Polaroid",
      "description": "Оправа для очков Polaroid подходит для установки линз.",
      "characteristics": [{"name": "Материал оправы", "value": "пластик"}],
    }
    llm_body = {
      "title": {"value": "Оправа для очков женская квадратная Polaroid", "reason": "Учтена просьба специалиста."},
      "description": {
        "value": "Оправа для очков Polaroid подходит для установки линз.",
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
        "391030226",
        card,
        selected_keywords=[{"query": "оправа для очков женская круглая", "wbCount": 1000}],
        draft={"title": "Оправа для очков женская круглая Polaroid"},
        revision_instruction="замени форму оправы с круглой на квадратную",
        sections=["title"],
      )

    title = result["draftContent"]["title"]["value"]
    self.assertIn("квадратная", title.lower())
    self.assertNotIn("круглая", title.lower())
    self.assertFalse(result["contentOptimization"]["titleRuleApplied"])

  def test_guided_description_addition_is_applied_when_llm_ignores_instruction(self):
    card = {
      "nmID": "243430592",
      "title": "Солнцезащитные очки мужские Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города и поездок.",
      "characteristics": [
        {"name": "Поляризация", "value": "да"},
        {"name": "Материал линзы", "value": "триацетат целлюлозы"},
        {"name": "Материал оправы", "value": "поликарбонат"},
        {"name": "Форма оправы", "value": "прямоугольная"},
      ],
    }
    draft_description = "Солнцезащитные очки Polaroid подходят для яркого дня, прогулок и поездок."
    addition = (
      "Polaroid мужские очки имеют линзы из триацетата целлюлозы и прочную оправу из поликарбоната. "
      "Материалы подходят для регулярного использования, а лаконичный дизайн позволяет носить модель каждый день. "
      "Такие очки солнцезащитные мужские брендовые станут подходящим выбором для тех, кто ценит узнаваемый стиль, функциональность и удобную посадку."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки мужские Polaroid", "reason": "test"},
      "description": {
        "value": draft_description,
        "reason": "LLM проигнорировал добавление.",
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
        "243430592",
        card,
        selected_keywords=[{"query": "очки солнцезащитные мужские", "wbCount": 1000}],
        draft={"description": draft_description},
        revision_instruction=f"Добавь абзац в текст: {addition}",
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    self.assertIn("Polaroid мужские очки имеют линзы из триацетата целлюлозы", description)
    self.assertIn("прочную оправу из поликарбоната", description)
    self.assertIn("очки солнцезащитные мужские брендовые", description)
    self.assertTrue(result["contentOptimization"]["revisionAdditionApplied"])
    self.assertLessEqual(len(description), server.CONTENT_REOPTIMIZE_DESCRIPTION_LIMIT)

  def test_explicit_addition_mode_does_not_require_command_words(self):
    card = {
      "title": "Солнцезащитные очки мужские Polaroid",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Материал линзы", "value": "триацетат целлюлозы"},
        {"name": "Материал оправы", "value": "поликарбонат"},
      ],
    }
    bare_addition = (
      "Polaroid мужские очки имеют линзы из триацетата целлюлозы и прочную оправу из поликарбоната. "
      "Материалы подходят для регулярного использования."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки мужские Polaroid", "reason": "test"},
      "description": {"value": "Солнцезащитные очки Polaroid подходят для города.", "reason": "test"},
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
        "243430592",
        card,
        selected_keywords=[{"query": "очки солнцезащитные мужские", "wbCount": 1000}],
        draft={"description": "Солнцезащитные очки Polaroid подходят для города."},
        revision_instruction="",
        revision_mode="addition",
        revision_text=bare_addition,
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    self.assertIn("Polaroid мужские очки имеют линзы из триацетата целлюлозы", description)
    self.assertEqual(result["contentOptimization"]["revisionInstructionMode"], "addition")
    self.assertTrue(result["contentOptimization"]["revisionAdditionApplied"])

  def test_reference_mode_uses_user_text_when_llm_ignores_it(self):
    card = {
      "title": "Солнцезащитные очки мужские Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Поляризация", "value": "да"},
        {"name": "Материал линзы", "value": "триацетат целлюлозы"},
        {"name": "Материал оправы", "value": "поликарбонат"},
        {"name": "Форма оправы", "value": "прямоугольная"},
        {"name": "Цвет", "value": "черный"},
        {"name": "Цвет линз", "value": "серый"},
      ],
    }
    reference = (
      "Солнцезащитные очки мужские Polaroid PLD 4137 S 807 M9 подходят для ярких солнечных дней и поездок за рулем. "
      "Прямоугольная форма оправы выглядит сдержанно и современно. "
      "Polaroid мужские очки имеют линзы из триацетата целлюлозы и прочную оправу из поликарбоната. "
      "Серые линзы и черная оправа легко сочетаются с повседневной одеждой."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки мужские Polaroid", "reason": "test"},
      "description": {"value": "Солнцезащитные очки Polaroid подходят для города.", "reason": "test"},
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
        "243430592",
        card,
        selected_keywords=[{"query": "очки солнцезащитные мужские", "wbCount": 1000}],
        revision_mode="reference",
        revision_text=reference,
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    self.assertIn("Солнцезащитные очки мужские Polaroid PLD 4137 S 807 M9", description)
    self.assertIn("Polaroid мужские очки имеют линзы из триацетата целлюлозы", description)
    self.assertEqual(result["contentOptimization"]["revisionInstructionMode"], "reference")
    self.assertTrue(result["contentOptimization"]["revisionAdditionApplied"])
    self.assertLessEqual(len(description), server.CONTENT_REOPTIMIZE_DESCRIPTION_LIMIT)

  def test_reference_mode_substitutes_current_card_model(self):
    card = {
      "title": "Солнцезащитные очки мужские Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Поляризация", "value": "да"},
        {"name": "Форма оправы", "value": "прямоугольная"},
        {"name": "Цвет", "value": "черный"},
      ],
    }
    reference = (
      "Солнцезащитные очки мужские Polaroid PLD 6012 N 807 M9 подходят для ярких солнечных дней и поездок за рулем. "
      "Прямоугольная форма оправы выглядит сдержанно и современно. "
      "Polaroid PLD 6012 N 807 M9 имеет поляризационные линзы и черную оправу. "
      "Эта модель помогает собрать понятное описание для покупателя."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки мужские Polaroid", "reason": "test"},
      "description": {"value": "Солнцезащитные очки Polaroid подходят для города.", "reason": "test"},
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
        "243430592",
        card,
        selected_keywords=[{"query": "очки солнцезащитные мужские", "wbCount": 1000}],
        revision_mode="reference",
        revision_text=reference,
        sections=["description"],
      )

    evidence = json.loads(captured["messages"][1]["content"])["evidenceBundle"]
    description = result["draftContent"]["description"]["value"]
    self.assertEqual(evidence["card"]["model"], "PLD 4137 S 807 M9")
    self.assertEqual(evidence["revision"]["currentCardModel"], "PLD 4137 S 807 M9")
    self.assertIn("evidenceBundle.card.model", captured["messages"][0]["content"])
    self.assertIn("Polaroid PLD 4137 S 807 M9", description)
    self.assertNotIn("PLD 6012 N 807 M9", description)

  def test_reference_mode_aligns_description_audience_to_target_keywords(self):
    card = {
      "title": "Солнцезащитные очки Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Поляризация", "value": "да"},
        {"name": "Форма оправы", "value": "прямоугольная"},
      ],
    }
    reference = (
      "Очки солнцезащитные мужские Polaroid PLD 4137 S 807 M9 подходят для ярких дней и поездок за рулем. "
      "Мужские очки легко сочетать с повседневной одеждой. "
      "Эта мужская модель имеет прямоугольную форму и спокойный дизайн. "
      "Такие очки удобно брать в отпуск и носить в городе."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки Polaroid", "reason": "test"},
      "description": {"value": "Солнцезащитные очки Polaroid подходят для города.", "reason": "test"},
      "characteristics": [],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "content_reoptimization_expand_description", side_effect=lambda description, *_args, **_kwargs: description), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "262693847",
        card,
        selected_keywords=[{"query": "очки солнцезащитные женские", "wbCount": 1000}],
        revision_mode="reference",
        revision_text=reference,
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    self.assertIn("Очки солнцезащитные женские", description)
    self.assertIn("Женские очки", description)
    self.assertIn("женская модель", description)
    self.assertNotIn("мужские", description.lower())
    self.assertNotIn("мужская", description.lower())
    self.assertEqual(result["contentOptimization"]["revisionInstructionMode"], "reference")

  def test_reference_mode_aligns_description_to_current_characteristics(self):
    card = {
      "title": "Солнцезащитные очки Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Поляризация", "value": "да"},
        {"name": "Материал линзы", "value": "триацетат целлюлозы"},
        {"name": "Материал оправы", "value": "поликарбонат"},
        {"name": "Форма оправы", "value": "прямоугольная"},
        {"name": "Цвет", "value": "черный"},
        {"name": "Цвет линз", "value": "серый"},
        {"name": "Комплектация", "value": "футляр, салфетка"},
      ],
    }
    reference = (
      "Солнцезащитные очки Polaroid PLD 4137 S 807 M9 подходят для города и отдыха. "
      "Круглая форма оправы смотрится мягко и подходит для спокойных образов. "
      "Коричневая оправа и зеленые линзы создают теплый визуальный акцент. "
      "Металлическая оправа и стеклянные линзы ощущаются солидно. "
      "Такой аксессуар удобно носить в яркий день."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки Polaroid", "reason": "test"},
      "description": {"value": "Солнцезащитные очки Polaroid подходят для города.", "reason": "test"},
      "characteristics": [],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "content_reoptimization_expand_description", side_effect=lambda description, *_args, **_kwargs: description), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "262693847",
        card,
        selected_keywords=[{"query": "очки солнцезащитные", "wbCount": 1000}],
        revision_mode="reference",
        revision_text=reference,
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    normalized = description.lower()
    self.assertIn("форма оправы - прямоугольная", normalized)
    self.assertIn("цвет оправы - черный", normalized)
    self.assertIn("цвет линз - серый", normalized)
    self.assertIn("материал линз - триацетат целлюлозы", normalized)
    self.assertIn("материал оправы - поликарбонат", normalized)
    self.assertIn("поляризация - да", normalized)
    self.assertIn("комплектация - футляр и салфетка", normalized)
    self.assertNotIn("круглая форма", normalized)
    self.assertNotIn("коричневая оправа", normalized)
    self.assertNotIn("зеленые линзы", normalized)
    self.assertNotIn("металлическая оправа", normalized)
    self.assertNotIn("стеклянные линзы", normalized)

  def test_guided_description_adds_characteristic_values_even_when_generic_words_exist(self):
    card = {
      "title": "Солнцезащитные очки Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Материал линзы", "value": "триацетат целлюлозы"},
        {"name": "Материал оправы", "value": "поликарбонат"},
        {"name": "Форма оправы", "value": "прямоугольная"},
        {"name": "Цвет", "value": "черный"},
        {"name": "Цвет линз", "value": "серый"},
      ],
    }
    generic_description = (
      "Солнцезащитные очки Polaroid подходят для города и отдыха. "
      "Форма, цвет оправы, цвет линз и материалы помогают оценить внешний вид модели перед заказом."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки Polaroid", "reason": "test"},
      "description": {"value": generic_description, "reason": "test"},
      "characteristics": [],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "content_reoptimization_expand_description", side_effect=lambda description, *_args, **_kwargs: description), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "262693847",
        card,
        selected_keywords=[{"query": "очки солнцезащитные", "wbCount": 1000}],
        revision_instruction="Сделай еще вариант описания.",
        sections=["description"],
      )

    normalized = result["draftContent"]["description"]["value"].lower()
    self.assertIn("по характеристикам текущей карточки", normalized)
    self.assertIn("форма оправы - прямоугольная", normalized)
    self.assertIn("цвет оправы - черный", normalized)
    self.assertIn("цвет линз - серый", normalized)
    self.assertIn("материал линз - триацетат целлюлозы", normalized)
    self.assertIn("материал оправы - поликарбонат", normalized)

  def test_fresh_description_reoptimization_includes_current_characteristics(self):
    card = {
      "title": "Солнцезащитные очки Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Материал линзы", "value": "триацетат целлюлозы"},
        {"name": "Материал оправы", "value": "поликарбонат"},
        {"name": "Форма оправы", "value": "прямоугольная"},
        {"name": "Цвет", "value": "черный"},
        {"name": "Цвет линз", "value": "серый"},
      ],
    }
    llm_body = {
      "title": {"value": "Солнцезащитные очки Polaroid", "reason": "test"},
      "description": {"value": "Солнцезащитные очки Polaroid подходят для яркого дня, прогулок и дороги.", "reason": "test"},
      "characteristics": [],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "content_reoptimization_expand_description", side_effect=lambda description, *_args, **_kwargs: description), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "262693847",
        card,
        selected_keywords=[{"query": "очки солнцезащитные", "wbCount": 1000}],
        sections=["description"],
      )

    normalized = result["draftContent"]["description"]["value"].lower()
    self.assertIn("по характеристикам текущей карточки", normalized)
    self.assertIn("форма оправы - прямоугольная", normalized)
    self.assertIn("цвет оправы - черный", normalized)
    self.assertIn("цвет линз - серый", normalized)
    self.assertIn("материал линз - триацетат целлюлозы", normalized)
    self.assertIn("материал оправы - поликарбонат", normalized)

  def test_guided_description_instruction_aligns_audience_when_llm_ignores_it(self):
    card = {
      "title": "Солнцезащитные очки Polaroid PLD 4137 S 807 M9",
      "subjectName": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Солнцезащитные очки Polaroid подходят для города.",
      "characteristics": [
        {"name": "Поляризация", "value": "да"},
        {"name": "Форма оправы", "value": "прямоугольная"},
      ],
    }
    ignored_description = (
      "Очки солнцезащитные мужские Polaroid PLD 4137 S 807 M9 подходят для ярких дней. "
      "Мужские очки легко сочетать с повседневной одеждой. "
      "Эта мужская модель имеет прямоугольную форму и спокойный дизайн. "
      "Посадку удобно оценивать по фото, форме оправы и расстоянию между линзами перед заказом. "
      "Для города важны нейтральный цвет, комфорт на переносице и понятный силуэт без лишнего визуального шума. "
      "В дороге такая модель помогает спокойнее воспринимать яркий дневной свет и сохранять привычный ритм. "
      "Прямоугольная форма выглядит сдержанно, поэтому аксессуар легко вписывается в деловую и повседневную одежду. "
      "Перед покупкой стоит сверить размеры, оттенок линз и комплект, чтобы ожидания совпали с карточкой. "
      "Polaroid PLD 4137 S 807 M9 можно носить на прогулке, в отпуске и за рулем, когда солнце быстро утомляет глаза. "
      "Форма оправы визуально вытягивает линию лица и остается аккуратной без спортивного или слишком яркого акцента. "
      "Линзы и оправа описаны только по фактам карточки, без обещаний свойств, которых нет в характеристиках. "
      "Для ежедневного выбора важны удобная посадка, спокойный стиль и понятное сочетание с базовым гардеробом. "
      "Этот вариант описания сохраняет структуру покупательского текста и не превращает карточку в список ключей. "
      "Финальный абзац помогает покупателю еще раз проверить назначение, внешний вид и параметры модели перед заказом."
    )
    llm_body = {
      "title": {"value": "Солнцезащитные очки Polaroid", "reason": "test"},
      "description": {"value": ignored_description, "reason": "test"},
      "characteristics": [],
      "_meta": {"warnings": []},
    }

    def fake_llm(_messages):
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "content_reoptimization_expand_description", side_effect=lambda description, *_args, **_kwargs: description), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_card_content_reoptimization(
        "demo-wb",
        "262693847",
        card,
        selected_keywords=[{"query": "очки солнцезащитные", "wbCount": 1000}],
        draft={"description": ignored_description},
        revision_instruction="заменить мужские на женские",
        sections=["description"],
      )

    description = result["draftContent"]["description"]["value"]
    self.assertIn("Очки солнцезащитные женские", description)
    self.assertIn("Женские очки", description)
    self.assertIn("женская модель", description)
    self.assertNotIn("мужские", description.lower())
    self.assertNotIn("мужская", description.lower())
    self.assertEqual(result["contentOptimization"]["revisionInstructionMode"], "instruction")

  def test_ozon_content_reoptimization_uses_final_semantic_and_mpstats_characteristics(self):
    card = {
      "sku": "oz-100",
      "offerId": "offer-100",
      "title": "Солнцезащитные очки",
      "category": "Солнцезащитные очки",
      "brand": "Polaroid",
      "description": "Очки для яркого дня.",
      "characteristics": [{"name": "Пол", "value": "женский"}],
    }
    semantic = {
      "cardKey": "oz-100",
      "sku": "oz-100",
      "title": "Солнцезащитные очки",
      "final": [{"query": "очки женские солнцезащитные", "ozonCount": 1200}],
      "removal": [{"query": "детские очки"}],
    }
    llm_body = {
      "title": {"value": "Солнцезащитные очки женские Polaroid", "reason": "test"},
      "description": {
        "value": "Солнцезащитные очки женские Polaroid подходят для города и поездок.",
        "reason": "test",
      },
      "characteristics": [{"name": "Пол", "values": ["женский"], "reason": "MPStats и карточка совпали."}],
      "_meta": {"warnings": []},
    }
    captured = {}

    def fake_llm(messages):
      captured["evidence"] = json.loads(messages[1]["content"])["evidenceBundle"]
      return {
        "choices": [{"message": {"content": json.dumps(llm_body, ensure_ascii=False)}}],
      }, "test-model", "test-provider"

    with patch.object(server, "content_reoptimization_configured", return_value=True), \
      patch.object(server, "audit_llm_chat_completion", side_effect=fake_llm):
      result = server.build_ozon_card_content_reoptimization_result(
        card,
        semantic_payload=semantic,
        mpstats_characteristics=[
          {"name": "Пол", "values": [{"value": "женский", "score": 80}]},
        ],
      )

    evidence = captured["evidence"]
    self.assertEqual(evidence["marketplace"], "Ozon")
    self.assertEqual(evidence["semanticCore"]["finalKeywords"][0]["query"], "очки женские солнцезащитные")
    self.assertEqual(evidence["characteristicsContext"]["mpstatsCharacteristics"][0]["name"], "Пол")
    self.assertEqual(result["draftContent"]["title"], "Солнцезащитные очки женские Polaroid")
    self.assertEqual(result["draftContent"]["characteristics"][0]["name"], "Пол")
    self.assertEqual(result["contentOptimization"]["marketplace"], "Ozon")

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
