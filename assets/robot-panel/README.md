# 로봇 제어 페이지

`optimize-1008`의 버거 제어 패널을 독립 페이지 `robots.html`로 옮겼습니다. 공정 시뮬레이션의 **로봇 제어** 링크로 이동하며, 팝업이나 iframe을 사용하지 않습니다.

- Host PC에서 웹 서버를 실행하고 `http://localhost:8082/robots.html`을 엽니다. `python3 -m http.server 8082 --bind 127.0.0.1`과 `python3 host/server.py` 모두 지원합니다.
- rosbridge 실행 터미널에서 ROS Jazzy와 `host_pkg` 설치 환경을 source하고 `ROS_DOMAIN_ID=40`을 설정해야 합니다. 로봇도 같은 도메인에서 AMR Action 서버와 상태 발행이 준비돼 있어야 합니다.
- 연결 주소·사용 여부·로컬 접속 제한은 루트 `ros-config.js`를 사용합니다. 기본값은 `ws://localhost:9090`이며 공개 Pages에서는 장치 연결 없이 실행 안내를 표시합니다.
- `/M1/data`, `/M2/data`의 `host_pkg/action/Burger`에 직접 요청합니다. 이 페이지의 개별 이동에는 `host_backend/main.py`가 필요하지 않습니다.
- 이동은 `GO_TO_MAT/ASM/REST/PARK`, 정지는 `EMER_STOP`, 정지 해제는 `RESTART`입니다. 이동 속도는 AMR 설정 최대속도의 100%입니다.
- 화면 진입은 상태 구독만 합니다. 최근 제어 상태가 없거나 임무·명령이 진행 중이면 이동 버튼을 비활성화합니다. 정지는 WebSocket이 연결돼 있는 동안 요청할 수 있습니다.
- 카메라 영상은 받지 않습니다. 주행 단계·통신·도킹·IR·속도·Action 결과와 진단 이벤트를 표시합니다. `(최근 기록)`은 마지막 임무 결과이며 현재 위치를 뜻하지 않습니다.
- 연결 복구 시 명령을 자동 재전송하지 않습니다. 명령 결과를 받기 전에 연결이 끊겼다면 로봇의 실제 작업 상태부터 확인합니다. 화면을 닫아도 작업을 취소하지 않습니다.

검사: `node tests/robot-panel.test.cjs`. 모의 WebSocket만 사용하며 실제 로봇에는 연결하지 않습니다.
