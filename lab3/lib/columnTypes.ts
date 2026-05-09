export type ColumnType = "number" | "string";

export function inferColumnTypes(rows: Record<string, unknown>[]): {
  types: Record<string, string>;
  numericCount: number;
} {
  const types: Record<string, string> = {};
  if (rows.length === 0) return { types, numericCount: 0 };

  const sample = rows.slice(0, 30);
  for (const key of Object.keys(rows[0])) {
    const allNumeric = sample.every((row) => {
      const v = row[key];
      return (
        v === null ||
        v === undefined ||
        v === "" ||
        typeof v === "number" ||
        (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)))
      );
    });
    types[key] = allNumeric ? "number" : "string";
  }
  return { types, numericCount: Object.values(types).filter((t) => t === "number").length };
}
