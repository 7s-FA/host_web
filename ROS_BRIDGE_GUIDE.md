# 웹 → ROS 상태 송신 시험

팀원 수정본의 송신 기능을 최신 관리자 설정·시스템 설정·출차 경로에 합쳤습니다. 웹은 `rosbridge`에 연결해 `/web_to_ros`로 화면 상태를 보냅니다. 실제 로봇 명령이나 작업 완료 회신은 아직 연결하지 않았습니다.

## 수정할 파일

저장소에서는 루트, 다운로드 ZIP에서는 `robot3_host/web/` 기준입니다.

| 파일 | 역할 |
|---|---|
| `ros-config.js` | 사용 여부, 접속 주소, 토픽, 메시지 타입, 전송 주기 |
| `ros-client.js` | 연결·송신·연결 해제·재연결 및 상태 표시 |
| `app.js` | 현재 수량·재생 여부·제품명 제공 |
| `assets/vendor/roslib-1.4.1.min.js` | 패키지에 포함한 ROS 라이브러리. CDN 접속 불필요 |

`config.js`의 시뮬레이션 속도와 독립된 설정입니다. 관리자 설정을 내보내도 ROS 설정은 덮어쓰지 않습니다. `system-config.json`의 ROS Action 규칙을 실행하는 기능은 여전히 별도 구현 대상입니다.

## 기본값

```js
window.ROS_BRIDGE_CONFIG={
 enabled:true,
 localOnly:true,
 url:'ws://localhost:9090',
 topic:'/web_to_ros',
 messageType:'std_msgs/msg/String',
 publishIntervalMs:200
};
```

- 기본값은 HTTP의 `localhost` 또는 `127.0.0.1`에서만 자동 연결합니다. 공개 웹사이트와 단일 HTML 파일에서는 연결하지 않습니다.
- 연결된 동안 주문 대기·일시정지를 포함하여 200ms(초당 5번)마다 화면 상태를 보냅니다. 주기는 100~60000ms의 정수입니다.
- 화면의 **ROS 연결 해제 / ROS 연결·재연결** 버튼으로 제어합니다. 서버를 늦게 켰거나 연결이 끊겼다면 재연결하세요. 자동 재시도와 끊긴 동안의 데이터 재전송은 없습니다.
- ROS 연결 여부는 기존 **호스트 연결** HTTP 시험과 별개입니다. ROS 서버·라이브러리가 없어도 시뮬레이션과 HTTP 시험은 계속 사용할 수 있습니다.
- 다른 PC의 rosbridge라면 `url`을 그 PC 주소로 바꿉니다. `localhost`는 브라우저를 실행한 PC입니다. 다른 주소에서 웹까지 열려면 `localOnly:false`가 필요합니다. HTTPS 웹에서는 브라우저 정책에 맞는 WSS 구성이 필요할 수 있습니다.
- 설정을 변경한 뒤 새로고침합니다. 시나리오를 다시 생성할 필요는 없습니다.

## Host PC에서 확인

ROS 2 Jazzy와 rosbridge_server가 설치되어 있다는 전제입니다. 미설치 시 `sudo apt install ros-jazzy-rosbridge-suite`로 설치합니다. 각 ROS 터미널에서 환경을 설정하세요.

터미널 1 — rosbridge 실행:

```bash
source /opt/ros/jazzy/setup.bash
export ROS_DOMAIN_ID=40
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
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

저장소를 clone했다면 `python3 host/server.py`를 사용합니다. `http://127.0.0.1:8082/`를 열어 **ROS 연결됨**을 확인하고 제품 수량과 재생 상태를 바꿉니다. HTTP 단계 시험도 하려면 기존 **호스트 연결** 버튼을 누릅니다.

수신 메시지의 `data`는 다음 JSON을 담은 문자열입니다. 팀원 코드와 호환되도록 수량도 문자열로 유지했습니다.

```json
{"quantity":"2","playing":false,"product":"A제품 · 부품 3개 / 세트"}
```

수량은 입력창의 현재 값이므로 입력 중에는 빈 문자열이나 유효하지 않은 값일 수도 있습니다. 수신 측에서 사용할 때 검증해야 합니다. `playing`은 시뮬레이션 재생 상태이며 로봇 시작/정지 명령이 아닙니다. 화면의 **연결됨**은 WebSocket 연결 상태이고 수신 처리나 로봇 작업 성공 확인이 아닙니다.

다음 개발 범위는 주문 ID·작업 ID를 가진 명령, Host의 Action 처리, 완료/실패 수신, 실제 상태 표시입니다. 이번 송신 데이터를 실제 장비의 반복 실행 명령으로 사용하지 않습니다.

참고: [roslibjs 1.4.1](https://github.com/RobotWebTools/roslibjs/tree/1.4.1), [rosbridge_suite](https://github.com/RobotWebTools/rosbridge_suite). 라이브러리의 BSD 라이선스는 `assets/vendor/ROSLIB-LICENSE.txt`에 포함합니다.
