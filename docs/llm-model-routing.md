# Выбор GPT для OptiCards — 09.11.2026

Назначение: русский контент WB/Ozon с подтверждёнными фактами, классификация
запросов СЯ с обязательными factId/точной цитатой. Модель не меняет факты,
правила согласования, WB/Ozon изоляцию и источники MPStats.

| Модель | Роль | Настройка | Вход / выход за 1М токенов, USD |
|---|---|---|---|
| gpt-6.1-terra | Заголовки, характеристики, описание, анализ конкурента | none | 1 / 5 |
| gpt-6-luna | Массовая классификация запросов СЯ, включая automatic SEO fast stages | low | 0.10 / 0.50 |
| gpt-6.1-sol | Кандидат для сложных случаев; автоматически не включается | low | 2 / 10 |

Цены Standard из официальных model pages на09.11.2026, без налогов, кеширования,
fast tier и возможных особых тарифов. Фактическую стоимость определяет usage.
Источники:
- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/guides/latest-model

## Что проверено

Ограниченный live benchmark на18 обезличенных запросах для3 придуманных товаров:
средство от моли, женская оправа без линз, леденцы с сахаром. Каждая из3 моделей
приняла6 релевантных и не приняла ни одного из12 неподтверждённых/противоречащих
запросов. Стандартный backend проверил точную цитату/factId, формат полон.
Медиана на пакет6запросов: Luna2.59с, Terra4.59с, Sol4.18с. Одиночная простая
генерация около2.2–2.5с; разница в таком маленьком замере несущественна.
Terra также прошла реальные PROFILE_SCHEMA и PLAN_SCHEMA автоматического SEO
(2.13с/4.58с). Большая пачка/продолжительный throughput и качество относительно
GigaChat не сравнивались. Это проверка пригодности, не гарантия качества всех
товаров и не обещание ускорения полного процесса MPStats→СЯ→контент.
Артефакты: var/research/2026-11-09-openai/benchmark.json и live-schemas.json.

## Конфигурация

Ключ только в owner600 .env.local / защищённом backend окружении, не в git/UI:

```dotenv
OPENAI_API_KEY=<секрет через защищённый канал>
OPTICARDS_LLM_PROVIDER=openai
OPTICARDS_LLM_MODEL=gpt-6.1-terra
OPTICARDS_LLM_REASONING_EFFORT=none
OPTICARDS_LLM_CLASSIFIER_MODEL=gpt-6-luna
OPTICARDS_LLM_CLASSIFIER_REASONING_EFFORT=low
```

Если отдельный classifier model не задан, он наследует основную модель.
OpenAI adapter соблюдает model_override на каждом запросе; GPT5/6 получают
max_completion_tokens, effort-aware temperature. response_schema передаётся
как json_schema strict, обычный JSON — json_object, plain text без JSON wrapper.
Chat Completions сохраняется; инструменты/агенты модели не вызываются.
Таймаут120с для schema,60с для обычного текста, ответ≤4МБ. Общая очередь,
429/cooldown/transient retries и4слота OpenAI остаются прежними. Неверный
400 не повторяется. Ключ semantic cache включает classifier model+effort.

GET /api/admin-status возвращает только metadata: classifierModel, reasoningEffort,
classifierReasoningEffort и текущий provider/model; ключи не возвращаются.

GigaChat имеет прежний транспорт/схемы/параллельность и GigaChat-2-Max дляSEO;
если активен provider=gigachat, новые OpenAI параметры на него не влияют.
Повторно запускать принятые старые задачи ради новой модели не требуется.

## Перед включением на рабочем сервере

Подготовленные настройки локально не переключают production. Проверить доступ
с фактического сервера к API, generation quota и модели, остановить только по
штатному idle/recovery guard, сделать SQLite backup, выставить backend env и
выполнить штатный deploy. Если env меняется, проверять реально пересозданный
контейнер и admin-status; opticards-restart сам по себе этого не гарантирует.
Текущий инфраструктурный блок и runtime — в WORK.md.
