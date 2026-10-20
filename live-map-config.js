/* M1/M2 로봇 적용 지도와 SHA256 일치 확인: 2026-10-19.
 * 39 × 76 cells, 0.05 m/cell, origin [-0.328, -2.195, 0].
 * factory_map.pgm SHA256: 7e1fb385deea9b8413880f6b6676706337666ae85ee24cd1e1cf417c39784a46
 * 로봇·경유점은 동일 축척으로 표시하고 설비 그림은 기존 배치도 표시용입니다.
 */
(function(root){
 'use strict';
 const config={
  url:'ws://localhost:9090',
  robotTopics:['burger1','burger2'],
  poseMaxAgeMs:3000,
  interpolationMs:200,
  metric:{image:'assets/metric-map/factory-map.png',resolution:0.05,width:39,height:76,
   origin:[-0.328,-2.195,0],pixelsPerMeter:480,
   svgOrigin:[110,700],viewBox:[0,0,720,1120]},
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
      {x:0.46813,y:0.390648,svgY:500}
     ]
    },
    {
     home:{x:0.008258599567777303,y:-0.344867488367798,yaw:3.138493403842874},
     knots:[
      {x:0.45062385,y:-0.368328193,svgY:795},
      {x:0.45062385,y:-0.208328193,svgY:750},
      {x:0.45062385,y:0.036671807,svgY:700},
      {x:0.46813,y:0.390648,svgY:500}
     ]
    }
   ]
  }
 };
 if(typeof module!=='undefined'&&module.exports)module.exports=config;
 else root.LIVE_MAP_CONFIG=config;
})(typeof window!=='undefined'?window:globalThis);
