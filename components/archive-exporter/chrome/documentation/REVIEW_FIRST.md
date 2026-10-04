# REVIEW FIRST — v1.4.0 Stable

For a new ChatGPT/Codex session:

1. **Do not rewrite the scanner.**
2. Read `HANDOFF.md`.
3. Read `documentation/CAPTURE_ENGINE.md` and `documentation/ISSUES_AND_FIXES.md`.
4. Treat stable v1.4.0 as the reference implementation.
5. First GitHub objective: commit baseline + add regression fixtures.
6. The last major correctness bug was stale/cross-conversation SPA DOM. Preserve active-scope logic.
7. The last major presentation fix was current ChatGPT code-card normalization. Keep that separate from acquisition.
8. KaTeX is intentionally frozen unless a math regression is reproduced.
9. Firefox intentionally omits `version_name`.
10. Attachment files themselves are not archived; only visible chips are.

The two mandatory smoke tests before any release are:
- long virtualized ChatGPT conversation;
- small table + code + equation + attachment-chip conversation.
