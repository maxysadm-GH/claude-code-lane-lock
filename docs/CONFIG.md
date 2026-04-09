# Configuration Reference

## Precedence order
Per-project (`.claude/lane-lock.json` in the pinned project root) wins over global (`~/.claude/lane-lock.json`) which wins over built-in defaults.

## Schema
Each field in the configuration is documented below with its type, default value, and a brief description.

- `schemaVersion` (number, always 1)
  - The version of the configuration schema. Currently always 1.

- `knownProjects` (array of objects with `name`, `aliases`, `root`)
  - List of known sibling projects for cross-lane detection.

- `trustedSiblings` (array of strings, v0.2)
  - Names of sibling projects that are trusted to be referenced without warnings.

- `overridePhrases` (array of strings)
  - Phrases that allow bypassing lane-lock checks when present in a prompt.

- `haikuEnabled` (boolean, default false)
  - Enables or disables haiku-style output formatting.

- `logLevel` (string, `info`|`warn`|`error`, default `info`)
  - Sets the minimum logging level for output.

- `mode` (string, `read-warn-write-block` is the only supported mode in v0.1)
  - Controls how the system handles cross-lane access. Currently only `read-warn-write-block` is supported.

## Example
```json
{
  "schemaVersion": 1,
  "knownProjects": [
    {
      "name": "frontend-app",
      "aliases": ["fe", "client"],
      "root": "/home/user/projects/frontend-app"
    },
    {
      "name": "backend-api",
      "aliases": ["be", "server"],
      "root": "/home/user/projects/backend-api"
    }
  ],
  "trustedSiblings": ["frontend-app"],
  "overridePhrases": ["please ignore lane lock"],
  "haikuEnabled": false,
  "logLevel": "info",
  "mode": "read-warn-write-block"
}
```

## Alias rules
- Minimum length is 3 characters
- Aliases shorter than 3 chars are filtered out at load time
- Word-boundary regex matching, case-insensitive
- Substring collisions are avoided by the word-boundary guard

## Bypass mechanisms
- Prompt phrase `[cross-lane: PROJECT]` anywhere in the user prompt
- Environment variable `CLAUDE_ALLOW_CROSS_PROJECT=PROJECT` before starting Claude Code

## Known projects structure
Each known project needs: `name` (canonical), `aliases` (array, 3+ chars each), `root` (absolute path). The matcher uses this list to detect drift mentions of sibling projects.