"""Build the team Host development handoff plus the working web/HTTP demo."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
prefix = 'robot3_host/'
web_names = ['dashboard.css','control.html','control.css','control.js','HOST_CONTROL_GUIDE.md','ros-config.js','ros-client.js','ROS_BRIDGE_GUIDE.md','system-policy.js','CONFIG_GUIDE.md','config.js','settings.js','admin.html','admin.js','admin.css','downloads.html','downloads.css','waypoints.html','waypoints.css','waypoints.js','routes-burger1.json','host/scenario-config.json','host/build_scenarios.cjs','index.html','styles.css','app.js','engine.js','host-client.js','host/server.py','host/live_control.py','host/system_config.py','host/scenarios.json','host/README.md']
with ZipFile(root / 'host-test.zip', 'w', ZIP_DEFLATED) as z:
    for p in sorted((root / 'team-template').rglob('*')):
        if p.is_file():
            z.write(p, prefix + p.relative_to(root / 'team-template').as_posix())
    z.write(root / 'system-config.json', prefix + 'config/system-config.json')
    z.write(root / 'SYSTEM_CONFIG_GUIDE.md', prefix + 'config/SYSTEM_CONFIG_GUIDE.md')
    for name in web_names:
        z.write(root / name, prefix + 'web/' + name)
    if (root / 'waypoints-burger1.json').is_file():
        z.write(root / 'waypoints-burger1.json', prefix + 'web/waypoints-burger1.json')
    for p in sorted((root / 'assets').rglob('*')):
        if p.is_file():
            z.write(p, prefix + 'web/assets/' + p.relative_to(root / 'assets').as_posix())
print('Created host-test.zip: robot3_host team handoff + web demo')
