# Request Mocker

Кроссбраузерное расширение (Chrome + Firefox) для подмены HTTP-запросов. Позволяет тестировать поведение приложения при ошибках сервера, задержках, отсутствии авторизации и других сценариях без доступа к бэкенду.

## Архитектура

- **Content script approach** — перехватывает `fetch()` и `XMLHttpRequest` через injection в page context
- **MV3** — Manifest V3 для Chrome (service_worker) и Firefox (background.scripts)
- Запросы перехватываются на стороне клиента, **не видны в Network tab** DevTools
- Логи мокированных запросов отображаются в Console с тегом `[Request Mocker]`

## Структура проекта

```
mockExtention/
├── extension/                    — исходники расширения (Chrome)
│   ├── manifest.json             — Chrome MV3 манифест
│   ├── background/background.js  — service worker
│   ├── content/content.js        — bridge extension ↔ page
│   ├── content/injected.js       — fetch/XHR override (page context)
│   ├── popup/popup.html|js|css   — compact popup UI
│   ├── panel/panel.html|js|css   — full-page UI (new tab)
│   ├── shared/rule-schema.js     — константы (ACTION_TYPES)
│   ├── lib/rule-sync.js          — sync rules to content script
│   ├── lib/rules-engine.js       — matching logic
│   └── icons/                    — иконки 16/48/128px
├── manifest.firefox.json         — Firefox манифест (background.scripts)
├── build-firefox.sh              — сборка Firefox билда
├── build-zip.sh                  — создание ZIP-архивов для тестировщиков
├── GUIDE.md                      — инструкция для тестировщика
├── build/
│   └── firefox/                  — Firefox билд
└── dist/
    ├── mock-extention-chrome.zip
    └── mock-extention-firefox.zip
```

## Разработка

### Chrome (Load unpacked)

1. Откройте `chrome://extensions`
2. Включите Developer mode
3. Load unpacked → выберите папку `extension/`

### Firefox

```bash
./build-firefox.sh
```

Затем `about:debugging` → This Firefox → Load Temporary Add-on → `build/firefox/manifest.json`

### Сборка ZIP для тестировщиков

```bash
./build-zip.sh
```

Создаёт `dist/mock-extention-chrome.zip` и `dist/mock-extention-firefox.zip`.

## Типы действий

| Тип             | Описание                                          |
| --------------- | ------------------------------------------------- |
| `mockResponse`  | Подмена ответа: статус, заголовки, тело, задержка |
| `modifyRequest` | Изменение запроса: удалить/установить заголовки   |

## Ограничения

- Перехватываются только `fetch()` и `XMLHttpRequest`
- Forbidden headers (Cookie, Host, Connection) нельзя удалить через modify
- Content script не перехватывает навигацию, `<script src>`, `<img>` и т.д.
- Firefox: временное дополнение пропадает при перезапуске браузера
