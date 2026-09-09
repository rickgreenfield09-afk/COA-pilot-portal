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

public class AssetFunctions(ILogger<AssetFunctions> logger)
{
    private readonly ILogger<AssetFunctions> _logger = logger;

    // GetMyAssets/GetMyAssetRequests rely on the RLS fix drafted in
    // add-asset-self-service-rls.sql (2026-09-08) — until that's applied,
    // these will run without error but return an empty list for anyone
    // who isn't an admin, since the only RLS policy that currently exists
    // on these tables is admin-only.
    [Function("GetMyAssets")]
    public async Task<IActionResult> GetMyAssets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "assets/me")] HttpRequest req,
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

        try
        {
            var (conn, profileId) = await AerisDbConnectionFactory.OpenScopedAsync(entraObjectId, role);
            await using var _ = conn;

            await using var cmd = new NpgsqlCommand(
                """
                select id, asset_name, asset_type, department, location, serial_number,
                       purchase_date, warranty_expiry, condition, vendor, model,
                       issued_date, returned_date, notes, purchased_from, purchase_price,
                       photo_url
                from assets
                where assigned_to = @assignedTo
                order by issued_date desc
                """, conn);
            cmd.Parameters.AddWithValue("assignedTo", profileId);

            var results = new List<object>();
            await using var reader = await cmd.ExecuteReaderAsync();

            string? S(NpgsqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);
            DateOnly? D(NpgsqlDataReader r, int i) => r.IsDBNull(i) ? null : DateOnly.FromDateTime(r.GetDateTime(i));
            decimal? N(NpgsqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetDecimal(i);

            while (await reader.ReadAsync())
            {
                results.Add(new
                {
                    id = reader.GetGuid(0),
                    asset_name = reader.GetString(1),
                    asset_type = S(reader, 2),
                    department = S(reader, 3),
                    location = S(reader, 4),
                    serial_number = S(reader, 5),
                    purchase_date = D(reader, 6),
                    warranty_expiry = D(reader, 7),
                    condition = S(reader, 8),
                    vendor = S(reader, 9),
                    model = S(reader, 10),
                    issued_date = D(reader, 11),
                    returned_date = D(reader, 12),
                    notes = S(reader, 13),
                    purchased_from = S(reader, 14),
                    purchase_price = N(reader, 15),
                    photo_url = S(reader, 16)
                });
            }

            return new OkObjectResult(results);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetMyAssets failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }

    [Function("GetMyAssetRequests")]
    public async Task<IActionResult> GetMyAssetRequests(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "asset-requests/me")] HttpRequest req,
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

        try
        {
            var (conn, profileId) = await AerisDbConnectionFactory.OpenScopedAsync(entraObjectId, role);
            await using var _ = conn;

            await using var cmd = new NpgsqlCommand(
                """
                select id, asset_name, status, created_at
                from asset_requests
                where requested_by = @requestedBy
                order by created_at desc
                """, conn);
            cmd.Parameters.AddWithValue("requestedBy", profileId);

            var results = new List<object>();
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                results.Add(new
                {
                    id = reader.GetGuid(0),
                    asset_name = reader.GetString(1),
                    status = reader.GetString(2),
                    created_at = reader.GetDateTime(3)
                });
            }

            return new OkObjectResult(results);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetMyAssetRequests failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }

    private record AssetRequestInput(
        string? asset_name, string? asset_type, string? serial_number, string? vendor,
        string? model, string? condition, string? issued_by_external, string? issued_date,
        string? purchased_from, decimal? purchase_price, string? purchase_date,
        string? warranty_expiry, string? photo_url, string? notes, string? status);

    // requested_by is ALWAYS the resolved profile id from the validated
    // token — never trust a client-supplied requested_by (the frontend
    // today sends session.user.id itself, which this endpoint ignores by
    // design). status is restricted to draft/pending — an employee
    // submitting their own request must never be able to set it to
    // approved/denied directly; RLS's insert-self policy doesn't restrict
    // the status value at all, so that check has to happen here.
    [Function("SubmitAssetRequest")]
    public async Task<IActionResult> SubmitAssetRequest(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "asset-requests/me")] HttpRequest req,
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

        AssetRequestInput? input;
        try
        {
            input = await req.ReadFromJsonAsync<AssetRequestInput>();
        }
        catch (JsonException)
        {
            return new BadRequestObjectResult(new { error = "Invalid JSON body." });
        }

        if (input is null || string.IsNullOrWhiteSpace(input.asset_name))
        {
            return new BadRequestObjectResult(new { error = "asset_name is required." });
        }

        var status = input.status ?? "pending";
        if (status is not ("draft" or "pending"))
        {
            return new BadRequestObjectResult(new { error = "status must be 'draft' or 'pending'." });
        }

        try
        {
            var (conn, profileId) = await AerisDbConnectionFactory.OpenScopedAsync(entraObjectId, role);
            await using var _ = conn;

            await using var cmd = new NpgsqlCommand(
                """
                insert into asset_requests (
                    requested_by, asset_name, asset_type, serial_number, vendor, model,
                    condition, issued_by_external, issued_date, purchased_from,
                    purchase_price, purchase_date, warranty_expiry, photo_url, notes, status
                ) values (
                    @requestedBy, @assetName, @assetType, @serialNumber, @vendor, @model,
                    @condition, @issuedByExternal, @issuedDate, @purchasedFrom,
                    @purchasePrice, @purchaseDate, @warrantyExpiry, @photoUrl, @notes, @status
                )
                returning id
                """, conn);
            cmd.Parameters.AddWithValue("requestedBy", profileId);
            cmd.Parameters.AddWithValue("assetName", input.asset_name);
            cmd.Parameters.AddWithValue("assetType", (object?)input.asset_type ?? DBNull.Value);
            cmd.Parameters.AddWithValue("serialNumber", (object?)input.serial_number ?? DBNull.Value);
            cmd.Parameters.AddWithValue("vendor", (object?)input.vendor ?? DBNull.Value);
            cmd.Parameters.AddWithValue("model", (object?)input.model ?? DBNull.Value);
            cmd.Parameters.AddWithValue("condition", (object?)input.condition ?? DBNull.Value);
            cmd.Parameters.AddWithValue("issuedByExternal", (object?)input.issued_by_external ?? DBNull.Value);
            cmd.Parameters.AddWithValue("issuedDate", (object?)input.issued_date ?? DBNull.Value);
            cmd.Parameters.AddWithValue("purchasedFrom", (object?)input.purchased_from ?? DBNull.Value);
            cmd.Parameters.AddWithValue("purchasePrice", (object?)input.purchase_price ?? DBNull.Value);
            cmd.Parameters.AddWithValue("purchaseDate", (object?)input.purchase_date ?? DBNull.Value);
            cmd.Parameters.AddWithValue("warrantyExpiry", (object?)input.warranty_expiry ?? DBNull.Value);
            cmd.Parameters.AddWithValue("photoUrl", (object?)input.photo_url ?? DBNull.Value);
            cmd.Parameters.AddWithValue("notes", (object?)input.notes ?? DBNull.Value);
            cmd.Parameters.AddWithValue("status", status);

            var newId = await cmd.ExecuteScalarAsync();

            return new OkObjectResult(new { id = newId });
        }
        catch (PostgresException ex) when (ex.SqlState == "23514" || ex.SqlState == "22007" || ex.SqlState == "22008")
        {
            // check_violation, or an unparseable date/timestamp value.
            return new BadRequestObjectResult(new { error = "One or more field values were invalid." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "SubmitAssetRequest failed for Entra object id {EntraObjectId}", entraObjectId);
            return new ObjectResult(new { error = "Internal error." }) { StatusCode = 500 };
        }
    }
}
