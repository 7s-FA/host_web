# 주행 방식 변경 — 도킹 위치 10cm 후진 → 180도 회전 → Nav2 전진

## 확정 흐름

두 버거는 초기 HOME에서 왼쪽 벽을 바라보고 있습니다. HOME·WAREHOUSE·ASSEMBLY·WAITING에서 출차할 때마다 로컬 출차 제어기로 10cm 후진하고, 정지 확인 후 제자리에서 180도 회전합니다. 회전·정지가 확인되면 Nav2에 목적지 이동을 맡깁니다.

```text
Host → 버거: MOVE_TO(WAREHOUSE 또는 WAITING)
버거 내부:
  READY / 출차 가능 확인
  → 로컬 속도 제어권 획득
  → cmd_vel 후진, 실제 이동 거리 0.10m 확인
  → 속도 0, 정지 확인
  → 제자리 180° 회전, 실제 yaw 변화 확인
  → 속도 0, 정지 확인
  → 제어권을 Nav2로 전환
  → 전진 경로로 목적지 접근
  → 로컬 최종 도킹·후방 IR 정지 확인
버거 → Host: 해당 MOVE_TO의 최종 Result
```

10cm 후진·180도 회전은 별도 Host 작업이 아닙니다. 하나의 MOVE_TO 내부 단계이며 Feedback으로 UNDOCKING / TURNING / NAVIGATING / DOCKING을 보고합니다. 후진이나 회전만 끝났다고 전체 이동 성공을 보고하지 않습니다. HOME·WAREHOUSE·ASSEMBLY·WAITING에 도킹된 상태에서 새 이동 작업을 시작할 때 수행합니다. 같은 작업의 재전송·재접속에는 중복 출차하지 않습니다.

일반 구간과 대기장소 진입은 전진 주행입니다. 대기장소에서는 ArUco 없이 진입 방향으로 정렬해 **전진 주차 + 후방 IR 검은선 정지**를 수행합니다. 출차할 때만 다른 도킹 위치와 같이 로컬 10cm 후진·정지 후 180도 회전합니다.

## 웨이포인트와 도킹 세부 단계

웹 왼쪽 **버거 주행 단계**에서 두 로봇을 선택해 진행 상태를 확인합니다. 빨강은 미완료, 초록은 완료입니다. 화면의 거리·Nav2 도착·카메라·IR 조건은 모의 신호이며 실제 센서 입력이 아닙니다.

| 순서 | 내부 동작 | 완료 조건 |
| --- | --- | --- |
| 1 | cmd_vel로 10cm 후진 | 실제 후진 거리 도달 |
| 2 | 제자리 180° 회전 | 회전·정지 확인 |
| 3 | 버거 1은 WP1, 버거 2는 WP4로 Nav2 전진 | 해당 웨이포인트 도착 |
| 4 | Nav2로 WP2까지 이동 | WP2 도착 후 최종 도킹 제어로 전환 |
| 5 | 전방 카메라의 ArUco 마커를 추종하며 정렬·전진 | 후방 IR 감지선까지 접근 |
| 6 | 후방 IR 감지 → 정지 | 정지 확인 후 MOVE_TO 최종 성공 회신 |

버거 2의 기존 대기장소 경유는 유지합니다. 버거 1이 자재창고에 도착하면 버거 2는 출차해 WP4 → 대기장소로 갑니다. 앞 버거의 제작공정 진입 후 대기장소에서 후진·회전하고 WP2 → 카메라 도킹 → IR 정지 순으로 창고에 접근합니다. 대기장소에는 ArUco 단계 없이 전진 진입·후방 IR 정지를 적용합니다.

WP1·WP4는 각 초기위치의 통로 합류점, WP2는 창고 접근점, WP3는 제작공정 합류점입니다. 경로상의 다른 점은 전진으로 통과하며 Host 승인을 기다리지 않습니다. Nav2 웨이포인트 도착만으로 목적지 전체 이동 성공을 보고하지 않습니다.

웹 이벤트의 `navigation_start` / `navigation_done`은 단계 코드(`UNDOCK`, `TURN_180`, `NAV_HOME_WP`, `NAV_APPROACH`, `ARUCO_DOCK`, `LINE_APPROACH`, `IR_STOP`)와 제어 방식을 기록합니다. 이는 화면/모의 기록용이며 실제 ROS2 Feedback 필드와 메시지 타입은 버거·Host 담당자가 구현할 때 기존 Action 규약에 연결해야 합니다.

## 설정 위치

`config/system-config.json`:

```json
"navigation": {
  "travel_mode": "NAV2_FORWARD_ONLY",
  "dock_departure": {
    "stations": ["HOME", "WAREHOUSE", "ASSEMBLY", "WAITING"],
    "backup_distance_m": 0.1,
    "rotate_degrees": 180,
    "distance_feedback": "ODOMETRY",
    "rotation_feedback": "ODOMETRY_OR_IMU",
    "stop_between_phases": true,
    "executor": "BURGER_LOCAL",
    "speed_settings_location": "BURGER_LOCAL_CONFIG"
  },
  "waiting_parking": "FORWARD_REAR_IR",
  "velocity_ownership": "SINGLE_OWNER_LOCAL_ARBITER"
}
```

