#!/usr/bin/env bash
set -euo pipefail

# ─── pi-tokamak 一键发布 ────────────────────────────────────────────
# 用法:
#   ./scripts/release.sh           # patch 发布 (0.1.0 → 0.1.1)
#   ./scripts/release.sh minor     # minor 发布 (0.1.0 → 0.2.0)
#   ./scripts/release.sh major     # major 发布 (0.1.0 → 1.0.0)
#   ./scripts/release.sh 0.5.0     # 指定版本
# ─────────────────────────────────────────────────────────────────────

BUMP="${1:-patch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. 确保工作区干净
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "❌ 工作区不干净，请先 commit 或 stash"
  exit 1
fi

# 2. 拉取最新
git pull --ff-only 2>/dev/null || true

# 3. 跑测试
echo "🧪 跑测试..."
npm test || { echo "❌ 测试未通过"; exit 1; }

# 4. 升版本
OLD_VER=$(node -p "require('./package.json').version")
npm version "$BUMP" --no-git-tag-version 2>/dev/null
NEW_VER=$(node -p "require('./package.json').version")

if [ "$OLD_VER" = "$NEW_VER" ] && [ "$1" != "" ]; then
  # 如果是指定版本号且与当前相同，强制更新
  node -e "const p=require('./package.json');p.version='$1';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
  NEW_VER="$1"
fi

echo "📦 $OLD_VER → $NEW_VER"

# 5. 打包预览
echo "📦 打包预览..."
npm pack --dry-run 2>&1 | grep -E "name:|version:|total files:|package size:"

# 6. 发布到 npm
echo "🚀 发布到 npm..."
npm publish --access public

# 7. Git 提交 + 打 tag + 推送
git add package.json
git commit -m "release: v$NEW_VER"
git tag "v$NEW_VER"
git push && git push --tags

echo ""
echo "✅ pi-tokamak v$NEW_VER 发布完成"
echo "   npm: https://www.npmjs.com/package/pi-tokamak"
echo "   git: https://github.com/DoubleDD/pi-tokamak/releases/tag/v$NEW_VER"
