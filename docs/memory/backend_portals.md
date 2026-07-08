# Backend Portals

Дата: 2026-07-08.

Решение:
- список кабинетов является backend-состоянием в SQLite `portals`;
- состав проекта хранится в `portal_members`;
- frontend после логина загружает кабинеты через `GET /api/portals`;
- создание кабинета идет через `POST /api/portals`;
- изменение состава проекта идет через `POST /api/portals/<portal_id>/team`;
- `localStorage` в frontend остается только временным fallback, когда backend еще недоступен на контуре.

Правила:
- WB API токены не попадают в ответ `GET /api/portals`;
- `portal_integrations.external_key` хранит не секретный fingerprint внешнего кабинета/набора карточек для защиты от повторного добавления;
- счетчики `card_count`, `work_count`, `problem_count` и `last_sync_at` обновляются после read-only загрузки WB;
- карточки пока не являются отдельной постоянной таблицей, при открытии API-кабинета frontend может перечитать snapshot через `/api/wb/cards`.
