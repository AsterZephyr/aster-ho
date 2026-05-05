import type { TicketProvider, TicketRequest } from "@ho/ticket-provider";
import type { AlertEvent, AlertNotifier } from "./types.js";

export interface TicketNotifierConfig {
	readonly severity?: "low" | "medium" | "high" | "critical";
	readonly labels?: readonly string[];
}

export class TicketNotifier implements AlertNotifier {
	private readonly provider: TicketProvider;
	private readonly config: TicketNotifierConfig;

	constructor(provider: TicketProvider, config?: TicketNotifierConfig) {
		this.provider = provider;
		this.config = config ?? {};
	}

	notify(event: AlertEvent): void {
		const fingerprint = `alert:${event.rule}:${event.metric}`;

		this.provider
			.findDuplicate(fingerprint)
			.then((existing) => {
				if (existing) return;

				const request: TicketRequest = {
					title: `[ho-alert] ${event.rule}: ${event.metric} = ${event.value}`,
					body: [
						"Alert triggered.",
						"",
						`Metric: ${event.metric}`,
						`Value: ${event.value}`,
						`Threshold: ${event.threshold}`,
						`Timestamp: ${new Date(event.timestamp).toISOString()}`,
					].join("\n"),
					labels: this.config.labels ?? ["ho-alert"],
					fingerprint,
					severity: this.config.severity ?? "medium",
				};

				this.provider.createTicket(request).catch(() => {});
			})
			.catch(() => {});
	}
}
