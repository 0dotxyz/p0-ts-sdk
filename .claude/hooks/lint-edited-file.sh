#!/usr/bin/env bash
# PostToolUse: eslint --fix + prettier on the src file the agent just wrote.
input=$(cat)
file=$(printf '%s' "$input" | node -e '
  let d = "";
  process.stdin.on("data", (c) => (d += c)).on("end", () => {
    const j = JSON.parse(d);
    process.stdout.write((j.tool_input && j.tool_input.file_path) || "");
  });
')

case "$file" in
  "$CLAUDE_PROJECT_DIR"/src/*.ts) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

# Pick up the repo's .nvmrc when nvm is present.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use --silent >/dev/null 2>&1
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0
./node_modules/.bin/eslint --fix "$file" >/dev/null 2>&1
./node_modules/.bin/prettier --log-level warn --write "$file" >/dev/null 2>&1
exit 0
