# Прод-развертывание OptiCards

Дата: 2026-07-07.

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
- прод-обвязка лежит на сервере, не в репозитории;
- не добавлять в репозиторий `Dockerfile`, `docker-compose.prod.yml`, `deploy/` и edge/frontend-nginx конфиги без отдельного согласования;
- публично отдаются только `index.html` и backend API `/api/*`;
- `docs/`, `WORK.md`, `.git`, `document/*.xlsx` и `document/*.docx` должны оставаться закрытыми;
- реальные учетные данные нельзя класть в frontend, CSV, документацию или репозиторий;
- если появятся новые публичные ассеты, лучше складывать их в `public/` и согласовать перевод webroot/сборки на сервере.
