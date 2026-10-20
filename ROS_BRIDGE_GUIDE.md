# 웹 → ROS 상태 송신 시험

기본 데모는 `rosbridge`에 연결해 `/web_to_ros`로 화면 상태를 보냅니다. 이전 백엔드는 `playing=true`를 공정 시작으로 사용했지만, 새 통합 제어기는 이 토픽을 구독하지 않고 `control.html`의 명시적 주문만 처리합니다. 작업 완료 회신이나 주문 ID를 포함한 관제 API는 아닙니다. 메인 화면의 **로봇 제어 ↗**에서 이동 로봇에 개별 Action을 요청하는 기능과 구분합니다.

## 실물 상태 보기와 구분

Host PC에서 통합 실행 후 `http://localhost:8082/?live=1` 또는 메인 화면의 **실물 상태 보기**를 엽니다. 상태 모니터링은 수신 전용이며 `/web_to_ros`의 주문·재생 상태 송신을 실행하지 않습니다. 사용자가 M1·M2의 **정지·정지 해제**를 누르면 해당 실물 로봇에 Action을 보냅니다. 아래 `/web_to_ros` 송신 시험은 기본 데모 주소 `/`에만 해당합니다.

M1·M2 위치·방향은 `/burger1/amcl_pose`, `/burger2/amcl_pose`의 `map` 좌표와 quaternion에서 읽습니다. `live-map-config.js`의 동일한 m당 픽셀 비율을 양 축에 적용해 로봇·WP1~4를 표시합니다. 설비 그림은 배치 안내용이며 실측 외곽선이 아닙니다. 첫 좌표 전에는 아이콘이 숨겨지고, 3초 이상 오래된 좌표는 흐리게 표시하며 화면의 아이콘 움직임을 멈춥니다. Host와 로봇의 시각을 동기화하세요.

로봇팔 1~3은 Action 실행·일시정지·완료 상태에 따라 표시하고 실행 중 애니메이션을 보여줍니다. ROSAPI의 발행 노드 확인이 실패하면 상태 미확인으로 전환하고 애니메이션을 멈춥니다. 세부 관절 자세를 표시하는 기능은 아닙니다. 전체 주문은 통합 실행 후 `control.html`, 개별 이동은 로봇 제어 패널을 사용합니다.

## M1·M2 실물 정지·해제와 배터리 연결

메인 데모(`/`), 실물 상태 보기(`?live=1`), Host 관제(`control.html`)의 **M1 정지·M2 정지**는 HTTP `localhost`·`127.0.0.1`에서 rosbridge에 직접 연결합니다. 공개 사이트에서는 비활성화됩니다. HTTP Host 어댑터가 없거나 바쁘고 장치 상태가 오래되어도 rosbridge가 연결되어 있으면 정지를 요청할 수 있습니다.

