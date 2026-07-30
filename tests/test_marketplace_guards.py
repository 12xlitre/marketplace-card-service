import base64
import json
import tempfile
import unittest
from pathlib import Path

import server


class MarketplaceGuardTest(unittest.TestCase):
  def setUp(self):
    self._tmp = tempfile.TemporaryDirectory()
    self._previous_db_path = server.DB_PATH
    server.DB_PATH = Path(self._tmp.name) / "opticards-test.sqlite3"
    server.init_db()
    with server.connect_db() as db:
      db.execute(
        """
        INSERT INTO users (login, password_hash, full_name, role, user_role, access_level)
        VALUES
          ('owner.manager', 'x', 'Owner Manager', 'Manager', 'manager', 'overview'),
          ('readonly.tech', 'x', 'Read Only Tech', 'Tech', 'tech', 'readonly_wb'),
          ('anastasia.tech', 'x', 'Анастасия Руднева', 'Технический специалист', 'tech', 'readonly_wb')
        """
      )
    self.manager = {
      "login": "owner.manager",
      "role": "Manager",
      "user_role": "manager",
      "access_level": "overview",
    }
    self.readonly = {
      "login": "readonly.tech",
      "role": "Tech",
      "user_role": "tech",
      "access_level": "readonly_wb",
    }
    self.anastasia = {
      "login": "anastasia.tech",
      "full_name": "Анастасия Руднева",
      "role": "Технический специалист",
      "user_role": "tech",
      "access_level": "readonly_wb",
    }
    self.ozon_portal_id = server.create_portal(
      "Ozon Beta",
      "Ozon",
      "selected",
      "owner.manager",
      {"lead": "owner.manager", "tech": "readonly.tech", "manager": "anastasia.tech"},
      store_url="https://www.ozon.ru/seller/test",
    )
    self.wb_portal_id = server.create_portal(
      "WB Cabinet",
      "Wildberries",
      "full",
      "owner.manager",
      {"lead": "owner.manager", "tech": "readonly.tech", "manager": "anastasia.tech"},
    )

  def tearDown(self):
    server.DB_PATH = self._previous_db_path
    self._tmp.cleanup()

  def test_readonly_user_can_read_but_cannot_write_ozon_tasks(self):
    result = server.list_ozon_tasks(self.ozon_portal_id, self.readonly)
    self.assertEqual(result["tasks"], [])

    with self.assertRaises(PermissionError):
      server.save_ozon_tasks(
        self.ozon_portal_id,
        {"tasks": [{"cardKey": "sku-1", "sku": "123456789", "title": "Ozon card"}]},
        self.readonly,
      )

  def test_anastasia_can_manage_ozon_beta_but_not_wildberries(self):
    self.assertTrue(server.user_can_edit_portal(self.anastasia, self.ozon_portal_id))
    self.assertFalse(server.user_can_edit_portal(self.anastasia, self.wb_portal_id))

    result = server.save_ozon_tasks(
      self.ozon_portal_id,
      {"tasks": [{"cardKey": "sku-1", "sku": "123456789", "title": "Ozon card"}]},
      self.anastasia,
    )

    self.assertEqual(len(result["tasks"]), 1)

  def test_ozon_writes_reject_wildberries_portal(self):
    with self.assertRaisesRegex(ValueError, "ozon_portal_required"):
      server.save_ozon_semantic_draft(
        self.wb_portal_id,
        {
          "cardKey": "sku-1",
          "sku": "123456789",
          "title": "Ozon card",
          "final": [{"query": "ozon keyword"}],
        },
        self.manager,
      )

  def test_wildberries_content_guard_rejects_ozon_portal(self):
    with self.assertRaisesRegex(ValueError, "unsupported_marketplace"):
      server.ensure_wildberries_content_portal(self.ozon_portal_id)

  def test_ozon_semantic_fallback_labels_do_not_reference_wb(self):
    payload = server.normalize_ozon_semantic_payload({
      "cardKey": "sku-1",
      "recommendations": [{"query": "ozon keyword"}],
      "selected": [{"query": "selected ozon keyword"}],
    })

    self.assertEqual(payload["recommendations"][0]["source"], "MPStats keyword-база")
    self.assertEqual(payload["selected"][0]["source"], "MPStats keyword-база")

  def test_ozon_semantic_import_applies_agreement_by_sku(self):
    with server.connect_db() as db:
      db.execute(
        "UPDATE portals SET cards_snapshot_json = ? WHERE id = ?",
        (
          json.dumps([{
            "id": "123456789",
            "sku": "123456789",
            "offerId": "SUN-001",
            "title": "Солнцезащитные очки Polaroid",
            "category": "Солнцезащитные очки",
          }], ensure_ascii=False),
          self.ozon_portal_id,
        ),
      )
    csv_body = (
      "SKU,Ключ к добавлению,Согласовано добавление,Частотность добавление Ozon,Ключ к удалению,Согласовано удаление,Причина удаления\n"
      "123456789,очки солнцезащитные женские,Да,5772,старый ключ,Да,не нужен\n"
    )
    payload = {
      "fileName": "ozon-semantic.csv",
      "fileData": base64.b64encode(csv_body.encode("utf-8")).decode("ascii"),
      "scope": "portal",
      "mode": "preview",
    }

    preview = server.import_ozon_semantic_core_agreement(self.ozon_portal_id, payload, self.manager)

    self.assertEqual(preview["summary"]["cardsMatched"], 1)
    self.assertEqual(preview["summary"]["selectedToAdd"], 1)
    self.assertEqual(preview["summary"]["removalToApply"], 1)

    applied = server.import_ozon_semantic_core_agreement(
      self.ozon_portal_id,
      {**payload, "mode": "apply"},
      self.manager,
    )
    draft = applied["applied"]["cards"][0]["draft"]["draft"]

    self.assertEqual(applied["applied"]["updatedCards"], 1)
    self.assertEqual(draft["cardKey"], "123456789")
    self.assertEqual(draft["sku"], "123456789")
    self.assertEqual(draft["offerId"], "SUN-001")
    self.assertEqual(draft["selected"][0]["query"], "очки солнцезащитные женские")
    self.assertEqual(draft["selected"][0]["ozonCount"], 5772)
    self.assertEqual(draft["removal"][0]["query"], "старый ключ")
    self.assertEqual(draft["final"][0]["query"], "очки солнцезащитные женские")

  def test_readonly_user_cannot_apply_ozon_semantic_import(self):
    csv_body = "SKU,Ключ к добавлению,Согласовано добавление\n123456789,очки,Да\n"
    payload = {
      "fileName": "ozon-semantic.csv",
      "fileData": base64.b64encode(csv_body.encode("utf-8")).decode("ascii"),
      "scope": "portal",
      "mode": "apply",
    }

    with self.assertRaises(PermissionError):
      server.import_ozon_semantic_core_agreement(self.ozon_portal_id, payload, self.readonly)

  def test_ozon_semantic_import_rejects_wildberries_portal(self):
    csv_body = "SKU,Ключ к добавлению,Согласовано добавление\n123456789,очки,Да\n"
    payload = {
      "fileName": "ozon-semantic.csv",
      "fileData": base64.b64encode(csv_body.encode("utf-8")).decode("ascii"),
      "scope": "portal",
      "mode": "preview",
    }

    with self.assertRaisesRegex(ValueError, "ozon_portal_required"):
      server.import_ozon_semantic_core_agreement(self.wb_portal_id, payload, self.manager)

  def test_withdrawn_approval_from_submitted_is_logged(self):
    previous_payload = server.normalize_card_draft_payload({
      "meta": {
        "approvalSections": {
          "content": {
            "status": "submitted",
            "submittedBy": "anastasia.tech",
            "submittedAt": "2026-07-28T10:00:00+00:00",
          },
        },
      },
    })
    payload = server.normalize_card_draft_payload({
      "meta": {
        "approvalSections": {
          "content": {
            "status": "draft",
            "submittedBy": "",
            "submittedAt": "",
            "history": [{
              "action": "withdrawn",
              "reason": "Специалист забрал блок с согласования для доработки.",
              "createdAt": "2026-07-28T10:30:00+00:00",
              "userLogin": "anastasia.tech",
            }],
          },
        },
      },
    })

    events = server.approval_events_from_payload_change(payload, previous_payload, self.anastasia, "123", "ART-1")

    self.assertEqual(len(events), 1)
    self.assertEqual(events[0]["status"], "draft")
    self.assertEqual(events[0]["action"], "withdrawn")
    self.assertIn("Контент", events[0]["reason"])

  def test_wb_content_publication_prepares_only_approved_content_for_tech(self):
    raw_card = {
      "nmID": 262693847,
      "vendorCode": "WB-ART-1",
      "brand": "Optic",
      "title": "Старый заголовок",
      "description": "Старое описание",
      "subjectID": 123,
      "subjectName": "Оправы",
      "characteristics": [
        {"id": 14177449, "name": "Цвет", "value": "черный"},
        {"id": 12, "name": "Форма оправы", "value": ["квадратная"]},
        {"id": 999, "name": "Ширина линзы", "value": 52},
      ],
      "sizes": [{"chrtID": 1001, "techSize": "0", "wbSize": "", "skus": ["2000000000011"]}],
    }
    with server.connect_db() as db:
      db.execute(
        "UPDATE portals SET cards_snapshot_json = ? WHERE id = ?",
        (json.dumps([server.normalize_wb_card(raw_card)], ensure_ascii=False), self.wb_portal_id),
      )

    approved_payload = {
      "content": {
        "title": {"value": "Оправа для очков женская Optic"},
        "description": {"value": "Новое согласованное описание с характеристиками текущей карточки."},
        "characteristics": {
          "charc:14177449": {"label": "Цвет", "charcID": 14177449, "values": ["красный"]},
          "shape": {"label": "Форма оправы", "values": ["круглая"]},
        },
      },
      "meta": {
        "approvalSections": {
          "content": {
            "status": "approved",
            "reviewedBy": "anastasia.tech",
            "reviewedAt": "2026-07-30T10:00:00+00:00",
          },
        },
      },
    }
    server.save_card_draft(
      self.wb_portal_id,
      "262693847",
      "262693847",
      "WB-ART-1",
      approved_payload,
      self.anastasia,
    )

    preview = server.prepare_wb_content_publication(self.wb_portal_id, self.readonly)
    self.assertEqual(preview["summary"]["readyCount"], 1)
    self.assertEqual(preview["summary"]["apiReadyCount"], 1)
    card = preview["cards"][0]

    self.assertEqual(card["updatePayload"]["title"], "Оправа для очков женская Optic")
    self.assertEqual(card["updatePayload"]["description"], "Новое согласованное описание с характеристиками текущей карточки.")
    characteristics = {str(item["id"]): item["value"] for item in card["updatePayload"]["characteristics"]}
    self.assertEqual(characteristics["14177449"], "красный")
    self.assertEqual(characteristics["12"], ["круглая"])
    self.assertEqual(characteristics["999"], 52)

    with self.assertRaises(PermissionError):
      server.prepare_wb_content_publication(self.wb_portal_id, self.anastasia)

  def test_wb_content_publication_table_marks_content_exported(self):
    raw_card = {
      "nmID": 262693847,
      "vendorCode": "WB-ART-1",
      "brand": "Optic",
      "title": "Старый заголовок",
      "description": "Старое описание",
      "subjectID": 123,
      "subjectName": "Оправы",
      "characteristics": [{"id": 14177449, "name": "Цвет", "value": "черный"}],
      "sizes": [{"chrtID": 1001, "techSize": "0", "wbSize": "", "skus": ["2000000000011"]}],
    }
    with server.connect_db() as db:
      db.execute(
        "UPDATE portals SET cards_snapshot_json = ? WHERE id = ?",
        (json.dumps([server.normalize_wb_card(raw_card)], ensure_ascii=False), self.wb_portal_id),
      )
    server.save_card_draft(
      self.wb_portal_id,
      "262693847",
      "262693847",
      "WB-ART-1",
      {
        "content": {
          "title": {"value": "Оправа для очков женская Optic"},
          "description": {"value": "Новое согласованное описание."},
          "characteristics": {},
        },
        "meta": {"approvalSections": {"content": {"status": "approved"}}},
      },
      self.anastasia,
    )

    result = server.publish_wb_content_publication(
      self.wb_portal_id,
      {"mode": "table", "cardKeys": ["262693847"]},
      self.readonly,
    )

    self.assertEqual(result["summary"]["publishedCount"], 1)
    draft = server.get_card_draft(self.wb_portal_id, "262693847", self.readonly)
    status = draft["draft"]["meta"]["approvalSections"]["content"]["status"]
    self.assertEqual(status, "exported")
    with server.connect_db() as db:
      row = db.execute(
        "SELECT action FROM card_approval_events WHERE portal_id = ? AND card_key = ? ORDER BY id DESC LIMIT 1",
        (self.wb_portal_id, "262693847"),
      ).fetchone()
    self.assertEqual(row["action"], "content_export_table")

  def test_wb_content_publication_api_requires_encrypted_portal_token(self):
    with self.assertRaisesRegex(ValueError, "wb_token_missing"):
      server.publish_wb_content_publication(
        self.wb_portal_id,
        {"mode": "api"},
        self.readonly,
      )


if __name__ == "__main__":
  unittest.main()
