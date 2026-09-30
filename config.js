/* 유지보수용 기본 설정. 관리자에서 내보낸 config.js로 교체할 수 있습니다.
 * 이동 값은 기존 시뮬레이션 대비 속도 배율이며 실제 로봇 m/s가 아닙니다.
 * Host 적용: node host/build_scenarios.cjs 실행 후 Python 서버 재시작.
 */
(function(root){
 const config={
  version:1,
  burger1:{forwardSpeed:1,reverseSpeed:1,turnSpeed:90},
  burger2:{forwardSpeed:1,reverseSpeed:1,turnSpeed:90},
  process:{loadPartSeconds:1.5,assemblySeconds:6,linearPrepareSeconds:3,linearHomeSeconds:2,palletSeconds:3}
 };
 if(typeof module!=='undefined'&&module.exports)module.exports=config;
 else root.SIMULATION_CONFIG=config;
})(typeof window!=='undefined'?window:globalThis);
