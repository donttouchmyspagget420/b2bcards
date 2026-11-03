# Примеры результатов

Файлы `<sample>.json` и `<sample>.md` создаются командой:

```bash
npm run examples
```

Она читает все JSON из `samples/`, вызывает выбранного провайдера и перезаписывает
результаты.

## Текущий статус

Примеры — реальные ответы Google AI Studio (Gemini), а не mock:

```json
"meta": {
  "provider": "gemini",
  "model": "gemini-3.5-flash-lite",
  "attempts": 1
}
```

На момент генерации модель по умолчанию `gemini-3.8-flash` возвращала HTTP 503
«This model is currently experiencing high demand», поэтому примеры были собраны на
доступной `gemini-3.5-flash-lite`:

```bash
GEMINI_MODEL=gemini-3.5-flash-lite npm run examples
```

Модель по умолчанию в проекте остаётся `gemini-3.8-flash`; когда она снова доступна,
достаточно выполнить `npm run examples` без переопределения `GEMINI_MODEL`.

## Что проверять в примерах

- `quality.descriptionLength` — в диапазоне 800–1200;
- `quality.titleLength` — не больше 70;
- `quality.warnings` — пусто, если модель сразу уложилась в требования;
- `draft.keySpecs` — значения берутся из `samples/*.json`, отсутствующие отмечены
  `«данных нет»`;
- `draft.missingData` — перечень того, что нужно уточнить у поставщика.

Mock-провайдер по-прежнему доступен для офлайн-проверки:

```bash
npm run examples -- --provider mock
```

Он не выдумывает значения, но пишет шаблонно и не заменяет проверку качества реальной
моделью.
