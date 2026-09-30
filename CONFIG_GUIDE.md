# 시뮬레이션 관리자 설정 유지보수

관리자 페이지: `admin.html` (공개 사이트의 상단 **관리자 설정** 링크).

## 적용 범위

관리자 화면에서는 버거 1·2의 전진·후진·회전 속도만 조절합니다. 공정 작업 시간은 시뮬레이션 계산에 필요하므로 `config.js`의 `process`에서 관리합니다. 실제 로봇의 Nav2 속도나 ROS 2 파라미터를 제어하지 않습니다. 관리자는 별도 로그인 권한이 있는 서버 관리 기능이 아니라 공개 시뮬레이션 설정 페이지입니다.

- 기본값: 프로젝트 루트 `config.js`.
- 관리자 저장: 현재 브라우저·사이트의 localStorage에 저장. 다른 PC나 다른 방문자의 설정은 변경하지 않음.
- 자동·단계별 시뮬레이션: 새 주문 시작 시 설정을 복사해서 사용. 진행 중인 주문의 시간을 변경하지 않음.
- Host 통신 시험: 서버가 전송한 `simulation_config`를 사용. 브라우저 개인 설정을 적용하지 않으므로 ACK 경계와 애니메이션 시간이 일치함.
- 기존 화면의 재생 배속: 전체 애니메이션 재생 속도. 여기서 지정하는 장치별 속도·작업 시간과 별개.

## 변경 가능한 값

관리자 화면에는 아래 버거 속도 6개만 표시됩니다. `process.*`는 `config.js`에서 직접 수정하며, 기존 브라우저 저장값이나 가져온 JSON의 공정 시간은 화면에서 숨겨져도 저장·내보내기 시 유지됩니다.

| config.js 경로 | 기본값 | 허용 범위 | 의미 |
| --- | --- | --- | --- |
| `burger1.forwardSpeed` | 1 | 0.25~3 | 버거1 전진 속도 배율 |
| `burger1.reverseSpeed` | 1 | 0.25~3 | 버거1 후진 속도 배율 |
| `burger1.turnSpeed` | 90 | 15~180 | 버거1 회전 속도 기준, °/초 |
| `burger2.forwardSpeed` | 1 | 0.25~3 | 버거2 전진 속도 배율 |
| `burger2.reverseSpeed` | 1 | 0.25~3 | 버거2 후진 속도 배율 |
| `burger2.turnSpeed` | 90 | 15~180 | 버거2 회전 속도 기준, °/초 |
| `process.loadPartSeconds` | 1.5 | 0.1~60 | 팔1 부품 1개 적재 시간, 초. 3개면 세 배 |
| `process.assemblySeconds` | 6 | 0.1~120 | 팔2 조립 시간, 초 |
| `process.linearPrepareSeconds` | 3 | 0.1~60 | 리니어 A지그 준비 시간, 초 |
| `process.linearHomeSeconds` | 2 | 0.1~60 | 리니어 원점 복귀 시간, 초 |
| `process.palletSeconds` | 3 | 0.1~120 | 팔3 파렛트 적재 시간, 초 |

`version`은 현재 1로 유지합니다. 값 누락, 문자열, 범위 밖 숫자, NaN/Infinity는 거부합니다. 회전 시간은 각도÷turnSpeed로 정하며 화면에서는 부드러운 가감속을 표현합니다. 전진·후진 배율은 기존 경로별 이동 시간을 기준으로 계산하고 실측 m/s가 아닙니다. 경로 좌표, 마커·센서 조건과 부품 수량은 관리자 수정 대상이 아닙니다.

## 브라우저에서 변경

1. 관리자 설정에서 버거 속도를 입력합니다. A제품 2개의 예상 시간·단계 수가 갱신됩니다.
2. **이 브라우저에 저장**을 누릅니다.
3. 시뮬레이션으로 돌아가 새 주문을 시작합니다.
4. **기본값으로 복원**은 브라우저 저장값을 지우고 현재 `config.js` 값으로 돌아갑니다.

JSON 백업/가져오기는 숨겨진 공정 시간도 포함합니다. 가져오기는 화면에 값만 채우므로 저장 버튼을 눌러야 적용됩니다. 손상된 브라우저 저장값은 기본값으로 대체하고 관리자 페이지에서 안내합니다. 저장소가 차단된 환경에서는 저장 실패를 표시합니다.

## 프로젝트 기본값 변경

1. 관리자에서 **config.js 내보내기**를 누릅니다. 내보내기 자체는 브라우저 저장이 아닙니다.
2. 프로젝트의 `config.js`를 다운로드 파일로 교체합니다. 파일을 직접 편집해도 됩니다.
3. 아래 Host 시간표를 재생성합니다.
4. `config.js`, `host/scenarios.json`, `host/scenario-config.json`을 함께 커밋합니다. GitHub Pages 배포에서도 시간표를 재생성합니다.
5. 브라우저에 개인 설정이 남아 있으면 기본값 복원 후 새 주문으로 확인합니다. 배포 파일 변경 후에는 브라우저를 새로고침합니다.

## Host PC에 적용

Node.js 22 이상과 Python 3가 필요합니다. 이미 생성된 기본 시간표를 실행할 때는 Python만 필요합니다.

서버를 종료한 다음 프로젝트 루트에서:

```bash
node host/build_scenarios.cjs
python3 host/server.py
```

생성기는 `config.js`를 검증한 뒤 다음 파일을 갱신합니다.

- `host/scenarios.json`: 주문 1~20개의 완료 경계 및 카운트
- `host/scenario-config.json`: 해당 시간표 생성에 사용한 설정

서버는 이 두 파일을 시작 시 읽고 설정을 브라우저에 전달합니다. **config.js만 수정하고 시간표를 재생성하지 않으면 Host는 이전 설정을 계속 사용합니다.** 로컬 관리자 화면에는 서버 기준 2개 주문 시간과 단계 수를 별도로 표시합니다. 최신 경로의 2개 주문 8단계는 기본값 기준이며 설정에 따라 단계 수는 달라질 수 있습니다.

## 테스트·다운로드 파일 갱신

```bash
node host/build_scenarios.cjs
node tests/engine.test.cjs
node tests/host-client.test.cjs
node tests/host-stages.test.cjs
node tests/step-ui.test.cjs
node tests/settings.test.cjs
python3 -m unittest discover -s tests -p 'test_host.py'
python3 host/package.py
python3 build_standalone.py
```

`host-test.zip`에 관리자 화면·설정·생성기를 포함합니다. 오프라인 단일 HTML에는 기본 설정과 설정 로더를 내장합니다. 단일 HTML의 관리자 링크는 공개 관리자 페이지로 이동하며, 공개 사이트의 브라우저 저장값과 로컬 파일의 저장 영역은 공유되지 않습니다. 오프라인 기본값을 변경하려면 config.js를 수정하고 단일 HTML을 다시 생성하세요.

코드 위치:

- `config.js`: 수정할 기본값
- `settings.js`: 허용 범위·검증·저장·내보내기
- `admin.html`, `admin.css`, `admin.js`: 관리자 화면
- `engine.js`: 설정에 따른 이동·공정 시간 계산
- `host/build_scenarios.cjs`: Host 시간표 생성

## 주문·ROS 통신·완료 체크 설정

속도 외 Host 시스템 설정은 `system-config.json`과 [SYSTEM_CONFIG_GUIDE.md](SYSTEM_CONFIG_GUIDE.md)를 참고하세요. 주문 범위·기본값과 HTTP Host 설정은 현재 연결됐으며 ROS 관련 규칙은 실제 실행부 구현 시 연결할 계약입니다.
