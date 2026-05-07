# MockerJoker

Кроссбраузерное расширение (Chrome + Firefox) для подмены HTTP-запросов. Позволяет тестировать поведение приложения при ошибках сервера, задержках, отсутствии авторизации и других сценариях без доступа к бэкенду.

## Возможности

- Mock ответов (статус, заголовки, тело, задержка)
- Modify запросов (удалить/установить заголовки)
- 7 пресетов для типичных сценариев
- JSON editor с подсветкой синтаксиса
- Полноэкранный режим редактирования тела (тёмная тема)
- Валидация JSON в реальном времени
- Автоформатирование при вставке
- Счётчик перехваченных запросов
- Автодополнение URL из реальных запросов на странице
- Экспорт/импорт правил
- Chrome + Firefox поддержка

## Архитектура

- **Content script approach** — перехватывает `fetch()` и `XMLHttpRequest` через injection в page context
- **MV3** — Manifest V3 для Chrome (service_worker) и Firefox (background.scripts)
- Запросы перехватываются на стороне клиента, **не видны в Network tab** DevTools
- Логи мокированных запросов отображаются в Console с тегом `[MockerJoker]`

## Структура проекта

```
extension/
├── manifest.json             — Chrome MV3 манифест
├── background/background.js  — service worker
├── content/content.js        — bridge extension ↔ page
├── content/injected.js       — fetch/XHR override (page context)
├── popup/popup.html|js|css   — compact popup UI
├── panel/panel.html|js|css   — full-page UI (new tab)
└── icons/                    — иконки 16/48/128px
manifest.firefox.json         — Firefox манифест (background.scripts)
build-firefox.sh              — сборка Firefox билда
build-zip.sh                  — создание ZIP-архивов
GUIDE.md                      — руководство пользователя
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

### Сборка ZIP

```bash
./build-zip.sh
```

Создаёт `dist/mock-extention-chrome.zip` и `dist/mock-extention-firefox.zip`.

## Типы действий

| Тип | Описание |
|---|---|
| `mockResponse` | Подмена ответа: статус, заголовки, тело, задержка |
| `modifyRequest` | Изменение запроса: удалить/установить заголовки |

## Ограничения

- Перехватываются только `fetch()` и `XMLHttpRequest`
- Content script не перехватывает навигацию, `<script src>`, `<img>` и т.д.
- Firefox: временное дополнение пропадает при перезапуске браузера (подписанное — нет)

### Запрещённые заголовки

Браузер не позволяет удалить или изменить следующие заголовки через `modifyRequest`:

| Заголовок | Причина |
|---|---|
| `Accept-Charset` | Forbidden request header |
| `Accept-Encoding` | Forbidden request header |
| `Access-Control-Request-Headers` | CORS preflight |
| `Access-Control-Request-Method` | CORS preflight |
| `Connection` | Forbidden request header |
| `Content-Length` | Forbidden request header |
| `Cookie` | Forbidden request header |
| `Cookie2` | Forbidden request header |
| `Date` | Forbidden request header |
| `DNT` | Forbidden request header |
| `Expect` | Forbidden request header |
| `Host` | Forbidden request header |
| `Keep-Alive` | Forbidden request header |
| `Origin` | Forbidden request header |
| `Referer` | Forbidden request header |
| `TE` | Forbidden request header |
| `Trailer` | Forbidden request header |
| `Transfer-Encoding` | Forbidden request header |
| `Upgrade` | Forbidden request header |
| `Via` | Forbidden request header |
| `Sec-*` | Все заголовки начинающиеся с `Sec-` |
| `Proxy-*` | Все заголовки начинающиеся с `Proxy-` |

## Установка

### Chrome

1. Скачайте `mock-extention-chrome.zip` из [Releases](https://github.com/kreanx/MockerJoker/releases)
2. Распакуйте в папку
3. `chrome://extensions` → Developer mode → Load unpacked → выберите папку

### Firefox

Ссылка для установки подписанного расширения: https://addons.mozilla.org/addon/deadb76029ef4f9b86b6/

Или через `about:debugging` → Load Temporary Add-on → `build/firefox/manifest.json`
