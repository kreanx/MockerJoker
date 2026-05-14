# MockerJoker Changelog

## v5.1.0 (2026-05-14)

### Добавлено
- **shared/common.css** — общий CSS (1193 строки): 68 идентичных селекторов, 87 shared-with-differences селекторов с `var(--xxx)`, 161 custom property
- **shared/utils.js** — `$`, `generateId`, `formatTime`, `escapeHtml`, `escapeAttr`
- **shared/rules-store.js** — data model, CRUD, presets, render, export/import
- **shared/json-editor.js** — highlighting, search, fullscreen, line numbers
- **shared/url-autocomplete.js** — seenUrls, URL/GraphQL dropdowns
- **shared/editor-ui.js** — editor open/save, row helpers, bindEditorEvents, tooltips
- **opencode.json** — конфигурация opencode (instructions: AGENTS.md)

### Изменено
- `common.js` (~1008 строк) разбит на 5 фокусных модулей для лучшей организации
- `popup/popup.css` сокращён с ~924 до 265 строк (popup-only styles + body constraints)
- `panel/panel.css` сокращён с ~1255 до 655 строк (:root overrides + panel-only styles)
- `popup.html`, `panel.html` — 6 `<script>` тегов (constants, utils, rules-store, json-editor, url-autocomplete, editor-ui) + `<link>` на common.css перед variant CSS

### Исправлено
- **GraphQL anonymous queries**: `graphqlOperation: "*"` теперь мэтчит запросы без `operationName`
- **btn-primary background**: `.btn` base class не перекрывает больше фон `.btn-primary`
- **btn-primary hover**: hover не применяет светло-серый фон к primary кнопкам

### Удалено
- `shared/common.js` — заменён 5 модулями

---

## v5.0.2 (2026-05-14)

### Добавлено
- **shared/common.css** — общий CSS (1193 строки): 68 идентичных селекторов, 87 shared-with-differences селекторов с `var(--xxx)`, 161 custom property
- **shared/utils.js** — `$`, `generateId`, `formatTime`, `escapeHtml`, `escapeAttr`
- **shared/rules-store.js** — data model, CRUD, presets, render, export/import
- **shared/json-editor.js** — highlighting, search, fullscreen, line numbers
- **shared/url-autocomplete.js** — seenUrls, URL/GraphQL dropdowns
- **shared/editor-ui.js** — editor open/save, row helpers, bindEditorEvents, tooltips
- **opencode.json** — конфигурация opencode (instructions: AGENTS.md)

### Изменено
- `common.js` (~1008 строк) разбит на 5 фокусных модулей для лучшей организации
- `popup/popup.css` сокращён с ~924 до 265 строк (popup-only styles + body constraints)
- `panel/panel.css` сокращён с ~1255 до 655 строк (:root overrides + panel-only styles)
- `popup.html`, `panel.html` — 6 `<script>` тегов (constants, utils, rules-store, json-editor, url-autocomplete, editor-ui) + `<link>` на common.css перед variant CSS

### Удалено
- `shared/common.js` — заменён 5 модулями

---

## v5.0.1 (2026-05-14)

### Добавлено
- **Нумерация строк** в JSON редакторе (popup + panel)
- **Resizable textarea** — тело ответа можно тянуть за нижний край
- **Видимый скроллбар** в textarea (был скрыт)
- **shared/constants.js** — централизованный объект `CONST` (action types, defaults, message types)
- **Release automation** — `release.sh` + GitHub Actions + динамический бейдж в README

### Изменено
- `injected.js` — локальные константы `AT`, `PAGE_MSG` вместо строковых литералов
- `common.js` — использует `CONST.ACTION_TYPES`, `CONST.DEFAULT_STATUS`, `CONST.MSG_*`
- `content.js`, `background.js` — локальные константы `MSG`/`PAGE` для message types
- `popup.html`, `panel.html` — подключён `constants.js`
- `popup.js`, `panel.js` — общий `bindEditorEvents()` вынесен в `common.js`
- Editor font sizes: labels 12→14px, inputs/selects 12→14px, hints 11→13px
- Popup body height: 600px (Chrome max)
- Empty-state padding уменьшен для исключения скролла

