# Host 시스템 설정 — system-config.json

시뮬레이션 속도는 `config.js`, **주문·장치 통신·명령·완료 확인·다음 작업 규칙은 `system-config.json`**에서 관리합니다. 실제 ROS 2 Action 클라이언트와 공정 스케줄러는 아직 구현 전입니다.

## 어디를 수정하나

| 항목 | JSON 경로 | 예시 | 현재 적용 상태 |
| --- | --- | --- | --- |
| 기본 주문 수량 | `order.quantity_default` | 2 | 웹·HTTP Host 적용 |
| 최소/최대 주문 수량 | `order.quantity_min`, `order.quantity_max` | 1, 20 | 웹 입력 및 Host 서버 검증 적용 |
| 자동/단계별 초기값 | `order.auto_advance_default` | false | Host 시작 시 적용 |
| 제품·부품 개수 | `order.product_type`, `order.parts_per_product` | A, 3 | 현재 엔진 제약. A·3 외에는 검증 실패 |
| Host 웹 포트 | `web_host.port` | 8082 | 서버 실행 시 적용. `--port`가 우선 |
| 브라우저 응답 제한시간 | `web_host.browser_timeout_seconds` | 5 | Host가 무응답 시 일시정지하는 기준 |
| ROS 도메인·타입 | `ros2.domain_id`, `ros2.action_type` | 40, robot3_interfaces/action/ExecuteTask | ROS 실행부 연결 예정 |
| 상태·생존 신호 | `ros2` 내 topic, heartbeat, timeout | 2Hz / 3초 | ROS 실행부 연결 예정, 실측 전 제안값 |
| 장치별 주소 | `devices.burger1.action_name` 등 | /burger1/execute_task | ROS 실행부 연결 예정 |
| 작업별 제한시간 | `commands.MOVE_TO.execution_timeout_seconds` 등 | 120초 | ROS 실행부 연결 예정, 실측 전 제안값 |
| 완료 판정 | `commands.LOAD_PARTS.result_equals` 등 | 적재 3개·PASS·팔 이탈 | ROS 결과 검증부 연결 예정 |
| 체크 항목 문구 | `conditions.<id>.label` | 앞 버거 대기 주차 완료 | ROS 기반 웹 상태 표시 연결 예정 |
| 다음 작업 선행 조건 | `transitions.<id>.requires_all` | 조건 ID 배열 | ROS 스케줄러 연결 예정 |
| 카운트 변경 이벤트 | `counters` | DELIVERY_STARTED / PALLETIZED | ROS 이벤트 집계 연결 예정 |

현재 시뮬레이션의 빨강/초록 표시는 엔진의 모의 이벤트를 사용합니다. `conditions`나 `transitions`를 수정한다고 기존 시뮬레이션 경로·공정 순서가 바뀌지는 않습니다. 실제 ROS 실행부에서 이 설정을 읽도록 구현할 때 연결해야 합니다. 설정 파일을 만들었다고 실제 로봇이 연결되거나 동작하지는 않습니다.

## 예시 1: 주문은 기본 3개, 최대 10개

`order`에서 다음 값을 변경합니다. 나머지 필드는 유지하세요.

```json
"quantity_min": 1,
"quantity_max": 10,
"quantity_default": 3
```

현재 지원 범위는 1~20개입니다. 최대 수량을 20보다 크게 하려면 엔진·시간표·테스트의 지원 범위를 먼저 확장해야 합니다.

## 예시 2: 버거1의 ROS Action 주소 변경

```json
"action_name": "/burger1/execute_task"
```

`devices.burger1` 안에서 수정합니다. 장치 쪽 Action Server와 Host Client가 같은 이름·타입을 사용해야 합니다. ROS 2는 DDS 통신이므로 이 설정에서 장치별 TCP 포트를 임의로 배정하지 않습니다. `web_host.port`는 브라우저용 HTTP 포트입니다.

## 예시 3: 적재 완료 판정

```json
"result_equals": {
  "success": true,
  "actual_part_count": "$order.parts_per_product",
  "inspection": "PASS",
  "arm_clear": true
}
```

