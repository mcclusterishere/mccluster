import { BOARD_SIZE, WALLS, SHOES, EXIT } from './engine.mjs';
export function soleObjective(run) {
  return ['robbery','velocity','ghost','gravity'].map(id => SHOES.find(s => s.id === id)).find(s => !run.collected.includes(s.id)) || {...EXIT,name:'Collection exit'};
}
export function soleRoute(run) {
  const goal = soleObjective(run), key = p => `${p.x},${p.y}`, start = key(run.player);
  const blocked = new Set(WALLS.map(p => p.join(','))), seen = new Set([start]), queue = [[run.player]];
  while(queue.length) {
    const path=queue.shift(), p=path.at(-1);
    if(p.x===goal.x && p.y===goal.y) return path;
    for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      const next={x:p.x+dx,y:p.y+dy}, id=key(next);
      if(next.x<0||next.x>=BOARD_SIZE||next.y<0||next.y>=BOARD_SIZE||blocked.has(id)||seen.has(id))continue;
      seen.add(id);queue.push([...path,next]);
    }
  }
  return [];
}
