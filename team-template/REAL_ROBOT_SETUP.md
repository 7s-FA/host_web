# 실제 로봇 연결 시 변경·설정할 항목

이 문서는 **Host·공통 인터페이스·웹 브리지·장치 Action 서버를 구현한 뒤** mock에서 실물로 전환할 때 사용하는 안내입니다. 현재 다운로드 패키지에는 해당 ROS 실행 코드가 없습니다. config 수정만으로 실제 로봇과 통신하거나 제어할 수는 없습니다.

## 1. 그대로 사용할 것과 바꿀 것

| 항목 | 유지/변경 | 담당·위치 |
| --- | --- | --- |
| 제품 수량 입력·카운트·조건 목록 UI | 화면 구조 유지, 값의 출처를 Host 실제 상태로 교체 | 웹 담당, web/app.js |
| 주문 수량 정책 | config 값 유지 또는 운영 수량으로 수정 | config/system-config.json → order |
| 실행 결과의 출처 | 시간 기반 모의 완료 → 실제 장치 Action Result | Host + 장치 담당 |
| 장치 실행 서버 | mock 5개 종료 → 각 실제 보드의 Action Server 실행 | robot3_mock_devices / 각 보드 |
| 공정 순서·선행 조건 | 유지하되 실제 결과·자원 상태로 검증 | robot3_orchestrator |
| ROS 도메인 | Host와 모든 보드 40 | 실행 환경 / launch |
| Action·Topic·Service 이름 | 보드 실제 이름과 config를 일치시킴 | config → devices / ros2 |
| 주행 속도 | 웹 배율 사용 안 함. 각 버거의 Nav2·도킹 제어 설정에서 실측 조정 | 각 버거 Pi |
| 지도·목표 좌표·ArUco·IR | 현장 실제 값으로 설정 | 각 버거 Pi |
| 팔·리니어 동작 | 모의 대기 → 실제 드라이버·티칭·센서 판정 | 각 팔 보드 |
| 웹 위치 표시 | 가상 픽셀 이동 → 로봇 실제 위치의 지도 변환 | 버거 + 웹 담당 |
| 통신/작업 timeout | 제안값 → 현장 측정값으로 조정 | config → ros2 / commands |
| launch | mock용 구성 → Host 전용 + 보드별 실행 구성 | launch 담당, 구현 필요 |

## 2. Host 설정 파일에서 바꿀 값

파일: `config/system-config.json`

| JSON 경로 | 변경 내용 | 확인 방법 |
| --- | --- | --- |
| ros2.domain_id | 40 유지 | 실제 노드를 띄우는 모든 터미널/서비스/컨테이너 환경도 40인지 확인 |
| ros2.action_type | 최종 공통 패키지의 실제 Action 타입 | 모든 장치와 Host의 타입·필드·버전 일치 |
| devices.<장치>.namespace | 버거/팔별 namespace | 두 보드가 같은 이름을 사용하지 않는지 확인 |
| devices.<장치>.action_name | 실제 작업 서버 주소 | 예: /burger1/execute_task |
| devices.<장치>.state_topic / event_topic / heartbeat_topic | 실제 상태·시작 이벤트·생존 신호 주소 | Host가 해당 메시지를 수신하는지 확인 |
| devices.<장치>.control_service / get_task_service | 실제 제어·상태 조회 서비스 주소 | 정지 요청·재접속 조회 시험 |
| ros2.order_state_topic / host_heartbeat_topic | Host가 발행할 주소 | 웹 브리지·보드가 수신하는지 확인 |
| ros2.heartbeat_hz / heartbeat_timeout_seconds | 실측 네트워크에 맞는 주기·제한시간 | 정상 상태 오판과 실제 끊김 감지 시험 |
| ros2.goal_response_timeout_seconds | 명령 수락 응답 제한시간 | 응답 지연 시험 |
| commands.<명령>.execution_timeout_seconds | 작업별 실제 최대 소요시간 기준 | 정상 최장 작업과 고장 상태를 구분해 시험 |
| commands.<명령>.result_equals | 장치가 실제로 보낼 완료 증거와 일치 | 단순 타이머 완료가 아닌 센서·검사 결과 확인 |
| order | 운영 수량·자동 실행 기본값 | 첫 실물 시험은 단계별 실행으로 확인 |

기본 heartbeat 2Hz·3초, Goal 응답 2초, 각 작업 timeout은 **실측 전 초안**입니다. 지연을 이유로 완료 검증을 생략하지 않습니다. 세션·작업 ID 검증과 중복 방지는 Host 코드에서 함께 구현해야 합니다.

`web_host.port`는 브라우저용 HTTP 포트입니다. 실제 ROS 장치마다 이 포트를 설정하는 구조가 아닙니다. 현재 서버의 loopback 주소 제한은 그대로 두고 Host PC에서 화면을 사용하세요. 다른 PC에서 관제해야 한다면 접근 제어와 접속 경로를 웹 브리지 담당과 별도로 설계해야 합니다.

## 3. 버거1·2 Pi에서 설정할 것

