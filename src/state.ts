import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SellerInfo } from "./parse.ts";
import type { ProductRow } from "./leads.ts";

/**
 * Everything a run has collected, saved after every page so a captcha, a
 * closed laptop lid or Ctrl+C never loses work: the next run skips what's done.
 */
export interface RunState {
  version: 1;
  products: Record<string, ProductRow>;
  sellers: Record<string, SellerInfo>;
  /** ASINs seen in search but skipped (filters, Amazon retail, no seller) so they aren't reopened. */
  skipped: Record<string, string>;
  /** Last finished search page per keyword. */
  keywordPages: Record<string, number>;
  /** Keywords whose results ran out before --pages. */
  keywordDone: Record<string, boolean>;
}

export const emptyState = (): RunState => ({ version: 1, products: {}, sellers: {}, skipped: {}, keywordPages: {}, keywordDone: {} });

export function loadState(path: string): RunState {
  if (!existsSync(path)) return emptyState();
  return { ...emptyState(), ...JSON.parse(readFileSync(path, "utf8")) };
}

export function saveState(path: string, s: RunState) {
  mkdirSync(dirname(path), { recursive: true });
  // Write then rename, so a crash mid-write can't leave a half-written state file.
  writeFileSync(path + ".tmp", JSON.stringify(s));
  renameSync(path + ".tmp", path);
}
