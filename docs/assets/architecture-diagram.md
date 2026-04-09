# Architecture diagram

Two renderings of the same diagram live here. Use whichever fits the surface.

## 1. SVG (recommended for README)

The primary asset is [`architecture.svg`](./architecture.svg). It's hand-crafted,
self-contained, and scales cleanly on GitHub and in any browser. Embed it directly:

```markdown
![claude-code-lane-lock architecture](docs/assets/architecture.svg)
```

## 2. Mermaid source (GitHub-native renderer)

[`architecture.mmd`](./architecture.mmd) holds the Mermaid flowchart source. GitHub
renders Mermaid natively inside fenced code blocks, so you can paste the contents
straight into a README section like this:

````markdown
```mermaid
<!-- contents of docs/assets/architecture.mmd -->
```
````

## Design notes

- The red `UserPromptSubmit` node + edge is the hero mechanism: exit 2 erases a
  drift prompt from the session's context **before any reasoning token fires**.
- `PreToolUse` is deliberately split into two hook scripts:
  - **read-warn tier** (`Read | Grep | Glob`) allows cross-project reads with a
    stderr warning so you can still glance at a sibling repo for a pattern.
  - **write-block tier** (`Edit | Write | MultiEdit | NotebookEdit | Bash`) emits
    a `permissionDecision: "deny"` and hard-blocks the call.
- `TaskCreated` is dashed because it's a no-op stub reserved for the eventual
  Agent Teams handoff.
- All 7 hooks delegate to the same `lib/*.mjs` modules so the logic is tested
  once and reused everywhere.