최신 출차 규칙은 **HOME·WAREHOUSE·ASSEMBLY·WAITING에서 cmd_vel 10cm 후진·정지 → 180도 회전·정지 → Nav2 전진**입니다. [주행 정책 상세](NAVIGATION_POLICY.md)를 우선 적용하세요. 대기장소는 전진 주차하되 ArUco 없이 후방 IR 검은선으로 정지합니다.

버거마다 별도 Action Server를 구현하고 `MOVE_TO(target_station)` 한 건으로 출차부터 도킹·정지까지 처리합니다.

- ROS 환경: domain 40, 해당 namespace, 공통 robot3_interfaces 버전.
- 지도/위치 추정: 현장 지도, map/odom/base 프레임, 초기 위치, 지도 버전. 두 버거의 센서·TF 이름 충돌을 방지합니다.
- 목적지: HOME은 각 버거 자신의 초기칸 좌표, WAREHOUSE/ASSEMBLY/WAITING은 현장 좌표와 도착 방향.
- 로컬 주행: Nav2 설정, 전진·후진·회전 제한과 가감속, 로컬 속도 출력 제어권. 실제 단위·파라미터 이름은 사용하는 드라이버/Nav2 구성에서 확인합니다.
- 도킹: 마커 ID·크기·카메라 보정, 정렬 오차, 접근 속도, 후방 IR GPIO·극성·검은선 임계값·필터·정지 판정.
- WAITING: ArUco 없음. 대기장소 방향 정렬 → 전진 주차 → 후방 IR 감지 → 정지. 출차는 10cm 후진·정지 → 180도 회전 → 전진 주행. 해당 목적지에 마커 탐색을 요구하지 않습니다.
- 출차: 이전 주차 IR 감지 상태를 새 목적지 완료에 재사용하지 않도록 해제/재무장 절차를 구현합니다.
- 결과: 로컬 경로 수행 + 필요한 도킹 검증 + 실제 정지가 끝난 뒤 station_id/stopped/dock_verified와 성공 Result를 보냅니다.

웹 `config.js`의 forwardSpeed/reverseSpeed는 시뮬레이션 배율입니다. 실제 로봇의 m/s 또는 Nav2 파라미터로 그대로 전달하지 않습니다. `engine.js`의 픽셀 좌표도 실제 목표 좌표가 아닙니다. 위 실물 지도·센서·속도 설정 파일은 아직 이 패키지에 없으며 버거 담당자가 작성해야 합니다.

## 4. 로봇팔·리니어 보드에서 설정할 것

| 보드 | 연결할 실행 코드 | 성공 보고 전 실제 확인 |
| --- | --- | --- |
| 팔1 Jetson | 지정 버거의 트레이에 부품 3개 상차 | actual_part_count=3, 검사 PASS, 팔이 버거 진출 영역에서 이탈 |
| 팔2 Pi | 하차·A지그 티칭 조립 | 조립 검사 PASS, 팔이 버거·리니어 간섭 영역에서 이탈 |
| 팔3 Pi — LINEAR_PREPARE | 지그를 작업 위치로 이동 | 위치 센서/제어기 확인 + 정지 |
| 팔3 Pi — LINEAR_HOME | 원점/인계 위치로 복귀 | 실제 원점/인계 위치 확인 + 정지 |
| 팔3 Pi — PALLETIZE | 완제품 파렛트 적재 | 적재 검사 PASS + 팔 이탈 |

담당자가 실제 드라이버 연결 정보, 티칭 포인트·레시피 버전, 그리퍼 확인, 작업 영역, 검사 방식, 리미트/원점 센서를 설정합니다. 원점과 팔3 인계 위치가 실제로 같은지도 확인합니다. 이 값들은 아직 제공되지 않은 장치별 설정에 작성합니다.

팔3 Pi가 리니어도 소유하며 두 작업을 동시에 구동하지 않습니다. 명령 수락·취소 수락은 실제 작업/정지 완료를 뜻하지 않습니다.

## 5. 기존 웹 코드를 바꿀 위치

| 기존 코드/파일 | 실물 관제 전환 시 할 일 |
| --- | --- |
| web/app.js의 주문 시작 | 현재 시뮬레이션 plan 생성 대신 브리지로 주문을 보내고 Host의 주문 ID·상태 수신 |
| web/app.js의 frame()/HostBridge.complete() 경로 | 실물 모드에서 시간 경과에 따른 완료 ACK 전송을 사용하지 않음 |
| web/host-client.js | 기존 /api/start·next·ack 시험 API와 실물 API를 구분. 새 브리지 계약에 맞는 상태 구독·명령 요청 구현 |
| web/engine.js / web/host/scenarios.json | 시뮬레이션 모드 전용으로 유지. 실물 완료 판단이나 다음 명령 스케줄로 사용하지 않음 |
| web/host/server.py | 현재 HTTP 시험 서버는 시뮬레이션용. 실물 제어는 구현할 orchestrator/web_bridge가 담당 |
| renderConditions·카운트 표시 | Host가 검증한 결과·조건별 상태 사용. 재접속은 Host 상태를 조회해 복원 |
| 로봇 지도 애니메이션 | 실측 pose·지도 좌표 변환과 데이터 시각 표시. 위치 정보가 없으면 추정 애니메이션 대신 미수신 표시 |
| 관리자 화면 | 현재 시뮬레이션 설정과 향후 실물 설정 적용 범위를 분리. 실제 적용 여부와 버전 표시 |

