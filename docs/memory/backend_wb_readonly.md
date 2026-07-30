# Wildberries API Контур

Дата: 2026-07-30.

Решение:
- WB API подключается только через backend `server.py`, frontend не принимает и не хранит API-ключ;
- список карточек загружается через официальный метод `POST /content/v2/get/cards/list` в режиме чтения;
- основной UI-сценарий: `Добавить портал` -> `Через API` -> `POST /api/portals`; backend проверяет ключ read-only запросом, создает портал и сохраняет токен AES-GCM;
- backend route для интерфейса: `GET /api/wb/cards?portal_id=...&limit=...`;
- для встроенного первого кабинета `demo-wb` в живом рабочем контуре допустим env fallback `WB_API_TOKEN` из `.env.local`;
- для числовых порталов env fallback запрещен, нужен encrypted token через UI или админскую команду `npm run set-wb-token`;
- единственная разрешенная write-операция WB на этом этапе - ручная публикация уже принятого контента через `POST /api/portals/<portal_id>/wb-content-publication` с `mode=api`; цены, остатки, медиа и автоматическая публикация при принятии по-прежнему не реализованы.

Технические правила:
- запросы к WB идут с timeout и retry только для transient ошибок, `5xx`, сети и `429`;
- на `429` учитывается `Retry-After`;
- используется cursor-пагинация и `withPhoto: -1` для любых карточек;
- UI получает нормализованные карточки, статусы качества и расширенный снимок полей карточки (`rawFields`) для детального просмотра;
- `rawFields` проходит backend-sanitizer: из вложенных объектов вырезаются ключи с `token`, `secret`, `password`, `authorization`, `api_key`, `apikey`, `cookie`, `session`, `credential`; raw WB token и секреты в ответ не попадают.
- повторное подключение того же WB кабинета блокируется: сначала по digest API-ключа, после read-only проверки по fingerprint набора `nmID`; активный дубль возвращает `portal_already_connected`, архивный - `portal_already_archived`.
- публикация контента доступна только техспециалисту проекта или админу, после принятия секции `Контент` аккаунт-менеджером; `mode=preview` показывает состав, `mode=api` отправляет payload в `POST /content/v2/cards/update`, `mode=table` готовит XLSX для ручной загрузки в кабинет WB.
- API-публикация требует encrypted token конкретного портала, перед записью заново читает карточки из WB, сохраняет текущие `nmID`, `vendorCode`, `brand`, `dimensions`, `sizes` и характеристики карточки, а поверх применяет только принятые title/description/characteristics из `card_drafts`.
- После успешного API-обновления или подготовки таблицы backend помечает секцию `Контент` как `exported` и пишет событие `content_published_wb` или `content_export_table`.
