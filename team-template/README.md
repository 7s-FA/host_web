# Robot3 Host PC — 팀 개발 시작 패키지

## 목표와 현재 상태

**ROS_DOMAIN_ID=40**을 기준으로 Host가 주문을 받고 버거 2대·로봇팔 3대에 작업을 지시하며, 실제 완료 결과로 다음 작업을 진행하는 시스템을 개발합니다.

이 패키지는 **기존 웹/HTTP 시험 프로그램 + 시스템 설정 + 팀 개발 폴더 및 작업 명세**입니다. ROS 2 Host·Action 서버·웹 브리지는 아직 구현되지 않았습니다. ROS 폴더의 README는 팀원이 구현할 명세이며 실행 코드가 아닙니다. 아직 `colcon build`나 `ros2 launch`로 전체 시스템을 실행할 수 없습니다.

| 구분 | 제공 상태 |
| --- | --- |
| 주문 입력·카운트·단계별 실행·빨강/초록 조건 표시 | 웹 시뮬레이션 구현됨 |
| 관리자 버거 주행 속도 설정 | 시뮬레이션용 구현됨 |
| 웹 ↔ Python Host 명령/ACK 시험 | 구현됨, 실제 장치 제어 아님 |
| 실장치 관제 화면·로컬 어댑터 API | 화면·상태 수신 계약 구현, ROS 2 어댑터는 팀 구현 필요 |
| system-config 및 검증기 | 제공됨, 주문/HTTP 일부 설정 연결됨 |
| 공통 ROS 메시지·Host 스케줄러·웹 브리지 | 팀 구현 필요 |
| 가짜 장치 5개·실물 장치 Action 서버 | 팀 구현 필요 |
| 실제 센서 기반 완료·ROS 오류/복구 처리 | 팀 구현·검증 필요 |

## 최신 주행 방식

초기위치·자재창고·제작공정·대기장소에서 로컬 cmd_vel로 10cm 후진·정지 → 180도 회전·정지 → Nav2 전진 주행합니다. 대기장소에도 전진 주차하고 후방 IR 검은선으로 정지합니다. [NAVIGATION_POLICY.md](NAVIGATION_POLICY.md)에 구현·설정·시험 기준을 정리했습니다.

## 실제 로봇으로 전환할 때

[REAL_ROBOT_SETUP.md](REAL_ROBOT_SETUP.md)에 변경할 config 키, 버거·팔 보드 설정, 웹 코드 교체 지점, mock 종료→실물 연결 순서와 팀 확인 기록을 정리했습니다. 실제 연결 전에 각 담당자가 해당 항목을 확인하세요.

## 폴더 구조

```text
robot3_host/
├─ README.md                       # 이 문서: 전체 계획·담당·실행 방법
├─ REAL_ROBOT_SETUP.md             # 실물 전환 시 변경·연결할 항목
├─ config/
│  ├─ system-config.json            # Host 주문·ROS 주소·완료·전환 규칙
│  └─ SYSTEM_CONFIG_GUIDE.md        # 설정별 현재 적용 범위
├─ robot3_interfaces/
│  ├─ README.md                     # 공통 인터페이스 담당 명세
│  ├─ action/README.md              # ExecuteTask.action 작성 위치
│  └─ msg/README.md                 # 상태·이벤트·heartbeat 메시지 작성 위치
├─ robot3_orchestrator/README.md    # Host 공정 관리 개발 명세
├─ robot3_web_bridge/README.md      # 웹 ↔ ROS 연결 개발 명세
├─ robot3_mock_devices/README.md    # 가짜 장치 5개 개발 명세
├─ web/                            # 기존 동작하는 웹·HTTP 시험 파일
│  ├─ index.html / admin.html
│  ├─ config.js                     # 시뮬레이션 속도·시간 기본값
│  ├─ app.js / engine.js / assets/
│  └─ host/
│     ├─ server.py                  # 기존 HTTP 시험 서버
│     ├─ system_config.py           # 시스템 설정 검증기
│     └─ build_scenarios.cjs         # 시뮬레이션 시간표 생성기
├─ launch/README.md                # 통합 실행 구성 개발 명세
└─ tests/README.md                 # 팀 합격 기준·시험 순서
```

