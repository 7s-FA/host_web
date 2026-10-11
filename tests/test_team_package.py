"""Verify the actual downloadable tree, not only the source layout."""
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from zipfile import ZipFile
import importlib.util
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

class TeamPackageTest(unittest.TestCase):
    def test_extracted_package_and_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            with ZipFile(ROOT/'host-test.zip') as z:
                names=z.namelist()
                self.assertEqual(len(names),len(set(names)))
                self.assertTrue(all(x.startswith('robot3_host/') and '..' not in Path(x).parts for x in names))
                z.extractall(tmp)
            root=Path(tmp)/'robot3_host'
            for name in ['README.md','REAL_ROBOT_SETUP.md','NAVIGATION_POLICY.md','config/system-config.json','config/SYSTEM_CONFIG_GUIDE.md','robot3_interfaces/action/README.md','robot3_interfaces/msg/README.md','robot3_orchestrator/README.md','robot3_web_bridge/README.md','robot3_mock_devices/README.md','launch/README.md','tests/README.md','web/index.html','web/dashboard.css','web/ros-config.js','web/ros-client.js','web/live-map-config.js','web/live-map-model.js','web/live-map-client.js','web/live-map.js','web/robot-stop-client.js','web/robot-stop.js','web/robot-battery-client.js','web/robot-battery.js','web/device-connection-client.js','web/device-connection.js','web/device-connection.css','web/ROS_BRIDGE_GUIDE.md','web/assets/vendor/roslib-1.4.1.min.js','web/assets/vendor/ROSLIB-LICENSE.txt','web/control.html','web/control.css','web/control.js','web/HOST_CONTROL_GUIDE.md','web/host/live_control.py','web/downloads.html','web/downloads.css','web/waypoints.html','web/waypoints.css','web/waypoints.js','web/routes-burger1.json','web/routes-burger2.json','web/waypoints-burger1.json','web/assets/waypoints-burger1-source.png','web/host/server.py','web/assets/full-map.jpg']:
                self.assertTrue((root/name).is_file(),name)
            self.assertFalse((root/'web/system-config.json').exists(),'Only one canonical system config')
            for name in ['admin.html','admin.js','admin.css','CONFIG_GUIDE.md']:
                self.assertFalse((root/'web'/name).exists(), name)
            cfgpath=root/'config/system-config.json'
            c=json.loads(cfgpath.read_text());c['order'].update(quantity_min=1,quantity_default=1,quantity_max=2,auto_advance_default=False)
            cfgpath.write_text(json.dumps(c))
            subprocess.run([sys.executable,str(root/'web/host/system_config.py'),'--write-web-policy'],cwd=tmp,check=True,capture_output=True)
            self.assertIn('"quantity_default": 1',(root/'web/system-policy.js').read_text())
            self.assertFalse((root/'config/system-policy.js').exists())
            # Run the extracted server import in a separate interpreter: no module-cache sharing.
            program='''
import sys,threading,json
from urllib.request import urlopen,Request
from urllib.error import HTTPError
sys.path.insert(0,sys.argv[1])
import server
s=server.make_server(0)
threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 base=f'http://127.0.0.1:{s.server_port}'
 for name in ['/','/control.html','/control.css','/control.js','/HOST_CONTROL_GUIDE.md','/downloads.html','/downloads.css','/waypoints.html','/waypoints.css','/waypoints.js','/routes-burger1.json','/routes-burger2.json','/waypoints-burger1.json','/assets/waypoints-burger1-source.png','/dashboard.css','/ros-config.js','/ros-client.js','/live-map-config.js','/live-map-model.js','/live-map-client.js','/live-map.js','/robot-stop-client.js','/robot-stop.js','/robot-battery-client.js','/robot-battery.js','/device-connection-client.js','/device-connection.js','/device-connection.css','/assets/vendor/roslib-1.4.1.min.js','/engine.js','/assets/full-map.jpg']:
  assert urlopen(base+name).status==200,name
 c=json.load(urlopen(base+'/system-config.json'))
 assert c['order']['quantity_max']==2
 assert c['order']['quantity_default']==1
 assert b'quantity_default' in urlopen(base+'/system-policy.js').read()
 w=json.load(urlopen(base+'/waypoints-burger1.json'))
 assert len(w['waypoints'])==4 and w['waypoints'][1]['y']==0.360654172
 def post(action,data):
  req=Request(base+'/api/'+action,json.dumps({'client_id':'package-test','message_id':action,**data}).encode(),{'Content-Type':'application/json','Origin':base})
  return json.load(urlopen(req))
 post('connect',{})
 try:post('start',{'quantity':3})
 except HTTPError as error:assert error.code==400
 else:raise AssertionError('Three-item order accepted')
 state=post('start',{'quantity':2,'product_type':'B'})
 assert state['product_type']=='B'
 assert any('B제품 2개' in e['text'] for e in state['command']['events'])
 while state['status']!='done':
  cmd=state['command']
  if cmd: state=post('ack',{'message_id':'ack'+str(cmd['seq']),'order_id':cmd['order_id'],'seq':cmd['seq'],'time':cmd['target_time']})
  if state['status']=='waiting': state=post('next',{'message_id':'next'+str(state['acked_seq'])})
 assert state['counters']['completed']==2
 assert state['product_type']=='B'
 assert 'B제품 2개' in state['counters']['events'][-1]['text']
finally:s.shutdown();s.server_close()
'''
            subprocess.run([sys.executable,'-c',program,str(root/'web/host')],cwd=tmp,check=True,timeout=30,capture_output=True)

if __name__=='__main__':unittest.main()
