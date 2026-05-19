import json
import os
import sys
import io
import traceback
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
DEEPSEEK_BASE = "https://api.deepseek.com/chat/completions"

app = FastAPI(title="LLM Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://llm-api-analyst.vercel.app",
        "http://localhost:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    dataset: str
    message: str = ""
    column_summary: str = ""


class AnalyzeResponse(BaseModel):
    overview: str
    keyMetrics: list[dict] = []
    insights: list[dict] = []
    correlations: list[dict] | None = []
    charts: list[dict] | None = []
    isError: bool = False
    iterations: int = 0


class ExecuteRequest(BaseModel):
    code: str
    dataset: str | None = None


SYSTEM_PROMPT = """Ты аналитик данных. Датасет уже загружен как pandas DataFrame 'df', типы колонок известны.

Вызови execute_python один раз с кодом, который:
- Делает ТОЛЬКО один print(json.dumps(result, ensure_ascii=False)) в конце
- Возвращает словарь result со строгой структурой:
  {
    "overview": "2-3 предложения с ключевыми цифрами",
    "keyMetrics": [{"label": "...", "value": "...", "description": "..."}],
    "insights": [{"title": "...", "description": "...", "importance": "high/medium/low"}],
    "correlations": [{"col1": "...", "col2": "...", "strength": "сильная/средняя/слабая", "direction": "положительная/отрицательная", "description": "..."}],
    "charts": [{"type": "bar/pie/histogram", "title": "...", "data": [{"x": "...", "y": 0}], "xKey": "x", "yKey": "y", "description": "..."}]
  }

Правила:
- Все цифры вычисляй через pandas/numpy
- Весь код после импортов оберни в try/except с выводом {"error": str(e)} при ошибке
- Перед расчётами приводи числовые колонки через pd.to_numeric(col, errors='coerce')
- Если числовых колонок < 3 — не включай correlations
- Графики: 2-3 штуки, не более 20 точек"""

FIX_PROMPT = """Код упал с ошибкой. Напиши исправленную версию.

Ошибка: {error}
Код: {code}"""

EXTRACT_PROMPT = """Верни ТОЛЬКО JSON из вывода ниже (ключи: overview, keyMetrics, insights, correlations, charts).

{output}"""

PYTHON_TOOL = {
    "type": "function",
    "function": {
        "name": "execute_python",
        "description": "Run Python code. df is pre-loaded. Print only: print(json.dumps(result, ensure_ascii=False))",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Python code ending with print(json.dumps(result, ensure_ascii=False))"
                }
            },
            "required": ["code"]
        }
    }
}


def safe_json_parse(text: str | None) -> dict | None:
    if not text:
        return None
    cleaned = text.strip()
    cleaned = re.sub(r'^```\w*\n?', '', cleaned)
    cleaned = re.sub(r'\n?```$', '', cleaned)

    start = cleaned.find('{')
    end = cleaned.rfind('}')
    if start == -1 or end == -1 or start >= end:
        return None
    cleaned = cleaned[start:end + 1]

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    fixed = re.sub(r',(\s*[}\]])', r'\1', cleaned)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    depth = 0
    last_valid = 0
    in_string = False
    for i, ch in enumerate(cleaned):
        if ch == '"' and (i == 0 or cleaned[i - 1] != '\\'):
            in_string = not in_string
        if in_string:
            continue
        if ch == '{':
            depth += 1
        if ch == '}':
            depth -= 1
            if depth == 0:
                last_valid = i + 1
                break
    if last_valid > 0:
        try:
            return json.loads(cleaned[:last_valid])
        except json.JSONDecodeError:
            pass

    return None


async def call_deepseek(
    messages: list[dict],
    tools: list[dict] | None = None,
    temperature: float = 0.0,
    max_tokens: int = 8192,
) -> dict:
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY not configured")

    async with httpx.AsyncClient(timeout=120.0) as client:
        body: dict[str, Any] = {
            "model": DEEPSEEK_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            body["tools"] = tools

        resp = await client.post(
            DEEPSEEK_BASE,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            },
            json=body,
        )

        if resp.status_code in (400, 413):
            text = resp.text
            if any(kw in text.lower() for kw in ["context", "token", "maximum"]):
                raise HTTPException(status_code=400, detail="Датасет слишком большой — превышен лимит токенов LLM.")

        if not resp.is_success:
            raise HTTPException(status_code=502, detail=f"DeepSeek API error {resp.status_code}: {resp.text[:300]}")

        data = resp.json()
        msg = data.get("choices", [{}])[0].get("message", {})
        print(f"[DeepSeek] Tokens: {data.get('usage', {}).get('total_tokens', '?')}")
        return msg


def extract_code_from_tool_call(msg: dict) -> str:
    tool_calls = msg.get("tool_calls", [])
    if not tool_calls:
        raise HTTPException(status_code=500, detail="No tool call in LLM response")
    args = json.loads(tool_calls[0]["function"]["arguments"])
    return args.get("code", "")