ROS 패키지를 개발할 때 각 담당 폴더를 패키지 루트로 사용합니다. `package.xml`, CMakeLists.txt 또는 setup.py, 실제 노드와 launch 파일은 아직 없으며 담당자가 추가합니다. 위 구조는 작업 분배용이며 배포용 ROS 워크스페이스 구성은 환경 확정 후 맞춥니다.

## 지금 실행할 수 있는 것

압축을 풀고 **robot3_host 폴더에서** 실행합니다. Python 3.10 이상이며 기본 HTTP 시험에는 추가 Python 패키지·ROS 설치가 필요 없습니다.

```bash
python3 web/host/server.py
```

기본 접속: `http://127.0.0.1:8082/?host=1`

- 관리자: `http://127.0.0.1:8082/admin.html`
- 종료: 터미널에서 Ctrl+C
- 실행 위치와 무관하게 설정은 `config/system-config.json`에서 읽습니다.
- 이 서버는 브라우저와의 시뮬레이션 ACK 시험용입니다. 실제 ROS 제어기로 오인하지 마세요.
- 예전 ZIP의 `python3 host/server.py`는 새 구조에서는 `python3 web/host/server.py`로 바뀌었습니다.

시스템 설정 수정 후:

```bash
python3 web/host/system_config.py --write-web-policy
python3 web/host/server.py
```

서버가 이미 켜져 있으면 종료 후 다시 실행합니다. 생성된 웹 수량 정책은 `web/system-policy.js`에 저장됩니다. Host 포트·수량 범위·자동 진행 초기값·브라우저 무응답 제한시간은 현재 적용됩니다. ROS 주소·완료·전환 규칙은 향후 구현할 실행부가 읽어야 합니다.

시뮬레이션 속도·시간을 수정하려면 `web/config.js`를 편집하거나 관리자에서 내보낸 파일로 교체한 뒤 다음을 실행합니다. 생성에는 Node.js 22 이상이 필요합니다.

```bash
node web/host/build_scenarios.cjs
python3 web/host/server.py
```

`config/SYSTEM_CONFIG_GUIDE.md`와 `web/CONFIG_GUIDE.md`는 원본 프로젝트 기준 경로 설명을 포함합니다. **이 ZIP에서는 위 경로 대응과 실행 명령을 우선 사용하세요.**

## 팀별 작업 분배

담당자 이름은 팀에서 기입합니다.

| 역할 | 작업 폴더/장치 | 선행 작업 | 제출물·완료 기준 |
| --- | --- | --- | --- |
| 공통 인터페이스 담당 | robot3_interfaces | Host·보드 ROS 환경 합의 | ExecuteTask Action, 상태/이벤트/heartbeat, control/get_task 정의·빌드 |
| Host 담당 | robot3_orchestrator | 인터페이스 확정 | 주문 관리·Action Client 5개·의존 조건·중복 방지·오류 처리 |
| 웹 담당 | robot3_web_bridge + web | Host 상태/명령 계약 합의 | 주문 전달, 실제 상태·카운트·미완료 사유 표시 |
| 시험 담당 | robot3_mock_devices + tests | 인터페이스 확정 | 정상/실패/지연/중복/재접속 시험과 결과 기록 |
| 버거 담당 | burger1·burger2 Pi | 인터페이스 확정 | MOVE_TO를 각 Pi의 Nav2·도킹·후방 IR 정지와 연결 |
| 자재창고 담당 | arm1 Jetson | 인터페이스 확정 | 부품 3개 적재·검사·팔 이탈 후 완료 보고 |
| 공정 담당 | arm2 Pi | 인터페이스 확정 | 조립·검사·간섭 영역 이탈 후 완료 보고 |
| 팔3·리니어 담당 | arm3 Pi | 인터페이스 확정 | 지그 준비/원점/파렛트 작업 직렬 실행·완료 보고 |

## 개발 순서

