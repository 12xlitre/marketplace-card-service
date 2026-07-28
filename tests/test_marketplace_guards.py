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


if __name__ == "__main__":
  unittest.main()
