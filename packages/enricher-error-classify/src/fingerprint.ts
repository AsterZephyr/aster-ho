/**
 * Error message fingerprinting.
 * Normalizes messages by stripping variable parts (numbers, UUIDs, timestamps,
 * paths, URLs) and produces a stable hash so that structurally identical errors
 * collapse into the same fingerprint regardless of specific runtime values.
 */

/** Strip variable parts from an error message, keeping the structural pattern. */
function normalize(message: string): string {
	let normalized = message;

	// UUIDs (must come before generic hex/number stripping)
	normalized = normalized.replace(
		/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
		"<UUID>",
	);

	// URLs (http/https)
	normalized = normalized.replace(/https?:\/\/[^\s)]+/g, "<URL>");

	// File paths (Unix and Windows)
	normalized = normalized.replace(/(?:\/[\w.\-]+){2,}/g, "<PATH>");
	normalized = normalized.replace(/[A-Z]:\\[\w.\-\\]+/g, "<PATH>");

	// ISO timestamps (2024-01-15T10:30:00Z variants)
	normalized = normalized.replace(
		/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g,
		"<TIMESTAMP>",
	);

	// Numbers (integers and floats, including negatives)
	normalized = normalized.replace(/-?\d+(\.\d+)?/g, "<N>");

	// Collapse whitespace
	normalized = normalized.replace(/\s+/g, " ").trim();

	return normalized;
}

/** FNV-1a hash producing a hex string. Simple, no external deps, good distribution. */
function fnv1a(str: string): string {
	let hash = 2166136261; // FNV offset basis (32-bit)
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 16777619); // FNV prime (32-bit)
	}
	// Convert to unsigned 32-bit then hex
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Compute a stable fingerprint for an error message. */
export function computeFingerprint(message: string): string {
	const normalized = normalize(message);
	return fnv1a(normalized);
}
