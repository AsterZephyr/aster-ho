import { createContextKey } from "@opentelemetry/api";

export const SUPPRESS_INSTRUMENTATION_KEY = createContextKey("ho.suppress_instrumentation");
