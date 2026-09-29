#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
BOOTSTRAP="$REPOSITORY_ROOT/scripts/development/codex/bootstrap_worktree_local_layer.sh"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local expected="$2"
    grep -Fq -- "$expected" "$file" || fail "$file does not contain: $expected"
}

[[ -x "$BOOTSTRAP" ]] || fail "bootstrap script is missing or not executable: $BOOTSTRAP"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

FIXTURE_REPOSITORY="$TEST_ROOT/repository"
FIXTURE_TARGET="$TEST_ROOT/feature worktree"
FIXTURE_CONFLICT_TARGET="$TEST_ROOT/conflict-worktree"
FIXTURE_OTHER_REPOSITORY="$TEST_ROOT/other-repository"
FIXTURE_HOME="$TEST_ROOT/home"

mkdir -p \
    "$FIXTURE_REPOSITORY/documentation/workflows/codex-worktree-templates" \
    "$FIXTURE_REPOSITORY/scripts/development/codex" \
    "$FIXTURE_HOME/.codex"

cp "$REPOSITORY_ROOT/.gitignore" "$FIXTURE_REPOSITORY/.gitignore"
cp "$REPOSITORY_ROOT/documentation/workflows/CODEX_AUTONOMOUS_EXECUTION_POLICY.txt" \
    "$FIXTURE_REPOSITORY/documentation/workflows/"
cp "$REPOSITORY_ROOT/documentation/workflows/CODEX_MASTER_INCREMENT_TEMPLATE.txt" \
    "$FIXTURE_REPOSITORY/documentation/workflows/"
cp "$REPOSITORY_ROOT/documentation/workflows/codex-worktree-templates/AGENTS.md.in" \
    "$FIXTURE_REPOSITORY/documentation/workflows/codex-worktree-templates/"
cp "$REPOSITORY_ROOT/documentation/workflows/codex-worktree-templates/config.toml.in" \
    "$FIXTURE_REPOSITORY/documentation/workflows/codex-worktree-templates/"
cp "$REPOSITORY_ROOT/scripts/development/codex/bootstrap_worktree_local_layer.sh" \
    "$FIXTURE_REPOSITORY/scripts/development/codex/"
cp "$REPOSITORY_ROOT/scripts/development/codex/codex_notify.sh" \
    "$FIXTURE_REPOSITORY/scripts/development/codex/"

git -C "$FIXTURE_REPOSITORY" init -q -b main
git -C "$FIXTURE_REPOSITORY" config user.name "Codex Bootstrap Test"
git -C "$FIXTURE_REPOSITORY" config user.email "codex-bootstrap-test@example.invalid"
git -C "$FIXTURE_REPOSITORY" add .
git -C "$FIXTURE_REPOSITORY" commit -q -m fixture
git -C "$FIXTURE_REPOSITORY" worktree add -q -b feature "$FIXTURE_TARGET"

BOOTSTRAP_OUTPUT="$TEST_ROOT/bootstrap-output.txt"
HOME="$FIXTURE_HOME" \
    "$FIXTURE_TARGET/scripts/development/codex/bootstrap_worktree_local_layer.sh" \
    "$FIXTURE_TARGET" >"$BOOTSTRAP_OUTPUT"

for generated_file in \
    AGENTS.md \
    .codex/config.toml \
    .codex/CODEX_AUTONOMOUS_EXECUTION_POLICY.txt \
    .codex/CODEX_MASTER_INCREMENT_TEMPLATE.txt \
    .codex/notify.sh; do
    [[ -f "$FIXTURE_TARGET/$generated_file" ]] || fail "missing generated file: $generated_file"
    git -C "$FIXTURE_TARGET" check-ignore -q -- "$generated_file" || \
        fail "generated file is not ignored: $generated_file"
done

[[ -x "$FIXTURE_TARGET/.codex/notify.sh" ]] || fail "generated notify.sh is not executable"
assert_contains "$FIXTURE_TARGET/AGENTS.md" "$FIXTURE_TARGET"
assert_contains "$FIXTURE_TARGET/.codex/config.toml" \
    "notify = [\"bash\", \"$FIXTURE_TARGET/.codex/notify.sh\"]"
