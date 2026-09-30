# Host PC 실장치 관제 연결

`control.html`은 버거 2대·로봇팔 3대의 **Host 보고 상태**만 표시합니다. 지도·시뮬레이션 엔진의 경과시간과 브라우저 ACK를 사용하지 않습니다. 공개 사이트에서는 미연결 안내가 정상입니다. Host PC에서 `python3 host/server.py`를 실행하고 `http://127.0.0.1:8082/control.html`을 엽니다. 다운로드 ZIP에서는 `robot3_host/`에서 `python3 web/host/server.py`를 실행합니다.

현재 제공된 Python 서버는 로컬 관제 API와 명령 대기열까지 구현했습니다. **ROS 2 Action Client와 각 장치 Result를 검증하는 Host 어댑터는 아직 팀 구현 대상**입니다. 이 어댑터가 연결되기 전에는 주문·다음 단계 버튼이 비활성화되며 실제 로봇에 명령을 보내지 않습니다. 기존 `/?host=1`은 웹 시뮬레이션 ACK 시험으로, 실장치 관제와 별개입니다.

## Host 어댑터 연결 계약

1. Host PC에서 `ROBOT3_BRIDGE_TOKEN` 환경변수를 충분히 긴 임의 문자열로 설정한 뒤 서버를 시작합니다. 토큰은 브라우저로 보내지 않습니다.
2. ROS 2 어댑터가 `GET /api/live/commands`를 `X-Bridge-Token` 헤더와 함께 주기적으로 조회합니다. `start`, `next`, `pause`, `resume` 지시의 `id`를 수신합니다.
3. 어댑터가 장치별 Action Goal/Feedback/Result, heartbeat, 완료 증거, 주문·제품·작업 ID와 선행 조건을 검증합니다. 수락한 명령 ID를 `accepted_command_ids`에 넣어 `POST /api/live/report`로 최신 전체 상태를 보고합니다. `revision`은 서버 실행 중 계속 증가해야 합니다.
4. 관제 화면은 `GET /api/live/state`를 1초마다 읽습니다. 보고가 `ros2.heartbeat_timeout_seconds`(기본 3초) 동안 없으면 연결 끊김으로 바뀌고 다음 지시를 막습니다.

`POST /api/live/report` 예시의 형태:

```json
{
  "revision": 1,
  "accepted_command_ids": [],
  "devices": {
    "burger1": {"state": "idle", "detail": "초기위치"},
    "burger2": {"state": "idle", "detail": "초기위치"},
    "arm1": {"state": "idle", "detail": "자재창고"},
    "arm2": {"state": "idle", "detail": "제작공정"},
    "arm3": {"state": "idle", "detail": "리니어·파렛트"}
  },
  "order": null,
  "conditions": [],
  "can_advance": false,
  "log": ["Host 어댑터 시작"]
}
```

작업 중 `order`에는 `id`, `status`(`idle/running/waiting/paused/done/failed`), `quantity`, `transport_remaining`, `product_remaining`, `completed`, `stage`, `stage_count`가 필요합니다. 장치 `state`는 `offline/idle/running/done/failed/unknown`입니다. `conditions`는 `{ "label": "부품 3개 적재 및 팔 이탈", "done": true }` 형식입니다. **`can_advance=true`는 주문 상태가 `waiting`이고 모든 조건이 참일 때만 허용됩니다.** 단순 Feedback 100%, 타이머, 브라우저 버튼을 성공 Result로 취급하면 안 됩니다.

서버는 `start`의 수량 범위, `next`의 완료 조건, 명령 중복, 보고 revision과 어댑터 토큰을 검사합니다. 수락되지 않은 명령은 대기열에 남으며 다음 명령이 막힙니다. 실제 ROS 명령 전송·완료 판정·오류 복구는 어댑터가 담당합니다. 이 Python 서버의 관제 상태·명령 대기열은 메모리에만 있으므로 서버 재시작 뒤에는 어댑터가 실제 장치·주문 상태를 다시 조회해 보고해야 합니다. 모든 API는 PC의 `127.0.0.1`에만 바인딩됩니다.

설정 위치: `system-config.json`의 장치 Action/상태·heartbeat 주소와 완료 조건, `host/live_control.py`의 관제 경계, `host/server.py`의 HTTP 경로. ZIP에서는 각각 `config/system-config.json`, `web/host/live_control.py`, `web/host/server.py`입니다.
