using Npgsql;

namespace CoaFunctions.Data;

// Opens a Postgres connection scoped to the calling user, per the RLS
// session-variable pattern locked for this project (app.user_id /
// app.user_role — see postgres-rls-policies.sql and the app.is_admin()/
// app.current_user_id()/app.is_manager_of() helpers it defines).
//
// app.current_user_id() is a PLAIN read of the app.user_id session
// variable (confirmed via pg_get_functiondef against the live database —
// no DB lookup of its own), so app.user_id must already be set to the
// internal profiles.id, not the Entra object id. Nothing else resolves
// that mapping automatically, and profiles' own RLS policy requires
// id = app.current_user_id() to see a row — circular unless one step is
// allowed to bypass RLS. app.resolve_profile_id() (SECURITY DEFINER —
// see add-app-api-role-and-identity-resolution.sql) is that one step.
//
// The connection string should point at the dedicated app_api Postgres
// role (same SQL file), not coaadmin — coaadmin is the server admin
// account, and RLS is only a real boundary if the connecting role is
// actually subject to it.
public static class AerisDbConnectionFactory
{
    public static async Task<(NpgsqlConnection Connection, Guid ProfileId)> OpenScopedAsync(string entraObjectId, string role)
    {
        var connectionString = Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING")
            ?? throw new InvalidOperationException("POSTGRES_CONNECTION_STRING app setting is not configured.");

        var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();

        Guid profileId;
        await using (var resolveCmd = new NpgsqlCommand("select app.resolve_profile_id(@entraId)", conn))
        {
            resolveCmd.Parameters.AddWithValue("entraId", Guid.Parse(entraObjectId));
            var result = await resolveCmd.ExecuteScalarAsync();
            if (result is null || result is DBNull)
            {
                await conn.DisposeAsync();
                throw new InvalidOperationException(
                    $"No profiles row found with entra_object_id = {entraObjectId}. " +
                    "The signed-in Entra account has no matching profile row yet.");
            }
            profileId = (Guid)result;
        }

        // Parameterized even though these are session variables, not table
        // data — a role/id value should never be able to break out of the
        // SET. is_local=false (set_config's third argument) makes the
        // setting persist for this connection's whole session rather than
        // just the current transaction, since queries here aren't always
        // wrapped in an explicit transaction.
        await using (var cmd = new NpgsqlCommand(
            "SELECT set_config('app.user_id', @userId, false), set_config('app.user_role', @role, false)",
            conn))
        {
            cmd.Parameters.AddWithValue("userId", profileId.ToString());
            cmd.Parameters.AddWithValue("role", role);
            await cmd.ExecuteNonQueryAsync();
        }

        return (conn, profileId);
    }
}