assert_contains "$FIXTURE_TARGET/.codex/config.toml" \
    "CE_CHATGPT_BULK_DELETE_ROOT = \"$FIXTURE_TARGET\""
assert_contains "$BOOTSTRAP_OUTPUT" "User-level Codex trust was not detected for: $FIXTURE_TARGET"
printf -v EXPECTED_NEXT_COMMAND 'code %q' "$FIXTURE_TARGET"
assert_contains "$BOOTSTRAP_OUTPUT" "$EXPECTED_NEXT_COMMAND"

if grep -R -E -i \
    'NucSyn|nucsyn_311|NUCSYN_|RED8|/tamir2/|src/3rd|localhost:6000' \
    "$FIXTURE_TARGET/AGENTS.md" "$FIXTURE_TARGET/.codex" >/dev/null || \
    grep -R -E '(^|[^[:alnum:]_])RNA([^[:alnum:]_]|$)' \
        "$FIXTURE_TARGET/AGENTS.md" "$FIXTURE_TARGET/.codex" >/dev/null; then
    fail "generated local layer contains a banned historical assumption"
fi

if grep -R -F "$FIXTURE_REPOSITORY" \
    "$FIXTURE_TARGET/AGENTS.md" "$FIXTURE_TARGET/.codex" >/dev/null; then
    fail "generated local layer retained the source worktree path"
fi

GENERATED_HASHES="$TEST_ROOT/generated-hashes"
(
    cd "$FIXTURE_TARGET"
    sha256sum \
        AGENTS.md \
        .codex/config.toml \
        .codex/CODEX_AUTONOMOUS_EXECUTION_POLICY.txt \
        .codex/CODEX_MASTER_INCREMENT_TEMPLATE.txt \
        .codex/notify.sh
) >"$GENERATED_HASHES"

chmod 0775 "$FIXTURE_TARGET/.codex/notify.sh"
HOME="$FIXTURE_HOME" \
    "$FIXTURE_TARGET/scripts/development/codex/bootstrap_worktree_local_layer.sh" \
    "$FIXTURE_TARGET" >/dev/null
(
    cd "$FIXTURE_TARGET"
    sha256sum --check "$GENERATED_HASHES" >/dev/null
) || fail "idempotent bootstrap changed generated content"
[[ "$(stat -c '%a' "$FIXTURE_TARGET/.codex/notify.sh")" == "775" ]] || \
    fail "idempotent bootstrap changed an already-executable notify.sh mode"

git -C "$FIXTURE_REPOSITORY" worktree add -q -b conflict "$FIXTURE_CONFLICT_TARGET"
printf 'unrelated local instructions\n' >"$FIXTURE_CONFLICT_TARGET/AGENTS.md"
if HOME="$FIXTURE_HOME" \
    "$FIXTURE_CONFLICT_TARGET/scripts/development/codex/bootstrap_worktree_local_layer.sh" \
    "$FIXTURE_CONFLICT_TARGET" >"$TEST_ROOT/conflict-output.txt" 2>&1; then
    fail "bootstrap overwrote an unrelated existing AGENTS.md"
fi
[[ "$(cat "$FIXTURE_CONFLICT_TARGET/AGENTS.md")" == "unrelated local instructions" ]] || \
    fail "bootstrap changed the conflicting AGENTS.md"
[[ ! -e "$FIXTURE_CONFLICT_TARGET/.codex" ]] || \
    fail "bootstrap wrote partial output before reporting a conflict"

mkdir -p "$FIXTURE_OTHER_REPOSITORY"
git -C "$FIXTURE_OTHER_REPOSITORY" init -q -b main
if HOME="$FIXTURE_HOME" \
    "$FIXTURE_TARGET/scripts/development/codex/bootstrap_worktree_local_layer.sh" \
    "$FIXTURE_OTHER_REPOSITORY" >"$TEST_ROOT/other-output.txt" 2>&1; then
    fail "bootstrap accepted a target from a different repository"
fi
[[ ! -e "$FIXTURE_OTHER_REPOSITORY/AGENTS.md" ]] || \
    fail "bootstrap wrote into a target from a different repository"

printf 'PASS: bootstrap generates, validates, refuses conflicts, and is idempotent\n'
