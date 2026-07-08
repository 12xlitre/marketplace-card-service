# OptiCards Deployment

Дата фиксации: 2026-07-08.

## Статус

OptiCards развернут на общем сервере.

Живой адрес:

```text
https://opticards.weboptai.ru/
```

Health:

```text
https://opticards.weboptai.ru/healthz
```

На 2026-07-08 `/healthz` отвечает `ok`, главная страница отдается с `HTTP/2 200`, backend API работает через `server.py`.

## Как работает прод

Прод переключен с nginx-static контейнера на Python backend. Контейнер запускает:

```bash
python3 server.py serve --host 0.0.0.0 --port 80
```

Edge nginx по-прежнему завершает TLS и проксирует домен на контейнер `opticards_web:80`.

Локально прототип отдается командой:

```bash
npm run prototype
```

Backend `server.py` отдает `index.html` и API `/api/*`. Внутренние файлы (`docs/`, `WORK.md`, `document/`, `.git`) должны отвечать `404`.

Серверный каталог:

```text
/opt/opticards
```

Репозиторий:

```text
git@github.com:12xlitre/marketplace-card-service.git
```

Ветка:

```text
main
```

## Управление на сервере

Подключение:

```bash
ssh lostdeal-server
```

Команды под учеткой `lostdeal`:

```bash
sudo opticards-deploy    # git pull + пересборка + перезапуск
sudo opticards-restart   # перезапуск без пересборки
sudo opticards-logs      # логи backend-контейнера
sudo opticards-ps        # статус
```

Backend env уже настроен на сервере в `/opt/opticards/.env.prod`:

```bash
OPTICARDS_DB=/app/var/opticards.sqlite3
OPTICARDS_SECRET_KEY=<stored in /opt/opticards/.env.prod>
OPTICARDS_SECURE_COOKIE=1
```

`OPTICARDS_SECRET_KEY` уже создан, хранится с правами `600`, gitignored, заново его не генерировать. SQLite находится в `/opt/opticards/var` и переживает пересборку контейнера.

WB API ключ вводится через интерфейс `Добавить портал` -> `Через API`; backend шифрует его в SQLite этим секретом. Вручную передавать WB ключ на сервер не нужно.

Рабочий цикл:

```text
правка локально -> commit -> push в main -> sudo opticards-deploy на сервере
```

Код прямо на сервере не редактировать: только локальная правка -> commit -> push -> `sudo opticards-deploy`.

## Публичные файлы

Снаружи отдаются только:

- `index.html`;
- backend API `/api/*`.

Остальное закрыто и должно отдавать `404`:

- `.git`;
- `WORK.md`;
- `docs/`;
- `document/`;
- другие внутренние материалы.

Пользователи хранятся в SQLite-базе backend-сервера. Пароли нельзя класть в frontend, CSV, документацию или репозиторий; через CLI в базу попадает только PBKDF2-хеш.

## Новые ассеты

Если появятся новые публичные файлы, например изображения, ассеты или дополнительные страницы, они не появятся на сайте автоматически.

Варианты:

1. Попросить серверную сторону добавить файлы в сборку/раздачу.
2. Лучше: сложить всю публичную статику в отдельную папку `public/` и согласовать перевод webroot на нее.

## Что не добавлять в репозиторий

Прод-обвязка лежит на сервере, не в этом репозитории:

- `Dockerfile`;
- `docker-compose.prod.yml`;
- `deploy/`;
- edge/frontend-nginx конфиг;
- серверные команды `opticards-*`.

Эти файлы не нужно добавлять в git здесь, чтобы не конфликтовать с серверным `git pull` и внешней инфраструктурой.

Если в приложении меняется порт, структура публичных файлов или webroot, нужно заранее предупредить серверную сторону, чтобы они поправили маршрут и раздачу.
