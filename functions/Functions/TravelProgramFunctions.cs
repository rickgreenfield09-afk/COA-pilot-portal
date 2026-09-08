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

public class TravelProgramFunctions(ILogger<TravelProgramFunctions> logger)
{
    private readonly ILogger<TravelProgramFunctions> _logger = logger;

    private record TravelProgramInput(string? program_type, string? provider_name, string? membership_number);

    [Function("GetMyTravelPrograms")]
    public async Task<IActionResult> GetMyTravelPrograms(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "travel-programs/me")] HttpRequest req,
        FunctionContext context)
    {
        if (context.Items["User"] is not ClaimsPrincipal user)
        {
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
                select id, program_type, provider_name, membership_number
                from employee_travel_programs
                where employee_id = @employeeId
                order by created_at asc
                """, conn);
            cmd.Parameters.AddWithValue("employeeId", profileId);

            var results = new List<object>();
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                results.Add(new
                {
                    id = reader.GetGuid(0),
                    program_type = reader.GetString(1),
                    provider_name = reader.GetString(2),
                    membership_number = reader.GetString(3)
                });
            }

            return new OkObjectResult(results);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetMyTravelPrograms failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }

    // Mirrors the frontend's existing replace-all pattern (screen-profile.js:
    // DELETE every row for the employee, then POST the full new set) rather
    // than per-row upsert. Wrapped in an explicit transaction here since
    // Npgsql doesn't give that atomicity for free the way a single Postgres
    // RPC call would (see the burndown-schema atomic-RPC precedent in
    // ssp-log.md 2026-08-06) — without it, a failure after the DELETE but
    // before the INSERT would silently wipe the employee's travel programs.
    [Function("ReplaceMyTravelPrograms")]
    public async Task<IActionResult> ReplaceMyTravelPrograms(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "travel-programs/me")] HttpRequest req,
        FunctionContext context)
    {
        if (context.Items["User"] is not ClaimsPrincipal user)
        {
            return new UnauthorizedResult();
        }

        var entraObjectId = user.FindFirst("oid")?.Value;
        if (string.IsNullOrEmpty(entraObjectId))
        {
            _logger.LogWarning("Validated Entra token had no 'oid' claim.");
            return new UnauthorizedResult();
        }

        var role = AerisRoleMapper.ResolveRole(user);

        List<TravelProgramInput>? programs;
        try
        {
            programs = await req.ReadFromJsonAsync<List<TravelProgramInput>>();
        }
        catch (JsonException)
        {
            return new BadRequestObjectResult(new { error = "Invalid JSON body — expected an array." });
        }

        if (programs is null)
        {
            return new BadRequestObjectResult(new { error = "Request body must be a JSON array." });
        }

        var invalid = programs.FirstOrDefault(p =>
            string.IsNullOrWhiteSpace(p.program_type) ||
            string.IsNullOrWhiteSpace(p.provider_name) ||
            string.IsNullOrWhiteSpace(p.membership_number));
        if (invalid is not null)
        {
            return new BadRequestObjectResult(new
            {
                error = "Every entry needs program_type, provider_name, and membership_number."
            });
        }

        try
        {
            var (conn, profileId) = await AerisDbConnectionFactory.OpenScopedAsync(entraObjectId, role);
            await using var _ = conn;

            await using var tx = await conn.BeginTransactionAsync();

            await using (var deleteCmd = new NpgsqlCommand(
                "delete from employee_travel_programs where employee_id = @employeeId", conn, tx))
            {
                deleteCmd.Parameters.AddWithValue("employeeId", profileId);
                await deleteCmd.ExecuteNonQueryAsync();
            }

            foreach (var program in programs)
            {
                await using var insertCmd = new NpgsqlCommand(
                    """
                    insert into employee_travel_programs (employee_id, program_type, provider_name, membership_number)
                    values (@employeeId, @programType, @providerName, @membershipNumber)
                    """, conn, tx);
                insertCmd.Parameters.AddWithValue("employeeId", profileId);
                insertCmd.Parameters.AddWithValue("programType", program.program_type!);
                insertCmd.Parameters.AddWithValue("providerName", program.provider_name!);
                insertCmd.Parameters.AddWithValue("membershipNumber", program.membership_number!);
                await insertCmd.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return new OkObjectResult(new { count = programs.Count });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ReplaceMyTravelPrograms failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }
}
