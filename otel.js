const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { metrics } = require('@opentelemetry/api');

require("dotenv").config();
const BETTERSTACK_SOURCE_TOKEN = process.env.BETTERSTACK_SOURCE_TOKEN;

// Open Telemetry Metric Exporter
const metricExporter = new OTLPMetricExporter({
    url: `https://in-otel.logs.betterstack.com/v1/metrics`,
    headers: {
        "Authorization": `Bearer ${BETTERSTACK_SOURCE_TOKEN}`
    }
});

const meterProvider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter: metricExporter })],
});

metrics.setGlobalMeterProvider(meterProvider);

const meter = metrics.getMeter("server-lord-meter");


const queryLatencyHistogram = meter.createHistogram("postgres.query.duration", {
    description: "PostgreSQL query execution time in milliseconds",
    unit: "ms",
    boundaries: [1, 5, 10, 20, 50, 100, 250, 500, 1000, 2000]
});

// Force flushing metrics every 10 seconds
setInterval(async () => {
    try {
        const metricData = await meterProvider.forceFlush();  // Flush collected metrics
        console.log(" OpenTelemetry Metrics Flushed Successfully");
    } catch (error) {
        console.error(" Error flushing OpenTelemetry metrics:", error);
    }
}, 10000);

console.log("OpenTelemetry metrics setup complete. Sending data to Better Stack...");

// Exporting histogram for use in server.js
module.exports = { queryLatencyHistogram };
