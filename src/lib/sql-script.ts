// Shared SQL-step script builders.
//
// Both the step panel executor and the auto-runner execute SQL the same way:
// generate an in-container shell script that parses a DSN from an env var
// (credentials never leave the pod) and pipes the SQL to the client via a
// quoted heredoc.

export type SqlClient = 'auto' | 'mysql' | 'psql';

export const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Extract the schema/database from the connection string INSIDE the container —
// the DSN (credentials included) never leaves the pod, only the db name comes back
export function buildDetectSchemaScript(envVar: string): string {
  return `DSN="\${${envVar}:?env var ${envVar} is not set}"
rest="\${DSN#*://}"
hostpart="\${rest#*@}"
dbpath=""
case "$hostpart" in */*) dbpath="\${hostpart#*/}" ;; esac
printf '%s' "\${dbpath%%\\?*}"
`;
}

// Build the in-container script: parse $ENV_VAR (scheme://user:pass@host:port/db),
// then run the client with the SQL on stdin via a quoted heredoc (verbatim, no
// shell expansion). A schema override replaces the db parsed from the DSN.
// Known limitation: passwords containing '@' or ':' break the naive parse.
export function buildSqlScript(envVar: string, client: SqlClient, schema: string, content: string): string {
  const delim = content.includes('RT_SQL_EOF') ? 'RT_SQL_EOF_X9' : 'RT_SQL_EOF';
  const schemaAssign = schema ? `db='${schema.replace(/'/g, `'\\''`)}'` : '';
  return `set -e
DSN="\${${envVar}:?env var ${envVar} is not set}"
rest="\${DSN#*://}"
scheme="\${DSN%%://*}"
[ "$scheme" = "$DSN" ] && scheme=""
userpass="\${rest%%@*}"
hostpart="\${rest#*@}"
hostport="\${hostpart%%/*}"
dbpath=""
case "$hostpart" in */*) dbpath="\${hostpart#*/}" ;; esac
db="\${dbpath%%\\?*}"
host="\${hostport%%:*}"
port="\${hostport##*:}"
[ "$port" = "$hostport" ] && port=""
user="\${userpass%%:*}"
pass="\${userpass#*:}"
[ "$pass" = "$userpass" ] && pass=""
${schemaAssign}
client="${client}"
if [ "$client" = "auto" ]; then
  case "$scheme" in
    mysql*|mariadb*) client=mysql ;;
    postgres*|pgsql*) client=psql ;;
    *) echo "Cannot detect SQL client from DSN scheme: '$scheme'" >&2; exit 1 ;;
  esac
fi
if [ "$client" = "mysql" ]; then
  MYSQL_PWD="$pass" mysql -h"$host" -P"\${port:-3306}" -u"$user" \${db:+"$db"} <<'${delim}'
${content}
${delim}
elif [ "$client" = "psql" ]; then
  PGPASSWORD="$pass" psql -h "$host" -p "\${port:-5432}" -U "$user" \${db:+-d "$db"} -v ON_ERROR_STOP=1 <<'${delim}'
${content}
${delim}
fi
`;
}
