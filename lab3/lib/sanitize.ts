const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /игнорируй\s+(все\s+)?(предыдущие|прошлые|вышестоящие)\s+(инструкции|правила|промпты)/gi,
  /you\s+are\s+now\s+(a|an|the)/gi,
  /теперь\s+ты\s+/gi,
  /system\s*:\s*/gi,
  /система\s*:\s*/gi,
  /assistant\s*:\s*/gi,
  /ассистент\s*:\s*/gi,
  /user\s*:\s*/gi,
  /пользователь\s*:\s*/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /act\s+as\s+(a|an|the)/gi,
  /(действуй|выступай|работай)\s+как\s+/gi,
  /pretend\s+(you|that)\s+(are|be)/gi,
  /притвор(ись|яйся)\s+(что\s+)?(ты|будь)/gi,
  /disregard\s+(all\s+)?(previous|prior)/gi,
  /(не\s+учитывай|отбрось|пропусти)\s+(все\s+)?(предыдущие|прошлые)/gi,
  /new\s+instructions?\s*:/gi,
  /новые\s+инструкции\s*:/gi,
  /override\s+(safety|rules|instructions?)/gi,
  /(переопредели|отмени)\s+(защиту|правила|инструкции)/gi,
  /DAN\s+mode/gi,
  /режим\s+DAN/gi,
  /jailbreak/gi,
  /джейлбрейк/gi,
  /do\s+anything\s+now/gi,
  /делай\s+(всё|что угодно|что хочешь)\s+(сейчас|теперь)/gi,
  /forget\s+(all\s+)?(previous|prior|above)/gi,
  /забудь\s+(все\s+)?(предыдущие|прошлые|выше\s*сказанное)/gi,
  /from\s+now\s+on\s+you\s+are/gi,
  /(с\s+этого\s+момента|отныне)\s+ты\s+/gi,
];

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeUserInput(text: string): { sanitized: string; flagged: boolean } {
  let s = text.replace(CONTROL_CHARS, "");
  let flagged = false;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(s)) {
      s = s.replace(pattern, "[FILTERED]");
      flagged = true;
    }
  }
  return { sanitized: s.trim(), flagged };
}

export function sanitizeColumnName(name: string): string {
  return name.replace(CONTROL_CHARS, "").slice(0, 200);
}

export function sanitizeFileName(name: string): string {
  return name.replace(CONTROL_CHARS, "").replace(/[<>:"/\\|?*]/g, "_").slice(0, 255);
}
