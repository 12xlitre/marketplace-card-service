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
- вкладку `Отчетный период` внутри кабинета селлера для плана работ отдела по произвольным датам, чек-листу задач и итоговому отчету выполнения;
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
GET /api/portals/<portal_id>/wb-client-report?start=2026-07-01&end=2026-07-07
GET /api/admin/mpstats-usage?limit=5000
GET /api/approval-workflow?portal_id=1
GET /api/card-workset?portal_id=1
GET /api/portal-card-drafts?portal_id=1
GET /api/semantic-core-collections?portal_id=1
GET /api/portal-work-periods?portal_id=1
POST /api/card-audit
POST /api/card-content-reoptimize
POST /api/card-competitors/suggest
POST /api/card-workset
POST /api/card-workset/create-tasks
POST /api/semantic-core-collections
POST /api/portal-work-periods
DELETE /api/semantic-core-collections?portal_id=1&collection_id=1
DELETE /api/portal-work-periods?portal_id=1&period_id=1
```

Для числовых порталов env fallback отключен: у каждого портала должен быть свой зашифрованный WB-токен. До отдельного решения write-операции WB не реализуются.

`GET /api/wb/cards` возвращает нормализованные карточки и sanitised `rawFields` для детального просмотра. Поля с признаками секретов (`token`, `secret`, `password`, `authorization`, `api_key`, `apikey`, `cookie`, `session`, `credential`) вырезаются на backend.

`POST /api/card-audit` запускает backend-аудит карточки по методике OptiCards/MP Audit: собирает WB snapshot, WB CDN, справочник характеристик WB, MPStats-характеристики, SEO/рыночные данные MPStats при наличии ключа и возвращает структурированный `auditResult` + draft-предложения для вкладки `Изменения`. Для MPStats-ниши backend берет `path` как числовой `subject.id` из `/analytics/v1/wb/items/{nmID}/full` или fallback `subjectID` карточки и передает его в query subject-ручек. Если часть внешних источников недоступна, маршрут возвращает частичный аудит с пользовательскими `riskNotes`, а не применяет write-операции в WB. Технические ошибки внешних API, например отсутствие `path` для MPStats-ниши, не выводятся в интерфейс напрямую.

`POST /api/card-content-reoptimize` переписывает заголовок и описание через настроенный LLM/GigaChat по выбранным запросам вкладки `Семантическое ядро`. Маршрут требует доступ пользователя к `portalId`, не пишет в WB и возвращает только `draftContent` для сохранения во вкладке `Изменения`.

`POST /api/card-competitors/suggest` собирает до 5 конкурентов для вкладки `ТОП конкурентов`: использует MPStats-нишу и тот же скоринг коммерческой схожести, что аудит, сохраняет список в `card_competitors` и возвращает сравнительные метрики. Маршрут проверяет доступ к `portalId` и не выполняет write-операции в WB.

`GET /api/admin/mpstats-usage` возвращает журнал обращений к MPStats для XLSX-выгрузки из `Настройки -> Интеграции -> MPStats API -> Скачать журнал API`. Маршрут доступен только пользователям, которые могут управлять кабинетами/интеграциями, и не возвращает сохраненный MPStats-токен. Журнал хранит пользователя, место действия, портал/карточку, метод и путь MPStats, HTTP-статус, источник `api/cache`, оценку расхода лимита и остаток, если MPStats когда-либо вернет его в headers. По публичной справке MPStats 1 API-запрос списывает 1 лимит внешней аналитики; отдельный API-остаток сейчас не передается.

Семантическое ядро использует отдельный свежий MPStats-период: по умолчанию последние 30 дней с лагом 1 день (`MPSTATS_SEMANTIC_PERIOD_DAYS`, `MPSTATS_SEMANTIC_PERIOD_LAG_DAYS`). Аудит и конкурентные срезы остаются на стабильном историческом окне `audit_period_default`, поэтому даты в СЯ и аудите могут отличаться намеренно.

SEO expansion MPStats отправляется не только с пользовательским стартовым запросом, но и с релевантными seed-фразами из карточки, если они явно читаются в текущем контенте/характеристиках. Стартовый запрос можно менять в поле СЯ и запускать новый подбор по Enter; при смене запроса обновляются только кандидаты к добавлению, а ранжирующиеся позиции карточки остаются отдельным набором. Например для очков с ручным запросом `кошачий глаз` backend сохраняет эту фразу как стартовую и дополнительно отправляет `очки кошачий глаз` / `солнцезащитные очки кошачий глаз`, чтобы высокочастотные товарные запросы попадали в кандидаты к добавлению.

`GET/POST/DELETE /api/semantic-core-collections` хранит архив подборок СЯ внутри кабинета. Подборка имеет ручное название и список ключей к добавлению; применение подборки копирует ключи в текущую карточку, не связывая карточку с архивом автоматически. Повторное сохранение с тем же названием или `collectionId` пополняет подборку только новыми ключами, а ручное редактирование архива отправляет `mode: "replace"` и сохраняет очищенный список.

Частотные корзины СЯ настраиваются через `MPSTATS_SEMANTIC_HIGH_FREQUENCY` и `MPSTATS_SEMANTIC_MEDIUM_FREQUENCY`; значения по умолчанию: высокий спрос `>=1000`, средний `>=300`, низкий `<300`. Автодобавление выбирает до 36 запросов, балансируя до 12 строк из каждой корзины.

Карточечная XLSX-выгрузка `Семантическое ядро` содержит вкладку `Инструкция` и рабочую вкладку `СЯ в работу`. Рабочие колонки: `Ключи в карточке (действующие)`, `Ранжируемые ключи`, `Позиция ранжируемого ключа`, `Ключ к добавлению`, `Частота запроса ключа к добавлению`, `Согласование`. Заполненные данные защищены от редактирования; в `Согласование` доступен выбор `Да/Нет`, по умолчанию `Да` для каждой строки с ключом к добавлению.

`GET /api/portal-card-drafts` отдает сохраненные черновики карточек по одному кабинету после проверки доступа. Frontend использует его для кабинетных XLSX-выгрузок: итоговое СЯ по карточкам с сохраненным СЯ и итоговый контент только по карточкам, где секция `Контент` принята (`approved/exported`).

`GET/POST /api/card-workset` хранит рабочий набор карточек кабинета в backend, а `POST /api/card-workset/create-tasks` создает внутренние задачи по выбранным типам работ (`СЯ`, `Контент`, `Цены`, `Остатки`). Задачи остаются в `card_drafts` и approval workflow; для СЯ задача считается закрытой после сохранения карточки в итоговое СЯ кабинета.

`GET /api/portals/<portal_id>/wb-client-report` собирает данные для клиентского XLSX-отчета по выбранному периоду `start/end` в формате `YYYY-MM-DD`. Старый параметр `weeks` остается совместимым fallback, но UI использует сценарий `выбрать отчет -> выбрать период -> сформировать` во вкладке `Отчеты` внутри кабинета селлера. Маршрут проверяет доступ к кабинету, берет WB-токен только из backend-хранилища и не выполняет write-операции в WB.

`GET/POST/DELETE /api/portal-work-periods` хранит отчетные периоды отдела внутри конкретного кабинета. Это не клиентский XLSX-отчет и не MPStats-период: пользователь создает произвольный период через даты начала/конца, выбирает план работ (`Семантика`, `Контент`, `Цены`, `Остатки`), корректирует активные пункты во время периода, отмечает выполнение с комментарием и датой, может вернуть задачу с причиной и скачать клиентский XLSX `План работ`. Убранные из плана пункты не удаляются бесследно, а переходят в статус `excluded`. Финальный XLSX-отчет доступен только после даты окончания периода; backend action `generate_report` до этого отвечает `work_period_not_finished`. Все операции проверяют доступ к `portal_id` и сохраняются в backend-таблице `portal_work_periods`; пункты плана уже имеют необязательные поля для будущей связи с задачами/пачками кабинета.

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
