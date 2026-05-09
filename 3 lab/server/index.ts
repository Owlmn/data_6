import express from "express";
import cors from "cors";
import { spawn, execSync } from "child_process";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

function findPython(): string {
  for (const name of ["python", "python3", "python3.11", "python3.12", "python3.10"]) {
    try {
      execSync(`${name} --version`, { stdio: "ignore" });
      return name;
    } catch {}
  }
  return "python3";
}

const PYTHON_BIN = findPython();
console.log(`Using Python: ${PYTHON_BIN}`);

app.post("/execute", async (req, res) => {
  try {
    const { code, dataset } = req.body as { code?: string; dataset?: string };
    if (!code?.trim()) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const wrapped = `
import json, sys, io, pandas as pd, numpy as np

_stdout = io.StringIO()
sys.stdout = _stdout

try:
${dataset ? `
    data = json.loads(sys.stdin.read())
    df = pd.DataFrame(data['rows'])
` : ""}
${code.split("\n").map(line => "    " + line).join("\n")}
except Exception as _e:
    import traceback
    print(f"ERROR: {_e}")
    print(traceback.format_exc())

sys.stdout = sys.__stdout__
print(_stdout.getvalue())
`;

    const python = spawn(PYTHON_BIN, ["-c", wrapped], {
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf-8"); });
    python.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf-8"); });

    python.on("close", () => {
      const output = stdout.trim();
      if (output) res.json({ result: output });
      else if (stderr.trim()) res.json({ result: `Error: ${stderr.trim().slice(0, 2000)}` });
      else res.json({ result: "[No output]" });
    });

    python.on("error", (err) => {
      res.json({ result: `Python spawn error: ${err.message}` });
    });

    if (dataset) {
      python.stdin.write(dataset);
    }
    python.stdin.end();
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Python executor running on port ${PORT}`);
});
