# Data Analyst AI

Веб-приложение для анализа данных с помощью ИИ. Загрузите CSV или Excel файл — DeepSeek выполнит Python-код, вычислит метрики, найдёт инсайты и построит графики.

## Как это работает

```
   Загрузка файла  →   Анализ через DeepSeek API    →    Результат

   CSV / Excel         Python-код                        Метрики, графики,
   Парсинг на          (pandas, numpy,                   инсайты,
   клиенте             matplotlib)                       корреляции
```

1. Пользователь загружает CSV или Excel (.xlsx/.xls) через веб-интерфейс
2. Данные парсятся на клиенте (Papa Parse для CSV, SheetJS для Excel) и отправляются на сервер
3. Сервер автоматически определяет типы колонок (number/string), формирует промпт и отправляет данные в DeepSeek API
4. DeepSeek самостоятельно пишет и выполняет Python-код для анализа
5. Результат возвращается в структурированном JSON: overview, keyMetrics, insights, correlations, charts
6. Фронтенд визуализирует результат: карточки метрик, таблица корреляций, графики (Recharts), блоки инсайтов
7. Можно задавать уточняющие вопросы к уже загруженному датасету — как в чате

## Технологии

| Компонент | Технология |
|---|---|
| Frontend | Next.js 16, React 18, Tailwind CSS |
| Backend (API) | Next.js API Routes (TypeScript) |
| Python Runtime | FastAPI (серверлес-функция на Vercel) |
| Графики | Recharts |
| Парсинг CSV | Papa Parse |
| Парсинг Excel | SheetJS (xlsx) |
| LLM | DeepSeek (через OpenAI-совместимый API) |
| Деплой | Vercel |

## Быстрый старт

### 1. Получите API ключ

Зарегистрируйтесь на [platform.deepseek.com](https://platform.deepseek.com) и создайте API ключ.

### 2. Настройте окружение

Создайте файл `.env` в корне проекта:

```bash
DEEPSEEK_API_KEY=ваш_ключ_здесь
DEEPSEEK_MODEL=deepseek-chat
PYTHON_EXECUTOR_URL=http://localhost:8000
```

### 3. Установите зависимости и запустите

```bash
npm install
pip install -r requirements.txt

# Терминал 1: Python-сервер для исполнения кода
python -m uvicorn api.index:app --reload --port 8000

# Терминал 2: Next.js dev-сервер
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) в браузере.

## Структура проекта

```
├── .env                        # API ключи (не коммитить!)
├── .env.example                # Шаблон переменных окружения
├── .gitignore
├── package.json
├── next.config.js              # Rewrites: /api/* → Python-функция (Vercel) или localhost:8000 (dev)
├── tailwind.config.js
├── tsconfig.json
├── vercel.json                 # Конфигурация серверлес-функций Vercel
├── requirements.txt            # Python-зависимости (FastAPI, pandas, numpy, vercel)
├── app/
│   ├── globals.css             # Глобальные стили + Tailwind
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Главная страница (вся логика UI)
│   └── api/analyze/
│       └── route.ts            # Next.js API: вызов DeepSeek + оркестрация Python
├── api/
│   └── index.py                # FastAPI: исполнение Python-кода (серверлес-функция Vercel)
├── components/
│   ├── FileUpload.tsx          # Drag-and-drop загрузка CSV/Excel
│   └── AnalysisResults.tsx     # Визуализация результатов анализа
└── lib/
    ├── dataParser.ts           # Клиентский парсинг и типизация данных
    ├── sanitize.ts             # Защита от prompt injection
    └── columnTypes.ts          # Автоопределение типов колонок
```

## API

### `POST /api/analyze`

Отправляет данные в DeepSeek и возвращает результат анализа.

**Запрос:**
```json
{
  "fileName": "sales.csv",
  "message": "Покажи топ-5 по выручке",
  "data": [
    {"date": "2024-01", "revenue": 15000, "orders": 120},
    {"date": "2024-02", "revenue": 18000, "orders": 145}
  ]
}
```

**Ответ:**
```json
{
  "analysis": {
    "overview": "Датасет содержит данные о продажах за 2 месяца...",
    "keyMetrics": [
      {"label": "Общая выручка", "value": "33 000", "description": "Сумма выручки за все периоды"}
    ],
    "insights": [
      {"title": "Рост выручки", "description": "Выручка выросла на 20%...", "importance": "high"}
    ],
    "correlations": [
      {"col1": "revenue", "col2": "orders", "strength": "strong", "direction": "positive", "description": "..."}
    ],
    "charts": [
      {"type": "bar", "title": "Выручка по месяцам", "data": [...], "xKey": "date", "yKey": "revenue", "description": "..."}
    ]
  },
  "warnings": []
}
```

### `POST /api/execute` (Python-функция)

Исполняет Python-код, сгенерированный DeepSeek. Вызывается серверным роутом `/api/analyze`.

### `GET /api/health`

Проверка работоспособности Python-сервера.

**Ошибки:**
| Код | Причина |
|---|---|
| 400 | Пустой датасет, невалидная структура |
| 500 | Не настроен `DEEPSEEK_API_KEY` |
| 502 | Ошибка DeepSeek API |

## Особенности

### Адаптивный интерфейс

Приложение адаптировано для мобильных устройств: сворачиваемый сайдбар с историей чатов, адаптивные отступы и размеры графиков.

### Защита от Prompt Injection

Многоуровневая защита от инъекций в данных:
- Фильтрация паттернов вида «ignore previous instructions», «system:» и подобных
- Санитизация управляющих символов
- Валидация структуры датасета
- Ролевое разграничение в промпте

### Оптимизации скорости

- Отключён thinking mode — модель отвечает быстрее
- Автоопределение типов колонок на сервере — модель не тратит токены на угадывание
- Корреляции вычисляются только при ≥3 числовых колонках
- Автоматическая обрезка данных при превышении лимита токенов (1 048 576)

### Деплой на Vercel

Проект полностью готов к деплою на Vercel:
- Next.js обрабатывает фронтенд и API-роут `/api/analyze`
- Python FastAPI (`api/index.py`) деплоится как серверлес-функция для исполнения кода
- `vercel.json` настраивает Python-функции, `next.config.js` — rewrites для API

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Описание |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ | — | API ключ из DeepSeek Platform |
| `DEEPSEEK_MODEL` | ❌ | `deepseek-v4-flash` | Модель DeepSeek |
| `PYTHON_EXECUTOR_URL` | ❌ | `http://localhost:8000` | URL Python-сервера (только для локальной разработки) |
