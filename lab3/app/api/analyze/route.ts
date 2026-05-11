import { NextRequest, NextResponse } from "next/server";
import { sanitizeCellValue, sanitizeColumnName, validateDataset } from "@/lib/sanitize";
import { inferColumnTypes } from "@/lib/columnTypes";

export const runtime = "nodejs";

const DEFAULT_MODEL = "deepseek-v4-flash";

const PYTHON_TOOL = {
  type: "function" as const,
  function: {
    name: "execute_python",
    description: "Execute Python for data analysis. df is pre-loaded. Print ONLY: print(json.dumps(result_dict, ensure_ascii=False))",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python code. End with print(json.dumps(result, ensure_ascii=False))" },
      },
      required: ["code"],
    },
  },
};

const SYSTEM_PROMPT = `Ты data-аналитик. Датасет загружен как pandas DataFrame 'df'.
Типы колонок уже определены и переданы в сообщении пользователя — НЕ трать токены на их определение.
Вызови execute_python ОДИН раз. В коде:

1. НИКАКИХ print() кроме финального print(json.dumps(result, ensure_ascii=False))
2. Проанализируй данные и создай словарь result со строгой структурой:

{
  "overview": "2-3 предложения на русском с ключевыми цифрами (всего строк, столбцов, главный вывод)",
  "keyMetrics": [
    {"label": "Название метрики на русском", "value": "42 или 42.5%", "description": "Что это значит"}
  ],
  "insights": [
    {"title": "Заголовок на русском", "description": "1 предложение с цифрами", "importance": "high/medium/low"}
  ],
  "correlations": [
    {"col1": "Колонка1", "col2": "Колонка2", "strength": "сильная/средняя/слабая", "direction": "положительная/отрицательная", "description": "Интерпретация на русском"}
  ],
  "charts": [
    {"type": "bar/line/pie/histogram/scatter", "title": "Название на русском", "data": [{"x": "Категория", "y": 42}], "xKey": "x", "yKey": "y", "description": "Что показывает"}
  ]
}

ТРЕБОВАНИЯ К АНАЛИЗУ:
- Метрики: общее количество, средние, медианы, минимумы/максимумы, доли в процентах, топ-3 категорий
- Инсайты: находи СУЩЕСТВЕННЫЕ различия (>10%), аномалии, тренды, неожиданные паттерны
- Корреляции: для ВСЕХ числовых пар, указывай точный коэффициент
- Графики: 2-3 штуки, данные до 20 точек, ТОЛЬКО bar/pie/histogram
- ВСЕ цифры должны быть ВЫЧИСЛЕНЫ в коде, не выдумывай
- Все тексты на русском, КОРОТКИЕ (1 предложение на описание)
- Если колонок <3 числовых — не включай correlations
- Оборачивай опасные операции (pd.cut, pd.qcut, биннинг) в try/except и при ошибке пропускай их
- Если метрика или график не могут быть вычислены — пропусти, не ломай весь анализ

ПРИМЕР КОДА:
\`\`\`python
import json
import pandas as pd
import numpy as np

total = len(df)
num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
cat_cols = df.select_dtypes(include=['object']).columns.tolist()

metrics = []
insights = []
correlations = []
charts = []

survived = int(df['Survived'].sum()) if 'Survived' in df.columns else 0
survived_pct = round(survived / total * 100, 1)
metrics.append({"label": "Выжило пассажиров", "value": f"{survived} ({survived_pct}%)", "description": "Доля выживших от общего числа"})

if survived_pct < 50:
    insights.append({"title": "Низкая выживаемость", "description": f"Выжило только {survived_pct}% пассажиров ({survived} из {total})", "importance": "high"})

if len(num_cols) >= 2:
    corr_matrix = df[num_cols].corr()
    for i in range(len(num_cols)):
        for j in range(i+1, len(num_cols)):
            coeff = corr_matrix.iloc[i, j]
            if abs(coeff) > 0.1:
                strength = "сильная" if abs(coeff) > 0.5 else "средняя" if abs(coeff) > 0.3 else "слабая"
                direction = "положительная" if coeff > 0 else "отрицательная"
                correlations.append({
                    "col1": num_cols[i], "col2": num_cols[j],
                    "strength": strength, "direction": direction,
                    "description": f"Коэффициент {coeff:.2f}"
                })

if cat_cols:
    top_cat = df[cat_cols[0]].value_counts().head(10)
    charts.append({
        "type": "bar",
        "title": f"Распределение по {cat_cols[0]}",
        "data": [{"x": str(k), "y": int(v)} for k, v in top_cat.items()],
        "xKey": "x", "yKey": "y",
        "description": f"Топ-10 значений {cat_cols[0]}"
    })

result = {
    "overview": f"Датасет содержит {total} записей и {len(df.columns)} полей. Проанализированы ключевые показатели.",
    "keyMetrics": metrics,
    "insights": insights,
    "correlations": correlations,
    "charts": charts
}
print(json.dumps(result, ensure_ascii=False))
\`\`\``;

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

function isRowArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every(r => typeof r === "object" && r !== null);
}

function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const key = sanitizeColumnName(k);
      out[key] = typeof v === "string" ? sanitizeCellValue(v).sanitized : v;
    }
    return out;
  });
}

function buildPayload(rows: Record<string, unknown>[], fileName: string): { json: string } {
  return { json: JSON.stringify({ fileName, rows }) };
}

