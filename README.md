<p align="center">
  <img width="600" alt="Mockerjoker" src="https://github.com/user-attachments/assets/b72cbb80-e20d-42d1-854c-a493c79de236" />
</p>

<h1 align="center">MockerJoker</h1>

<p align="center">
  <em>fake it till you make it</em> — мокирование HTTP-запросов на стероидах.<br>
  Тестируйте ошибки сервера, задержки, отсутствие авторизации и любой сценарий — без доступа к бэкенду.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-MV3-green?logo=googlechrome" alt="Chrome">
  <img src="https://img.shields.io/badge/Firefox-MV3-orange?logo=firefox" alt="Firefox">
  <img src="https://img.shields.io/badge/version-4.0.0-blue" alt="Version">
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

## Возможности

- **Подмена ответа** — полностью заменить ответ (статус, заголовки, тело, задержка)
- **Изменение заголовков запроса** — удалить/установить заголовки исходящего запроса
- **Изменение Заголовков ответа** — удалить/установить заголовки входящего ответа
- **Изменение тела запроса на основании условий** — трансформация JSON-тела запроса по dot notation

- 8 пресетов для типичных сценариев
- JSON editor с подсветкой синтаксиса и поиском
- Полноэкранный режим редактирования тела
- Валидация JSON в реальном времени
- Автоформатирование при вставке
- Счётчик перехваченных запросов
- Автодополнение URL из реальных запросов на странице
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
├── popup/popup.html|js|css   — compact popup UI
├── panel/panel.html|js|css   — full-page UI (new tab)
├── shared/common.js          — общий код popup + panel
└── icons/                    — иконки 16/48/128px
manifest.firefox.json         — Firefox манифест (background.scripts)
build-firefox.sh              — сборка Firefox билда
build-zip.sh                  — создание ZIP-архивов
GUIDE.md                      — руководство пользователя
```

## Типы действий

| Тип | Описание |
|---|---|
| `mockResponse` | **Подмена ответа** — полностью заменить ответ: статус, заголовки, тело, задержка |
| `modifyRequest` | **Заголовки запроса** — удалить/установить заголовки исходящего запроса |
| `modifyResponse` | **Заголовки ответа** — удалить/установить заголовки входящего ответа |
| `modifyBody` | **Тело запроса** — трансформация JSON-тела запроса по dot notation |

## Body Conditions

Любое правило может содержать условия на тело. Правило сработает только если все условия выполняются.

**Какое тело проверяется** зависит от типа действия:
- `mockResponse` / `modifyResponse` → проверяется **response body** (после получения реального ответа)
- `modifyBody` / `modifyRequest` → проверяется **request body** (исходящее тело запроса)

| Оператор | Описание |
|---|---|
| `equals` | Значение по пути равно указанному |
| `notEquals` | Значение не равно указанному |
| `contains` | Строка содержит подстроку / массив содержит элемент |
| `exists` | Путь существует в JSON |

Путь поддерживает dot notation с индексами и wildcard: `signal`, `user.address.city`, `items[0].name`, `items[*].id`.

Значения автотипизируются: `"true"` → `true`, `"123"` → `123`, `"null"` → `null`.

## Modify Body

Тип действия `modifyBody` трансформирует тело запроса перед отправкой. Таблица трансформаций: **путь** → **новое значение**.

Поддерживает dot notation с индексами и wildcard: `items[0].name`, `items[*].status`.

Пример: правило с URL `*` и body condition `signal equals "protect"` + transform `signal → "unprotect"` заменит значение поля `signal` в теле любого POST-запроса.

## Последовательное применение правил

Несколько правил могут применяться к одному запросу последовательно:

1. **Фаза 1** — `modifyBody` + `modifyRequest` (модификация исходящего запроса)
2. **Фаза 2** — `mockResponse` без body conditions → немедленная подмена
3. **Фаза 3** — реальный запрос → `mockResponse` с body conditions (условная подмена) + `modifyResponse` (условная/безусловная модификация заголовков)

## Ограничения

- Перехватываются только `fetch()` и `XMLHttpRequest`
- Content script не перехватывает навигацию, `<script src>`, `<img>` и т.д.
- ModifyBody работает только с JSON-телами (строковые body парсятся через `JSON.parse`)

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

## Troubleshooting

| Симптом | Решение |
|---|---|
| Правило не сработало | Обновите страницу (F5). Content script инжектится при загрузке |
| Firefox: расширение пропало после перезапуска | Временное дополнение не переживает рестарт — загрузите заново через `about:debugging` |
| Заголовок Cookie/Origin/Host не удаляется | Это forbidden headers — браузер блокирует их изменение через `fetch`/`XHR` |
| Запрос не перехватывается | Перехватываются только `fetch()` и `XMLHttpRequest`, не `<script>`, `<img>`, навигация |
| Правило с body condition не срабатывает | Убедитесь что тело — валидный JSON. Проверьте правильность пути (dot notation) и оператор |

## License

MIT
