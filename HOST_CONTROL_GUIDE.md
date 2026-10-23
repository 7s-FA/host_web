# Host PC 실장치 관제 연결

`control.html`은 **M1·M2·자재창고·제작공정** 네 단위의 Host 보고 상태를 표시합니다. 제작공정은 로봇팔 2·3, 리니어와 카메라 상태를 통합한 단위입니다. 지도·시뮬레이션 엔진의 경과시간과 브라우저 ACK를 사용하지 않습니다. 공개 사이트에서는 미연결 안내가 정상입니다. Host PC에서 `python3 host/server.py`를 실행하고 `http://127.0.0.1:8082/control.html`을 엽니다. 다운로드 ZIP에서는 `robot3_host/`에서 `python3 web/host/server.py`를 실행합니다.

통합 폴더의 `host_backend`가 로컬 API와 ROS Action을 연결합니다. `bash /home/operator/final_project/start_host.sh --mock`로 먼저 모의 실행하고, 옵션 없이 실행하면 실물 Domain 40을 사용합니다. 다섯 장치 서버가 검색되면 주문을 받을 수 있으며 초기 배치는 현장에서 확인해야 합니다. **자동 진행**을 끄면 매 Action 완료 후 다음 단계 버튼으로 진행합니다. **단계 후 일시정지**는 현재 동작 완료 후 적용되며 즉시 정지가 아닙니다. 팔3 LOAD_A/B 성공과 마지막 운송로봇 복귀까지 확인해야 주문 완료입니다. M1·M2의 **정지·정지 해제와 배터리 수신**은 별도 rosbridge 연결을 사용합니다. 기존 `/?host=1`은 웹 시뮬레이션 ACK 시험으로, 실장치 관제와 별개입니다.

관제에서는 **A제품/B제품**, 수량 **1개/2개**를 버튼으로 선택한 뒤 **주문 시작**을 누릅니다. 각 장치와 Host의 **로그** 버튼은 해당 기록을 작은 팝업으로 엽니다. 통신이 끊겨도 마지막으로 받은 로그는 확인할 수 있으며, 현재 상태나 최신 기록으로 간주하지 않습니다.

메인 공정 시뮬레이션도 같은 **A제품/B제품·1개/2개** 버튼을 사용합니다. 선택한 제품은 주문·지그·이벤트·기록에 반영되며, 두 제품은 같은 설명용 이동 경로와 시간을 사용합니다. 실제 B제품 동작을 보정한 것은 아닙니다. 메인 화면의 **로봇 제어 ↗**는 준비된 버거에 개별 Action을 요청하는 별도 패널이며, 이 문서의 자동 공정용 관제 API와 구분합니다.

## 장치 연결 표시등

메인 화면과 관제의 연결 표시등은 rosbridge에서 직접 확인하므로, 주문·작업 로그용 HTTP Host 어댑터 없이도 동작합니다. HTTP `localhost`·`127.0.0.1`에서만 연결하며 공개 사이트에서는 **Host PC에서 확인**으로 표시합니다. 초록은 연결 확인, 노랑은 일부 연결·확인 불가, 빨강은 연결 끊김, 회색은 최초 확인 대기입니다.

`device-connection-client.js`는 `/ros_to_web`의 유효한 Host 메시지를 구독하고, `/host/device_discovery`의 0.5초 주기 발행자 목록을 구독해 `/M1/data/_action/status`, `/M2/data/_action/status`, `/arm1/data/_action/status`, `/arm2/data/_action/status`, `/arm3/data/_action/status`의 발행자를 확인합니다. 발행 시각 기준 3초가 지난 목록과 3초 이상 끊긴 Host 수신은 유효하지 않습니다. 웹은 장치별 서비스 요청을 반복하지 않습니다. 응답 누락·실패는 **확인 불가**, 빈 발행자 목록은 **연결 끊김**이며 WebSocket 연결만으로 장치 표시등을 켜지 않습니다. 다시 연결돼도 새 확인 전까지 이전 초록 표시를 복구하지 않습니다.

