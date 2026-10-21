#!/usr/bin/env bash
# Push perps-guardian to GitHub. Create the empty repo first:
#   https://github.com/new  ->  dreamdex-perps-mvp  ->  Public
#   do NOT tick Add a README / .gitignore / license
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git -c core.safecrlf=false commit -q -m "Sync"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin https://github.com/mbiiii/dreamdex-perps-mvp.git
else
  git remote add origin https://github.com/mbiiii/dreamdex-perps-mvp.git
fi

git push -u origin master
echo
echo "repo url: https://github.com/mbiiii/dreamdex-perps-mvp"
