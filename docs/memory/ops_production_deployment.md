# Прод-развертывание OptiCards

Дата: 2026-07-08.

OptiCards развернут на общем сервере:

```text
https://opticards.weboptai.ru/
```

Health:

```text
https://opticards.weboptai.ru/healthz
```

Серверный каталог:

```text
/opt/opticards
```

Рабочий цикл:

```text
локальная правка -> commit -> push в main -> sudo opticards-deploy на сервере
```

Команды на сервере под учеткой `lostdeal`:

```bash
ssh lostdeal-server
sudo opticards-deploy
sudo opticards-restart
sudo opticards-logs
sudo opticards-ps
```

Проверено 02.11.2026: текущий wrapper `opticards-restart` выполняет `docker compose ... up -d` и не перезапускает уже работающий контейнер. Не считать его вызов доказательством нового старта процесса; проверять `opticards-ps`. Штатный `opticards-deploy` при изменившемся образе пересоздаёт контейнер. Не менять root-owned wrapper в рамках исправления приложения.

02.11.2026 повторный `opticards-deploy` на том же6f85ec5 также пересоздал контейнер: считать любой deploy потенциальным рестартом, даже при неизменном gitSHA/слоях. Не запускать для диагностики во время генерации. Перед необходимым выпуском на работающей пачке нужен scoped durable recovery intent; после выпуска проверять ту же версию/сохранность источников и готовых результатов. Файлы, атомарно записанные контейнером, могут снова принадлежать runtime-пользователю и быть недоступны lostdeal: не обходить права через root/sudo shell и не считать это поводом для повторной выкладки.

Перед выпуском изменений React выполнять `npm run frontend:build` и включать обновлённый корневой `index.html` в коммит. `frontend:check` только проверяет сборку в `.react-build/`; production Dockerfile копирует корневой `index.html` и не собирает JSX. Успешный git pull/deploy исходников React без этого оставляет прежний интерфейс. Проверка реального браузера после выпуска обязательна.

Ограничения:
- код прямо на сервере не редактировать;
- прод-обвязка root-owned и лежит на сервере, не в репозитории;
- не добавлять в репозиторий `Dockerfile`, `docker-compose.prod.yml`, `deploy/` и edge/frontend-nginx конфиги без отдельного согласования;
- публично отдаются только `index.html` и backend API `/api/*`;
- `docs/`, `WORK.md`, `.git`, `document/*.xlsx` и `document/*.docx` должны оставаться закрытыми;
- реальные учетные данные нельзя класть в frontend, CSV, документацию или репозиторий;
- если появятся новые публичные ассеты, лучше складывать их в `public/` и согласовать перевод webroot/сборки на сервере.

Текущее состояние:
- prod runtime переключен на Python backend `server.py`;
- edge nginx проксирует домен на backend-контейнер `opticards_web:80`;
- `GET /api/session` должен отвечать `200 {"user": null}` для неавторизованного пользователя;
- `document/` должен отвечать `404`;
- SQLite хранится в `/opt/opticards/var` и переживает пересборку;
- `OPTICARDS_SECRET_KEY` уже находится в `/opt/opticards/.env.prod`, права `600`, заново его не генерировать;
- WB API ключ вводится через интерфейс и шифруется в SQLite.
- на рабочей машине Chromium для Playwright можно запускать без sudo: сам браузер установлен в `~/.cache/ms-playwright`, недостающие системные библиотеки распакованы в `/home/dmitriy/.local/chromium-deps/root`; перед запуском нужен `LD_LIBRARY_PATH=/home/dmitriy/.local/chromium-deps/root/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH`.

С 20.10.2026 для автоматической оптимизации Ozon серверный Dockerfile включает в `COPY` также `automatic_seo.py`, `automatic_seo_host.py`, `automatic_seo_xlsx.py`; `requirements.txt` включает openpyxl. Изменение согласовано и применено при штатной выкладке; точный патч хранится в `docs/automatic-seo-runtime.patch`. При добавлении Python-модулей проверять состав серверного образа: файлы репозитория вне `COPY` в контейнер не попадают. Текущий релиз и резервные копии — в `WORK.md`.

09.11.2026 выпуск eca3580: новый процесс план/задачи/календарь/клиентские
файлы WB/Ozon находится в server.py, отдельный Python-модуль образу не нужен.
Добавлены ReportLab и packaged Roboto; настоящий кириллический PDF проверен
на production. Новые таблицы мигрируются приложением, без изменения root-owned
Dockerfile/compose/wrappers. Перед выпуском backup SQLite; после — временные
изолированные кабинеты с обычным пунктом плана (без автоподбора СЯ, оплат и
уведомлений), полное удаление fixtures и сравнение прежних файлов/состояний.
Документационный follow-up после приёмки не требует повторной выкладки образа.

