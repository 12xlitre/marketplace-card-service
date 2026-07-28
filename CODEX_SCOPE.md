# Codex Scope

Default mode for this project: low-token, targeted work.

## Work Rules

- Start with focused `rg` searches for the named route, function, error, file, or domain term.
- Read only the smallest useful set of files, usually 1-3 files for a local task.
- If the user describes a feature without knowing the file, ask 1 short clarifying question when it can avoid broad scanning.
- Prefer direct fixes over broad refactors.
- Run only checks that are relevant to the touched code.
- Before expanding into a protected area, say why it is needed and wait for approval unless the task is blocked.
- After finding where a feature lives, update the Project Map below with the shortest useful note.
- Keep progress updates and final summaries short.

## Protected Areas

Do not inspect or edit these areas unless the user explicitly asks or the current task cannot be completed without them:

- Database schema and migrations.
- OAuth, authentication, authorization, permissions, and tenant isolation.
- External integrations: Bitrix24 REST, smtp.bz, webhooks, and API clients.
- Deployment, hosting, infrastructure, CI/CD, and secrets.
- Marketplace moderation/submission artifacts.
- Large docs, archives, dumps, generated files, and fixtures.
- Lock files and dependency manifests unless the task is about dependencies.

## Allowed By Default

- The specific module, route, component, test, or config named by the user.
- Neighboring tests for touched code.
- Minimal supporting files needed to understand or verify the change.

## Discovery Flow

When the user does not know the file:

1. Convert the request into 1-3 exact search terms: UI text, route, error text, API method, component name, or domain word.
2. Run focused `rg` searches, excluding heavy/generated areas when possible.
3. Read the best matching file first.
4. If there are many matches, ask a short clarifying question instead of scanning widely.
5. Update `Project Map` with the discovered location.

Useful search excludes:

```bash
rg "term" -g '!node_modules' -g '!var' -g '!.git' -g '!docs/memory'
```

## Project Map

Keep this section compact. Add only stable locations that help avoid future searches.

- Frontend app: `frontend/src/`
- Tests: `tests/`
- Project docs/memory: `docs/`, `docs/memory/`
- Generated/local runtime data: `var/`
- Built/cache dependencies: `node_modules/`, `.react-build/`
