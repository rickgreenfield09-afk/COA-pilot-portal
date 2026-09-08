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
    // already validated the bearer token by the time this runs; resolve
    // the validated principal's Entra oid to the internal profiles.id and
    // set app.user_id/app.user_role from ONLY that principal's own claims
    // (never from a client-supplied parameter); query; return JSON.
    //
    // Column list confirmed against the live database's actual `profiles`
    // schema (pulled 2026-09-08 — see postgres-schema-live.txt), not
    // guessed. Mirrors what screen-profile.js's Overview tab reads today
    // via Supabase (profiles?select=*,departments(name)).
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

        var entraObjectId = user.FindFirst("oid")?.Value;
        if (string.IsNullOrEmpty(entraObjectId))
        {
            _logger.LogWarning("Validated Entra token had no 'oid' claim.");
            return new UnauthorizedResult();
        }

        var role = AerisRoleMapper.ResolveRole(user);

        try
        {
            var (conn, profileId) = await AerisDbConnectionFactory.OpenScopedAsync(entraObjectId, role);
            await using var _ = conn;

            await using var cmd = new NpgsqlCommand(
                """
                select p.id, p.full_name, p.preferred_name, p.email, p.role, p.job_title,
                       p.department_id, d.name as department_name, p.location, p.phone,
                       p.home_email, p.home_phone, p.bio, p.photo_url, p.manager_id,
                       p.start_date, p.employment_status, p.clearance_level,
                       p.clearance_investigation_type, p.clearance_granted_date,
                       p.clearance_expiration_date, p.known_traveler_number,
                       p.theme_preference, p.pto_balance_hours
                from profiles p
                left join departments d on d.id = p.department_id
                where p.id = @id
                """, conn);
            cmd.Parameters.AddWithValue("id", profileId);

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                // Should be unreachable — OpenScopedAsync already threw if
                // no profiles row matched the Entra account. Kept as a
                // defensive fallback only.
                return new NotFoundObjectResult(new { error = "No profile found for this account." });
            }

            string? S(int i) => reader.IsDBNull(i) ? null : reader.GetString(i);
            Guid? G(int i) => reader.IsDBNull(i) ? null : reader.GetGuid(i);
            DateOnly? D(int i) => reader.IsDBNull(i) ? null : DateOnly.FromDateTime(reader.GetDateTime(i));
            decimal? N(int i) => reader.IsDBNull(i) ? null : reader.GetDecimal(i);

            return new OkObjectResult(new
            {
                id = reader.GetGuid(0),
                full_name = S(1),
                preferred_name = S(2),
                email = S(3),
                role = S(4),
                job_title = S(5),
                department_id = G(6),
                department_name = S(7),
                location = S(8),
                phone = S(9),
                home_email = S(10),
                home_phone = S(11),
                bio = S(12),
                photo_url = S(13),
                manager_id = G(14),
                start_date = D(15),
                employment_status = S(16),
                clearance_level = S(17),
                clearance_investigation_type = S(18),
                clearance_granted_date = D(19),
                clearance_expiration_date = D(20),
                known_traveler_number = S(21),
                theme_preference = S(22),
                pto_balance_hours = N(23)
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetMyProfile failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }
}
