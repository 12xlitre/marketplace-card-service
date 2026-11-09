# Модели генерации и классификации

09.11.2026 Дмитрий поручил заменить GigaChat на GPT ради качества/скорости.
Выбран после official docs + bounded live eval маршрут gpt-6.1-terra/none для
контента, gpt-6-luna/low для классификации СЯ. Sol/low — исследованный кандидат,
автоматического дорогого fallback нет. Измерения/цены/оговорки/переменные —
../llm-model-routing.md. Эти модели не являются моделью самого Codex-агента.

Ключ из6строки .env.local был голым текстом и не читался. Теперь именованный
OPENAI_API_KEY, owner600/ignored; никогда не печатать/копировать в tracked файлы.
Production env может отличаться от локального, текущая активация — в WORK.md.
Перед переводом провайдера выполнить smoke с фактического места исполнения;
models200 локально не доказывает доступ с production или generation quota.
09.11.2026 с46.19.66.244 получен403 unsupported_country_region_territory, при том
что локальные completion/model запросы успешны. Не переводить рабочий сервис на
неработающий маршрут; Дмитрий передаёт инфраструктурную проблему Сергею.

Один audit_llm_chat_completion управляет очередью/retry и обоими провайдерами.
OpenAI honours request-local model_override; json_schema strict при schema,
json_object без schema, plain text без response_format. GPT5/6 используют
max_completion_tokens и reasoning_effort; sampling параметры убраны при
reasoning!=none. Для Sol/Astra none нормализуется в low, legacyGPT4без reasoning.
Отдельный classifier работает и в semantic_classify_query_batch, и в fast stage
automatic SEO host. semantic_model_key включает classifier+effort для OpenAI;
GigaChat путь, native_functions/JSON prompts и его модель остаются прежними.
Новые модели не запускают заново старые принятые версии/остановленные пачки.

Обычный рабочий процесс перед deploy: idle/recovery guard, SQLitebackup,
frontend:build/root index, штатный native opticards-deploy. Не менять root-owned
Dockerfile/compose. env_file .env.prod уже используется compose; .env.local в
образ не попадает. Изменение backend env требует настоящего пересоздания,
opticards-restart сам по себе это не гарантирует. Фактический provider/model
проверять /api/admin-status с правами и не отдавать ключи интерфейсу.