09.11.2026 выпуск09e5829: сквозной календарь и PDF-шаблон агентства остаются
в server.py; PNG/JPEG фото и логотипа из предоставленного PDF встроены в модуль,
поскольку образ явно копирует только известные Python-файлы. Клиентский PDF
целиком не упакован. ReportLab использует уже имеющийся Pillow; PyMuPDF нужен
только локальному визуальному чтению, runtime его не импортирует. JSX/CSS
собраны в root index.html. Additive workflow_legacy_schedule и nullable
start_minute в обеих таблицах календаря, без изменения обвязки. Production
acceptance на временных обычных задачах WB/Ozon с полным cleanup PASS;
повторять выкладку ради документационного follow-up не нужно.

09.11.2026 выпускc32a075: день аккаунта хранится в additive
workflow_day_assignments без фиктивных минут; оценки остаются в прежних двух
таблицах. Новая calendar-window API приватна. Native deploy без изменения
инфраструктуры/зависимостей;48backend/14frontend и production native mouse
WB/Ozon/30мин/mobile390 PASS, fixtures полностью удалены. Перед выпуском
консистентный backup и idle guard, после — исходные количества/state/Excel SHA.
Документационный follow-up не требует повторного перезапуска.

09.11.2026 выпуск4beaf4a: переписка Б24 через сделку в существующем server.py,
additive workflow_crm_links, root index пересобран; runtime/infra зависимости
без изменений. Backup deal-mail-release-20261109T145202Z quick_check OK.
Production WB/Ozon mail-tab/CRM-needed state/tech403/guide/mobile390 PASS;
реальных писем/привязок не делали, fixtures полностью удалены. Существующие
календарная запись/event1, paid states и Excel SHA сохранены. Последний scope
пока без CRM; это внешняя настройка, не повод повторять выкладку. Docs follow-up
после приёмки не требует повторного перезапуска.

09.11.2026 выпускaef46fe: подготовлен OpenAI adapter + отдельный classifier
model/effort, вкладка «Почта». Production env НЕ переключён: api.openai.com
с46.19.66.244 вернул403 unsupported_country_region_territory, хотя локальные
model/completion вызовы успешны. После native deploy admin-status подтвердил
GigaChat/GigaChat-2-Max; региональную проблему Дмитрий передаёт Сергею.
SQLitebackup openai-adapter-release-20261109T151039Z quickcheck OK;
165 backend/14 frontend/live synthetic schema/both marketplaces/mobile PASS,
fixtures удалены, прежние states/rows/calendar/Excel SHA сохранены. Новых
runtime dependencies/infra config changes нет, .env.local в образ не копируется.
Для GPT позже нужны доступный регион, живой smoke с места исполнения и явная
смена backend env с настоящим пересозданием контейнера. Docs follow-up не требует
повторной выкладки.

10.11.2026 выпуск b773fa9: выбор карточек сделок из «Аккаунтинга» №11 в
существующей вкладке «Почта», приватная crm-deals API в server.py; новых
модулей/зависимостей/инфраструктуры/миграций нет. До native deploy idle guard
и backup crm-picker-release-20261110T094222Z quick_check OK. Светлане по
разрешению Дмитрия сохранён проверенный ID Б24 93 с прежними рабочими днями,
без возобновления очередей. Production natural acceptance с настоящим read-only
Б24: Светлана создаёт WB/Ozon и видит 23 свои сделки; Дмитрий/Кристина/Оксана
admin/all создают кабинеты и видят все 58 сделок воронки. Проверены preview/
явная привязка на временных кабинетах, собственник403/tech403/mobile390/guide,
JS errors0. 5 кабинетов/5 сессий удалены; прежние states/rows/workflow hashes
и физические Excel SHA сохранены. Пользовательские кабинеты не привязывались,
писем не отправляли. Docs follow-up не требует повторного deploy/рестарта.

10.11.2026 выпуск a9f26c4: PDF плана использует исходные страницы образца
вместо повторной стилизации; персональные поля удалены заранее, выбранные
работы/данные верстает ReportLab, объединяет pypdf6.21.4 из requirements.
PDF/font assets встроены в существующий server.py; новых модулей/infra нет.
PyMuPDF/fontTools только локальная подготовка и проверки, на runtime не нужны.
Backup original-pdf-release-20261110T102219Z quick_check OK, idle guard PASS.
Production WB/Ozon UI/скачивание/контакты менеджера/mobile/guide PASS; статические
страницы вне подстановок совпали с исходником пиксель в пиксель. Временные
кабинеты/планы/PDF/сессии удалены; прежние рабочие строки/states/Excel SHA и
Настя91/Светлана93 сохранены. WB integration updated_at обновились при старте,
остальные поля и ключи не менялись. Старые PDF версий не перезаписываются.
Документационный follow-up не требует повторного выпуска/перезапуска.