### Исправлено
- **Delay inconsistency bug**: FETCH `|| 5` → `|| 0` (теперь `DEFAULT_DELAY = 0` на обоих путях)
- Убраны все захардкоженные `200`, `"mockResponse"` и т.д. — заменены на константы

### Удалено
- **Steps/Chains** — полностью удалены из v5 (неправильный дизайн, заменено переменными)

---

## v5.0.0 (2026-05-08)

### Добавлено
- **Изменение метода запроса** - переопределение HTTP-метода (POST -> GET и т.д.)
- **Подмена URL-параметров** - удаление и установка query params в исходящем запросе
- **GraphQL Support** - мэтчинг по `operationName` + REST/GraphQL табы в редакторе
- **Переменные между правилами** - saveVars + varConditions (body/header/status, per-tab, $prefix)
- **Новые пресеты**: GraphQL Mock
- **CHANGELOG.md** - история версий

---

## v4.0.0 (2026-05-07)

### Добавлено
- **modifyBody** - новый тип действия для трансформации JSON-тела запроса по dot notation
- **bodyConditions** - условия на тело: `equals`, `notEquals`, `contains`, `exists`
- Семантика bodyConditions зависит от типа: mockResponse/modifyResponse -> response body, modifyBody/modifyRequest -> request body
- **8 пресетов**: 500, 403, 401, 204, частичные данные, убрать Auth, убрать CORS, заменить значение
- **JSON редактор**: подсветка синтаксиса, поиск, fullscreen dark theme, validation, autoformat
- **Hit counter** - счётчик перехватов рядом с каждым правилом
- **URL autocomplete** - автоподстановка URL из реальных запросов
- **Help overlay** - справка внутри popup
- **Export/Import** правил в JSON
- `setByPath` с auto-create промежуточных объектов + `[*]` wildcard

### Изменено
- XHR handler переписан на `findAllRules` + 3 фазы (аналогично fetch)
- Fetch handler переписан на пофазную обработку: Phase 1 (modifyBody/modifyRequest) -> Phase 2 (mockResponse unconditional) -> Phase 3 (real request + conditional mock + modifyResponse)
- 4 типа действий: mockResponse, modifyRequest, modifyResponse, modifyBody
- removeCookies пресет удалён (Cookie - forbidden header)
- Tooltip `?` иконки с `position: fixed`

### Исправлено
- `[*]` wildcard не парсился в splitPath regex
- `?` в URL не экранировался в globToRegex
- Root arrays + `[*]` wildcard в body path navigation

---

## v3.0.2 (2026-05-07)

### Добавлено
- Search highlight в JSON редакторе
- resolve relative URLs

### Изменено
- Prettify console output: body as object, обновлён badge стиль `[MockerJoker]`

---

## v2.2.0 (2026-05-07)

### Добавлено
- JSON editor с syntax highlighting, fullscreen mode, validation
- Автоформатирование при вставке JSON из буфера
- Search в JSON редакторе

### Исправлено
- Firefox: добавлены `data_collection_permissions` в manifest
- Missing closing brace в deleteRuleById

### Изменено
- alert/confirm заменены на inline UI
- Убрана tester-specific терминология

---

## v2.1 (2026-05-07)

### Добавлено
- Rebrand на MockerJoker
- Custom autocomplete dropdown вместо datalist

### Исправлено
- Extension context invalidated - reconnect к background
- Filter seen requests по active tab
- Long URLs overflow - expand on hover
- overflow:hidden убран из rule-info

---

## v2.0 (2026-05-07)

### Добавлено
- URL autocomplete из реальных запросов
- Hit counter - счётчик перехватов
- Firefox support (MV2 manifest, build-firefox.sh)
- Build scripts: build-zip.sh, build-firefox.sh

---

## v1.0 (2026-05-07)

### Добавлено
- Initial release - Request Mocker extension
- mockResponse - полная подмена ответа (статус, тело, заголовки, задержка)
- modifyRequest - модификация заголовков исходящего запроса
- modifyResponse - модификация заголовков входящего ответа
- URL-паттерны с `*` маской
- Content script подход (fetch/XHR override)
- Chrome + Firefox поддержка
- Popup + Panel интерфейс
- chrome.storage.local для хранения правил
