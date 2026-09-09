using System.Security.Claims;
using System.Text.Json;
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

    // Matches app-core.js's employeeEditableFields, plus theme_preference
    // (a separate PATCH call on the frontend today via setThemePreference(),
    // but the same self-service trust boundary — no reason to split it into
    // a second endpoint here). Deliberately excludes full_name/location
    // (adminEditableFields-only on the frontend) and every HR/clearance
    // field, which stay display-only even for the profile's own owner —
    // matches the 2026-08-07 ssp-log decision on this exact split. This is
    // an allow-list, not just documentation: UpdateMyProfile below silently
    // ignores any request field not in this set, rather than trusting
    // whatever the client happens to send.
    private static readonly HashSet<string> EditableFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "preferred_name", "phone", "home_email", "home_phone",
        "known_traveler_number", "bio", "theme_preference"
    };

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
            // This IS the real auth boundary — EntraAuthMiddleware never
            // short-circuits the pipeline itself (writing a response body
            // directly from middleware is unreliable in the isolated-
            // worker model), so every endpoint must check this and return
            // its own 401. See EntraAuthMiddleware's class comment.
            var reason = context.Items["AuthError"] as string ?? "Unauthorized.";
            return new UnauthorizedObjectResult(new { error = reason });
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

    // Write counterpart to GetMyProfile — establishes the write pattern:
    // an explicit allow-list of updatable columns (never build an UPDATE
    // from arbitrary client-supplied field names — that's a mass-assignment
    // hole), values always parameterized, scoped to the caller's own row
    // via the same identity-resolution chain as every other endpoint.
    // profiles_update_self's RLS policy (id = current_user_id() OR
    // is_admin()) double-enforces the self-only scoping at the database
    // layer even if this code ever had a bug — WHERE id = @id here matches
    // it, not a separate trust boundary.
    [Function("UpdateMyProfile")]
    public async Task<IActionResult> UpdateMyProfile(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "profile/me")] HttpRequest req,
        FunctionContext context)
    {
        if (context.Items["User"] is not ClaimsPrincipal user)
        {
            var reason = context.Items["AuthError"] as string ?? "Unauthorized.";
            return new UnauthorizedObjectResult(new { error = reason });
        }

        var entraObjectId = user.FindFirst("oid")?.Value;
        if (string.IsNullOrEmpty(entraObjectId))
        {
            _logger.LogWarning("Validated Entra token had no 'oid' claim.");
            return new UnauthorizedResult();
        }

        var role = AerisRoleMapper.ResolveRole(user);

        Dictionary<string, JsonElement>? body;
        try
        {
            body = await req.ReadFromJsonAsync<Dictionary<string, JsonElement>>();
        }
        catch (JsonException)
        {
            return new BadRequestObjectResult(new { error = "Invalid JSON body." });
        }

        if (body is null || body.Count == 0)
        {
            return new BadRequestObjectResult(new { error = "No fields provided." });
        }

        var fieldsToUpdate = body.Keys.Where(k => EditableFields.Contains(k)).ToList();
        if (fieldsToUpdate.Count == 0)
        {
            return new BadRequestObjectResult(new { error = "No editable fields in request body." });
        }

        // Every value here must be a string or JSON null — every field in
        // EditableFields is a text column (confirmed against the real
        // schema), so anything else is a client mistake, not a valid edit.
        var nonStringField = fieldsToUpdate.FirstOrDefault(f =>
            body[f].ValueKind is not JsonValueKind.String and not JsonValueKind.Null);
        if (nonStringField is not null)
        {
            return new BadRequestObjectResult(new { error = $"Field '{nonStringField}' must be a string or null." });
        }

        try
        {
            var (conn, profileId) = await AerisDbConnectionFactory.OpenScopedAsync(entraObjectId, role);
            await using var _ = conn;

            // Column names here come only from EditableFields (a fixed,
            // hardcoded allow-list checked above), never directly from the
            // request body — safe to interpolate; values are still always
            // parameterized below.
            var setClauses = fieldsToUpdate.Select(f => $"{f} = @{f}");
            var sql = $"update profiles set {string.Join(", ", setClauses)} where id = @id";

            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("id", profileId);
            foreach (var field in fieldsToUpdate)
            {
                object value = body[field].ValueKind == JsonValueKind.Null
                    ? DBNull.Value
                    : body[field].GetString()!;
                cmd.Parameters.AddWithValue(field, value);
            }

            var rowsAffected = await cmd.ExecuteNonQueryAsync();
            if (rowsAffected == 0)
            {
                // Should be unreachable — OpenScopedAsync already threw if
                // no profiles row matched the Entra account.
                return new NotFoundObjectResult(new { error = "No profile found for this account." });
            }

            return new OkObjectResult(new { updated = fieldsToUpdate });
        }
        catch (PostgresException ex) when (ex.SqlState == "23514")
        {
            // check_violation — e.g. theme_preference outside ('dark','light').
            return new BadRequestObjectResult(new { error = "One or more values failed a database constraint." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "UpdateMyProfile failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }
}
