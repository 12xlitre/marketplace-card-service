# Marketplace Card Service

Внутренний сервис для команды, которая ведет карточки продавцов на маркетплейсах.

## Прототип

Постоянная локальная ссылка прототипа:

```text
http://localhost:5173/
```

Запуск:

```bash
npm run prototype
```

Frontend переведен на React + Vite. Исходники находятся в `frontend/`, а production-сборка генерирует single-file `index.html`, чтобы текущий серверный Dockerfile продолжал копировать только корневые файлы.

Команды frontend:

```bash
npm run frontend:dev
npm run frontend:build
npm run frontend:check
```

`npm run frontend:build` собирает `frontend/` в `.react-build/index.html` и затем обновляет корневой `index.html`, который отдает Python backend.

Текущий frontend показывает основной входной сценарий:

- экран логина через backend: пользователи в SQLite, пароли в PBKDF2-хешах, сессия в HttpOnly cookie;
- главный экран `Кабинеты` с добавлением портала через API или вручную;
- разделы левого меню `Кабинеты`, `Аудит`, `Настройки`;
- кабинет селлера с обзором, источником данных, составом проекта и режимами охвата;
- детальную карточку с аудитом, полными полями WB API, вариантами заголовка и блоком `Было / стало`.
- сессии:
  - авторизация через `POST /api/login`, восстановление через `GET /api/session`, выход через `POST /api/logout`;
  - remember-me задает TTL cookie: 7 дней, иначе 12 часов;
  - сессия хранится в HttpOnly cookie, пароль не кешируется в браузере.

Создание или обновление пользователя:

```bash
npm run create-user -- dmitriy.admin "Сафиуллин Дмитрий" "Администратор" --user-role admin --access-level all
```

Подключение WB API из интерфейса:

- пользователь нажимает `Добавить портал` -> `Через API`;
- вводит WB API ключ в модальном окне;
- frontend отправляет ключ только в `POST /api/portals`;
- backend проверяет ключ read-only запросом WB, создает портал и сохраняет токен зашифрованно в SQLite;
- в браузере и `localStorage` ключ не хранится.

Админский fallback для серверной проверки:

```bash
npm run generate-secret-key
export OPTICARDS_SECRET_KEY="..."
npm run create-portal -- "Wildberries кабинет" --lead manager-login --tech tech-login --manager manager-login
WB_API_TOKEN="..." npm run set-wb-token -- 1
npm run list-portals
npm run wb-sync -- --portal-id 1 --limit 20
```

WB API ключ не хранится в `index.html` и не пишется в браузерное хранилище.

Read-only маршруты backend:

```text
POST /api/portals
GET /api/portals
POST /api/portals/<portal_id>/team
POST /api/portals/<portal_id>/archive
POST /api/portals/<portal_id>/restore
GET /api/wb/cards?portal_id=demo-wb&limit=100
GET /api/wb/characteristics?portal_id=1&subject_id=123
GET /api/mpstats/characteristics?portal_id=1&type=subject&value=123
POST /api/card-audit
```

Для числовых порталов env fallback отключен: у каждого портала должен быть свой зашифрованный WB-токен. До отдельного решения write-операции WB не реализуются.

`GET /api/wb/cards` возвращает нормализованные карточки и sanitised `rawFields` для детального просмотра. Поля с признаками секретов (`token`, `secret`, `password`, `authorization`, `api_key`, `apikey`, `cookie`, `session`, `credential`) вырезаются на backend.

`POST /api/card-audit` запускает backend-аудит карточки по методике OptiCards/MP Audit: собирает WB snapshot, WB CDN, справочник характеристик WB, MPStats-характеристики, SEO/рыночные данные MPStats при наличии ключа и возвращает структурированный `auditResult` + draft-предложения для вкладки `Изменения`. Если часть внешних источников недоступна, маршрут возвращает частичный аудит с пользовательскими `riskNotes`, а не применяет write-операции в WB. Технические ошибки внешних API, например отсутствие `path` для MPStats-ниши, не выводятся в интерфейс напрямую.

При повторном подключении того же WB кабинета `POST /api/portals` отвечает `409`: `portal_already_connected` для активного кабинета или `portal_already_archived`, если кабинет уже есть в архиве. Проверка идет по digest токена и fingerprint набора `nmID`, сам WB ключ в ответ не попадает.

## Прод

Живой адрес:

```text
https://opticards.weboptai.ru/
```

Health:

```text
https://opticards.weboptai.ru/healthz
```

Рабочий цикл: локальная правка -> commit -> push в `main` -> на сервере `sudo opticards-deploy`.

Прод-обвязка находится на сервере, а не в этом репозитории. Подробности: `docs/deployment.md`.
