<p align="center">
  <img width="600" alt="Mockerjoker" src="https://github.com/user-attachments/assets/b72cbb80-e20d-42d1-854c-a493c79de236" />
</p>

<h1 align="center">MockerJoker</h1>

<p align="center">
  <em>fake it till you make it</em> — браузерное расширение для мокирования HTTP-запросов на стероидах.<br>
  Тестируйте ошибки сервера, задержки, отсутствие авторизации и любой сценарий — без доступа к бэкенду.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome" alt="Chrome">
  <img src="https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox" alt="Firefox">
  <img src="https://img.shields.io/github/v/tag/kreanx/MockerJoker?label=version&color=blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="License">
</p>

<hr>

<p align="center">
  <img width="280" alt="Popup" src="https://github.com/user-attachments/assets/79cdcf44-3853-4945-ad8a-269cbc128ccd" />
  <img width="280" alt="Popup Editor" src="https://github.com/user-attachments/assets/4810aeb8-46b8-449e-a27c-fe4cafa77bab" />
  <img width="560" alt="Panel" src="https://github.com/user-attachments/assets/664112a2-6c23-4e84-a05e-dd9482d89cf5" />
</p>

<p align="center">
  <em>Popup · Редактор правила · Полноэкранная панель</em>
</p>

<hr>

## Быстрый старт

1. Установите расширение (Chrome/Firefox)
2. Откройте popup и выберите пресет **500 Internal Error**
3. Введите URL-паттерн `*/api/*` → **Сохранить**
4. Готово — все запросы к `*/api/*` вернут ошибку 500

## Примеры использования

**Симуляция ошибки сервера для конкретного эндпоинта**
> Пресет `500 Internal Error` → URL `*/api/payments/*` → все платежи вернут 500

**Убрать авторизацию для тестирования**
> `modifyRequest` → URL `*/api/*` → Remove Header: `Authorization`

**Подставить токен из логина в следующий запрос**
> 1. varSaver: URL `*/auth/login`, source `body`, path `token`, name `$authToken`
> 2. `modifyRequest` → URL `*/api/*` → Set Header: `Authorization` = `Bearer $authToken`

**Изменить поле в теле ответа**
> `modifyResponse` → URL `*/api/user` → Transform: `role` → `"admin"`

**Мокировать GraphQL-запрос по имени операции**
> `mockResponse` → GraphQL tab → operationName `GetUserProfile` → тело `{"data": {"name": "Test User"}}`

**Условный мок — только если баланс меньше 100**
> `mockResponse` → URL `*/api/checkout` → Body Condition: `balance` < `100` (через varSaver + varCondition)

## Возможности

### Действия с запросами

- **Подмена ответа** (`mockResponse`) — полностью заменить ответ (статус, заголовки, тело, задержка)
- **Изменение запроса** (`modifyRequest`) — изменить метод, удалить/установить заголовки, трансформировать тело, удалить/установить query-параметры
- **Изменение ответа** (`modifyResponse`) — удалить/установить заголовки ответа, трансформировать тело ответа
- **GraphQL** — мэтчинг по `operationName` + REST/GraphQL табы в редакторе
- **Переменные** (`varSavers`) — извлечение значений из запросов **и** ответов (body/header/status) и использование `$varName` в трансформациях, заголовках, query-параметрах, условиях **и теле mock-ответа**
- **Условия на тело** (`bodyConditions`) — правило сработает только если все условия выполняются (equals, notEquals, contains, exists)

### Интерфейс

- Dark/Light тема (Catppuccin Mocha/Latte)
- 8 пресетов для типичных сценариев
- JSON editor с подсветкой синтаксиса, нумерацией строк и поиском
- Полноэкранный режим редактирования тела
- Валидация JSON в реальном времени
- Автоформатирование при вставке
- Счётчик перехваченных запросов (badge на иконке расширения, per-tab)
- Автодополнение URL из реальных запросов (редактор правил + varSaver модалка)
- Автодополнение `$varName` при вводе `$` во всех полях значений (transforms, setHeaders, setQueryParams, body conditions, var conditions)
- Табы в редакторе — **Условия** и **Действие** для компактного интерфейса
- **Подмена тела запроса** (REST) и **GraphQL query override** в modifyRequest
- Экспорт/импорт правил

## Архитектура

