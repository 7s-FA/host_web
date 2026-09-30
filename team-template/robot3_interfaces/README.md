# 공통 인터페이스 담당

상태: 명세만 제공. ROS 패키지와 메시지 파일을 구현해야 합니다.

- `robot3_interfaces/action/ExecuteTask`: Goal/Feedback/Result 공통 정의.
- Goal: protocol_version, message_id, host_session_id, expected_device_boot_id, order_id, task_id, attempt, product_no, product_type, command, target_station, part_count 및 지도/레시피 버전.
- Result: 세션·작업 식별자, success, result_code, started/start_event_id, station_id, actual_part_count, stopped, dock_verified, arm_clear, position_verified, inspection.
- Feedback: task_id/attempt/device_boot_id, phase, progress, completed_parts, detail.
- 메시지: DeviceState, TaskEvent, Heartbeat, OrderState.
- 서비스: DeviceControl(BIND_SESSION/HOLD/RESET), GetTask(실행 상태·저장 결과 조회).

간단한 설명의 target/error_code와 실제 v1의 target_station/result_code를 혼용하지 않습니다. config/system-config.json은 명령 이름과 판정 조건을 정의하고 실제 전송 타입은 이 패키지가 정의합니다.

제출물: package.xml·빌드 파일·인터페이스 파일·필드 설명. 합격: 전체 보드가 같은 버전으로 빌드하고 동일 Action 타입으로 요청/결과를 교환.
