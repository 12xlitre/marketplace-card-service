# Project Memory

Устойчивые договоренности и решения проекта.

- `product_visual_first.md` — продукт делаем через визуальный прототип и пошаговое уточнение процесса.
- `product_store_onboarding.md` — магазин можно заводить через WB API или вручную, с возможностью подключить API позже.
- `backend_auth_and_sessions.md` — backend-only auth, сессии с разным TTL и remember-me, восстановление состояния после refresh.
- `backend_portals.md` — кабинеты и состав проекта живут в SQLite/backend API, браузерный localStorage только fallback.
- `backend_wb_readonly.md` — read-only WB API подключение через backend, токены только env/demo или encrypted per portal, без write-операций.
- `ops_production_deployment.md` — OptiCards развернут на `opticards.weboptai.ru`, прод-обвязка живет на сервере.
- `product_wb_characteristic_values.md` — правила по значениям характеристик WB: где есть официальный справочник, где только подсказки из карточек, и почему нужен MPStats.
- `product_approval_workflow.md` — роли согласования, хранение задач/событий и правило soft reset анализа при обновлении WB.