이 설정은 실제 버거 실행부가 읽도록 구현할 규약입니다. 현재 패키지에 ROS 주행 실행 코드는 없습니다. 출차 선속도·회전 각속도·거리/각도 허용오차·센서 유효시간·제한시간은 버거 로컬 설정에 추가하고 실측해야 합니다. 임의 속도를 Host에서 직접 발행하지 않습니다.

## 버거 담당 구현 항목

1. **거리 확인**: 출차 시작 pose를 기록하고 시작 차체 방향의 후진 이동량을 odometry로 측정합니다. 2초 같은 고정 시간만으로 10cm 완료를 판정하지 않습니다. 횡방향 이탈·거리 초과·센서 유실은 실패로 처리합니다.
2. **회전 확인**: 정지 후 선속도 0으로 회전합니다. odometry/IMU yaw의 ±π 경계 처리를 포함해 누적 변화량 180도를 확인합니다. 좌/우 회전 방향은 현장 공간에 맞춰 로컬에서 정합니다.
3. **속도 제어권**: 초기 출차, Nav2, 최종 도킹 중 하나만 속도 출력 권한을 갖도록 중재합니다. 전환 시 이전 출력과 목표를 종료하고 정지를 확인한 뒤 다음 제어기를 활성화합니다. 보호용 정지·watchdog은 유지합니다.
4. **cmd_vel 경로**: 보드의 실제 namespace, 속도 입력 경로, Twist/TwistStamped 타입을 확인합니다. 버전에 맞는 단일 속도 파이프라인을 사용하고 베이스에 서로 다른 발행자가 경쟁하게 하지 않습니다.
5. **IR 재무장**: HOME·창고·공정·대기장소 출차 시 이미 검은선 위에 있는 상태와 새 목적지의 검출을 구분합니다. 이전 정지 latch를 출차 절차에서 제한적으로 해제하고 다음 도킹 전에 다시 유효화합니다.
6. **중단 처리**: 10cm 출차나 회전 중 실패·취소·정지 요청이면 속도 0과 정지를 확인하고 Nav2로 넘어가지 않습니다. 재접속했다고 10cm를 다시 무조건 후진하지 말고 실제 pose와 작업 상태를 확인합니다.

## Nav2 전진 주행 설정 시 확인할 것

이 파일의 NAV2_FORWARD_ONLY는 프로젝트 정책 이름이며 Nav2의 공통 파라미터 이름이 아닙니다. 선택한 planner/controller/behavior tree 전체를 확인해야 합니다.

- 후진 경로를 만들지 않는 planner 구성을 선택하고, controller의 역주행 허용 설정을 맞춥니다.
- Regulated Pure Pursuit를 사용하는 경우 `allow_reversing: false`가 관련 설정입니다. `use_rotate_to_heading`은 로봇의 제자리 회전 가능 여부와 사용 버전에 맞춰 검토합니다. 다른 controller에 같은 키를 복사하지 않습니다. [Nav2 공식 RPP 문서](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/controller_plugins/configuring_regulated_pp/)
- recovery/behavior tree에 자동 BackUp이 포함돼 있는지도 확인합니다. 정상 경로만 전진이어도 복구 동작에서 후진할 수 있습니다.
- Nav2 전진 제한을 최종 베이스의 모든 음수 속도 금지로 구현하면 도킹 위치의 10cm 후진 출차까지 막힙니다. Nav2 주행과 로컬 출차/도킹의 제어권을 구분합니다.
- 속도 메시지 타입은 버전에 따라 다를 수 있으므로 실제 설치와 드라이버를 확인합니다. [Nav2 속도 메시지 변경 안내](https://docs.nav2.org/rolling/configuration_and_development/migration_guides/jazzy/Jazzy/)

## 시뮬레이션에서 바뀐 부분

- HOME·WAREHOUSE·ASSEMBLY·WAITING 모두 짧은 후진 → 180도 회전 → 전진 경로를 보여줍니다.
- 창고·공정에서는 도킹 위치에서 곧바로 회전하지 않습니다. 10cm 후진 구간의 끝에서 정지·180도 회전한 뒤 전진합니다. 실제 차체 크기와 벽·작업대 간격을 고려해 10cm 이탈 후 회전 공간을 실측 확인합니다.
- 대기장소는 전진 주차하고, 출차할 때 10cm 후진·정지 → 180도 회전 후 전진합니다.
- 웹 맵은 실측 축척이 없으므로 **10cm 구간을 40 화면 단위로 개념 표시**합니다. 이 좌표·소요 시간을 실물에 복사하지 않습니다. config의 실물 출차 거리를 바꾸어도 화면 도형의 실측 크기가 바뀌는 것은 아닙니다.
- 경로 변경에 따라 Host 모의 시간표를 다시 생성했습니다. 최신 파일을 받은 후 기존 Python 서버를 재시작하세요.

## 검증 기준

- 두 버거 모두 HOME·창고·공정·대기장소 도킹 방향 → 후진 0.10m → 정지 → yaw 180도 → 정지 → Nav2 인계 순서를 지킴.
- 일반 이동은 전진이며 중간 코너에서 Host NEXT를 기다리지 않음.
- 대기장소는 최종 전진 주차·후방 IR 정지, ArUco 요구 없음.
- 출차/회전/도킹 중 취소·센서 유실·timeout이면 다음 동작 보류.
- 중복 명령·재접속으로 출차가 반복되지 않음.
- 1개/2개 주문과 기존 교대·공정·복귀 선행 조건이 유지됨.
