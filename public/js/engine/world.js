// ===== 万国事件引擎：天灾丰年、邦交关系、贸易商路 =====
// 大事件与外交都写入编年史（logs），标 major 的同时进入「大事记」视图。

const clampRel = (v) => Math.max(-100, Math.min(100, Math.round(v)));

export function relKey(a, b) {
  return [a, b].sort().join('|');
}

export function getRelation(game, a, b) {
  return game.relations?.[relKey(a, b)] ?? 0;
}

// 关系调整：钳制在 ±100。阈值跨越由调用方决定是否记录。
export function adjustRelation(game, a, b, delta) {
  game.relations = game.relations || {};
  const key = relKey(a, b);
  game.relations[key] = clampRel((game.relations[key] ?? 0) + delta);
  return game.relations[key];
}

// 关系直接钉值：用于劝降被拒、开战断交这类「一落千丈」的外交事件
export function setRelation(game, a, b, value) {
  game.relations = game.relations || {};
  game.relations[relKey(a, b)] = clampRel(value);
  return game.relations[relKey(a, b)];
}

export function relationLabel(v) {
  if (v <= -40) return '敌视';
  if (v <= -12) return '冷淡';
  if (v < 15) return '中立';
  if (v < 50) return '友善';
  return '盟好';
}

export function atWar(game, a, b) {
  return game.nations[a]?.enemies.includes(b) || game.nations[b]?.enemies.includes(a) || false;
}

// ---- 贸易商路 ----

export function routeBetween(game, a, b) {
  return (game.tradeRoutes || []).find(
    (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a),
  );
}

export function establishRoute(game, a, b, turn) {
  if (routeBetween(game, a, b)) return false;
  if (atWar(game, a, b)) return false;
  game.tradeRoutes = game.tradeRoutes || [];
  game.tradeRoutes.push({ a, b, since: turn });
  return true;
}

export function breakRoute(game, a, b) {
  const before = game.tradeRoutes || [];
  game.tradeRoutes = before.filter((r) => !((r.a === a && r.b === b) || (r.a === b && r.b === a)));
  return game.tradeRoutes.length !== before.length;
}

// 商路收益：双方按领地规模互市，小国利薄、大国利厚（规模 cap 防止滚雪球）
export function routeYield(game, route) {
  const sizeOf = (id) => game.nations[id]?.cells.length ?? 0;
  const scale = 1 + Math.min(8, (sizeOf(route.a) + sizeOf(route.b)) * 0.25);
  return {
    food: Math.round(3 * scale),
    minerals: Math.round(2 * scale),
    energy: Math.round(1.5 * scale),
  };
}

export function resolveTrade(game, logs) {
  for (const route of [...(game.tradeRoutes || [])]) {
    if (atWar(game, route.a, route.b) || getRelation(game, route.a, route.b) < 0) {
      breakRoute(game, route.a, route.b);
      logs.push({ turn: game.turn, kind: 'trade', major: true, text: `${game.nations[route.a].name}与${game.nations[route.b].name}的商路断绝。` });
      continue;
    }
    const yield_ = routeYield(game, route);
    for (const id of [route.a, route.b]) {
      const nation = game.nations[id];
      if (!nation || nation.dead) continue;
      nation.food += yield_.food;
      nation.minerals += yield_.minerals;
      nation.energy += yield_.energy;
    }
  }
}

// ---- 天灾与丰年 ----

const WORLD_EVENTS = [
  { kind: 'disaster', name: '旱魃为虐', weight: 3, apply: (n) => { n.food *= 0.72; n.appeal = Math.max(0, n.appeal - 3); }, text: '赤地千里，河渠见底' },
  { kind: 'disaster', name: '蝗灾蔽日', weight: 2, apply: (n) => { n.food *= 0.6; }, text: '蝗群过境，禾稼一空' },
  { kind: 'disaster', name: '洪水滔滔', weight: 2, apply: (n) => { n.pop *= 0.97; n.food *= 0.85; }, text: '江河决堤，淹没了低洼的田庄' },
  { kind: 'disaster', name: '瘟疫流行', weight: 2, apply: (n) => { n.pop *= 0.94; n.stability = Math.max(0, n.stability - 5); }, text: '疫病沿商道蔓延，市井为之一空' },
  { kind: 'disaster', name: '地动山摇', weight: 1, apply: (n) => { n.stability = Math.max(0, n.stability - 6); n.minerals *= 0.9; }, text: '大地震颤，屋舍倾颓' },
  { kind: 'harvest', name: '风调雨顺', weight: 2, apply: (n) => { n.food *= 1.25; n.appeal = Math.min(100, n.appeal + 2); }, text: '风调雨顺，仓廪充实' },
];

