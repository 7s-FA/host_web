const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const config=require('../live-map-config.js');
const {projectPose,parsePose}=require('../live-map-model.js');
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const closeHeading=(actual,expected)=>close((actual-expected+540)%360-180,0);

// Both robots use the same verified map. Distances and angles are not warped.
const model=require('../live-map-model.js'),metric=config.metric;
close(model.bounds.maxX-model.bounds.minX,1.95);
close(model.bounds.maxY-model.bounds.minY,3.8);
for(let index=0;index<2;index++){
 for(const point of [config.calibration.robots[index].home,...config.calibration.robots[index].knots]){
  const pose=projectPose({...point,yaw:0},index);
  close(pose.position[0],metric.svgOrigin[0]+point.x*metric.pixelsPerMeter);
  close(pose.position[1],metric.svgOrigin[1]-point.y*metric.pixelsPerMeter);
 }
 const a=projectPose({x:0,y:0,yaw:0},index),x=projectPose({x:.5,y:0,yaw:0},index),y=projectPose({x:0,y:.5,yaw:0},index);
 close(x.position[0]-a.position[0],metric.pixelsPerMeter*.5);close(a.position[1]-y.position[1],metric.pixelsPerMeter*.5);
}
for(const [yaw,heading] of [[0,90],[Math.PI/2,0],[Math.PI,270],[-Math.PI/2,180],[Math.PI/4,45]])
 closeHeading(projectPose({x:.42,y:-.1,yaw},0).heading,heading);
assert.deepEqual(projectPose({x:.5,y:.8,yaw:.7},0),projectPose({x:.5,y:.8,yaw:.7},1));
close(projectPose({x:model.bounds.minX,y:model.bounds.maxY,yaw:0},0).position[0],metric.svgOrigin[0]+model.bounds.minX*metric.pixelsPerMeter);
close(projectPose({x:model.bounds.minX,y:model.bounds.maxY,yaw:0},0).position[1],metric.svgOrigin[1]-model.bounds.maxY*metric.pixelsPerMeter);

const now=1800000000500;
function message(index=0,yaw=0){
 return {header:{frame_id:config.robotTopics[index]+'/map',stamp:{sec:1800000000,nanosec:500000000}},
  pose:{pose:{position:{x:.42,y:-.1,z:0},orientation:{x:0,y:0,z:Math.sin(yaw/2),w:Math.cos(yaw/2)}}}};
}
for(let index=0;index<2;index++){
 const m=message(index,Math.PI/2),parsed=parsePose(m,index,now);
 assert.ok(parsed);assert.equal(parsed.stamp,now);
 m.header.frame_id='map';assert.ok(parsePose(m,index,now));
 m.pose.pose.orientation.z*=.95;m.pose.pose.orientation.w*=.95;
 closeHeading(parsePose(m,index,now).heading,parsed.heading);
 m.pose.pose.orientation.z*=-1;m.pose.pose.orientation.w*=-1;
 closeHeading(parsePose(m,index,now).heading,parsed.heading);
}
assert.ok(parsePose(message(),0,now+3000));
assert.equal(parsePose(message(),0,now+3001),null);
const retained=parsePose(message(),0,now+600000,{allowStale:true});
assert.equal(retained.stamp,now,'retained positions keep their actual old timestamp');
// Docking beyond the old waypoint span remains visible on the metric map.
const dockMessage=message();
dockMessage.pose.pose.position={x:.45969099,y:.85449041,z:0};
const dockPose=parsePose(dockMessage,0,now+40000,{allowStale:true});
assert.equal(dockPose.withinMap,true);
close(dockPose.world.x,.45969099);close(dockPose.world.y,.85449041);
assert.equal(dockPose.stamp,now);
for(let index=0;index<2;index++){
 for(const [x,y,inside] of [[model.bounds.minX,model.bounds.minY,true],[model.bounds.maxX,model.bounds.maxY,true],
  [model.bounds.minX-.001,0,false],[model.bounds.maxX+.001,0,false],[0,model.bounds.minY-.001,false],[0,model.bounds.maxY+.001,false]]){
  const m=message(index);m.pose.pose.position={x,y};assert.equal(parsePose(m,index,now).withinMap,inside);
 }
}
assert.equal(parsePose(message(),0,now-1001,{allowStale:true}),null,'retained mode still rejects future timestamps');
assert.ok(parsePose(message(),0,now-1000));
assert.equal(parsePose(message(),0,now-1001),null);
for(const invalid of [null,{},'pose',{header:{}},{header:{frame_id:'map',stamp:{sec:0,nanosec:0}}}])
 assert.equal(parsePose(invalid,0,now),null);
for(const change of [
 m=>m.header.frame_id='burger2/map',m=>m.header.frame_id='odom',
 m=>m.header.stamp.sec=0,m=>m.header.stamp.sec=-1,m=>m.header.stamp.sec=1.5,
 m=>m.header.stamp.sec=Infinity,m=>m.header.stamp.nanosec=1e9,m=>m.header.stamp.nanosec=-1,
 m=>m.header.stamp.nanosec=1.5,m=>m.header.stamp=null,
 m=>m.pose.pose.position.x=NaN,m=>m.pose.pose.position.y=Infinity,
 m=>m.pose.pose.position.x='0.42',m=>m.pose.pose.position=null,
 m=>m.pose.pose.orientation=null,m=>m.pose.pose.orientation.x=NaN,
 m=>m.pose.pose.orientation.w=0,m=>m.pose.pose.orientation.w=2,
 m=>m.pose.pose.orientation.z=Infinity,m=>m.pose.pose=null
]){
 const m=message();change(m);assert.equal(parsePose(m,0,now),null);
}
for(const index of [-1,2,.5,'0',null])assert.equal(parsePose(message(),index,now),null);
assert.equal(parsePose(message(),0,NaN),null);
assert.equal(projectPose({x:NaN,y:0,yaw:0},0),null);

// 브라우저 스크립트도 Node와 같은 보정값·API를 제공합니다.
const browser={};browser.window=browser;vm.createContext(browser);
for(const file of ['live-map-config.js','live-map-model.js'])
 vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),browser);
const browserPose=browser.LiveMapModel.parsePose(message(),0,now);
assert.deepEqual(JSON.parse(JSON.stringify(browserPose)),parsePose(message(),0,now));
console.log('PASS: metric map bounds, equal scale, docking visibility, undistorted heading, pose freshness/validation and browser exports.');
