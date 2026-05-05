import type { AlertEvent, AlertNotifier } from "./types.js";

export class WebhookNotifier implements AlertNotifier {
	private readonly url: string;

	constructor(url: string) {
		this.url = url;
	}

	notify(event: AlertEvent): void {
		fetch(this.url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(event),
		}).catch(() => {});
	}
}

export class ConsoleNotifier implements AlertNotifier {
	readonly events: AlertEvent[] = [];

	notify(event: AlertEvent): void {
		this.events.push(event);
	}
}
