// ===== 美术资产加载器 =====
// 契约（详见仓库根 ART-BRIEF.md）：美术文件按约定放入 public/art/ 即自动生效；
// 任一文件缺失（404）时 drawArt 返回 false，调用方绘制程序化占位图形。
// 因此游戏零美术可玩，美术包可随时热插入，无需改任何代码。

const cache = new Map(); // path -> HTMLImageElement（加载失败置 null，不再重试）

function probe(path) {
  if (cache.has(path)) return cache.get(path);
  const img = new Image();
  img.onerror = () => cache.set(path, null);
  img.src = path;
  cache.set(path, img);
  return img;
}

// 尝试把美术图画在 (x,y,w,h)；图未就绪或缺失时返回 false，由调用方画占位
export function drawArt(ctx, path, x, y, w, h) {
  const img = probe(path);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, x, y, w, h);
    return true;
  }
  return false;
}

export const ART_PATHS = {
  city: (tier, capital) => `art/cities/${capital ? 'capital' : 'civ'}${tier}.png`,
  unit: (tier) => `art/units/unit${tier}.png`,
  tile: (terrain) => `art/tiles/${terrain}.png`,
};