`commands.LOAD_PARTS`의 설정입니다. `$order.parts_per_product`는 설정된 부품 수 3을 뜻합니다. MOVE_TO의 `$goal.target_station`은 이번 명령의 목적지와 완료 보고 위치가 같은지 확인하라는 뜻입니다.

실제 Host는 위 조건 외에도 Action 상태 SUCCEEDED와 현재 order_id/task_id/attempt/host_session_id/device_boot_id 일치를 확인해야 합니다. 수락 응답·Feedback 100%는 완료가 아니며 같은 결과는 한 번만 집계합니다.

## 예시 4: 다음 버거의 공정 출발 조건

```json
"next_delivery": {
  "requires_all": [
    "loaded_and_arm1_clear",
    "previous_palletized",
    "previous_burger_waiting"
  ],
  "device": "$current_burger",
  "command": "MOVE_TO",
  "target": "ASSEMBLY"
}
```

부품 적재·팔1 이탈, 앞 제품 파렛트 완료, 앞 버거 대기 주차가 모두 완료돼야 출발합니다. 실제 실행에서는 장치 준비·통로/자원 사용 가능 조건도 확인해야 합니다.

`$current_burger`, `$next_burger`, `$other_burger`는 Host가 제품별 담당 버거로 해석할 자리입니다. LOAD_PARTS의 `$current_burger` target은 BURGER1 또는 BURGER2로 변환합니다. 조건은 전역 bool로 계속 유지하지 않고 해당 주문·제품·작업의 유효한 결과에 묶어 관리해야 합니다.

`when`은 분기 의도를 설명하는 선언입니다. 실행 코드나 Python eval 대상이 아닙니다. 실제 스케줄러에서는 아래 분기를 명시적으로 구현해야 합니다.

- `quantity >= 2 and product_no == 1`: 첫 버거 창고 도착 시 버거2 대기 출발
- `has_next_product`: 현재 제품 뒤에 다음 제품이 있음
- `quantity >= 2 and final_delivery`: 마지막 운송 도킹 후 다른 버거 복귀
- `final_product`: 마지막 제품 조립 후 해당 버거 복귀

1개 주문·첫 제품·마지막 제품의 예외, 초기 HOME 확인, 통로 점유와 실패/취소/재시작 처리는 스케줄러가 담당합니다. 파일 자체는 완성된 실행 스케줄러가 아닙니다.

## 적용 방법

프로젝트 루트에서:

```bash
# 1. JSON 설정 수정 후 구조·범위 검증 및 공개 웹 수량 정책 생성
python3 host/system_config.py --write-web-policy

# 2. 로컬 Host 서버를 종료한 뒤 다시 실행
python3 host/server.py
```

- Host는 시작 시 `system-config.json`을 읽습니다. 실행 중 파일 수정은 기존 주문에 반영하지 않습니다.
- 로컬 웹은 서버에서 수량 정책을 받아 사용합니다. 공개 웹은 생성된 `system-policy.js`를 사용합니다.
- `system-policy.js`는 생성 파일이므로 직접 수정하지 않습니다. GitHub 배포에서도 자동 생성합니다.
- 공개 기본값 변경은 JSON 수정·커밋·배포가 필요합니다. 관리자 페이지에서 파일 다운로드 링크를 제공합니다.
- ROS 관련 값은 아직 실행부 미연결 상태입니다. 기존 HTTP ACK를 실제 장치 완료 Result로 혼동하지 않습니다.
- 기존 `config.js`의 시뮬레이션 속도 변경 절차는 `CONFIG_GUIDE.md`를 참고하세요.

## 초기 출차·전진 주행 정책 (2026-09-29 변경)

`navigation.dock_departure.backup_distance_m=0.1`, `rotate_degrees=180`: HOME·WAREHOUSE·ASSEMBLY·WAITING에서 로컬 cmd_vel 10cm 후진·정지 후 180도 회전·정지, 그다음 Nav2 전진 이동. `travel_mode=NAV2_FORWARD_ONLY`, `waiting_parking=FORWARD_REAR_IR`입니다. 실제 버거 실행부 연결 예정이며 Host가 cmd_vel을 직접 보내는 설정이 아닙니다. 거리·회전은 odometry/IMU로 확인하고 로컬 속도는 버거 보드에서 실측 설정합니다. 팀 ZIP의 NAVIGATION_POLICY.md 참고.
