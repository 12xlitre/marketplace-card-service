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

Прототип сейчас находится в `index.html` и показывает основной входной сценарий:

- экран логина через backend: пользователи в SQLite, пароли в PBKDF2-хешах, сессия в HttpOnly cookie;
- главный экран `Кабинеты` с добавлением портала через API или вручную;
- разделы левого меню `Кабинеты`, `Аудит`, `Настройки`;
- кабинет селлера с обзором, источником данных, составом проекта и режимами охвата;
- детальную карточку с аудитом, вариантами заголовка и блоком `Было / стало`.

Создание или обновление пользователя:

```bash
npm run create-user -- dmitriy.admin "Сафиуллин Дмитрий" "Администратор" --user-role admin --access-level all
```

Подготовка серверного хранения WB API:

```bash
npm run generate-secret-key
export OPTICARDS_SECRET_KEY="..."
npm run create-portal -- "Wildberries кабинет" --lead manager-login --tech tech-login --manager manager-login
WB_API_TOKEN="..." npm run set-wb-token -- 1
npm run list-portals
```

WB API ключ не вводится в браузере и не хранится в `index.html`. Для реального подключения прод должен запускать backend `server.py`, а не только статическую раздачу.

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
