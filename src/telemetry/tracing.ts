import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import "dotenv/config"

diag.setLogger(new DiagConsoleLogger(), { logLevel: DiagLogLevel.ERROR })
const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "guild-service",
    }),
    traceExporter: new OTLPTraceExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
    }),
    // traceExporter: new ConsoleSpanExporter(),
    instrumentations: [getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": {
            enabled: false
        }
    })]
})

sdk.start()

process.on("SIGTERM", () => sdk.shutdown().finally(process.exit(0)))