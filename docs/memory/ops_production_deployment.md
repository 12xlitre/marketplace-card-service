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
