# Session Memory Hook

## Trigger

`command:new` — Fires when a new conversation starts (session reset or first message).

## Purpose

Persists customer context information into Agent memory upon session transitions.
When a WeChat KF customer session ends or resets, this hook:

1. Extracts customer profile data (nickname, avatar, unionid, enter context)
2. Summarizes the session conversation history
3. Saves the context into the Agent's memory files for future reference

## Behavior

- Listens for `command:new` events on the `wecom-kf` channel
- Retrieves previous session messages before they are pruned
- Writes a structured memory entry to `memory/YYYY-MM-DD.md`
- Includes customer ID, name, topic summary, and satisfaction rating if available

## Configuration

No additional configuration required. The hook uses the existing Agent workspace
for memory storage.

## Output

Memory entries are written in Markdown format:

```markdown
## Customer Session: {nickname} ({external_userid})

- **Time**: 2025-01-15 14:30 - 15:45
- **Channel**: wecom-kf / {kf_account_name}
- **Topic**: {AI-generated summary}
- **Resolution**: {resolved/transferred/timeout}
- **Satisfaction**: {rating if available}
```
