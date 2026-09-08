using System.Security.Claims;
using CoaFunctions.Data;
using CoaFunctions.Utils;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace CoaFunctions.Functions;

public class ProfileFunctions(ILogger<ProfileFunctions> logger)
{
    private readonly ILogger<ProfileFunctions> _logger = logger;

    // FIRST Functions endpoint for the Aeris build — establishes the
    // pattern every later endpoint follows: EntraAuthMiddleware has
    // already validated the bearer token by the time this runs; derive
    // app.user_id/app.user_role from the validated principal's own claims
    // (never from a client-supplied parameter); open an RLS-scoped
    // connection via AerisDbConnectionFactory; query; return JSON.
    //
    // SELECT list is deliberately minimal (id, role only) — the actual
    // postgres-schema.sql column list for `profiles` isn't available in
    // this repo (it was drafted in a separate session/Claude project, see
    // coa_aeris_migration_track memory). Extend this once that schema is
    // in hand; don't guess at column names against a schema this session
    // can't see.
    [Function("GetMyProfile")]
    public async Task<IActionResult> GetMyProfile(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "profile/me")] HttpRequest req,
        FunctionContext context)
    {
        if (context.Items["User"] is not ClaimsPrincipal user)
        {
            // Should be unreachable — EntraAuthMiddleware rejects an
            // unauthenticated request before it ever reaches here. Kept as
            // a defensive check, not the real auth boundary.
            return new UnauthorizedResult();
        }

        var userId = user.FindFirst("oid")?.Value;
        if (string.IsNullOrEmpty(userId))
        {
            _logger.LogWarning("Validated Entra token had no 'oid' claim.");
            return new UnauthorizedResult();
        }

        var role = AerisRoleMapper.ResolveRole(user);

        try
        {
            await using NpgsqlConnection conn = await AerisDbConnectionFactory.OpenScopedAsync(userId, role);
            await using var cmd = new NpgsqlCommand("select id, role from profiles where id = @id", conn);
            cmd.Parameters.AddWithValue("id", userId);

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                return new NotFoundObjectResult(new { error = "No profile found for this account." });
            }

            return new OkObjectResult(new
            {
                id = reader.GetString(0),
                role = reader.IsDBNull(1) ? null : reader.GetString(1)
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetMyProfile failed for user {UserId}", userId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }
}
