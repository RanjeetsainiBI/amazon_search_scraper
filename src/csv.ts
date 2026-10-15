import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Cell = string | number | boolean | null | undefined;

export function escapeCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Stops spreadsheet apps from running a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toLine = (cells: Cell[]) => cells.map(escapeCell).join(",") + "\n";

/** Writes the whole file (header + rows). UTF-8 BOM so Excel shows ₹ and Hindi text correctly. */
export function writeCsv(path: string, header: string[], rows: Cell[][]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "﻿" + toLine(header) + rows.map(toLine).join(""));
}

/** Appends one row, writing the header first if the file is new. */
export function appendCsv(path: string, header: string[], row: Cell[]) {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "﻿" + toLine(header));
  appendFileSync(path, toLine(row));
}