def execute_python_code(code: str, dataset_json: str) -> str:
    stdout = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = stdout

    try:
        local_ns: dict[str, Any] = {}

        if dataset_json:
            data = json.loads(dataset_json)
            local_ns["df"] = pd.DataFrame(data.get("rows", []))
        else:
            local_ns["df"] = pd.DataFrame()

        local_ns["pd"] = pd
        local_ns["np"] = np
        local_ns["json"] = json

        exec(code, {"__builtins__": __builtins__}, local_ns)
    except Exception:
        print(f"ERROR: {traceback.format_exc()}")
    finally:
        sys.stdout = old_stdout

    return stdout.getvalue().strip()


def is_error_output(output: str) -> bool:
    if not output:
        return False
    if "Traceback (most recent call last)" in output:
        return True
    if output.startswith("ERROR:") or output.startswith("ERROR"):
        return True
    parsed = safe_json_parse(output)
    if parsed and "error" in parsed:
        return True
    return False


def is_valid_result(parsed: dict | None) -> bool:
    if parsed is None:
        return False
    return "overview" in parsed and isinstance(parsed["overview"], str) and len(parsed["overview"]) > 0


async def extract_json_via_llm(python_output: str) -> dict:
    messages = [
        {"role": "user", "content": EXTRACT_PROMPT.format(output=python_output[:8000])}
    ]
    msg = await call_deepseek(messages, temperature=0.0, max_tokens=4096)
    content = msg.get("content", "")
    result = safe_json_parse(content)
    if result and "overview" in result:
        return result

    retry = safe_json_parse(python_output)
    if retry and "overview" in retry:
        return retry

    return {
        "overview": python_output[:500] or "Не удалось структурировать результат.",
        "keyMetrics": [],
        "insights": [],
        "charts": [],
    }


async def agent_loop(column_summary: str, user_message: str, dataset_json: str, file_name: str) -> dict:
    base_prompt = user_message or "Проанализируй датасет и верни полный JSON с метриками, инсайтами и графиками"
    full_user_msg = f"{base_prompt}\n\n{column_summary}"

    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": full_user_msg},
    ]

    iteration = 0
    final_result: dict | None = None

    while iteration < MAX_RETRIES:
        iteration += 1
        print(f"[Agent] Iteration {iteration}/{MAX_RETRIES}")

        msg = await call_deepseek(messages, tools=[PYTHON_TOOL])

        assistant_msg = {
            "role": "assistant",
            "content": msg.get("content") or "",
        }
        if msg.get("tool_calls"):
            assistant_msg["tool_calls"] = msg["tool_calls"]
        messages.append(assistant_msg)

        try:
            code = extract_code_from_tool_call(msg)
        except HTTPException:
            content = msg.get("content", "")
            direct = safe_json_parse(content)
            if is_valid_result(direct):
                final_result = direct
                break
            raise

        print(f"[Agent] Code ({len(code)} chars)")

        python_output = execute_python_code(code, dataset_json)
        print(f"[Agent] Output ({len(python_output)} chars): {python_output[:200]}...")

        messages.append({
            "role": "tool",
            "tool_call_id": msg["tool_calls"][0]["id"],
            "content": python_output[:4000],
        })

        if is_error_output(python_output):
            parsed = safe_json_parse(python_output)
            error_text = parsed.get("error", python_output[:500]) if parsed else python_output[:500]

            print(f"[Agent] Error: {error_text[:100]}...")

            if iteration < MAX_RETRIES:
                messages.append({
                    "role": "user",
                    "content": FIX_PROMPT.format(code=code[:2000], error=error_text),
                })
                continue
            else:
                final_result = {
                    "overview": f"Не удалось выполнить анализ после {MAX_RETRIES} попыток: {error_text}",
                    "keyMetrics": [],
                    "insights": [],
                    "charts": [],
                }
                break

        parsed = safe_json_parse(python_output)
        if is_valid_result(parsed):
            final_result = parsed
            break

        print("[Agent] Invalid JSON — extracting via LLM...")
        final_result = await extract_json_via_llm(python_output)
        break

    if final_result is None:
        final_result = {
            "overview": "Не удалось получить результат анализа.",
            "keyMetrics": [],
            "insights": [],
            "charts": [],
        }

    final_result["iterations"] = iteration
    return final_result


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY not configured on server")

    try:
        result = await agent_loop(
            column_summary=req.column_summary,
            user_message=req.message,
            dataset_json=req.dataset,
            file_name="dataset",
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal agent error: {str(e)}")


@app.post("/api/execute")
async def execute(req: ExecuteRequest):
    output = execute_python_code(req.code, req.dataset or "")
    return {"result": output or "[No output]"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model": DEEPSEEK_MODEL,
        "max_retries": MAX_RETRIES,
    }
