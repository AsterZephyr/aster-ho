import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { HoConfigFile, ValidationResult } from "./types.js";

export async function loadConfig(configPath: string): Promise<HoConfigFile> {
	const content = await readFile(configPath, "utf-8");
	const parsed = parseYaml(content);

	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Invalid config file: ${configPath} is not a valid YAML object`);
	}

	return parsed as HoConfigFile;
}

export function validateConfig(config: HoConfigFile): ValidationResult {
	const errors: string[] = [];

	if (config.service_name !== undefined && typeof config.service_name !== "string") {
		errors.push("service_name must be a string");
	}

	if (config.enrichers !== undefined) {
		if (!Array.isArray(config.enrichers)) {
			errors.push("enrichers must be an array");
		} else {
			const known = ["cost", "error-classify", "context-rot"];
			for (const e of config.enrichers) {
				if (!known.includes(e)) {
					errors.push(`Unknown enricher: "${e}". Known: ${known.join(", ")}`);
				}
			}
		}
	}

	if (config.exporters !== undefined) {
		if (typeof config.exporters !== "object") {
			errors.push("exporters must be an object");
		} else {
			const known = ["file", "langfuse", "prometheus"];
			for (const name of Object.keys(config.exporters)) {
				if (!known.includes(name)) {
					errors.push(`Unknown exporter: "${name}". Known: ${known.join(", ")}`);
				}
			}
		}
	}

	if (config.alerts !== undefined) {
		if (!config.alerts.rules || !Array.isArray(config.alerts.rules)) {
			errors.push("alerts.rules must be an array");
		}
	}

	return { valid: errors.length === 0, errors };
}
