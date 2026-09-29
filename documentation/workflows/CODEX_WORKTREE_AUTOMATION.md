# Codex worktree automation

This repository keeps reusable Codex setup in tracked project files while each
Git worktree receives its own ignored `AGENTS.md` and `.codex/` instance.
A Git worktree alone is therefore not a complete Codex workspace.

## Repository and worktree layout

The canonical repository is:

```text
/home/didi/research/dev/tools/ce-chatgpt-bulk-delete
```

Normal feature worktrees are siblings named with a semantic suffix:

```text
/home/didi/research/dev/tools/ce-chatgpt-bulk-delete_<suffix>
```

Tracked templates and policies live under `documentation/workflows/`; tracked
bootstrap and notification helpers live under `scripts/development/codex/`.
The generated root `AGENTS.md` and root `.codex/` are local support files and
must not enter feature commits. The tracked root `.gitignore` enforces that
policy without depending on a developer's shared `.git/info/exclude`.

## Create a Codex-ready worktree

From the canonical repository, inspect the repository before creating anything:

```bash
cd /home/didi/research/dev/tools/ce-chatgpt-bulk-delete
pwd
git branch --show-current
git rev-parse HEAD
git status --short --branch
git worktree list
```

Create the feature worktree and run the project bootstrap with its explicit
absolute path:

```bash
git worktree add /home/didi/research/dev/tools/ce-chatgpt-bulk-delete_<suffix> -b <branch>
/home/didi/research/dev/tools/ce-chatgpt-bulk-delete_<suffix>/scripts/development/codex/bootstrap_worktree_local_layer.sh \
  /home/didi/research/dev/tools/ce-chatgpt-bulk-delete_<suffix>
```

The bootstrap accepts only a registered worktree belonging to the same Git
repository. It resolves the target, renders target-specific paths, refuses to
overwrite differing or symbolic-link content, installs an executable
notification helper, verifies the ignore policy and generated invariants, and
prints the exact `code <TARGET_WORKTREE>` command to run next.

Open VS Code at that target, then start Codex from the worktree. Do not start
Codex in the canonical checkout when the task belongs to a sibling worktree.

## Verify the local layer

Run these checks in the target worktree:

```bash
test -f AGENTS.md
test -f .codex/config.toml
test -f .codex/CODEX_AUTONOMOUS_EXECUTION_POLICY.txt
test -f .codex/CODEX_MASTER_INCREMENT_TEMPLATE.txt
test -x .codex/notify.sh
grep -F "$(pwd -P)" AGENTS.md .codex/config.toml
git check-ignore -v AGENTS.md .codex/config.toml .codex/notify.sh
git status --short --branch
```

The active-root comment, `notify` path, and
`CE_CHATGPT_BULK_DELETE_ROOT` value in `.codex/config.toml` must all name the
target worktree. Re-running the bootstrap is safe when the generated content is
unchanged; differing existing content is reported and left untouched.

## User-level project trust

The currently installed Codex may store project trust in the user's
`~/.codex/config.toml` rather than tracked repository configuration. Verify the
current Codex version/configuration behavior (for example with `codex doctor`)
rather than assuming an older trust mechanism remains authoritative. The
bootstrap checks for an exact trusted project entry without printing unrelated
user configuration. If trust is not
detected, it prints a warning; it never rewrites user-level configuration.
Review the warning and configure trust through the current Codex-supported
workflow before starting Codex in the target.

## Historical note

NucSyn was only the historical source used to establish the first local setup.
It is not a dependency of this extension, its bootstrap, or future worktrees.
Future worktrees must use this project bootstrap instead of manually copying
files from that project.
