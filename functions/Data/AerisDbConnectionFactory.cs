using Npgsql;

namespace CoaFunctions.Data;

// Opens a Postgres connection scoped to the calling user, per the RLS
// session-variable pattern locked for this project (app.user_id /
// app.user_role — see postgres-rls-policies.sql and the SECURITY DEFINER
// is_manager_of()/is_admin() helpers it defines). Every query run on the
// returned connection is scoped by whatever RLS policies key off those two
// settings — callers must never open a connection without going through
// this factory, and must never pass anything but the validated token's own
// claims (EntraAuthMiddleware) as userId/role.
public static class AerisDbConnectionFactory
{
    public static async Task<NpgsqlConnection> OpenScopedAsync(string userId, string role)
    {
        var connectionString = Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING")
            ?? throw new InvalidOperationException("POSTGRES_CONNECTION_STRING app setting is not configured.");

        var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();

        // Parameterized even though these are session variables, not table
        // data — a role/id value should never be able to break out of the
        // SET. is_local=false (set_config's third argument) makes the
        // setting persist for this connection's whole session rather than
        // just the current transaction, since queries here aren't always
        // wrapped in an explicit transaction.
        await using var cmd = new NpgsqlCommand(
            "SELECT set_config('app.user_id', @userId, false), set_config('app.user_role', @role, false)",
            conn);
        cmd.Parameters.AddWithValue("userId", userId);
        cmd.Parameters.AddWithValue("role", role);
        await cmd.ExecuteNonQueryAsync();

        return conn;
    }
}
