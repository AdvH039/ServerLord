import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { Resource } from "@opentelemetry/resources";

import {
    MeterProvider,
    PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { metrics } from "@opentelemetry/api";
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";

const resource = Resource.default().merge(
    new Resource({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "server-lord",
        [ATTR_SERVICE_VERSION]: "0.1.0",
    }),
);

const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),

    exportIntervalMillis: 10000,
});

const sdk = new NodeSDK({
    resource,
    metricReader,
    instrumentations: [new HttpInstrumentation(), new FastifyInstrumentation(),  new PgInstrumentation({ enhancedDatabaseReporting: true }),],
});

process.on("beforeExit", async () => {
    await sdk.shutdown();
});

sdk.start();
console.log("OpenTelemetry metrics setup complete!");