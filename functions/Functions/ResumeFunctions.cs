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

public class ResumeFunctions(ILogger<ResumeFunctions> logger)
{
    private readonly ILogger<ResumeFunctions> _logger = logger;

    // Same read pattern as GetMyProfile, with one new wrinkle: work_history/
    // education/certifications/skills are jsonb columns. Npgsql returns
    // jsonb as a plain string by default — reader.GetString() then
    // JsonDocument.Parse() turns that string into a real JsonElement, so
    // System.Text.Json embeds it as nested JSON in the response instead of
    // a JSON string containing escaped JSON (double-encoded, which is what
    // you get if you skip the Parse step and just return the raw string).
    // resumes.id is NOT its own generated key — it's the same uuid as the
    // owning profiles.id (a 1:1 extension table), which is exactly what
    // resumes_select's RLS policy checks (id = current_user_id()).
    [Function("GetMyResume")]
    public async Task<IActionResult> GetMyResume(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "resume/me")] HttpRequest req,
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
            return new UnauthorizedObjectResult(new { error = "Token has no 'oid' claim." });
        }

        var role = AerisRoleMapper.ResolveRole(user);

        try
        {
            var (conn, profileId) = await AerisDbConnectionFactory.OpenScopedAsync(entraObjectId, role);
            await using var _ = conn;

            await using var cmd = new NpgsqlCommand(
                """
                select r.id, r.summary, r.years_experience, r.work_history,
                       r.education, r.certifications, r.skills, r.updated_at,
                       r.email, r.linkedin_url, r.personal_phone,
                       p.full_name, p.job_title
                from resumes r
                join profiles p on p.id = r.id
                where r.id = @id
                """, conn);
            cmd.Parameters.AddWithValue("id", profileId);

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                // A genuinely missing resume row is possible here (unlike
                // GetMyProfile) — resumes isn't guaranteed to have a row
                // for every profile the way profiles itself does.
                return new NotFoundObjectResult(new { error = "No resume found for this account." });
            }

            string? S(int i) => reader.IsDBNull(i) ? null : reader.GetString(i);
            JsonElement? J(int i) => reader.IsDBNull(i) ? null : JsonDocument.Parse(reader.GetString(i)).RootElement;
            DateTime? T(int i) => reader.IsDBNull(i) ? null : reader.GetDateTime(i);

            return new OkObjectResult(new
            {
                id = reader.GetGuid(0),
                summary = S(1),
                years_experience = S(2),
                work_history = J(3),
                education = J(4),
                certifications = J(5),
                skills = J(6),
                updated_at = T(7),
                email = S(8),
                linkedin_url = S(9),
                personal_phone = S(10),
                full_name = S(11),
                job_title = S(12)
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetMyResume failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }
}