자재창고는 로봇팔 1, 제작공정은 로봇팔 2·3 모두의 제어 서버를 확인해야 초록입니다. 한쪽만 연결되면 **일부 연결**입니다. 리니어·카메라 개별 상태, 장치 작업 성공, 다음 공정 진행 가능 여부는 이 표시등으로 판정하지 않습니다. Host 표시등도 `/ros_to_web` 수신 여부이며 전체 제어기 정상 동작을 보증하지 않습니다.

## 실패 주문 초기화

호스트 터미널의 `hostreset` 또는 웹의 **실패 주문 초기화**를 사용합니다. 모든 장치 연결과 실패 주문 상태를 확인하고, 작업 종료·로봇/리니어 정지·초기 배치/자재 복구를 운영자가 확인해야 합니다. 미확인 작업이 남아 있으면 해당 장치의 `EMER_STOP` 성공·`IDLE` 응답 후 초기화하며, 응답이 없으면 실패 주문을 유지합니다. 접수 여부가 미확인된 진행 지시는 초기화할 수 없습니다. 실패 기록은 `.runtime/host/order-history/`에 보관합니다. 초기화는 이동·모터 활성화·정지 잠금 해제·좌표 설정을 수행하지 않습니다.

## M1·M2 실물 정지 Action

메인 화면의 데모·실물 모드와 `control.html`의 **M1 정지·M2 정지**는 `robot-stop-client.js`의 `RobotStopClient`와 `robot-stop.js`를 사용합니다. HTTP `localhost`·`127.0.0.1`에서 rosbridge에 연결되면 사용할 수 있고 공개 사이트에서는 비활성화됩니다. HTTP Host 어댑터 미연결·명령 처리 중·오래된 장치 보고는 정지 요청을 막지 않습니다. 정지·해제는 HTTP 명령 대기열을 거치지 않으며 `/api/live/stop` API는 없습니다.

기존 로봇 제어 패널과 같은 rosbridge Action 계약입니다. M2는 `action`을 `/M2/data`로 바꿉니다.

```json
{
  "op": "send_action_goal",
  "id": "요청별 고유 ID",
  "action": "/M1/data",
  "action_type": "host_pkg/action/Burger",
  "args": {"command": "EMER_STOP", "cmd_val": 0},
  "feedback": true
}
```

M1·M2의 대기 요청과 결과는 독립적으로 관리하며 응답의 `id`를 해당 요청과 맞춥니다. **정지 확인**은 최종 `action_result`의 `result=true`, `status=4`, `values.success=true`, `values.message="IDLE"`가 모두 맞을 때만 표시합니다. Feedback의 `IDLE`이나 WebSocket 연결만으로 성공 처리하지 않습니다. 결과가 10초 안에 오지 않거나 오류·연결 끊김이 발생하면 **정지 여부 미확인**으로 표시합니다. 로봇이 정지 잠금을 걸었어도 최신 odom으로 정지를 확인하지 못하면 `ERROR`를 반환할 수 있습니다. 재연결 시 요청을 자동 재전송하지 않고, `RESTART`도 자동 전송하지 않습니다.

**M1 정지 해제·M2 정지 해제**는 위 요청의 `args`를 `{"command":"RESTART","cmd_val":0}`으로 바꿉니다. 버튼은 해당 로봇의 `/burger1/motion_owner/communication_status` 또는 `/burger2/motion_owner/communication_status`가 최근 3.5초 이내에 수신되고, 실행 중 임무와 대기 요청이 없을 때만 활성화됩니다. AMR도 이동 목표가 실행 중이면 해제를 거부하고 최신 odom으로 정지를 확인한 뒤 잠금을 해제합니다. 해제 역시 요청 ID가 일치하는 위의 최종 `IDLE` 성공 조건을 모두 만족해야 **정지 해제 확인**이며, timeout·오류·연결 끊김은 **해제 여부 미확인**입니다. `RESTART`는 사용자가 누를 때만 보내고 자동 전송·재전송하지 않습니다.

