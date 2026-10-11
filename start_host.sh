#!/usr/bin/env bash
set -eo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ ! -f /opt/ros/jazzy/setup.bash ]]; then
  echo 'ROS 2 Jazzy가 필요합니다: /opt/ros/jazzy/setup.bash' >&2
  exit 1
fi
source /opt/ros/jazzy/setup.bash

host_overlay="$HOME/final_project_host/host_backend/install_local/local_setup.bash"
if [[ ! -f "$host_overlay" ]]; then
  echo "Action 타입 빌드가 필요합니다: $host_overlay" >&2
  echo 'README의 «Host PC 한 번에 실행» 최초 준비를 먼저 실행하세요.' >&2
  exit 1
fi
source "$host_overlay"

export ROS_DOMAIN_ID=40
export ROS_LOCALHOST_ONLY=0
# 시작할 때 M1·M2 관제 준비(robot_prepare.py)도 함께 실행한다. 로그는 이 터미널에 [버거1]/[버거2] 로 표시된다.
#   bash start_host.sh                      # 준비 포함 (기본)
#   bash start_host.sh parked:=true         # 로봇이 자기 주차 자리에 있을 때 (주차 좌표로 위치 설정)
#   bash start_host.sh robot_prepare:=false # 준비 없이 웹·rosbridge 만
exec ros2 launch "$PWD/host/host_control.launch.py" "$@"