1. **환경 확인**: Host와 각 보드의 OS, ROS 2 배포판, RMW, 네트워크를 확인합니다. 문서 기준은 Jazzy를 목표로 하지만 Jetson 설치 가능 여부까지 확인하고 확정합니다. 이미 설치됐다고 가정하지 않습니다.
2. **인터페이스 합의**: 필드 이름·완료 증거·오류 코드를 먼저 고정하고 모두 같은 패키지를 사용합니다.
3. **Host + mock 구현**: 실제 로봇 없이 5개 가짜 장치와 주문 2개를 끝까지 처리합니다.
4. **웹 연결**: 시간 기반 모의 완료를 Host가 검증한 실제 장치 상태로 교체합니다. 테스트 모드/실물 모드를 명확히 표시합니다.
5. **장치별 연결**: 모터 비구동 통신 확인 → 각 장치 단독 작업 → 제품 1개 → 제품 2개 교대 순서로 시험합니다.
6. **최종 통합**: 실패·통신 끊김·중복·재시작 시험을 통과한 후 팀 시연합니다.

첫 번째 마일스톤은 **도메인 40에서 mock 5개 + Host + 웹으로 A제품 2개를 끝까지 처리하고, 오류 주입 시 다음 작업이 보류되는 것**입니다.

## 장치와 Host의 책임

```text
웹: 주문·실행 버튼·상태 표시
  ↕ 웹 브리지
Host: 작업 배정·완료 검증·다음 명령·카운트
  ↕ ROS 2 Action
버거1/2: 로컬 Nav2·회전·후진·ArUco·후방 IR 정지
팔1: 부품 적재 / 팔2: 조립 / 팔3: 리니어 + 파렛트
```

- 한 장치 작업 하나가 Action 하나입니다. 수락 ≠ 완료, Feedback 100% ≠ 성공 Result입니다.
- Host는 속도·중간 경유점별 승인을 보내지 않습니다. 버거 내부에서 주행을 이어갑니다.
- 대기장소에는 ArUco 마커가 없습니다. 전진 주차·후방 IR 검은선 감지·실제 정지로 완료를 확인합니다.
- 팔3 Pi는 리니어와 팔 작업을 동시에 구동하지 않도록 중재합니다.
- Host와 모든 장치는 ROS_DOMAIN_ID=40을 사용합니다. 같은 값만 설정했다고 실제 네트워크 통신까지 확인된 것은 아닙니다.

```bash
# 각 실행 터미널 또는 최종 launch 환경에 적용
export ROS_DOMAIN_ID=40
```

## 반드시 지킬 공정 규칙

- 주문이 2개 이상이면 버거1 창고 도착·정지 완료 시 버거2를 대기장소로 보냅니다.
- 공정 조립은 운송 버거 도킹 + A지그 준비 + 필요한 장치/간섭 조건 확인 후 시작합니다.
- 다음 버거의 공정 출발은 부품 3개 적재·팔1 이탈 + 앞 제품 파렛트 완료 + 앞 버거 대기 주차가 모두 필요합니다.
- 마지막 운송 버거가 공정에 도킹하기 전에는 대기 중 다른 버거를 초기위치로 보내지 않습니다.
- 주문 완료는 모든 제품 적재, 운송 도착, 두 버거 HOME 정지, 팔·리니어 작업 종료를 확인합니다.
- 완료 조건은 주문/제품/작업/시도/장치 실행 세션에 묶습니다. 이전 작업의 초록 상태를 새 작업에 재사용하지 않습니다.

## 참고 문서

- 상세 통신 규약: https://rorobot.atlassian.net/wiki/spaces/robot3/pages/19759145
- 단계별 흐름: https://rorobot.atlassian.net/wiki/spaces/robot3/pages/19726542 (초안 상태일 수 있음)
- 1차 목표: https://rorobot.atlassian.net/wiki/spaces/robot3/pages/19759106
- 공개 웹: https://7s-fa.github.io/host_web/

## 추가된 ROS 상태 송신 시험 (2026-09-30)

`web/ros-config.js`에서 주소·토픽·주기를 설정합니다. 웹 수량·재생 상태·제품명을 `/web_to_ros`로 보내는 기능이며 실제 로봇 명령·완료 연동은 아닙니다. ROS_DOMAIN_ID=40의 rosbridge 실행과 수신 확인은 [web/ROS_BRIDGE_GUIDE.md](web/ROS_BRIDGE_GUIDE.md)를 참고하세요. 기존 웹/HTTP 시험에는 ROS 설치가 필요 없습니다.
