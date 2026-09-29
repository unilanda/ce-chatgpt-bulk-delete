#!/usr/bin/env bash
set -euo pipefail

PLACEHOLDER="__CE_CHATGPT_BULK_DELETE_WORKTREE__"
BANNED_PATTERN='NucSyn|nucsyn_311|NUCSYN_|RED8|/tamir2/|src/3rd|localhost:6000'
BANNED_RNA_PATTERN='(^|[^[:alnum:]_])RNA([^[:alnum:]_]|$)'

usage() {
    printf 'Usage: %s <TARGET_WORKTREE>\n' "$(basename "$0")" >&2
}

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

canonical_git_common_dir() {
    local repository_root="$1"
    local common_dir

    common_dir="$(git -C "$repository_root" rev-parse --git-common-dir)"
    if [[ "$common_dir" = /* ]]; then
        realpath -e -- "$common_dir"
    else
        realpath -e -- "$repository_root/$common_dir"
    fi
}

render_template() {
    local source_file="$1"
    local destination_file="$2"

    CE_CODEX_BOOTSTRAP_TARGET="$TARGET_WORKTREE" \
        CE_CODEX_BOOTSTRAP_PLACEHOLDER="$PLACEHOLDER" \
        awk '
            function replace_all(value, needle, replacement, position, output) {
                output = ""
                while ((position = index(value, needle)) > 0) {
                    output = output substr(value, 1, position - 1) replacement
                    value = substr(value, position + length(needle))
                }
                return output value
            }
            {
                print replace_all($0, ENVIRON["CE_CODEX_BOOTSTRAP_PLACEHOLDER"], ENVIRON["CE_CODEX_BOOTSTRAP_TARGET"])
            }
        ' "$source_file" >"$destination_file"
}

toml_escape() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '%s' "$value"
}

project_is_trusted() {
    local config_file="$1"
    local target_path="$2"
    local escaped_target
    local trust_header

    [[ -f "$config_file" ]] || return 1
    escaped_target="$(toml_escape "$target_path")"
    trust_header="[projects.\"$escaped_target\"]"

    CE_CODEX_TRUST_HEADER="$trust_header" awk '
        $0 == ENVIRON["CE_CODEX_TRUST_HEADER"] {
            in_target = 1
            next
        }
        in_target && /^\[/ {
            exit
        }
        in_target && /^[[:space:]]*trust_level[[:space:]]*=[[:space:]]*"trusted"[[:space:]]*(#.*)?$/ {
            found = 1
            exit
        }
        END {
            exit(found ? 0 : 1)
        }
    ' "$config_file"
}

[[ "$#" -eq 1 ]] || {
    usage
    exit 64
}

[[ -n "$1" ]] || fail "TARGET_WORKTREE must not be empty."
[[ "$1" != *$'\n'* ]] || fail "TARGET_WORKTREE must not contain a newline."
TARGET_WORKTREE="$(realpath -e -- "$1")" || fail "TARGET_WORKTREE does not exist: $1"
[[ -d "$TARGET_WORKTREE" ]] || fail "TARGET_WORKTREE is not a directory: $TARGET_WORKTREE"

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_ROOT="$(cd "$SCRIPT_DIRECTORY/../../.." && pwd -P)"
SOURCE_TOPLEVEL="$(git -C "$SOURCE_ROOT" rev-parse --show-toplevel 2>/dev/null)" || \
    fail "Bootstrap script is not inside a Git worktree."
SOURCE_TOPLEVEL="$(realpath -e -- "$SOURCE_TOPLEVEL")"
[[ "$SOURCE_TOPLEVEL" == "$SOURCE_ROOT" ]] || \
    fail "Could not resolve the bootstrap source repository root safely."

TARGET_TOPLEVEL="$(git -C "$TARGET_WORKTREE" rev-parse --show-toplevel 2>/dev/null)" || \
    fail "TARGET_WORKTREE is not a Git worktree: $TARGET_WORKTREE"
TARGET_TOPLEVEL="$(realpath -e -- "$TARGET_TOPLEVEL")"
[[ "$TARGET_TOPLEVEL" == "$TARGET_WORKTREE" ]] || \
    fail "TARGET_WORKTREE must name the worktree root, not a subdirectory: $TARGET_WORKTREE"

SOURCE_COMMON_DIR="$(canonical_git_common_dir "$SOURCE_ROOT")"
TARGET_COMMON_DIR="$(canonical_git_common_dir "$TARGET_WORKTREE")"
[[ "$SOURCE_COMMON_DIR" == "$TARGET_COMMON_DIR" ]] || \
    fail "TARGET_WORKTREE belongs to a different Git repository: $TARGET_WORKTREE"

TARGET_IS_LISTED=false
while IFS= read -r worktree_line; do
    [[ "$worktree_line" == worktree\ * ]] || continue
    listed_path="${worktree_line#worktree }"
    [[ -e "$listed_path" ]] || continue
    listed_path="$(realpath -e -- "$listed_path")"
    if [[ "$listed_path" == "$TARGET_WORKTREE" ]]; then
        TARGET_IS_LISTED=true
        break
    fi
done < <(git -C "$SOURCE_ROOT" -c core.quotePath=false worktree list --porcelain)
[[ "$TARGET_IS_LISTED" == true ]] || \
    fail "TARGET_WORKTREE is not registered as a worktree of this repository."

TEMPLATE_DIRECTORY="$SOURCE_ROOT/documentation/workflows/codex-worktree-templates"
POLICY_SOURCE="$SOURCE_ROOT/documentation/workflows/CODEX_AUTONOMOUS_EXECUTION_POLICY.txt"
TASK_TEMPLATE_SOURCE="$SOURCE_ROOT/documentation/workflows/CODEX_MASTER_INCREMENT_TEMPLATE.txt"
NOTIFY_SOURCE="$SOURCE_ROOT/scripts/development/codex/codex_notify.sh"

for required_source in \
    "$TEMPLATE_DIRECTORY/AGENTS.md.in" \
    "$TEMPLATE_DIRECTORY/config.toml.in" \
    "$POLICY_SOURCE" \
    "$TASK_TEMPLATE_SOURCE" \
    "$NOTIFY_SOURCE"; do
    [[ -f "$required_source" ]] || fail "Required tracked source is missing: $required_source"
done

TEMP_DIRECTORY="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIRECTORY"' EXIT
mkdir -p "$TEMP_DIRECTORY/.codex"

render_template "$TEMPLATE_DIRECTORY/AGENTS.md.in" "$TEMP_DIRECTORY/AGENTS.md"
render_template "$TEMPLATE_DIRECTORY/config.toml.in" "$TEMP_DIRECTORY/.codex/config.toml"
cp "$POLICY_SOURCE" "$TEMP_DIRECTORY/.codex/CODEX_AUTONOMOUS_EXECUTION_POLICY.txt"
cp "$TASK_TEMPLATE_SOURCE" "$TEMP_DIRECTORY/.codex/CODEX_MASTER_INCREMENT_TEMPLATE.txt"
cp "$NOTIFY_SOURCE" "$TEMP_DIRECTORY/.codex/notify.sh"
chmod 0755 "$TEMP_DIRECTORY/.codex/notify.sh"

GENERATED_RELATIVE_PATHS=(
    "AGENTS.md"
    ".codex/config.toml"
    ".codex/CODEX_AUTONOMOUS_EXECUTION_POLICY.txt"
    ".codex/CODEX_MASTER_INCREMENT_TEMPLATE.txt"
    ".codex/notify.sh"
)

if [[ -e "$TARGET_WORKTREE/.codex" && ! -d "$TARGET_WORKTREE/.codex" ]]; then
    fail "Refusing to replace non-directory path: $TARGET_WORKTREE/.codex"
fi

CONFLICTS=()
for relative_path in "${GENERATED_RELATIVE_PATHS[@]}"; do
    destination="$TARGET_WORKTREE/$relative_path"
    intended="$TEMP_DIRECTORY/$relative_path"

    if [[ -L "$destination" ]]; then
        CONFLICTS+=("$destination (symbolic link)")
    elif [[ -e "$destination" ]]; then
        if [[ ! -f "$destination" ]] || ! cmp -s -- "$intended" "$destination"; then
            CONFLICTS+=("$destination")
        fi
    fi
done

if [[ "${#CONFLICTS[@]}" -gt 0 ]]; then
    printf 'ERROR: Refusing to overwrite existing content that differs from the generated local layer:\n' >&2
    printf '  %s\n' "${CONFLICTS[@]}" >&2
    printf 'Compare or move the listed files, then run the bootstrap again.\n' >&2
    exit 1
fi

mkdir -p "$TARGET_WORKTREE/.codex"
CREATED=0
UNCHANGED=0
for relative_path in "${GENERATED_RELATIVE_PATHS[@]}"; do
    destination="$TARGET_WORKTREE/$relative_path"
    intended="$TEMP_DIRECTORY/$relative_path"

    if [[ -e "$destination" ]]; then
        UNCHANGED=$((UNCHANGED + 1))
    else
        if [[ "$relative_path" == ".codex/notify.sh" ]]; then
            install -m 0755 "$intended" "$destination"
        else
            install -m 0644 "$intended" "$destination"
        fi
        CREATED=$((CREATED + 1))
    fi
done
[[ -x "$TARGET_WORKTREE/.codex/notify.sh" ]] || \
    chmod 0755 "$TARGET_WORKTREE/.codex/notify.sh"

for relative_path in "${GENERATED_RELATIVE_PATHS[@]}"; do
    git -C "$TARGET_WORKTREE" check-ignore -q -- "$relative_path" || \
        fail "Generated support file is not ignored by tracked policy: $relative_path"
done

grep -Fqx -- "    $TARGET_WORKTREE" "$TARGET_WORKTREE/AGENTS.md" || \
    fail "Generated AGENTS.md does not identify TARGET_WORKTREE as the active root."
grep -Fqx -- "notify = [\"bash\", \"$TARGET_WORKTREE/.codex/notify.sh\"]" \
    "$TARGET_WORKTREE/.codex/config.toml" || \
    fail "Generated config.toml has an incorrect notify path."
grep -Fqx -- "CE_CHATGPT_BULK_DELETE_ROOT = \"$TARGET_WORKTREE\"" \
    "$TARGET_WORKTREE/.codex/config.toml" || \
    fail "Generated config.toml has an incorrect active root."

if [[ "$SOURCE_ROOT" != "$TARGET_WORKTREE" ]] && \
    grep -Fq -- "$SOURCE_ROOT/.codex/notify.sh" "$TARGET_WORKTREE/.codex/config.toml"; then
    fail "Generated config.toml retained the source worktree notify path."
fi

if grep -R -E -i "$BANNED_PATTERN" \
    "$TARGET_WORKTREE/AGENTS.md" "$TARGET_WORKTREE/.codex" >/dev/null || \
    grep -R -E "$BANNED_RNA_PATTERN" \
        "$TARGET_WORKTREE/AGENTS.md" "$TARGET_WORKTREE/.codex" >/dev/null; then
    fail "Generated local layer contains a banned historical project assumption."
fi

TRUST_CONFIG="${CODEX_HOME:-$HOME/.codex}/config.toml"
printf 'Codex worktree-local layer verified.\n'
printf '  Target: %s\n' "$TARGET_WORKTREE"
printf '  Created: %d\n' "$CREATED"
printf '  Unchanged: %d\n' "$UNCHANGED"
printf '  Ignore policy: /AGENTS.md and /.codex/\n'
if project_is_trusted "$TRUST_CONFIG" "$TARGET_WORKTREE"; then
    printf '  User-level Codex trust: trusted\n'
else
    printf 'WARNING: User-level Codex trust was not detected for: %s\n' "$TARGET_WORKTREE"
    printf 'Review the project trust entry in ~/.codex/config.toml before starting Codex.\n'
    printf 'The bootstrap did not modify user-level Codex configuration.\n'
fi
printf 'Next command:\n  code %q\n' "$TARGET_WORKTREE"
