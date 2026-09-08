using Azure.Monitor.OpenTelemetry.Exporter;
using CoaFunctions.Middleware;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Azure.Functions.Worker.OpenTelemetry;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OpenTelemetry;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

// Runs on every HTTP-triggered function — validates the Entra bearer token
// before the request reaches any function body. See EntraAuthMiddleware
// for what it checks and ssp-log.md (2026-09-08 entry) for why.
//
// CORS is deliberately NOT configured here in code — set as the Function
// App resource's own CORS allowed-origins setting (Aeris frontend origins
// only, per the 2026-09-08 decision), which is the standard place to
// configure it for Azure Functions and applies consistently whether this
// runs locally or deployed.
builder.UseMiddleware<EntraAuthMiddleware>();

if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("APPLICATIONINSIGHTS_CONNECTION_STRING")))
{
    builder.Services.AddOpenTelemetry()
        .UseFunctionsWorkerDefaults()
        .UseAzureMonitorExporter();
}

builder.Build().Run();
