using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace CoaFunctions.Middleware;

// Validates the Entra ID bearer token on every HTTP-triggered function.
// Isolated-worker Azure Functions have no built-in JWT validation (unlike
// App Service Easy Auth) — this is the standard hand-rolled pattern
// Microsoft documents for isolated-worker auth. Signing keys come from
// Entra's own OIDC discovery document via ConfigurationManager, which
// caches and auto-refreshes them, so a Microsoft signing-key rotation
// doesn't require a redeploy here.
//
// Establishes the pattern every future endpoint relies on: this is the
// ONLY place app.user_id/app.user_role (the RLS session variables — see
// AerisDbConnectionFactory) may originate from. They come from the
// validated token's own claims, never from anything client-supplied.
public class EntraAuthMiddleware : IFunctionsWorkerMiddleware
{
    private readonly string _tenantId;
    private readonly string[] _validAudiences;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> _configManager;

    public EntraAuthMiddleware()
    {
        _tenantId = Environment.GetEnvironmentVariable("ENTRA_TENANT_ID")
            ?? throw new InvalidOperationException("ENTRA_TENANT_ID app setting is not configured.");
        var audience = Environment.GetEnvironmentVariable("ENTRA_API_AUDIENCE")
            ?? throw new InvalidOperationException("ENTRA_API_AUDIENCE app setting is not configured.");

        // Accepts both audience forms rather than assuming one is
        // canonical — found live 2026-09-09 that switching the App
        // Registration to issue v2.0 tokens (requestedAccessTokenVersion,
        // fixing a separate issuer mismatch) also changed the aud claim
        // from the App ID URI (api://...) to the bare client ID GUID.
        // Both are valid ways Entra represents "this app" as an audience;
        // accepting either avoids being fragile to that kind of Entra-side
        // token-format detail changing again.
        const string apiUriPrefix = "api://";
        var bareClientId = audience.StartsWith(apiUriPrefix, StringComparison.OrdinalIgnoreCase)
            ? audience[apiUriPrefix.Length..]
            : audience;
        _validAudiences = [audience, bareClientId];

        var metadataAddress = $"https://login.microsoftonline.com/{_tenantId}/v2.0/.well-known/openid-configuration";
        _configManager = new ConfigurationManager<OpenIdConnectConfiguration>(
            metadataAddress,
            new OpenIdConnectConfigurationRetriever());
    }

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var httpContext = context.GetHttpContext();
        if (httpContext is null)
        {
            // Not an HTTP-triggered invocation (timer/queue/etc.) — nothing
            // to authenticate. No such triggers exist yet, but this keeps
            // the middleware safe to register globally as more are added.
            await next(context);
            return;
        }

        var authHeader = httpContext.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader is null || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            await Reject(httpContext, "Missing or malformed Authorization header.");
            return;
        }

        var token = authHeader["Bearer ".Length..].Trim();

        OpenIdConnectConfiguration openIdConfig;
        try
        {
            openIdConfig = await _configManager.GetConfigurationAsync(context.CancellationToken);
        }
        catch (Exception ex)
        {
            // Fails closed — if Entra's discovery document can't be
            // reached, requests are rejected rather than let through
            // unvalidated.
            await Reject(httpContext, $"Could not retrieve identity provider configuration: {ex.Message}");
            return;
        }

        var validationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = $"https://login.microsoftonline.com/{_tenantId}/v2.0",
            ValidateAudience = true,
            ValidAudiences = _validAudiences,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = openIdConfig.SigningKeys,
            ClockSkew = TimeSpan.FromMinutes(5)
        };

        ClaimsPrincipal principal;
        try
        {
            var handler = new JwtSecurityTokenHandler();
            principal = handler.ValidateToken(token, validationParameters, out _);
        }
        catch (Exception ex)
        {
            await Reject(httpContext, $"Token validation failed: {ex.Message}");
            return;
        }

        httpContext.User = principal;
        context.Items["User"] = principal;
        await next(context);
    }

    private static async Task Reject(HttpContext httpContext, string message)
    {
        httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await httpContext.Response.WriteAsync(message);
        // No call to next() — this short-circuits the pipeline, matching
        // standard ASP.NET Core middleware short-circuit behavior.
    }
}
