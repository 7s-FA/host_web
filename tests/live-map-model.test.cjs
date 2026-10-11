const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const config=require('../live-map-config.js');
const {projectPose,parsePose}=require('../live-map-model.js');
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const closeHeading=(actual,expected)=>close((actual-expected+540)%360-180,0);

// 각 로봇의 실제 waypoint가 공통 SVG 기준점에 정확히 놓여야 합니다.
for(let index=0;index<2;index++){
 const robot=config.calibration.robots[index];
 for(const knot of robot.knots){
  const point=projectPose({x:knot.x,y:knot.y,yaw:0},index);
  close(point.position[0],340);close(point.position[1],knot.svgY);
 }
 for(let i=0;i<robot.knots.length-1;i++){
  const a=robot.knots[i],b=robot.knots[i+1];
  const point=projectPose({x:(a.x+b.x)/2,y:(a.y+b.y)/2,yaw:0},index);
  close(point.position[0],340);close(point.position[1],(a.svgY+b.svgY)/2);
 }
 for(const [a,b,direction] of [[robot.knots[0],robot.knots[1],-1],[robot.knots.at(-1),robot.knots.at(-2),1]]){
  const y=a.y+direction*.1;
  const point=projectPose({x:a.x,y,yaw:0},index);
  close(point.position[0],340);
  close(point.position[1],a.svgY+(y-a.y)*(b.svgY-a.svgY)/(b.y-a.y));
 }
 const home=projectPose(robot.home,index);
 close(home.position[0],110,index===0?1e-6:25);
 close(home.position[1],index===0?700:795,7);
}
assert.notEqual(config.calibration.robots[0].knots[0].y,config.calibration.robots[1].knots[0].y);

// 직선 통로의 네 방향과 비등방/휘어진 통로 보정에서의 방향을 확인합니다.
for(const [yaw,heading] of [[0,90],[Math.PI/2,0],[Math.PI,270],[-Math.PI/2,180]])
 closeHeading(projectPose({x:.42,y:-.1,yaw},0).heading,heading);
const calibration=config.calibration;
const scaleX=(340-110)/(calibration.robots[0].knots[2].x-calibration.robots[0].home.x);
const scaleY=(700-750)/(.036671807-(-.193328193));
const diagonal=projectPose({x:.42,y:-.1,yaw:Math.PI/4},0);
closeHeading(diagonal.heading,Math.atan2(scaleX,-scaleY)*180/Math.PI);
assert.ok(Math.abs(diagonal.heading-45)>10,'conceptual map distortion changes the rendered direction');
const a=calibration.robots[0].knots[2],b=calibration.robots[0].knots[3];
const north=projectPose({x:.45,y:.15,yaw:Math.PI/2},0);
const dx=-(b.x-a.x)/(b.y-a.y)*scaleX,dy=(b.svgY-a.svgY)/(b.y-a.y);
closeHeading(north.heading,Math.atan2(dx,-dy)*180/Math.PI);

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
console.log('PASS: per-robot waypoint/home calibration, extrapolation, projected heading, pose freshness/validation and browser exports.');
