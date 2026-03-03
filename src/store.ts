/**
 * LanceDB Storage Layer with Multi-Scope Support
 */

import type * as LanceDB from "@lancedb/lancedb";
import { randomUUID } from "node:crypto";
import { existsSync, accessSync, constants, mkdirSync, realpathSync, lstatSync } from "node:fs";
import { dirname } from "node:path";

// ============================================================================
// Types
// ============================================================================

export interface MemoryEntry {
  id: string;
  text: string;
  vector: number[];
  category: "preference" | "fact" | "decision" | "entity" | "other";
  scope: string;
  importance: number;
  timestamp: number;
  metadata?: string; // JSON string for extensible metadata
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface StoreConfig {
  dbPath: string;
  vectorDim: number;
}

// ============================================================================
// LanceDB Dynamic Import
// ============================================================================

let lancedbImportPromise: Promise<typeof import("@lancedb/lancedb")> | null = null;

export const loadLanceDB = async (): Promise<typeof import("@lancedb/lancedb")> => {
  if (!lancedbImportPromise) {
    lancedbImportPromise = import("@lancedb/lancedb");
  }
  try {
    return await lancedbImportPromise;
  } catch (err) {
    throw new Error(`memory-lancedb-pro: failed to load LanceDB. ${String(err)}`, { cause: err });
  }
};

// ============================================================================
// Utility Functions
// ============================================================================

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

// ============================================================================
// Storage Path Validation
// ============================================================================

export function validateStoragePath(dbPath: string): string {
  let resolvedPath = dbPath;
  try {
    const stats = lstatSync(dbPath);
    if (stats.isSymbolicLink()) {
      resolvedPath = realpathSync(dbPath);
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  if (!existsSync(resolvedPath)) {
    mkdirSync(resolvedPath, { recursive: true });
  }
  accessSync(resolvedPath, constants.W_OK);
  return resolvedPath;
}

// ============================================================================
// Memory Store
// ============================================================================

const TABLE_NAME = "memories";

export class MemoryStore {
  private db: LanceDB.Connection | null = null;
  private table: LanceDB.Table | null = null;
  private initPromise: Promise<void> | null = null;
  private ftsIndexCreated = false;

  constructor(private readonly config: StoreConfig) {}

  get dbPath(): string {
    return this.config.dbPath;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.table) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const lancedb = await loadLanceDB();
    let db: LanceDB.Connection;
    try {
      db = await lancedb.connect(this.config.dbPath);
    } catch (err: any) {
      throw new Error(`Failed to open LanceDB at "${this.config.dbPath}": ${err.message}`);
    }

    let table: LanceDB.Table;
    try {
      table = await db.openTable(TABLE_NAME);
    } catch (_openErr) {
      const schemaEntry: MemoryEntry = {
        id: "__schema__",
        text: "",
        vector: Array.from({ length: this.config.vectorDim }).fill(0) as number[],
        category: "other",
        scope: "global",
        importance: 0,
        timestamp: 0,
        metadata: "{}",
      };
      table = await db.createTable(TABLE_NAME, [schemaEntry]);
      await table.delete('id = "__schema__"');
    }

    this.db = db;
    this.table = table;
  }

  async store(entry: Omit<MemoryEntry, "id" | "timestamp">): Promise<MemoryEntry> {
    await this.ensureInitialized();
    const fullEntry: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
      metadata: entry.metadata || "{}",
    };
    await this.table!.add([fullEntry]);
    return fullEntry;
  }

  async hasId(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const res = await this.table!.query().where(`id = '${escapeSqlLiteral(id)}'`).limit(1).toArray();
    return res.length > 0;
  }

  async stats(scopeFilter?: string[]): Promise<{ totalCount: number, scopeCounts: Record<string, number>, categoryCounts: Record<string, number> }> {
    await this.ensureInitialized();
    const results = await this.table!.query().select(["scope", "category"]).toArray();
    const scopeCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    for (const row of results) {
      const s = (row.scope as string) || "global";
      const c = (row.category as string) || "other";
      scopeCounts[s] = (scopeCounts[s] || 0) + 1;
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
    }
    return { totalCount: results.length, scopeCounts, categoryCounts };
  }

  async delete(id: string, scopeFilter?: string[]): Promise<boolean> {
    await this.ensureInitialized();
    await this.table!.delete(`id = '${escapeSqlLiteral(id)}'`);
    return true;
  }

  async list(scopeFilter?: string[], category?: string, limit = 20, offset = 0): Promise<MemoryEntry[]> {
    await this.ensureInitialized();
    const results = await this.table!.query().toArray();
    return results.slice(offset, offset + limit) as any;
  }

  async optimize(): Promise<{ beforeCount: number; afterCount: number }> {
    await this.ensureInitialized();
    const before = await this.table!.countRows();
    console.log(`Optimizing LanceDB at ${this.config.dbPath}...`);
    
    // Check available methods
    if (typeof (this.table as any).optimize === 'function') {
      await (this.table as any).optimize();
    } else if (typeof (this.table as any).compactFiles === 'function') {
      await (this.table as any).compactFiles();
    } else {
      console.warn("No optimization method found on Table object.");
    }
    
    const after = await this.table!.countRows();
    return { beforeCount: before, afterCount: after };
  }
}
