import Database from "better-sqlite3";

export const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
