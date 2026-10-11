/* map→개념도 투영만 수행합니다. 상태 저장, 보간 타이머, ROS 연결은 화면에서 관리합니다. */
(function(root){
 'use strict';
 const config=typeof module!=='undefined'&&module.exports?require('./live-map-config.js'):root.LIVE_MAP_CONFIG;
 const calibration=config.calibration;
 const scaleX=(calibration.aisleSvgX-calibration.homeSvgX)/
  (calibration.robots[0].knots[2].x-calibration.robots[0].home.x);

 function projectPoint(x,y,index){
  const knots=calibration.robots[index].knots;
  let segment=0;
  while(segment<knots.length-2&&y>knots[segment+1].y)segment++;
  const a=knots[segment],b=knots[segment+1],fraction=(y-a.y)/(b.y-a.y);
  const svgY=a.svgY+fraction*(b.svgY-a.svgY);
  const aisleX=y<=knots[0].y?knots[0].x:y>=knots.at(-1).y?knots.at(-1).x:a.x+fraction*(b.x-a.x);
  return [calibration.aisleSvgX+(x-aisleX)*scaleX,svgY];
 }

 // x/y는 map의 m, yaw는 rad. SVG heading은 위쪽 0°, 시계방향입니다.
 function projectPose(pose,index){
  if(!Number.isInteger(index)||index<0||index>=calibration.robots.length||
     !pose||![pose.x,pose.y,pose.yaw].every(Number.isFinite))return null;
  const position=projectPoint(pose.x,pose.y,index),epsilon=1e-5;
  const forward=projectPoint(pose.x+epsilon*Math.cos(pose.yaw),pose.y+epsilon*Math.sin(pose.yaw),index);
  const dx=forward[0]-position[0],dy=forward[1]-position[1];
  if(![...position,dx,dy].every(Number.isFinite)||Math.hypot(dx,dy)===0)return null;
  const heading=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
  return {position,heading};
 }

 // ROS PoseWithCovarianceStamped를 검사합니다. stamp는 epoch milliseconds입니다.
 function parsePose(message,index,nowMs){
  if(!Number.isInteger(index)||index<0||index>=config.robotTopics.length||!Number.isFinite(nowMs))return null;
  const header=message?.header,pose=message?.pose?.pose;
  if(!header||!['map',config.robotTopics[index]+'/map'].includes(header.frame_id)||!pose)return null;
  const sec=header.stamp?.sec,nanosec=header.stamp?.nanosec;
  if(!Number.isInteger(sec)||sec<0||sec>2147483647||!Number.isInteger(nanosec)||nanosec<0||nanosec>=1e9)return null;
  const stamp=sec*1000+nanosec/1e6;
  if(stamp<=0||nowMs-stamp>config.poseMaxAgeMs||stamp-nowMs>1000)return null;
  const x=pose.position?.x,y=pose.position?.y,q=pose.orientation;
  if(!q||![x,y,q.x,q.y,q.z,q.w].every(Number.isFinite))return null;
  const norm=Math.hypot(q.x,q.y,q.z,q.w);
  if(norm<0.9||norm>1.1)return null;
  const qx=q.x/norm,qy=q.y/norm,qz=q.z/norm,qw=q.w/norm;
  const yaw=Math.atan2(2*(qw*qz+qx*qy),1-2*(qy*qy+qz*qz));
  const projected=projectPose({x,y,yaw},index);
  return projected?{...projected,stamp}:null;
 }

 const api={projectPose,parsePose};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.LiveMapModel=api;
})(typeof window!=='undefined'?window:globalThis);
