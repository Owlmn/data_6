const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /you\s+are\s+now\s+(a|an|the)/gi,
  /system\s*:\s*/gi,
  /assistant\s*:\s*/gi,
  /user\s*:\s*/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /act\s+as\s+(a|an|the)/gi,
  /pretend\s+(you|that)\s+(are|be)/gi,
  /disregard\s+(all\s+)?(previous|prior)/gi,
  /new\s+instructions?\s*:/gi,
  /override\s+(safety|rules|instructions?)/gi,
  /DAN\s+mode/gi,
  /jailbreak/gi,
  /do\s+anything\s+now/gi,
];

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeCellValue(value: string): { sanitized: string; flagged: boolean } {
  let s = value.replace(CONTROL_CHARS, "");
  let flagged = false;
  for (const p of INJECTION_PATTERNS) {
    if (s.search(p) !== -1) { s = s.replace(p, "[FILTERED]"); flagged = true; }
  }
  return { sanitized: s, flagged };
}

export function sanitizeColumnName(name: string): string {
  return name.replace(CONTROL_CHARS, "");
}

export function validateDataset(data: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(data)) return { valid: false, error: "Data must be an array of objects" };
  if (data.length === 0) return { valid: false, error: "Dataset is empty" };
  const first = data[0];
  if (typeof first !== "object" || first === null) return { valid: false, error: "Each row must be an object" };
  const keys = Object.keys(first);
  if (keys.length === 0) return { valid: false, error: "Rows must have at least one column" };
  return { valid: true };
}
