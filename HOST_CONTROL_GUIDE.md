# Host PC 실장치 관제 연결

`control.html`은 **M1·M2·자재창고·제작공정** 네 단위의 Host 보고 상태를 표시합니다. 제작공정은 로봇팔 2·3, 리니어와 카메라 상태를 통합한 단위입니다. 지도·시뮬레이션 엔진의 경과시간과 브라우저 ACK를 사용하지 않습니다. 공개 사이트에서는 미연결 안내가 정상입니다. Host PC에서 `python3 host/server.py`를 실행하고 `http://127.0.0.1:8082/control.html`을 엽니다. 다운로드 ZIP에서는 `robot3_host/`에서 `python3 web/host/server.py`를 실행합니다.

현재 제공된 Python 서버는 로컬 관제 API와 명령 대기열까지 구현했습니다. **ROS 2 Action Client와 각 장치 Result를 검증하는 Host 어댑터는 아직 팀 구현 대상**입니다. 이 어댑터가 연결되기 전에는 주문·다음 단계 버튼이 비활성화되며 실제 로봇에 명령을 보내지 않습니다. 기존 `/?host=1`은 웹 시뮬레이션 ACK 시험으로, 실장치 관제와 별개입니다.

관제에서는 **A제품/B제품**, 수량 **1개/2개**를 버튼으로 선택한 뒤 **주문 시작**을 누릅니다. 각 장치와 Host의 **로그** 버튼은 해당 기록을 작은 팝업으로 엽니다. 통신이 끊겨도 마지막으로 받은 로그는 확인할 수 있으며, 현재 상태나 최신 기록으로 간주하지 않습니다.

메인 공정 시뮬레이션은 A제품만 지원합니다. 메인 화면의 **로봇 제어 ↗**는 준비된 버거에 개별 Action을 요청하는 별도 패널이며, 이 문서의 자동 공정용 관제 API와 구분합니다.

## Host 어댑터 연결 계약

1. Host PC에서 `ROBOT3_BRIDGE_TOKEN` 환경변수를 충분히 긴 임의 문자열로 설정한 뒤 서버를 시작합니다. 토큰은 브라우저로 보내지 않습니다.
2. ROS 2 어댑터가 `GET /api/live/commands`를 `X-Bridge-Token` 헤더와 함께 주기적으로 조회합니다. `start`, `next`, `pause`, `resume` 지시의 `id`를 수신합니다.
3. 어댑터가 장치별 Action Goal/Feedback/Result, heartbeat, 완료 증거, 주문·제품·작업 ID와 선행 조건을 검증합니다. 수락한 명령 ID를 `accepted_command_ids`에 넣어 `POST /api/live/report`로 최신 전체 상태를 보고합니다. `revision`은 서버 실행 중 계속 증가해야 합니다.
4. 관제 화면은 `GET /api/live/state`를 1초마다 읽습니다. 보고가 `ros2.heartbeat_timeout_seconds`(기본 3초) 동안 없으면 연결 끊김으로 바뀌고 다음 지시를 막습니다.

## 주문과 상태 형식

관제의 `POST /api/live/start` 요청은 제품과 수량을 함께 보냅니다.

```json
{"product_type": "B", "quantity": 2}
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

각 `devices.<키>.log`와 루트의 `log`는 선택 항목인 문자열 배열이며 생략하면 빈 배열로 처리합니다. 루트 `log`는 Host 기록입니다. 보고 배열은 50개 항목을 넘으면 거부하고, 각 문자열은 200자까지 저장합니다. 상태 응답의 Host 로그에는 웹 서버의 실제 지시 대기 기록도 합쳐지므로 최대 100개 항목이 표시될 수 있습니다. 장치별 로그와 Host 로그는 해당 팝업에서 구분해 표시합니다. 보고가 끊기면 장치 상태는 확인 불가로 바뀌고 제어가 보류되며, 마지막으로 수신한 로그는 보존됩니다. 이 기록은 서버 메모리에 있으므로 서버 재시작 이후 영구 보존되지는 않습니다.

서버는 `start`의 제품 종류·수량 범위, `next`의 완료 조건, 명령 중복, 보고 revision과 어댑터 토큰을 검사합니다. 수락되지 않은 명령은 대기열에 남으며 다음 명령이 막힙니다. 실제 ROS 명령 전송·완료 판정·오류 복구는 어댑터가 담당합니다. 이 Python 서버의 관제 상태·명령 대기열은 메모리에만 있으므로 서버 재시작 뒤에는 어댑터가 실제 장치·주문 상태를 다시 조회해 보고해야 합니다. 모든 API는 PC의 `127.0.0.1`에만 바인딩됩니다.

설정 위치: `system-config.json`의 장치 Action/상태·heartbeat 주소와 완료 조건, `host/live_control.py`의 관제 경계, `host/server.py`의 HTTP 경로. ZIP에서는 각각 `config/system-config.json`, `web/host/live_control.py`, `web/host/server.py`입니다.

`system-config.json`의 다섯 논리 장비와 A제품 시뮬레이션 규칙은 그대로입니다. 이 관제 API의 네 단위는 화면에 보고할 상태 묶음이며, B제품 선택이 기존 시뮬레이션이나 시스템 설정의 공정 규칙을 자동 변경하지는 않습니다.
