import type { MetricSample } from "./types.js";

interface AggregatedCounter {
	value: number;
}

interface AggregatedHistogram {
	sum: number;
	count: number;
	buckets: Map<number, number>;
}

export class Aggregator {
	private counters = new Map<string, AggregatedCounter>();
	private histograms = new Map<string, AggregatedHistogram>();
	private readonly defaultBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
	private readonly metricBuckets = new Map<string, number[]>();

	configureBuckets(metricName: string, buckets: readonly number[]): void {
		this.metricBuckets.set(
			metricName,
			[...buckets].sort((a, b) => a - b),
		);
	}

	push(samples: MetricSample[]): void {
		for (const sample of samples) {
			const key = this.makeKey(sample.name, sample.labels);

			if (sample.type === "counter") {
				const existing = this.counters.get(key);
				this.counters.set(key, { value: (existing?.value ?? 0) + sample.value });
			} else {
				const buckets = this.metricBuckets.get(sample.name) ?? this.defaultBuckets;
				const existing = this.histograms.get(key) ?? {
					sum: 0,
					count: 0,
					buckets: new Map<number, number>(),
				};

				const updated: AggregatedHistogram = {
					sum: existing.sum + sample.value,
					count: existing.count + 1,
					buckets: new Map(existing.buckets),
				};

				for (const bound of buckets) {
					if (sample.value <= bound) {
						updated.buckets.set(bound, (updated.buckets.get(bound) ?? 0) + 1);
					}
				}

				this.histograms.set(key, updated);
			}
		}
	}

	serialize(prefix: string): string {
		const lines: string[] = [];

		for (const [key, counter] of this.counters) {
			const { name, labels } = this.parseKey(key);
			const fullName = `${prefix}${name}_total`;
			lines.push(`# TYPE ${fullName} counter`);
			lines.push(`${fullName}${formatLabels(labels)} ${counter.value}`);
		}

		for (const [key, hist] of this.histograms) {
			const { name, labels } = this.parseKey(key);
			const fullName = `${prefix}${name}`;
			const buckets = this.metricBuckets.get(name) ?? this.defaultBuckets;

			lines.push(`# TYPE ${fullName} histogram`);
			for (const bound of buckets) {
				const count = hist.buckets.get(bound) ?? 0;
				lines.push(`${fullName}_bucket${formatLabels({ ...labels, le: String(bound) })} ${count}`);
			}
			lines.push(`${fullName}_bucket${formatLabels({ ...labels, le: "+Inf" })} ${hist.count}`);
			lines.push(`${fullName}_sum${formatLabels(labels)} ${hist.sum}`);
			lines.push(`${fullName}_count${formatLabels(labels)} ${hist.count}`);
		}

		return `${lines.join("\n")}\n`;
	}

	private makeKey(name: string, labels: Record<string, string>): string {
		const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
		return `${name}|${sorted.map(([k, v]) => `${k}=${v}`).join(",")}`;
	}

	private parseKey(key: string): { name: string; labels: Record<string, string> } {
		const [name, labelStr] = key.split("|");
		const labels: Record<string, string> = {};
		if (labelStr) {
			for (const pair of labelStr.split(",")) {
				const [k, v] = pair.split("=");
				if (k && v !== undefined) labels[k] = v;
			}
		}
		return { name: name!, labels };
	}
}

function formatLabels(labels: Record<string, string>): string {
	const entries = Object.entries(labels);
	if (entries.length === 0) return "";
	return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
}
