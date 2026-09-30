# Host 공정 관리 담당

상태: 구현 필요. 기존 web/host/server.py는 HTTP 시뮬레이션 시험용으로, 이 노드를 대신하지 않습니다.

1. config/system-config.json 로딩·검증 후 장치별 Action Client 구성.
2. 주문·제품·작업·시도·장치 세션 저장. 작업 상태 QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED/UNKNOWN 구분.
3. Goal 수락, STARTED, Feedback, Result를 구분해 처리.
4. SUCCEEDED + success + 식별자 일치 + result_equals 완료 증거를 검증.
5. requires_all과 제품별 분기, 장치/지그/통로 소유권을 확인해 다음 작업 배정. when 문자열을 eval하지 말고 명시적 분기로 구현.
6. 운송 잔여는 DELIVERY_STARTED, 완제품 잔여는 PALLETIZED에 제품별 한 번만 집계.
7. heartbeat 유실·timeout·실패·취소 시 관련 다음 작업 보류. 재접속은 get_task 조회·상태 대조 후 운영자 재개.
8. 웹으로 카운트·현재 작업·조건별 상태·미완료/실패 이유 전송. 단계별 버튼도 조건 검사를 우회하지 않음.

제출물: 실행 노드, config 로더 연결, 상태 저장·로그, mock 기반 시험. 합격: 1/2/3개 주문 정상 완료, 중복 결과 한 번 집계, 모르는 결과·재시작 전 결과로 다음 명령 금지. 실물 시연 전 장치별 완료 증거 판정 수단을 확인합니다.

실제 보드로 교체할 때는 [실물 전환 안내](../REAL_ROBOT_SETUP.md)를 함께 확인하세요.

도킹 위치의 10cm 후진·180도 회전은 버거의 MOVE_TO 내부 처리입니다. Host는 cmd_vel을 발행하거나 출차 단계마다 새 명령을 보내지 않습니다. [주행 정책](../NAVIGATION_POLICY.md) 참고.
