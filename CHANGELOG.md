# MockerJoker Changelog


## v5.9.0 (2026-08-06) — GraphQL-фильтр для varSaver

### Добавлено
- **«Только GraphQL запросы» в varSaver** — чекбокс в модалке создания/редактирования переменной (popup + panel). При включении varSaver реагирует только на GraphQL-запросы.
- **Operation Name фильтр** — опциональное поле с glob-маской (`CreateBucket`, `*Bucket*`, `*` — любые операции). Для varSaver из ответа operationName берётся из тела запроса, который вызвал этот ответ (GraphQL-ответы не содержат operationName).
- **Детализация в списке переменных** — у varSaver'ов с фильтром показывается `· GraphQL: <operationName>`.

### Тесты
- 52 теста (+6): `processVarSavers` — матчинг по operationName (request/response), пропуск чужих операций и не-GraphQL тел, glob-паттерны, обратная совместимость со старыми varSaver'ами без новых полей.



## v5.8.0 (2026-06-26) — DevTools панель + управление правилами + визуальные улучшения

 ### DevTools панель (новая)
- **Таблица перехватов в реальном времени** — запросы появляются моментально при отправке (pending `...`), обновляются при ответе. Как во вкладке Network в Chrome DevTools.
- **Детализированная панель** — таблица сверху (полная ширина), детализация снизу. Слева: вкладки Общее / Заголовки / Оригинал. Справа: Ответ (всегда виден).
- **URL с подсветкой** — динамические сегменты (ID, UUID, хеши) жёлтым, query-строка тусклым серым, cross-origin домен персиковым бейджем.
- **Поиск в ответе** — строка поиска с навигацией по матчам (Enter/Shift+Enter/Esc), как в Chrome DevTools. Работает и в Ответе, и в Оригинале.
- **Auto-size колонок** — ширина подгоняется под контент автоматически, ручной resize уважается.
- **Сортировка, фильтры** — клик по заголовку = сортировка, фильтры по статусу (All/Mock/2xx/4xx/5xx).
- **Контекстное меню** — ПКМ → Замокать, Copy cURL, Copy URL, Copy Body.
- **Цветовое кодирование** — методы (GET=зелёный, POST=жёлтый, DELETE=красный), статусы, diff-подсветка изменённых строк.
- **Тема** — синхронизация Catppuccin Mocha/Latte через `chrome.storage.local`. Light-тема: исправлен контраст URL, границ, фонов.

### Управление правилами (v5.8.0)
- **Дублирование** — кнопка ⎘ клонирует правило с новым ID и суффиксом «(копия)», открывает редактор.
- **Поиск** — инпут фильтрации правил по имени, URL-паттерну, методу (debounce 150ms).
- **Drag-and-drop** — перетаскивание правил для изменения приоритета. Поддержка Firefox (`setData`), drop ниже последнего элемента, визуальная обратная связь.

### Рефакторинг
- `renderRules()`, `handleRulesListClick()`, `initRulesListDnD()` — вынесены из popup/panel в общий `rules-store.js` (было дублирование).
- `cloneRule()`, `reorderArray()` — чистые функции, покрыты тестами.
- `createContentSearcher()` — фабрика поиска, переиспользуется для Ответа и Оригинала.
- Убрана вкладка «Запрос» (дублировала URL/Метод из «Общее»). Заголовки запроса → во вкладку «Заголовки», тело запроса → во вкладку «Общее».

### Тесты
- 46 тестов (+7 с v5.6.2): `cloneRule` (deep copy, ID, суффикс, disabled), `reorderArray` (forward/backward/after-target/same-index/invalid).

### Исправления
- **Invalid Date** в DevTools — `reportInterception` не передавал `timestamp`.
- **Пропала вкладка «Оригинал» + diff** для XHR modifyResponse — `originalBody` не передавался.
- **DnD в Firefox** — `setData("text/plain")` требуется для старта drag.
- **DnD лаги** — кэширование `lastTarget`, `classList.toggle` вместо add/remove.
## v5.6.2 (2026-06-23) — производительность JSON-редактора + тесты + константы

### Производительность
- **Поиск в JSON-редакторе: O(n²) → O(n)** — `applySearchHighlight` делал `substring(0,offset)` + два `lastIndexOf` на каждое совпадение (~1.1 c/нажатие при 10к строк). Переписан в один проход с предвычисленной маской «внутри тега». Замер: `e` @10к строк 1110 мс → 11 мс (~100×), `value` 554 мс → 9 мс.
- **Дебаунс поиска 120 мс** — `setupSearch` больше не делает полный ребилд на каждую клавишу.
- **Кеш подсветки тела** — `getHighlightedHTML` кеширует токенизированный HTML по значению textarea; ввод в поле поиска больше не перетокенизирует всё тело.
- **Нумерация строк** — ребилд `<span>` только при изменении количества строк (было на каждое нажатие).
- **Порог подсветки синтаксиса 50к → 1М символов** — регулярка токенизатора проверена на ReDoS (линейна, ≤1.7 мс на 100к). Тела ~10к строк теперь цветные, а не монохромные.
- **`globToRegex` мемоизация** — скомпилированные regex кешируются по паттерну (была повторная компиляция для каждого правила на каждом запросе).
- **Gate чтения тела ответа для varSaver** — `response.clone().text()` (полное чтение тела) теперь вызывается только если response-target varSaver реально матчит URL, а не при любом существовании varSaver.