function safeJSONParse(text: string | undefined | null): Record<string, unknown> | null {
  if (!text) return null;
  let cleaned = text.trim();

  cleaned = cleaned.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || start >= end) return null;
  cleaned = cleaned.slice(start, end + 1);

  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch {}

  const fixed = cleaned.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(fixed) as Record<string, unknown>; } catch {}

  let depth = 0, lastValid = 0, inString = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '"' && (i === 0 || cleaned[i - 1] !== "\\")) inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) { lastValid = i + 1; break; } }
  }
  if (lastValid > 0) {
    try { return JSON.parse(cleaned.slice(0, lastValid)) as Record<string, unknown>; } catch {}
  }

  return null;
}

function buildColumnSummary(rows: Record<string, unknown>[]): string {
  const { types } = inferColumnTypes(rows);
  const cols = Object.keys(rows[0] || {});
  return cols.map(c => `${c}: ${types[c] || "unknown"}`).join("\n");
}

async function executePython(code: string, datasetJson: string, signal?: AbortSignal): Promise<string> {
  let baseUrl = process.env.PYTHON_EXECUTOR_URL;
  if (!baseUrl) return "Error: PYTHON_EXECUTOR_URL is not set";
  if (!/^https?:\/\//.test(baseUrl)) baseUrl = `https://${baseUrl}`;

  try {
    const resp = await fetch(`${baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, dataset: datasetJson }),
      signal,
    });
    const data = await resp.json() as { result?: string; error?: string };
    return data.result ?? data.error ?? "[No output]";
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return "Error: Python execution timed out";
    return `Error: ${e instanceof Error ? e.message : "fetch failed"}`;
  }
}

async function callDeepSeekWithTools(
  datasetJson: string,
  userMessage: string,
  apiKey: string,
  model: string,
  columnSummary: string,
): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 90_000);

  try {
    const basePrompt = userMessage || "Проанализируй датасет и верни полный JSON с метриками, инсайтами и графиками";
    const fullUserMessage = `${basePrompt}\n\n${columnSummary}`;

    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: fullUserMessage },
    ];

    const step1Resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: [PYTHON_TOOL],
        temperature: 0,
        max_tokens: 8192,
        stream: false,
      }),
      signal: ctrl.signal,
    });

    if (!step1Resp.ok) {
      if (step1Resp.status === 400 || step1Resp.status === 413) {
        const errBody = await step1Resp.text().catch(() => "");
        if (errBody.includes("context") || errBody.includes("token") || errBody.includes("maximum")) {
          throw new Error("Датасет слишком большой — превышен лимит токенов LLM. Уменьшите файл.");
        }
      }
      throw new Error(`DeepSeek error ${step1Resp.status}`);
    }

    const step1Json = await step1Resp.json() as any;
    const msg = step1Json.choices?.[0]?.message;
    console.log("[Step1] Tokens:", step1Json.usage?.total_tokens);

    if (!msg?.tool_calls?.length) {
      const direct = safeJSONParse(msg?.content);
      if (direct) return direct;
      throw new Error("No tool call and no JSON in response");
    }

    const toolCall = msg.tool_calls[0];
    const args = JSON.parse(toolCall.function.arguments);
    const code = args.code;

    console.log(`[Python] Code: ${code.slice(0, 150)}...`);
    const pythonOutput = await executePython(code, datasetJson, ctrl.signal);
    console.log(`[Python] Output: ${pythonOutput.slice(0, 300)}`);

    const fromPython = safeJSONParse(pythonOutput);
    if (fromPython) {
      console.log("[Result] Got valid JSON from Python");
      return fromPython;
    }

    messages.push(
      { role: "assistant", content: "", tool_calls: [toolCall] },
      { role: "tool", tool_call_id: toolCall.id, name: "execute_python", content: pythonOutput },
    );

    let final: Record<string, unknown> | null = null;

    for (let attempt = 0; attempt < 2 && !final; attempt++) {
      const prompt = attempt === 0
        ? "Из вывода Python выше извлеки итоговый JSON анализа. Верни ТОЛЬКО JSON объект. Не используй markdown."
        : "Верни ТОЛЬКО один валидный JSON объект с ключами overview, keyMetrics, insights, charts. Без markdown, без пояснений.";

      messages.push({ role: "user", content: prompt });

      const step2Resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: 8192,
          stream: false,
        }),
        signal: ctrl.signal,
      });

      if (!step2Resp.ok) throw new Error(`Step2 error ${step2Resp.status}`);

      const step2Json = await step2Resp.json() as any;
      const finalText = step2Json.choices?.[0]?.message?.content ?? "";
      console.log(`[Step2] Attempt ${attempt + 1} (${finalText.length} chars):`, finalText.slice(0, 400));

      final = safeJSONParse(finalText);
      if (final) {
        console.log(`[Step2] Parsed OK on attempt ${attempt + 1}`);
        return final;
      }

      messages.push({ role: "assistant", content: finalText });
    }

    const retry = safeJSONParse(pythonOutput);
    if (retry) return retry;

    console.error("[Step2] All attempts failed. Python output:", pythonOutput.slice(0, 1000));
    throw new Error("Cannot parse final JSON");
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey?.trim()) return NextResponse.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 500 });

    const body = await req.json() as Record<string, unknown>;
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const data = body.data;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!isRowArray(data) || !fileName.trim()) return NextResponse.json({ error: "data and fileName required" }, { status: 400 });
    if (data.length === 0) return NextResponse.json({ error: "Dataset is empty" }, { status: 400 });

    const validation = validateDataset(data);
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });

    const sanitized = sanitizeRows(data);
    const { json: datasetJson } = buildPayload(sanitized, fileName);
    const model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
    const columnSummary = buildColumnSummary(sanitized);

    const analysis = await callDeepSeekWithTools(datasetJson, message, apiKey, model, columnSummary);
    return NextResponse.json({ analysis, warnings: [] });
  } catch (e) {
    console.error("Analysis error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 });
  }
}
