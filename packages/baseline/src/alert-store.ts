import type Database from "better-sqlite3";

export interface AlertStateStore {
	saveWindowState(ruleName: string, windowJson: string, updatedAtMs: number): void;
	loadWindowState(ruleName: string): string | undefined;
	saveCooldown(ruleName: string, lastFiredMs: number): void;
	loadCooldown(ruleName: string): number | undefined;
	clearExpired(maxAgeMs: number): void;
}

export class SqliteAlertStateStore implements AlertStateStore {
	private readonly db: Database.Database;

	constructor(db: Database.Database) {
		this.db = db;
	}

	saveWindowState(ruleName: string, windowJson: string, updatedAtMs: number): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO alert_windows (rule_name, window_json, updated_at_ms)
			 VALUES (?, ?, ?)`,
			)
			.run(ruleName, windowJson, updatedAtMs);
	}

	loadWindowState(ruleName: string): string | undefined {
		const row = this.db
			.prepare("SELECT window_json FROM alert_windows WHERE rule_name = ?")
			.get(ruleName) as { window_json: string } | undefined;
		return row?.window_json;
	}

	saveCooldown(ruleName: string, lastFiredMs: number): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO alert_cooldowns (rule_name, last_fired_ms)
			 VALUES (?, ?)`,
			)
			.run(ruleName, lastFiredMs);
	}

	loadCooldown(ruleName: string): number | undefined {
		const row = this.db
			.prepare("SELECT last_fired_ms FROM alert_cooldowns WHERE rule_name = ?")
			.get(ruleName) as { last_fired_ms: number } | undefined;
		return row?.last_fired_ms;
	}

	clearExpired(maxAgeMs: number): void {
		const cutoff = Date.now() - maxAgeMs;
		this.db.prepare("DELETE FROM alert_windows WHERE updated_at_ms < ?").run(cutoff);
		this.db.prepare("DELETE FROM alert_cooldowns WHERE last_fired_ms < ?").run(cutoff);
	}
}