정지는 선택한 로봇에 적용됩니다. 새 Host 제어기는 중단된 작업의 실패/취소 결과를 받으면 주문을 실패로 고정하고 다음 이동을 자동 요청하지 않습니다. 관제의 일시정지·재개는 현재 작업 완료 경계에서 동작하므로 AMR의 RESTART 명령과 다릅니다. 실패 주문은 장비·초기 배치를 복구한 후 별도로 정리해야 합니다.

## M1·M2 배터리 수신

메인 데모·실물 보기·Host 관제·기존 로봇 제어 패널에서 rosbridge로 다음 토픽을 구독합니다. HTTP Host 어댑터는 필요하지 않으며, HTTP `localhost`·`127.0.0.1`에서 사용합니다. 공개 사이트에서는 로컬 연결 안내를 표시합니다.

| 로봇 | 토픽 | 메시지 |
| --- | --- | --- |
| M1 | `/burger1/battery_state` | `sensor_msgs/msg/BatteryState` |
| M2 | `/burger2/battery_state` | `sensor_msgs/msg/BatteryState` |

표시 값은 `voltage`(V)와 **추정 잔량**이며 계산식은 `clamp((voltage - 10.5) / (12.3 - 10.5) * 100, 0, 100)`입니다. [공식 OpenCR의 전압 기반 계산](https://github.com/ROBOTIS-GIT/OpenCR/blob/master/arduino/opencr_arduino/opencr/libraries/turtlebot3_ros2/src/turtlebot3/turtlebot3.cpp)을 따른 추정치입니다. ROS 표준의 `percentage`는 0~1이지만, 공식 펌웨어와 [TurtleBot3 드라이버](https://github.com/ROBOTIS-GIT/turtlebot3/blob/main/turtlebot3_node/src/sensors/battery_state.cpp) 조합은 0~100을 보낼 수 있어 이 필드는 사용하지 않습니다. 실제 장치의 펌웨어 버전과 전압 측정은 현장에서 확인해야 합니다.

5초 이상 새 값이 없거나 rosbridge가 끊기면 마지막 값을 오래된 값으로 구분합니다. 첫 수신 전·비정상 전압·배터리 미감지 상태는 미확인으로 표시하며, 0%로 대체하지 않습니다. 전압으로 충전 중 여부를 추측하지 않습니다. 배터리 수신은 제어 명령을 보내지 않습니다.

## Host 어댑터 연결 계약

1. 통합 실행기는 `ROBOT3_BRIDGE_TOKEN`을 실행마다 생성하여 웹 서버와 어댑터에 함께 전달합니다. 단독 실행 시에는 양쪽에 같은 임의 토큰을 설정합니다. 토큰은 브라우저로 보내지 않습니다.
2. ROS 2 어댑터가 `GET /api/live/commands`를 `X-Bridge-Token` 헤더와 함께 주기적으로 조회합니다. `start`, `next`, `pause`, `resume` 지시의 `id`를 수신합니다.
3. 어댑터가 장치별 Action Goal/Feedback/Result, heartbeat, 완료 증거, 주문·제품·작업 ID와 선행 조건을 검증합니다. 수락한 명령 ID를 `accepted_command_ids`에 넣어 `POST /api/live/report`로 최신 전체 상태를 보고합니다. `revision`은 서버 실행 중 계속 증가해야 합니다.
4. 관제 화면은 `GET /api/live/state`를 1초마다 읽습니다. 보고가 `ros2.heartbeat_timeout_seconds`(기본 3초) 동안 없으면 연결 끊김으로 바뀌고 다음 지시를 막습니다.

## 주문과 상태 형식

관제의 `POST /api/live/start` 요청은 제품과 수량을 함께 보냅니다.

```json
{"product_type": "B", "quantity": 2, "auto_advance": true}
```

`product_type`은 `A` 또는 `B`, `quantity`는 정수 `1` 또는 `2`입니다. 이전 클라이언트를 위해 주문 요청에서 `product_type`을 생략하면 `A`로 처리합니다. 어댑터가 받는 `start` 지시에도 선택한 제품과 수량이 포함되며, B제품 공정의 실행·완료 검증은 어댑터가 구현해야 합니다.

`devices`에는 아래 네 키가 모두 필요합니다. 제작공정의 내부 장치 상태를 취합해 대표 상태와 세부 내용·로그를 만드는 책임은 Host 어댑터에 있습니다.

| 키 | 관제 표시 | 보고 범위 |
| --- | --- | --- |
| `M1` | M1 | 버거 1 |
| `M2` | M2 | 버거 2 |
| `warehouse` | 자재창고 | 자재창고 상태 |
| `production` | 제작공정 | 로봇팔 2·3, 리니어, 카메라 통합 상태 |

`POST /api/live/report` 예시의 형태:

```json
{
  "revision": 1,
  "accepted_command_ids": [],
  "devices": {
    "M1": {"state": "idle", "detail": "초기위치", "log": ["M1 준비 완료"]},
    "M2": {"state": "idle", "detail": "초기위치", "log": []},
    "warehouse": {"state": "idle", "detail": "자재창고 준비 완료", "log": []},
    "production": {"state": "idle", "detail": "팔 2·3, 리니어, 카메라 준비 완료", "log": []}
  },
  "order": null,
  "conditions": [],
  "can_advance": false,
  "log": ["Host 어댑터 시작"]
}
```

작업 중 `order`에는 `id`, `status`(`idle/running/waiting/paused/done/failed`), `product_type`(`A` 또는 `B`), `quantity`, `transport_remaining`, `product_remaining`, `completed`, `stage`, `stage_count`가 필요합니다. 주문 보고에서도 `product_type`을 생략하면 `A`로 처리합니다. 장치 `state`는 `offline/idle/running/done/failed/unknown`입니다. `conditions`는 `{ "label": "부품 3개 적재 및 팔 이탈", "done": true }` 형식입니다. **`can_advance=true`는 주문 상태가 `waiting`이고 모든 조건이 참일 때만 허용됩니다.** 단순 Feedback 100%, 타이머, 브라우저 버튼을 성공 Result로 취급하면 안 됩니다.

각 `devices.<키>.log`와 루트의 `log`는 선택 항목인 문자열 배열이며 생략하면 빈 배열로 처리합니다. 루트 `log`는 Host 기록입니다. 보고 배열은 50개 항목을 넘으면 거부하고, 각 문자열은 200자까지 저장합니다. 상태 응답의 Host 로그에는 웹 서버의 실제 지시 대기 기록도 합쳐지므로 최대 100개 항목이 표시될 수 있습니다. 장치별 로그와 Host 로그는 해당 팝업에서 구분해 표시합니다. 보고가 끊기면 장치 상태는 확인 불가로 바뀌고 주문·단계 지시가 보류되며, 마지막으로 수신한 로그는 보존됩니다. M1·M2 정지는 별도 rosbridge 연결 상태에 따릅니다. 이 기록은 서버 메모리에 있으므로 서버 재시작 이후 영구 보존되지는 않습니다.

서버는 `start`의 제품 종류·수량 범위, `next`의 완료 조건, 명령 중복, 보고 revision과 어댑터 토큰을 검사합니다. 수락되지 않은 명령은 대기열에 남으며 다음 명령이 막힙니다. 실제 ROS 명령 전송·완료 판정·오류 복구는 어댑터가 담당합니다. 이 Python 서버의 관제 상태·명령 대기열은 메모리에만 있으므로 서버 재시작 뒤에는 어댑터가 실제 장치·주문 상태를 다시 조회해 보고해야 합니다. 모든 API는 PC의 `127.0.0.1`에만 바인딩됩니다.

설정 위치: `system-config.json`의 장치 Action/상태·heartbeat 주소와 완료 조건, `host/live_control.py`의 관제 경계, `host/server.py`의 HTTP 경로. ZIP에서는 각각 `config/system-config.json`, `web/host/live_control.py`, `web/host/server.py`입니다.

`system-config.json`의 다섯 논리 장비와 공정 규칙은 그대로입니다. 이 관제 API의 네 단위는 화면에 보고할 상태 묶음입니다. 메인 시뮬레이션은 선택한 A·B제품에 같은 설명용 공정 규칙을 사용하며, 실제 제품별 Action 실행과 완료 검증은 Host 어댑터가 담당합니다.

## 현재 어댑터의 추가 필드

`auto_advance`는 주문 시작 시 선택하는 boolean이며 기본 true입니다. 주문 보고의
`pause_requested`, `stage_label`, `fault`로 보류 요청·작업 이름·실패 이유를 표시합니다.
`can_start`는 Host가 새 주문을 받을 수 있는지, `runtime_mode`는 mock/hardware를 나타냅니다.
`controller_id`는 실행별 UUID이고 명령에도 포함됩니다. 어댑터가 교체되면 이전 대기
명령은 폐기하며, `bridge_session` 변경 중의 활성 주문은 실패로 처리합니다.
작업별 UUID와 명령 ID로 지연 결과·중복 지시를 구분합니다. 영구 주문 기록은
최상위 `.runtime/host/order-*.json`에 보관됩니다.

### 실패 단계부터 재시도

장치가 모두 멈추고 현재 위치·자재 상태를 확인한 뒤 해당 장치의 **오류 초기화**(M1/M2는 **이동 초기화**)를 누릅니다. 장치 오류만 해제하고 주문의 실패 단계·완료 수량은 유지합니다. **다음 단계 · 실패 작업 재시도**에서 현장 확인 후 실행하면 완료한 단계는 반복하지 않고 미완료 작업을 다시 요청합니다. 자동 진행 주문은 재시도 성공 후 다음 작업으로 이어집니다.

부분적으로 수행된 팔 동작은 중간 관절 자세에서 이어지는 것이 아니라 해당 공정 명령을 다시 실행합니다. 재시도 전에 적재물과 작업 위치를 확인해야 합니다. 종료·정지 응답이 미확인된 작업은 재시도할 수 없습니다. **실패 주문 초기화**와 **전체 초기화**는 이어하기가 아닌 별도 초기화 기능입니다.

### 제품별 주문과 대기열

A·B 각각 0~2개를 지정합니다. 진행 중에는 **주문 추가**로 대기열에 저장하며 현재 묶음은 유지합니다. A부터 최대 2개씩 처리하고, 묶음 종료 후 완제품 팔레트를 비운 뒤 **팔레트 비움 확인 · 다음 묶음**으로 계속합니다. 재시작·실패 후 대기 주문이 자동으로 실행되지 않습니다. **대기 주문 삭제**는 현재 작업을 유지합니다. 실패 주문 초기화·전체 초기화는 대기 주문까지 비웁니다.

**이동 초기화**는 실패 주문이 없어도 재부팅으로 종료 응답을 잃은 M1/M2 개별 이동을 정리합니다. 모든 장치 정지를 확인한 뒤 실행하며, 해당 로봇의 정지·잠금 해제 응답까지 확인합니다. 위치 좌표/Nav2는 바꾸지 않고 새 이동도 보내지 않습니다. 실제로 옮겨서 위치 추정이 틀린 경우에는 별도의 **주차 위치 재설정**이 필요합니다.

## 연속 주문

A·B 각각 최대 2개, 합계 최대 4개를 주문합니다. 작업 중 추가 주문도 이미 접수한 수량에 합산하며, 한도를 넘는 선택지는 비활성화됩니다. M1·M2가 교대로 이어서 운반하고 묶음 확인 없이 생산합니다. 진행 중 일시정지나 오류는 주문 추가만으로 해제되지 않습니다.
