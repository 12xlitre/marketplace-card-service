# Read-only Wildberries API

Дата: 2026-07-08.

Решение:
- WB API подключается только через backend `server.py`, frontend не принимает и не хранит API-ключ;
- список карточек загружается через официальный метод `POST /content/v2/get/cards/list` в режиме чтения;
- основной UI-сценарий: `Добавить портал` -> `Через API` -> `POST /api/portals`; backend проверяет ключ read-only запросом, создает портал и сохраняет токен AES-GCM;
- backend route для интерфейса: `GET /api/wb/cards?portal_id=...&limit=...`;
- для встроенного первого кабинета `demo-wb` в живом рабочем контуре допустим env fallback `WB_API_TOKEN` из `.env.local`;
- для числовых порталов env fallback запрещен, нужен encrypted token через UI или админскую команду `npm run set-wb-token`;
- write-операции WB не реализованы и запрещены до отдельного решения.

Технические правила:
- запросы к WB идут с timeout и retry только для transient ошибок, `5xx`, сети и `429`;
- на `429` учитывается `Retry-After`;
- используется cursor-пагинация и `withPhoto: -1` для любых карточек;
- UI получает нормализованные карточки и статусы качества, а не raw WB token или секреты.
