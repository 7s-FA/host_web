# 가짜 장치 담당

상태: 구현 필요. 모터 제어 없이 실제 ROS Action 송수신을 시험할 5개 서버를 구현합니다.

| 서버 | 지원 명령 |
| --- | --- |
| burger1, burger2 | MOVE_TO |
| arm1 | LOAD_PARTS |
| arm2 | ASSEMBLE |
| arm3 | LINEAR_PREPARE, LINEAR_HOME, PALLETIZE |

config의 주소와 공통 ExecuteTask 타입을 사용합니다. Goal 수락 → STARTED/Feedback → 설정된 완료 증거 Result를 보냅니다. 각 장치 heartbeat/state/get_task/control도 단계적으로 구현합니다.

시험 옵션: 정상, 거부, 실패, 지연, 결과 유실, 중복 이벤트, 재시작, heartbeat 중단. 설정된 실패를 success로 보고하지 않습니다. arm3는 리니어/팔 작업을 직렬 실행합니다.

제출물: 장치별 또는 파라미터 기반 mock 노드와 실행 방법. 합격: ROS_DOMAIN_ID=40에서 Host가 5개 서버와 실제 Action 왕복을 하고 오류 주입에 맞게 진행을 보류.

실제 보드로 교체할 때는 [실물 전환 안내](../REAL_ROBOT_SETUP.md)를 함께 확인하세요.
