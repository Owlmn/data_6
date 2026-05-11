from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json, sys, io, traceback
import pandas as pd
import numpy as np

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExecuteRequest(BaseModel):
    code: str
    dataset: str | None = None


@app.post("/api/execute")
async def execute(req: ExecuteRequest):
    stdout = io.StringIO()
    sys.stdout = stdout
    try:
        if req.dataset:
            data = json.loads(req.dataset)
            df = pd.DataFrame(data["rows"])
        exec(req.code)
    except Exception:
        print(f"ERROR: {traceback.format_exc()}")
    sys.stdout = sys.__stdout__
    output = stdout.getvalue().strip()
    return {"result": output or "[No output]"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