`RobotStopClient`는 `/M1/data` 또는 `/M2/data`에 `host_pkg/action/Burger`, `{command:"EMER_STOP",cmd_val:0}`을 보냅니다. 로봇별 대기·결과는 독립적이며 선택한 로봇만 정지합니다. Host 전체 주문이나 팔을 일시정지하지 않고 `RESTART`를 자동 전송하지 않습니다. 최종 성공 Result를 확인해야 **정지 확인**이며, 10초 timeout·오류·연결 끊김은 **정지 여부 미확인**입니다. 재연결해도 이전 요청을 자동 재전송하지 않습니다. 정확한 응답 판정과 현재 Host 백엔드의 제약은 [정지 Action 계약](HOST_CONTROL_GUIDE.md#m1m2-실물-정지-action)을 참고하세요.

**M1 정지 해제·M2 정지 해제**는 같은 Action에 `{command:"RESTART",cmd_val:0}`을 명시적으로 보냅니다. 해당 로봇의 `motion_owner/communication_status`가 최근 3.5초 이내이고 실행 중 임무·대기 요청이 없어야 버튼이 활성화됩니다. AMR이 최신 odom 정지 여부도 확인하며, 해제 결과는 정지와 같은 최종 `IDLE` 성공 조건으로 확인합니다. 오류·timeout·연결 끊김은 해제 여부 미확인입니다. 이전 목표를 재개하지 않지만 잠금 해제 후 Host가 새 이동을 요청할 수 있습니다.

메인 데모·실물 보기·Host 관제·로봇 제어 패널의 배터리는 `/burger1/battery_state`·`/burger2/battery_state`(`sensor_msgs/msg/BatteryState`)를 구독합니다. `voltage`를 V로 표시하고 10.5~12.3V를 0~100%로 환산해 항상 **추정 잔량**으로 표시합니다. `percentage`는 펌웨어와 드라이버의 단위 차이 때문에 사용하지 않습니다. 5초 이상 미수신·연결 끊김은 마지막 값임을 구분하고, 첫 수신 전·비정상 값은 미확인으로 표시합니다. 공개 사이트에서는 실제 배터리 값을 만들지 않고 로컬 연결을 안내합니다. [배터리 수신 계약](HOST_CONTROL_GUIDE.md#m1m2-배터리-수신)을 참고하세요.

## 수정할 파일

저장소에서는 루트, 다운로드 ZIP에서는 `robot3_host/web/` 기준입니다.

| 파일 | 역할 |
|---|---|
| `ros-config.js` | 사용 여부, 접속 주소, 토픽, 메시지 타입, 전송 주기 |
| `ros-client.js` | 연결·송신·연결 해제·재연결 및 상태 표시 |
| `robot-stop-client.js` | M1·M2 정지·해제 Action 요청과 요청별 최종 결과 확인 |
| `robot-stop.js` | 메인 화면·Host 관제의 로봇별 정지·해제 버튼과 결과 표시 |
| `robot-battery-client.js` | M1·M2 배터리 수신, 전압 기반 추정 잔량과 최신 여부 판정 |
| `app.js` | 현재 수량·재생 여부·제품명 제공 |
| `assets/vendor/roslib-1.4.1.min.js` | 패키지에 포함한 ROS 라이브러리. CDN 접속 불필요 |

`system-config.json`의 자동 공정용 ROS 규칙을 실행하는 기능은 별도 구현 대상입니다.

## 기본값

```js
window.ROS_BRIDGE_CONFIG={
 enabled:true,
 localOnly:true,
 url:'ws://localhost:9090',
 topic:'/web_to_ros',
 messageType:'std_msgs/msg/String',
 publishIntervalMs:200,
 heartbeatMs:1000
};
```

- 기본값은 HTTP의 `localhost` 또는 `127.0.0.1`에서만 자동 연결합니다. 공개 웹사이트와 단일 HTML 파일에서는 연결하지 않습니다.
- 연결된 동안 주문 대기·일시정지를 포함하여 기본 200ms마다 화면 상태를 확인합니다. 값이 바뀌거나 마지막 송신에서 1초가 지나면 전송합니다. 확인 주기는 100~60000ms의 정수입니다.
- 화면의 **ROS 연결 해제 / ROS 연결·재연결** 버튼으로 제어합니다. 서버를 늦게 켰거나 연결이 끊겼다면 재연결하세요. 자동 재시도와 끊긴 동안의 데이터 재전송은 없습니다.
- ROS 연결 여부는 기존 **호스트 연결** HTTP 시험과 별개입니다. ROS 서버·라이브러리가 없어도 시뮬레이션과 HTTP 시험은 계속 사용할 수 있습니다.
- 다른 PC의 rosbridge라면 `url`을 그 PC 주소로 바꿉니다. `localhost`는 브라우저를 실행한 PC입니다. 다른 주소에서 웹까지 열려면 `localOnly:false`가 필요합니다. HTTPS 웹에서는 브라우저 정책에 맞는 WSS 구성이 필요할 수 있습니다.
- 설정을 변경한 뒤 새로고침합니다. 시나리오를 다시 생성할 필요는 없습니다.

## Host PC에서 확인

전체 소스를 clone한 Host PC에서는 루트 README의 사전 준비 후 `cd ~/host_web && bash start_host.sh`로 웹 서버와 rosbridge를 함께 켤 수 있습니다. 아래는 상태 송신만 개별 확인하는 절차이며, 통합 런치가 켜져 있다면 rosbridge와 웹 서버를 중복 실행하지 않습니다.

ROS 2 Jazzy와 rosbridge_server가 설치되어 있다는 전제입니다. 미설치 시 `sudo apt install ros-jazzy-rosbridge-suite`로 설치합니다. 각 ROS 터미널에서 환경을 설정하세요.

터미널 1 — rosbridge 실행:

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=40
ros2 launch rosbridge_server rosbridge_websocket_launch.xml address:=127.0.0.1 port:=9090
```

터미널 2 — 수신 확인:

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=40
ros2 topic echo /web_to_ros std_msgs/msg/String
```

터미널 3 — 다운로드 압축 해제 후 `robot3_host/`에서:

```bash
python3 web/host/server.py
```

저장소를 clone했다면 `python3 host/server.py`를 사용합니다. `http://127.0.0.1:8082/`를 열어 **ROS 연결됨**을 확인하고 **A제품/B제품·1개/2개** 버튼과 재생 상태를 바꿉니다. HTTP 단계 시험도 하려면 기존 **호스트 연결** 버튼을 누릅니다.

수신 메시지의 `data`는 다음 JSON을 담은 문자열입니다. 팀원 코드와 호환되도록 수량도 문자열로 유지했습니다.

```json
{"quantity":"2","playing":false,"product":"A제품 · 부품 3개 / 세트"}
```

제품 버튼의 `A`·`B`는 송신 전에 각각 **`A제품 · 부품 3개 / 세트`**, **`B제품 · 부품 3개 / 세트`**로 변환합니다. 현재 백엔드는 A 문자열이 정확히 일치할 때 A 작업을 선택하고 그 외에는 B 작업으로 분기하므로, 짧은 `A`·`B`만 보내면 안 됩니다. 수량은 버튼으로 선택한 `"1"` 또는 `"2"`입니다.

`playing`은 시뮬레이션 재생 상태입니다. 새 통합 백엔드는 이 값을 공정 시작에 사용하지 않습니다. 실제 주문은 `control.html`에서 시작합니다. `playing=false`는 진행 중인 실물 공정을 정지하는 명령이 아닙니다. 화면의 **연결됨**은 WebSocket 연결 상태이고 수신 처리나 로봇 작업 성공 확인이 아닙니다.

전체 자동 공정에는 주문 ID·작업 ID를 가진 명령, Host의 Action 처리와 완료/실패 검증이 별도로 필요합니다. Host 관제의 `/api/live/start`는 `product_type: "A"` 또는 `"B"`와 정수 수량을 사용하는 별도 계약이며, 통합 실행의 `host_backend`가 이 API를 ROS Action 실행부에 연결합니다.

참고: [roslibjs 1.4.1](https://github.com/RobotWebTools/roslibjs/tree/1.4.1), [rosbridge_suite](https://github.com/RobotWebTools/rosbridge_suite). 라이브러리의 BSD 라이선스는 `assets/vendor/ROSLIB-LICENSE.txt`에 포함합니다.
