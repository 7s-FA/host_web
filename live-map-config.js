/* 실제 map 좌표를 기존 공정 개념도에 맞추는 보정값입니다. 실측 정밀도를 보장하지 않습니다.
 * 출처: 로컬 AMR commit 6e7b69d의 M1/M2/config/waypoints.yaml 및
 * M1/M2/config/nav2.yaml의 amcl.ros__parameters.initial_pose.
 * 로봇별 waypoint 좌표가 다르므로 각각 보정합니다. SVG 기준점은 engine.js WAYPOINTS입니다.
 */
(function(root){
 'use strict';
 const config={
  url:'ws://localhost:9090',
  robotTopics:['burger1','burger2'],
  poseMaxAgeMs:3000,
  interpolationMs:200,
  calibration:{
   aisleSvgX:340,
   homeSvgX:110,
   robots:[
    {
     home:{x:0.020379762326882656,y:0.009640953270041441,yaw:3.1353725330574638},
     // map y 오름차순: WP4, WP3, WP1, WP2.
     knots:[
      {x:0.42062385,y:-0.348328193,svgY:795},
      {x:0.42062385,y:-0.193328193,svgY:750},
      {x:0.42062385,y:0.036671807,svgY:700},
      {x:0.46906513,y:0.320654172,svgY:500}
     ]
    },
    {
     home:{x:0.008258599567777303,y:-0.344867488367798,yaw:3.138493403842874},
     knots:[
      {x:0.45062385,y:-0.368328193,svgY:795},
      {x:0.45062385,y:-0.208328193,svgY:750},
      {x:0.45062385,y:0.036671807,svgY:700},
      {x:0.46906513,y:0.320654172,svgY:500}
     ]
    }
   ]
  }
 };
 if(typeof module!=='undefined'&&module.exports)module.exports=config;
 else root.LIVE_MAP_CONFIG=config;
})(typeof window!=='undefined'?window:globalThis);
