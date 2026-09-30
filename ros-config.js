/* 웹 → ROS 상태 송신 시험 설정. 수정 후 브라우저를 새로고침하세요.
 * 관리자 config.js 내보내기와 별도로 유지됩니다.
 * ROS_DOMAIN_ID=40은 rosbridge를 실행하는 터미널에서 설정합니다.
 */
window.ROS_BRIDGE_CONFIG={
 enabled:true,
 localOnly:true, // 기본: localhost/127.0.0.1의 HTTP 웹에서만 연결
 url:'ws://localhost:9090',
 topic:'/web_to_ros',
 messageType:'std_msgs/msg/String',
 publishIntervalMs:200 // 0.2초마다 화면 상태 송신 (주문 명령 아님)
};
