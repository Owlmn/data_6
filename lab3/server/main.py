import json
import os
import sys
import io
import traceback
from pathlib import Path
from typing import Any
from dataclasses import dataclass

from dotenv import load_dotenv

import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIChatModel

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))

os.environ.setdefault("OPENAI_API_KEY", DEEPSEEK_API_KEY)
os.environ.setdefault("OPENAI_BASE_URL", "https://api.deepseek.com/v1")

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


class ExecuteRequest(BaseModel):
    code: str
    dataset: str | None = None


class AnalysisResult(BaseModel):
    overview: str
    keyMetrics: list[dict] = []
    insights: list[dict] = []
    correlations: list[dict] | None = None
    charts: list[dict] | None = None


@dataclass
class Deps:
    dataset_json: str


SYSTEM_PROMPT = """Ты аналитик данных. Датасет загружен как pandas DataFrame 'df', типы колонок известны.

Вызови инструмент execute_python с Python-кодом, который проанализирует данные.

Код должен:
- НЕ печатать НИЧЕГО кроме финального print(json.dumps(result, ensure_ascii=False))
- НИКАКИХ print(df.shape), print(df.columns), print(df.head())
- Вернуть словарь result со структурой:
  {
    "overview": "2-3 предложения с ключевыми цифрами",
    "keyMetrics": [{"label": "...", "value": "42 или 42.5%", "description": "..."}],
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


agent = Agent(
    OpenAIChatModel(DEEPSEEK_MODEL),
    system_prompt=SYSTEM_PROMPT,
    output_type=AnalysisResult,
    deps_type=Deps,
    retries=MAX_RETRIES,
)


@agent.tool
async def execute_python(ctx: RunContext[Deps], code: str) -> str:
    """Execute Python code for data analysis. df DataFrame is pre-loaded with the dataset.
    Print ONLY: print(json.dumps(result, ensure_ascii=False)).
    No debug prints allowed — only the final JSON."""
    return execute_python_code(code, ctx.deps.dataset_json)


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY not configured on server")

    full_msg = (req.message or "Проанализируй датасет и верни полный JSON с метриками, инсайтами и графиками")
    full_msg += f"\n\n{req.column_summary}"

    try:
        result = await agent.run(full_msg, deps=Deps(dataset_json=req.dataset))

        tool_calls = 0
        try:
            for m in result.all_messages():
                for part in getattr(m, 'parts', []):
                    if getattr(part, 'part_kind', '') == 'tool-call':
                        tool_calls += 1
        except Exception:
            tool_calls = 1

        response = result.output.model_dump()
        response["iterations"] = max(tool_calls, 1)
        response["isError"] = False
        return response

    except Exception as e:
        error_msg = str(e)
        print(f"[Agent] Failed: {error_msg[:300]}")
        return {
            "overview": f"Не удалось выполнить анализ: {error_msg[:500]}",
            "keyMetrics": [],
            "insights": [],
            "charts": [],
            "isError": True,
            "iterations": 1,
        }


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