const EVENT_TOTAL_WEIGHT = WORLD_EVENTS.reduce((s, e) => s + e.weight, 0);

// 每回合约四成概率在列国某处发生一桩大事件（玩家与 AI 国一视同仁）
export function rollWorldEvents(game, logs, rng) {
  if (rng() >= 0.38) return;
  const alive = Object.values(game.nations).filter((n) => !n.dead && n.cells.length > 0);
  if (alive.length === 0) return;
  const nation = alive[Math.floor(rng() * alive.length)];
  let roll = rng() * EVENT_TOTAL_WEIGHT;
  const event = WORLD_EVENTS.find((e) => (roll -= e.weight) <= 0) || WORLD_EVENTS[0];

  event.apply(nation);
  const cellIdx = nation.cells[Math.floor(rng() * nation.cells.length)];
  const place = `（${cellIdx % game.map.w}, ${Math.floor(cellIdx / game.map.w)}）一带`;
  logs.push({
    turn: game.turn,
    kind: event.kind,
    major: true,
    text: `${nation.name}${event.name}：${event.text}${event.kind === 'disaster' ? `，${place}受灾尤重。` : '，万民称庆。'}`,
  });
}

// ---- 邦交 ----

// AI 列国的随机外交：遣使、开市、摩擦、会盟；交战双方可能求和停战。
export function aiDiplomacy(game, logs, rng) {
  if (rng() >= 0.33) return;
  const alive = Object.values(game.nations).filter((n) => !n.dead && n.cells.length > 0);
  if (alive.length < 2) return;
  const a = alive[Math.floor(rng() * alive.length)];
  let b = alive[Math.floor(rng() * alive.length)];
  if (a.id === b.id) b = alive[(alive.indexOf(a) + 1) % alive.length];

  if (atWar(game, a.id, b.id)) {
    // 30% 概率战罢言和
    if (rng() < 0.3) {
      a.enemies = a.enemies.filter((x) => x !== b.id);
      b.enemies = b.enemies.filter((x) => x !== a.id);
      adjustRelation(game, a.id, b.id, 25);
      logs.push({ turn: game.turn, kind: 'diplo', major: true, text: `${a.name}与${b.name}罢兵言和，约定互不侵犯。` });
    }
    return;
  }

  const rel = getRelation(game, a.id, b.id);
  const involvesPlayer = a.isPlayer || b.isPlayer;
  if (rel < 10 && rng() < 0.6) {
    adjustRelation(game, a.id, b.id, -12);
    if (involvesPlayer) logs.push({ turn: game.turn, kind: 'diplo', major: true, text: `${a.name}与${b.name}边境生衅，关系转恶。` });
    return;
  }
  if (rel >= 45 && !routeBetween(game, a.id, b.id)) {
    if (establishRoute(game, a.id, b.id, game.turn) && involvesPlayer) {
      logs.push({ turn: game.turn, kind: 'trade', major: true, text: `${a.name}与${b.name}缔结商约，边市大开。` });
    }
    return;
  }
  if (rel >= 60 && rng() < 0.5) {
    adjustRelation(game, a.id, b.id, 8);
    if (involvesPlayer) logs.push({ turn: game.turn, kind: 'diplo', major: true, text: `${a.name}与${b.name}会盟于境上，共尊旧好。` });
    return;
  }
  adjustRelation(game, a.id, b.id, 10);
  if (involvesPlayer) logs.push({ turn: game.turn, kind: 'diplo', major: false, text: `${a.name}遣使往来于${b.name}，两邦情谊渐笃。` });
}

// 战争的连带后果：交战国关系钉在 −40，双方商路断绝（在回合结算时统一清扫）
export function sweepHostilities(game, logs) {
  const ids = Object.keys(game.nations);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      if (!atWar(game, a, b)) continue;
      const rel = getRelation(game, a, b);
      if (rel > -40) {
        game.relations[relKey(a, b)] = -40;
        logs.push({ turn: game.turn, kind: 'diplo', major: true, text: `${game.nations[a].name}与${game.nations[b].name}正式进入战争状态，邦交断绝。` });
      }
      if (breakRoute(game, a, b)) {
        logs.push({ turn: game.turn, kind: 'trade', major: true, text: `战火切断商路：${game.nations[a].name}与${game.nations[b].name}的边市罢市。` });
      }
    }
  }
}
