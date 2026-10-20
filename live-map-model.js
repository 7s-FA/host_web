/* map→동일 축척 지도 투영만 수행합니다. 상태 저장, 보간 타이머, ROS 연결은 화면에서 관리합니다. */
(function(root){
 'use strict';
 const config=typeof module!=='undefined'&&module.exports?require('./live-map-config.js'):root.LIVE_MAP_CONFIG;
 const metric=config.metric;
 const scale=metric.pixelsPerMeter;
 const bounds={minX:metric.origin[0],minY:metric.origin[1],
  maxX:metric.origin[0]+metric.width*metric.resolution,
  maxY:metric.origin[1]+metric.height*metric.resolution};
 const viewBox=metric.viewBox;
 function projectPoint(x,y){
  return [metric.svgOrigin[0]+x*scale,metric.svgOrigin[1]-y*scale];
 }
 const topLeft=projectPoint(bounds.minX,bounds.maxY),bottomRight=projectPoint(bounds.maxX,bounds.minY);
 const fullViewBox=[Math.min(0,topLeft[0]-50),Math.min(0,topLeft[1]-50),0,0];
 fullViewBox[2]=Math.max(viewBox[2],bottomRight[0]+50)-fullViewBox[0];
 fullViewBox[3]=Math.max(viewBox[3],bottomRight[1]+50)-fullViewBox[1];
 // Equal scale for both axes: map x east, map y north; SVG y points down.
 function projectPose(pose,index){
  if(!Number.isInteger(index)||index<0||index>=config.robotTopics.length||
     !pose||![pose.x,pose.y,pose.yaw].every(Number.isFinite))return null;
  const position=projectPoint(pose.x,pose.y);
  if(!position.every(Number.isFinite))return null;
  return {position,heading:((90-pose.yaw*180/Math.PI)%360+360)%360};
 }

 // ROS PoseWithCovarianceStamped를 검사합니다. stamp는 epoch milliseconds입니다.
 function parsePose(message,index,nowMs,{allowStale=false}={}){
  if(!Number.isInteger(index)||index<0||index>=config.robotTopics.length||!Number.isFinite(nowMs))return null;
  const header=message?.header,pose=message?.pose?.pose;
  if(!header||!['map',config.robotTopics[index]+'/map'].includes(header.frame_id)||!pose)return null;
  const sec=header.stamp?.sec,nanosec=header.stamp?.nanosec;
  if(!Number.isInteger(sec)||sec<0||sec>2147483647||!Number.isInteger(nanosec)||nanosec<0||nanosec>=1e9)return null;
  const stamp=sec*1000+nanosec/1e6;
  if(stamp<=0||(!allowStale&&nowMs-stamp>config.poseMaxAgeMs)||stamp-nowMs>1000)return null;
  const x=pose.position?.x,y=pose.position?.y,q=pose.orientation;
  if(!q||![x,y,q.x,q.y,q.z,q.w].every(Number.isFinite))return null;
  const norm=Math.hypot(q.x,q.y,q.z,q.w);
  if(norm<0.9||norm>1.1)return null;
  const qx=q.x/norm,qy=q.y/norm,qz=q.z/norm,qw=q.w/norm;
  const yaw=Math.atan2(2*(qw*qz+qx*qy),1-2*(qy*qy+qz*qz));
  const projected=projectPose({x,y,yaw},index);
  const withinMap=x>=bounds.minX&&x<=bounds.maxX&&y>=bounds.minY&&y<=bounds.maxY;
  return projected?{...projected,stamp,world:{x,y,yaw},withinMap,withinCalibration:withinMap}:null;
 }

 const api={projectPose,parsePose,projectPoint,bounds,viewBox,fullViewBox};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.LiveMapModel=api;
})(typeof window!=='undefined'?window:globalThis);
