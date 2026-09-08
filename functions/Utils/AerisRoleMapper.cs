using System.Security.Claims;

namespace CoaFunctions.Utils;

// Maps the Entra "roles" App Role claim (defined directly in the
// "COA - Aeris" App Registration — see ssp-log.md 2026-08-28 entry) to the
// lowercase role string the Postgres RLS policies expect in app.user_role,
// matching profiles.role's existing values from the ported Supabase schema
// ('admin' etc.). If a user somehow holds more than one App Role, the most
// privileged one wins. Defaults to 'employee' if no recognized role claim
// is present, so a user with no App Role assignment yet still gets the
// least-privileged RLS scope rather than an empty/null session variable
// the RLS policies weren't written to expect.
//
// This is the FIRST place this claim-to-role mapping exists in the Aeris
// build — confirm the exact role names here still match whatever App
// Roles actually get defined in the App Registration before relying on
// this for anything beyond the initial endpoint pattern.
public static class AerisRoleMapper
{
    private static readonly string[] PriorityOrder = ["Admin", "Supervisor", "Employee"];

    public static string ResolveRole(ClaimsPrincipal user)
    {
        var claims = user.FindAll("roles")
            .Select(c => c.Value)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in PriorityOrder)
        {
            if (claims.Contains(candidate))
            {
                return candidate.ToLowerInvariant();
            }
        }

        return "employee";
    }
}
