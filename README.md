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
- главный экран `Кабинеты` со списком клиентов; внутри клиента есть общий экран и разделы Wildberries/Ozon, где текущий WB-поток открывается без изменения, а Ozon пока скрыт как beta только для Дмитрия;
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
POST /api/portals/<portal_id>/client-name
POST /api/portals/<portal_id>/client-contact
POST /api/portals/<portal_id>/manual-source
POST /api/portals/<portal_id>/ozon-mpstats-probe
POST /api/portals/<portal_id>/ozon-mpstats-cards
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
POST /api/card-workset/delete-tasks
POST /api/card-workset/reorder-tasks
POST /api/card-workset/log-event
POST /api/card-workset/audit-task
POST /api/semantic-core-import
POST /api/semantic-core-collections
POST /api/portal-work-periods
DELETE /api/semantic-core-collections?portal_id=1&collection_id=1
DELETE /api/portal-work-periods?portal_id=1&period_id=1
```

`POST /api/portals` принимает необязательный `clientName`: он нужен для группировки WB/Ozon кабинетов внутри одного клиента до появления отдельной backend-сущности `Client`. `POST /api/portals/<portal_id>/client-name` меняет эту привязку у кабинета после проверки доступа; frontend уровня клиента применяет новое имя ко всем кабинетам клиента.

`POST /api/portals/<portal_id>/manual-source` обновляет `storeUrl` и `manualSource` только у manual-кабинетов после проверки доступа. В текущем Ozon beta это сохраняет ссылку/Seller ID/ориентир и комментарий к будущей Ozon-specific загрузке, без подключения WB API.

`POST /api/portals/<portal_id>/ozon-mpstats-probe` доступен только для Ozon-порталов с edit/manage правами пользователя и проверяет сохраненный Ozon-источник через MPStats малым лимитом. Если в источнике указаны тестовые артикулы/SKU, item-кандидаты проверяются первыми и агрегируются пачкой до 50 найденных карточек; seller/brand/category остаются fallback, если SKU ничего не дали. Маршрут возвращает статус, найденный источник, попытки endpoint-ов и sample-карточки, но не сохраняет карточки и не запускает WB-загрузчик.

`POST /api/portals/<portal_id>/ozon-mpstats-cards` доступен только для Ozon-порталов с edit/manage правами пользователя и сохраняет явно выбранный результат Ozon MPStats probe в `cards_snapshot_json`. Карточки нормализуются как `marketplace=ozon`, мержатся по SKU/offer/id с уже сохраненным Ozon snapshot и обновляют `card_count/problem_count/last_sync_at`; WB API и WB bootstrap не запускаются.

Для числовых порталов env fallback отключен: у каждого портала должен быть свой зашифрованный WB-токен. До отдельного решения write-операции WB не реализуются.

`GET /api/wb/cards` возвращает нормализованные карточки и sanitised `rawFields` для детального просмотра. Поля с признаками секретов (`token`, `secret`, `password`, `authorization`, `api_key`, `apikey`, `cookie`, `session`, `credential`) вырезаются на backend.

`POST /api/card-audit` запускает backend-аудит карточки по методике OptiCards/MP Audit: собирает WB snapshot, WB CDN, справочник характеристик WB, MPStats-характеристики, SEO/рыночные данные MPStats при наличии ключа и возвращает структурированный `auditResult` + draft-предложения для вкладки `Изменения`. Для MPStats-ниши backend берет `path` как числовой `subject.id` из `/analytics/v1/wb/items/{nmID}/full` или fallback `subjectID` карточки и передает его в query subject-ручек. Если часть внешних источников недоступна, маршрут возвращает частичный аудит с пользовательскими `riskNotes`, а не применяет write-операции в WB. Технические ошибки внешних API, например отсутствие `path` для MPStats-ниши, не выводятся в интерфейс напрямую.

`POST /api/card-content-reoptimize` переписывает заголовок и описание через настроенный LLM/GigaChat по выбранным запросам вкладки `Семантическое ядро`. Маршрут принимает `selectedKeywords` и/или `removeKeywords`: новые запросы включаются естественно, а ключи/ранжирующиеся запросы из `removeKeywords` считаются предложенными к исключению и не должны намеренно сохраняться в новом тексте. Маршрут требует доступ пользователя к `portalId`, не пишет в WB и возвращает только `draftContent` для сохранения во вкладке `Изменения`.

`POST /api/card-competitors/suggest` собирает до 3 конкурентов для вкладки `Товарный аудит`: использует MPStats-нишу и тот же скоринг коммерческой схожести, что рыночный аудит, сохраняет список в `card_competitors` и возвращает сравнительные метрики. Маршрут проверяет доступ к `portalId` и не выполняет write-операции в WB.

`GET /api/admin/mpstats-usage` возвращает журнал обращений к MPStats для XLSX-выгрузки из `Настройки -> Интеграции -> MPStats API -> Скачать журнал API`. Маршрут доступен только пользователям, которые могут управлять кабинетами/интеграциями, и не возвращает сохраненный MPStats-токен. Журнал хранит пользователя, место действия, портал/карточку, метод и путь MPStats, HTTP-статус, источник `api/cache`, оценку расхода лимита и остаток, если MPStats когда-либо вернет его в headers. По публичной справке MPStats 1 API-запрос списывает 1 лимит внешней аналитики; отдельный API-остаток сейчас не передается.

Семантическое ядро использует отдельный свежий MPStats-период: по умолчанию последние 30 дней с лагом 1 день (`MPSTATS_SEMANTIC_PERIOD_DAYS`, `MPSTATS_SEMANTIC_PERIOD_LAG_DAYS`). Аудит и конкурентные срезы остаются на стабильном историческом окне `audit_period_default`, поэтому даты в СЯ и аудите могут отличаться намеренно.

SEO expansion MPStats отправляется не только с пользовательским стартовым запросом, но и с релевантными seed-фразами из карточки, если они явно читаются в текущем контенте/характеристиках. Стартовый запрос можно менять в поле СЯ и запускать новый подбор по Enter; при смене запроса обновляются только кандидаты к добавлению, а ранжирующиеся позиции карточки остаются отдельным набором. Например для очков с ручным запросом `кошачий глаз` backend сохраняет эту фразу как стартовую и дополнительно отправляет `очки кошачий глаз` / `солнцезащитные очки кошачий глаз`, чтобы высокочастотные товарные запросы попадали в кандидаты к добавлению.

`GET/POST/DELETE /api/semantic-core-collections` хранит архив подборок СЯ внутри кабинета. Подборка имеет ручное название и список ключей к добавлению; применение подборки копирует ключи в текущую карточку, не связывая карточку с архивом автоматически. Повторное сохранение с тем же названием или `collectionId` пополняет подборку только новыми ключами, а ручное редактирование архива отправляет `mode: "replace"` и сохраняет очищенный список.

Частотные корзины СЯ настраиваются через `MPSTATS_SEMANTIC_HIGH_FREQUENCY` и `MPSTATS_SEMANTIC_MEDIUM_FREQUENCY`; значения по умолчанию: высокий `>=5000`, средний `>=2000` и `<5000`, низкий `<2000`. Автодобавление выбирает до 36 запросов, балансируя до 12 строк из каждой корзины.

Карточечная XLSX-выгрузка `Семантическое ядро` содержит вкладку `Инструкция` и рабочую вкладку `СЯ в работу`. Рабочие колонки: `Ключи в карточке (действующие)`, `Ранжируемые ключи`, `Позиция ранжируемого ключа`, `Ключ к добавлению`, `Частота запроса ключа к добавлению`, `Согласование добавления`, `Ключ к удалению из карточки`, `Причина удаления`, `Согласование удаления`. Заполненные данные защищены от редактирования; в колонках согласования доступен выбор `Да/Нет`, по умолчанию `Да` для строк с ключом к добавлению или удалению.

`POST /api/semantic-core-import` загружает согласованное СЯ обратно в WB `card_drafts` без write-операций в Wildberries. Маршрут принимает JSON с `portalId`, `scope` (`card` или `portal`), `mode` (`preview` или `apply`), `fileName`, `fileData` base64 и опциональным `cardKey` для карточечного режима. Backend читает XLSX/CSV/TXT, ищет колонки ключей и `Да/Нет`, сопоставляет карточки по `cardKey`/WB `nmID`/артикулу/имени листа, а для категорийных файлов вроде `Шапки`, `Косынки`, `Панамки`, `Бейсболки` может сопоставлять карточки по предмету/названию. В `preview` возвращаются matched/unmatched строки; в `apply` обновляется только `meta.semanticCoreFinal`, `semanticCoreSelected` и `semanticCoreRemoval`, чтобы последующая переоптимизация контента работала по согласованному СЯ.

`GET /api/portal-card-drafts` отдает сохраненные черновики карточек по одному кабинету после проверки доступа. Frontend использует его для кабинетных XLSX-выгрузок: итоговое СЯ по карточкам с сохраненным СЯ и итоговый контент только по карточкам, где секция `Контент` принята (`approved/exported`).

`GET/POST /api/card-workset` хранит рабочий набор карточек кабинета в backend, а `POST /api/card-workset/create-tasks` создает внутренние задачи по выбранным типам работ (`СЯ`, `Контент`, `Цены`, `Остатки`). При создании пачку можно сразу связать с пунктом отчетного периода через `workPeriodId` + `workPeriodTaskKey`: backend добавляет `batchId`/тип задачи в `linkedBatchIds`/`linkedTaskIds` пункта и переводит пункт из `planned` в `in_progress`. Задачей считается только draft с явным `meta.batch.workTypes`; обычное сохранение СЯ/черновика карточки без batch не должно появляться как задача `Контент`. Во вкладке `Задачи` активная пачка открывается как рабочий конвейер в детальной карточке: прогресс `N из M`, текущая карточка и переходы `Предыдущая`/`Следующая` без возврата к списку. `POST /api/card-workset/reorder-tasks` сохраняет ручной порядок карточек внутри batch в `card_drafts.meta.batch.position`; маршрут фильтрует задачи по `portal_id` и `batch.id`, а frontend меняет порядок drag-and-drop локально до явного `Сохранить порядок`. `POST /api/card-workset/log-event` пишет журнал действий по карточке пачки (`opened`, `skipped`, `deferred`, `quick_completed`, `audit_completed`, `audit_failed`) в `card_approval_events` после проверки доступа к кабинету и существования `card_draft`. `POST /api/card-workset/audit-task` запускает аудит одной карточки пачки, сохраняет audit/content draft в `card_drafts`, не отправляет блоки на согласование и возвращает обновленный workflow; frontend вызывает этот маршрут последовательно для пакетного аудита видимых карточек. Задачи workflow содержат `hasAuditDraft`, поэтому после частичного пакетного аудита frontend может продолжить только карточки без сохраненного аудита или повторить только локально упавшие карточки. `POST /api/card-workset/delete-tasks` удаляет рабочую задачу/тип работ из batch, очищает matching-связи `linkedTaskIds`/`linkedBatchIds` в активных отчетных периодах, но сохраняет результаты карточки в `card_drafts`; для СЯ задача считается закрытой после сохранения карточки в итоговое СЯ кабинета.

`GET/POST /api/portals/<portal_id>/ozon-tasks` хранит beta-задачи Ozon отдельно от WB workflow. Маршрут доступен только пользователям с доступом к Ozon-кабинету, проверяет `marketplace=Ozon`, пишет задачи в `ozon_tasks`, события в `ozon_task_events` и не использует `card_drafts`/`card-workset`. Поддерживаемые статусы: `draft`, `done`, `skipped`, `later`, `returned`; frontend оставляет `localStorage` только как fallback/миграцию старых beta-задач.

`GET/POST /api/portals/<portal_id>/ozon-semantic-draft` хранит beta-черновик СЯ Ozon по `portal_id + card_key` в отдельной таблице `ozon_semantic_drafts`. Маршрут доступен только пользователям с доступом к Ozon-кабинету, проверяет `marketplace=Ozon`, сохраняет текущие ключи, выбранные рекомендации, исключения и финальный набор, не пишет в WB `card_drafts` и не запускает WB API.

`GET /api/portals/<portal_id>/ozon-semantic-drafts`, `GET/POST /api/portals/<portal_id>/ozon-card-draft`, `GET /api/portals/<portal_id>/ozon-card-drafts` и `POST /api/portals/<portal_id>/ozon-card-audit` развивают Ozon beta до отдельного контура результатов. Контент/аудит хранятся в `ozon_card_drafts`, задачи получают признаки `hasSemanticFinal`, `hasFinalContent`, `auditStatus`, а кабинетные XLSX `Скачать итоговое СЯ` и `Скачать итоговый контент` собираются только из Ozon-таблиц. Все маршруты проходят через проверку Ozon-портала и не используют WB `card_drafts`, WB audit или WB API.

`POST /api/card-drafts` при изменении статуса реальной задачи автоматически синхронизирует связанные пункты отчетного периода и возвращает измененные периоды в поле `workPeriods`. Статус считается по всей связанной пачке: пока хотя бы одна карточка по типу работ не завершена, пункт остается `in_progress`; для СЯ пункт становится `done` только когда все карточки пачки сохранены в итоговое СЯ; для `Контент`/`Цены`/`Остатки` все карточки `submitted` переводят пункт в `review`, все `approved/exported` - в `done`, а `changes_requested` возвращает пункт в `in_progress` с причиной возврата.

`GET /api/portals/<portal_id>/wb-client-report` собирает данные для клиентского XLSX-отчета по выбранному периоду `start/end` в формате `YYYY-MM-DD`. Старый параметр `weeks` остается совместимым fallback, но UI использует сценарий `выбрать отчет -> выбрать период -> сформировать` во вкладке `Отчеты` внутри кабинета селлера. Маршрут проверяет доступ к кабинету, берет WB-токен только из backend-хранилища и не выполняет write-операции в WB.

`GET/POST/DELETE /api/portal-work-periods` хранит отчетные периоды отдела внутри конкретного кабинета. Это не клиентский XLSX-отчет и не MPStats-период: пользователь создает произвольный период через даты начала/конца, выбирает план работ из детального чек-листа Wildberries, корректирует активные пункты во время периода, добавляет внеплановые ручные задачи `manual:*` с описанием и ведет каждый пункт по статусам `planned/in_progress/review/done`. Backend action `update_task_status` сохраняет статус, комментарий и один приложенный файл до 2 МБ; `return_task` переводит пункт в `returned` с обязательной причиной; `link_task` привязывает реальную задачу/пачку кабинета к пункту плана через `linkedTaskIds`/`linkedBatchIds` и переводит пункт в `in_progress`, если он был `planned`; `unlink_task` снимает эту связь с пункта плана без удаления самой задачи. Убранные из плана пункты не удаляются бесследно, а переходят в статус `excluded`. Финальный XLSX-отчет доступен только после даты окончания периода; backend action `generate_report` до этого отвечает `work_period_not_finished`. Все операции проверяют доступ к `portal_id` и сохраняются в backend-таблице `portal_work_periods`; в XLSX попадают статус, описание, связанные задачи и имя приложенного файла.

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
