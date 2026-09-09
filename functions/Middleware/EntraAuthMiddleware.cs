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
//
// Correction 2026-09-09: middleware in the isolated-worker + ASP.NET Core
// integration model cannot reliably short-circuit by writing directly to
// HttpContext.Response — this is a documented limitation (writes were
// silently dropped, producing a 401 with an empty body every time,
// discovered via a live test against the deployed API). The actual
// working pattern: middleware never writes a response itself and always
// calls next() so the function body runs; on failure it stores a reason
// in context.Items["AuthError"] instead of setting context.Items["User"],
// and every endpoint's existing defensive check
// (`if (context.Items["User"] is not ClaimsPrincipal user) return ...`)
// is the REAL enforcement point now, not a "should be unreachable"
// fallback — its return value goes through the function's normal,
// reliable response-serialization path.
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
        // context.Items is a plain dictionary — its indexer throws
        // KeyNotFoundException on a missing key rather than returning null
        // (unlike a normal lookup pattern). Every endpoint reads
        // context.Items["User"] unconditionally, so the key must always
        // exist, even when nothing has validated yet — found live via a
        // 500 with an empty body once next() started always running.
        context.Items["User"] = null!;

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
            context.Items["AuthError"] = "Missing or malformed Authorization header.";
            await next(context);
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
            context.Items["AuthError"] = $"Could not retrieve identity provider configuration: {ex.Message}";
            await next(context);
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
            var handler = new JwtSecurityTokenHandler
            {
                // Without this, JwtSecurityTokenHandler silently remaps
                // several short claim names (oid included) to long legacy
                // WS-Federation-style URIs when building the
                // ClaimsPrincipal — the value is still present, just under
                // a different Claim.Type, so FindFirst("oid") finds
                // nothing even though the raw JWT payload genuinely has an
                // oid claim. Confirmed live 2026-09-09: decoded the actual
                // token via jwt.ms, oid was there, but every endpoint's
                // FindFirst("oid") still came back null until this was
                // set. A well-known, long-standing .NET JWT gotcha, not
                // specific to this app.
                MapInboundClaims = false
            };
            principal = handler.ValidateToken(token, validationParameters, out _);
        }
        catch (Exception ex)
        {
            context.Items["AuthError"] = $"Token validation failed: {ex.Message}";
            await next(context);
            return;
        }

        httpContext.User = principal;
        context.Items["User"] = principal;
        await next(context);
    }
}