- **Content script approach** — перехватывает `fetch()` и `XMLHttpRequest` через injection-скрипт в page context
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
├── popup/popup.html|js|css   — compact popup UI (600px)
├── panel/panel.html|js|css   — full-page UI (new tab)
├── shared/
│   ├── common.css            — общий CSS (Catppuccin theme variables)
│   ├── constants.js          — CONST объект (action types, defaults)
│   ├── utils.js              — $, generateId, formatTime, escapeHtml
│   ├── rules-store.js        — data model, CRUD, presets, render
│   ├── json-editor.js        — highlighting, search, fullscreen, line numbers
│   ├── url-autocomplete.js   — seenUrls, URL/GraphQL dropdowns
│   └── editor-ui.js          — editor UI, varSavers UI, $var autocomplete
└── icons/                    — иконки 16/48/128px
manifest.firefox.json         — Firefox манифест (background.scripts)
build-zip.sh                  — создание ZIP-архивов (Chrome + Firefox)
release.sh                    — version bump + build + tag + push
GUIDE.md                      — руководство пользователя
CHANGELOG.md                  — история версий
```

## Типы действий

| Тип | Описание |
|---|---|
| `mockResponse` | **Подмена ответа** — полностью заменить ответ: статус, заголовки, тело, задержка |
| `modifyRequest` | **Изменение запроса** — метод, заголовки, query-параметры, трансформация тела |
| `modifyResponse` | **Изменение ответа** — заголовки ответа, трансформация тела ответа |

## Переменные (varSavers)

Независимые от правил извлекатели значений из HTTP-запросов и ответов:

1. URL-паттерн — на какие запросы/ответы реагировать
2. Источник — `body` (dot notation path), `header` (имя заголовка), `status` (HTTP код)
3. Откуда брать — **из ответа** (по умолчанию) или **из запроса**
4. Имя переменной — доступно как `$varName`

Использование `$varName`:
- В **теле mock-ответа** — автоматическая подстановка `$varName` в JSON (mockResponse)
- В **трансформациях** тела (transforms) — подставляет значение переменной
- В **заголовках** (setHeaders) — подставляет в значение заголовка
- В **query-параметрах** (setQueryParams) — подставляет в значение параметра
- В **условиях** (varConditions, bodyConditions) — правило сработает только если переменная соответствует

## Body Conditions

Любое правило может содержать условия на тело. Правило сработает только если все условия выполняются.

**Какое тело проверяется** зависит от типа действия:
- `mockResponse` / `modifyResponse` → проверяется **response body**
- `modifyRequest` → проверяется **request body**

| Оператор | Описание |
|---|---|
| `equals` | Значение по пути равно указанному |
| `notEquals` | Значение не равно указанному |
| `contains` | Строка содержит подстроку / массив содержит элемент |
| `exists` | Путь существует в JSON |

Путь поддерживает dot notation с индексами и wildcard: `signal`, `user.address.city`, `items[0].name`, `items[*].id`.

Значения автотипизируются: `"true"` → `true`, `"123"` → `123`, `"null"` → `null`.

## Последовательное применение правил

Несколько правил могут применяться к одному запросу последовательно:

1. **Фаза 1** — `modifyRequest` (модификация исходящего запроса: метод, заголовки, query, тело)
2. **Фаза 2** — `mockResponse` без body conditions → немедленная подмена
3. **Фаза 3** — реальный запрос → `mockResponse` с body conditions (условная подмена) + `modifyResponse` (условная/безусловная модификация)

## Ограничения

- Перехватываются только `fetch()` и `XMLHttpRequest`
- Content script не перехватывает навигацию, `<script src>`, `<img>` и т.д.
- Трансформации работают только с JSON-телами
- Переменные (`tabVars`) хранятся в runtime memory — не переживают перезапуск браузера или закрытие вкладки

<details>
<summary><strong>Запрещённые заголовки</strong></summary>

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

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

| Симптом | Решение |
|---|---|
| Правило не сработало | Обновите страницу (F5). Content script инжектится при загрузке |
| Firefox: расширение пропало после перезапуска | Временное дополнение не переживает рестарт — загрузите заново через `about:debugging` |
| Заголовок Cookie/Origin/Host не удаляется | Это forbidden headers — браузер блокирует их изменение |
| Запрос не перехватывается | Перехватываются только `fetch()` и `XMLHttpRequest` |
| Правило с body condition не срабатывает | Убедитесь что тело — валидный JSON, проверьте путь и оператор |
| Переменная не подставляется | Переменные извлекаются из ответов. Для параллельных запросов может понадобиться 1 F5 |
| Все правила не работают | Проверьте что мастер-переключатель (toggle) включён в header |

</details>

## License

MIT