### Изменено
- Убран дублирующий `input`/`scroll` обработчик на `editBodyFS` (`editor-ui.js`) — `setupBodyEditor` уже делает то же самое; `validateJSONBody` больше не гоняется дважды.

### Тесты
- **test/** — 39 тестов на Node `node:test` (без зависимостей): core-логика `injected.js` (glob, пути, bodyConditions, var-резолв, трансформы, findAllRules, prototype-pollution guard), `json-editor.js` (подсветка/поиск/кеш), `rules-store.js`/`utils.js` (validateRule, escapeAttr, generateId). `test/_load.js` грузит plain-скрипты через изолированные `Function`-скопы со стабами браузерных глобалов.
- **Test-хук в `injected.js`** — guarded export (`globalThis.__RM_TEST_EXPORT`), инертен в проде (browser не выставляет флаг → no-op).
- `package.json`: `"test": "node --test test/"`, engine `>=18`.


## v5.5.0 (2026-05-14)

### Добавлено
- **Счётчик перехваченных запросов** — badge на иконке расширения (Catppuccin Mauve), per-tab, сброс при навигации/закрытии
- **URL autocomplete в varSaver модалке** — `editVsUrl` показывает dropdown с замеченными URL (popup + panel)
- **$var dropdown во всех value-инпутах** — автодополнение `$varName` при вводе `$` в setHeaders, setQueryParams, setRespHeaders, body conditions, var conditions, varSaver varName
- **`setBadgeTextColor`** — тёмный текст на badge для читаемости (Chrome 100+, Firefox 109+)

### Изменено
- `addKvRow()` — placeholder "Значение или $varName", подключён `showVarDropdown`
- `openVarSaverEditor()` — вызывает `loadSeenUrls()` для заполнения URL dropdown

---

## v5.4.0 (2026-05-14)

### Добавлено
- **Визуальное разделение редактора** — секции "Условия мэтчинга" (sapphire) и "Действие" (mauve) с бордерами
- **Custom scrollbar** — popup body, editor-body, panel sidebar, panel content (webkit + Firefox `scrollbar-width: thin`)
- **`:focus-visible`** — глобальный outline для keyboard accessibility
- **`:active` states** — кнопки дают feedback при нажатии (scale + brightness)

### Изменено
- **Light theme: header buttons** — `btn-open-tab`, `btn-help`, `btn-panel-help` корректно видны (border + hover)
- **Badge backgrounds** — CSS variables (`--badge-*-bg`) с light-theme overrides (было hardcoded rgba из тёмной темы)
- **`color: #fff`** → `var(--ctp-crust)` — autocomplete hover, proto-tab.active, dropdown
- **Code backgrounds** — help tooltips, popup/panel help body: `var(--bg-hover)` вместо невидимого `var(--bg-surface)`
- **`--body-fs: 13px`** — добавлен в popup.css (раньше наследовался browser default 16px)

---

## v5.3.0 (2026-05-14)

### Изменено
- **Semantic CSS variables** — все hardcoded `--ctp-crust/mantle/surface0` background заменены на `--bg-input/surface/secondary/hover`
- **JSON editor fullscreen** — единый стиль поиска (раньше fullscreen был меньше/отличался)
- **Search navigation buttons** — 26x26px с border, крупнее и заметнее
- Fullscreen modal footer: `--bg-secondary` + border-top (контраст с input/buttons)

### Исправлено
- **panel.html broken nesting** — убраны 2 лишних `</div>`, ломавшие layout и fullscreen editor
- **Fullscreen modal overflow** — `inset: 0` вместо `width/height: 100%`; popup.css перебивал `100vw` (включал scrollbar)
- **JSON editor text clipping** — `padding-left: 44px` для textarea/highlight в fullscreen (под line numbers gutter)
- **Search bar specificity** — `input.json-search-input` выигрывает у `.editor-body input[type=text]`
- **XHR setHeaders** — добавлен `resolveVarValue()` для `$varName` в заголовках
- **XHR removeHeaders** — заголовки теперь реально удаляются из `__rmReqHeaders`
- **XHR setResponseHeaders** — добавлен `resolveVarValue()`
- Убраны redundant `[data-theme="light"]` border overrides для header buttons (header всегда тёмный)

---

## v5.2.0 (2026-05-14)

### Добавлено
- **Dark/Light theme toggle** — Catppuccin Mocha (dark, default) / Catppuccin Latte (light), кнопка луна/солнце в header
- **varSavers counter badge** — количество переменных в секции header
- Theme сохраняется в `chrome.storage.local`

### Изменено
- Удалены все debug-логи (в injected.js остался только `logAction()` — фейковый лог при срабатывании правила)

---

## v5.1.1 (2026-05-14)

### Исправлено
- **tabVars persistence**: `flushTabVars()` вызывается внутри `processVarSavers()` — переменные теперь отправляются в background.js после каждого сохранения
- Удалён мусорный дублированный блок кода в fetch handler
- Убраны все debug-логи (injected.js, content.js, background.js)

---

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
