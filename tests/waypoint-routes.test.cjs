const assert = require('node:assert/strict');
const fs = require('node:fs');
const engine = require('../engine.js');

const points = JSON.parse(fs.readFileSync('waypoints-burger1.json', 'utf8'));
assert.deepEqual(points.waypoints.map(point => point.number), [1,2,3,4]);
assert.deepEqual(engine.WAYPOINTS[1],[340,engine.POINTS.home1[1]],'WP1 joins Burger 1 home to the aisle');
assert.deepEqual(engine.WAYPOINTS[4],[340,engine.POINTS.home2[1]],'WP4 joins Burger 2 home to the aisle, not assembly undock');
assert.deepEqual(engine.WAYPOINTS[3],[340,engine.POINTS.assembly[1]],'WP3 joins assembly to the aisle');
const corridor = [4,3,1,2];
for(const robot of [0,1]){
  const routes = JSON.parse(fs.readFileSync(`routes-burger${robot+1}.json`, 'utf8'));
  assert.equal(routes.robot, `burger${robot+1}`);
  assert.equal(routes.kind, 'via_waypoints');
  assert.equal(routes.requires_site_validation, true);
  const endpoint = {home:robot===0?1:4, warehouse:2, assembly:3, waiting:4};
  const found = new Set();
  for (let quantity=1; quantity<=20; quantity++) {
    for (const move of engine.makePlan(quantity).tasks.filter(task => task.type==='move' && task.actor===robot)) {
      const key = move.from+'->'+move.to;
      const route = routes.legs.find(leg => leg.from===move.from && leg.to===move.to);
      assert(route, `Missing Burger ${robot+1} route for ${key}`);
      found.add(key);
      assert.deepEqual(move.via,route.via,'Engine and route config differ: '+key);
      const travel=engine.path(move.from,move.to,robot);
      let cursor=-1;
      for(const id of route.via){
        cursor=travel.findIndex((point,i)=>i>cursor && point[0]===engine.WAYPOINTS[id][0] && point[1]===engine.WAYPOINTS[id][1]);
        assert(cursor>=0,'Simulation path misses WP'+id+': '+key);
      }
      assert.equal(route.via[0], endpoint[move.from], 'Wrong start junction: '+key);
      assert.equal(route.via.at(-1), endpoint[move.to], 'Wrong destination junction: '+key);
      for (let i=1; i<route.via.length; i++) {
        assert.equal(Math.abs(corridor.indexOf(route.via[i])-corridor.indexOf(route.via[i-1])),1,
          'Route skips a junction: '+key);
      }
    }
  }
  assert.equal(found.size,routes.legs.length,'Route list should cover only simulated legs');
}
console.log('PASS: both robots use shared waypoints, correct home junctions and all simulated legs without skipped junctions.');