브리지 접속 주소·실물 모드 선택 항목은 **아직 구현돼 있지 않습니다.** 현재 config에 존재하지 않는 mode/ros_enabled 같은 키를 추가하는 것만으로 전환되지 않습니다. 웹·Host 담당자가 실행 모드와 API 계약을 먼저 구현하고 이 문서에 최종 실행 명령을 기록해야 합니다.

브라우저 새로고침·통신 끊김·버튼 연속 입력으로 주문이나 작업이 중복 실행되지 않도록 Host가 제어권과 요청 식별자를 관리합니다.

## 6. 연결·전환 순서

1. **인터페이스와 Host 구현 완료 확인**: mock 5개로 정상/실패/중복/재시작 시험을 먼저 통과합니다.
2. **환경 준비**: Host·5개 보드의 ROS 배포판·RMW·패키지 버전을 맞추고 네트워크 상호 접근·DDS 검색과 왕복을 확인합니다. Jetson은 OS/JetPack과 ROS 설치 가능 구성을 먼저 확인합니다.
3. **mock 종료**: 교체할 namespace의 mock 서버를 종료합니다. 실제 서버와 같은 이름으로 동시에 실행하지 않습니다. 혼합 시험은 어느 namespace가 mock인지 명시합니다.
4. **보드 서버 실행**: 모터 비구동 상태로 heartbeat, 장치 정보, READY와 세션 결합, 상태 조회부터 확인합니다.
5. **Host 연결**: 실제 Action 이름·타입과 장치 boot/session을 확인하고 새로운 실물 주문 상태로 시작합니다. mock의 완료 상태를 실물에 가져오지 않습니다.
6. **단독 작업**: 버거 한 대 이동/정지, 팔별 한 작업, 리니어 준비/복귀를 각각 검증합니다. 작업을 실행하기 전 현장 담당자가 동작 영역과 정지 수단을 확인합니다.
7. **제품 1개 통합**: 창고 → 상차 → 공정 → 조립 → 리니어 → 파렛트 → 복귀.
8. **제품 2개 교대**: B1 창고 도착 시 B2 대기, 3개 선행조건, 마지막 B2 공정 도킹 후 B1 복귀 확인.
9. **오류와 복구**: 장치 실패·응답 지연·연결 끊김·중복 결과에 다음 작업 보류, 상태 조회 후 명시적 재개를 확인합니다.

현재 실행 가능한 명령은 루트 README의 Python 웹 시험 명령뿐입니다. mock.launch.py/host.launch.py와 보드별 실행 명령은 각 담당자가 구현 후 루트 README 및 아래 기록란에 추가합니다.

## 7. ROS 연결 확인용 명령

ROS 설치 환경과 작업공간을 source한 뒤 각 실행 환경에서 적용합니다. 아래는 읽기 전용 상태 확인 예시이며 장치에 이동 Goal을 보내지 않습니다.

```bash
export ROS_DOMAIN_ID=40
ros2 node list
ros2 action list
ros2 topic list
```

같은 도메인은 검색의 기본 조건이지만 네트워크·검색 설정까지 보장하지는 않습니다. 노드 목록만 보고 완료하지 말고 mock 또는 비구동 보드에서 Action 수락·Feedback·Result 왕복과 heartbeat 수신까지 확인합니다. [ROS 환경 공식 문서](https://github.com/ros2/ros2_documentation/blob/rolling/source/Get-Started/Configuring-ROS2-Environment.rst), [ROS CLI 공식 문서](https://repo.test.ros2.org/en/jazzy/Concepts/Basic/About-Command-Line-Tools.html)

수락, 진행, 최종 결과의 구분은 [ROS 2 Action 공식 설계](https://design.ros2.org/articles/actions.html)를 기준으로 합니다.

## 8. 팀원이 채울 실물 연결 기록

| 항목 | 확정값·명령·결과 |
| --- | --- |
| Host OS / ROS 배포판 / RMW | 미확정 |
| Jetson OS / JetPack / ROS | 미확정 |
| 4개 Pi OS / ROS | 미확정 |
| robot3_interfaces 버전 | 미구현 |
| Host 실물 launch 명령 | 미구현 |
| 버거1·2 실행 명령 | 미구현 |
| 팔1·2·3 실행 명령 | 미구현 |
| 웹 브리지 URL·실행 방법 | 미구현 |
| 지도·경로·목적지 좌표 버전 | 실측 후 작성 |
| 팔 티칭·검사·리니어 위치 판정 방식 | 담당자 확인 후 작성 |
| config 버전·시험 날짜·담당자 | 시험 시 작성 |
| 1개/2개 주문 시험·오류 복구 결과 | 시험 시 작성 |
