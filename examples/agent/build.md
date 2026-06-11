---
defaults:
  model: cc/claude-sonnet-4-6
artifacts_dir: artifacts
---

# Agent step demo

Runs a general-purpose **coding agent** as a build step — in an isolated git
worktree, behind a human approval gate. The artifact is the **unified diff** of
what the agent actually changed (not its prose), so you can review it and
`git apply` it.

Prerequisites:

- This workspace must be inside a **git repo with at least one commit** — the
  `worktree` sandbox checks out `HEAD` into a throwaway directory.
- Install the agent runtime in your workspace:
  `npm install @anthropic-ai/claude-agent-sdk`
- Set `ANTHROPIC_API_KEY` (or a gateway base URL) in `examples/agent/.env`
  (see the repo's `.env.example`). The agent runtime reads the key itself.

Then:

```
md status examples/agent     # implement is stale (agent steps are cache: always)
md build  examples/agent      # runs the agent, previews its diff, prompts to accept
md why    implement examples/agent
```

The agent edits a **copy** of the workspace, never your working tree. On
approval the diff is written to `artifacts/implement.diff`; apply it with
`git apply artifacts/implement.diff`. Decline and nothing is written.

## target: implement
```yaml
inputs: [sources/task.md]
step: agent
agent: claude-code
sandbox: worktree
approval: required
output: artifacts/implement.diff
```
Implement the task described in {{sources/task.md}}. Make the smallest change
that satisfies it, directly in the working directory.
