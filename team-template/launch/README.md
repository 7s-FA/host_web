# 통합 실행 담당

상태: 실행 가능한 launch 파일 미제공.

구현할 구성:

- mock.launch.py: Host + 웹 브리지 + mock 서버 5개, ROS_DOMAIN_ID=40.
- host.launch.py: Host + 웹 브리지만 실행. 실제 장치 서버는 각 보드에서 실행.
- config 경로, 로그 경로, 실행 모드, 웹 포트를 파라미터로 전달.
- mock/실물 모드를 명확히 분리하고 같은 namespace의 mock과 실제 장치를 동시에 실행하지 않음.
- ROS 설치 경로·배포판과 공통 인터페이스 패키지를 확인한 뒤 source/빌드/실행 절차를 루트 README에 추가.

합격: 새 PC에서 README 순서만 따라 동일 구성 실행, domain 40·장치 5개·인터페이스 버전 확인 가능.

실제 보드로 교체할 때는 [실물 전환 안내](../REAL_ROBOT_SETUP.md)를 함께 확인하세요.
