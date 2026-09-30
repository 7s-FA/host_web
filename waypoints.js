(function () {
  const SVG = 'http://www.w3.org/2000/svg';
  const plot = document.getElementById('waypoint-plot');
  const list = document.getElementById('waypoint-list');
  const message = document.getElementById('waypoint-message');
  const element = (tag, attrs = {}, value) => {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([key, val]) => node.setAttribute(key, String(val)));
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const show = (data, source) => {
    if (data.robot !== 'burger1' || data.frame !== 'map' || !Array.isArray(data.waypoints) || !data.waypoints.length || data.waypoints.length > 50) throw new Error('버거 1 map 좌표 JSON 형식이 아닙니다.');
    const points = data.waypoints;
    if (points.some(p => !Number.isInteger(p.number) || ![p.x,p.y,p.yaw].every(Number.isFinite) || !['forward','reverse'].includes(p.mode))) throw new Error('번호, x, y, yaw, mode 값을 확인하세요.');
    const xValues = points.map(p => p.x), yValues = points.map(p => p.y);
    const minX = Math.min(...xValues), maxX = Math.max(...xValues), minY = Math.min(...yValues), maxY = Math.max(...yValues);
    const spanX = Math.max(maxX-minX, .2), spanY = Math.max(maxY-minY, .2);
    const scale = Math.min(460/spanX, 260/spanY);
    const centerX = (minX+maxX)/2, centerY = (minY+maxY)/2;
    const sx = x => 320+(x-centerX)*scale, sy = y => 200-(y-centerY)*scale;
    plot.replaceChildren(element('rect',{x:0,y:0,width:640,height:400,rx:12,fill:'#f5f8f9'}));
    plot.append(element('line',{x1:36,y1:200,x2:604,y2:200,stroke:'#c7d6df','stroke-dasharray':'5 5'}),element('line',{x1:320,y1:30,x2:320,y2:370,stroke:'#c7d6df','stroke-dasharray':'5 5'}));
    plot.append(element('text',{x:580,y:190,fill:'#718b99','font-size':13},'+X'),element('text',{x:332,y:47,fill:'#718b99','font-size':13},'+Y'));
    points.forEach(p => {
      const x = sx(p.x), y = sy(p.y), theta = p.yaw*Math.PI/180;
      plot.append(element('line',{x1:x,y1:y,x2:x+Math.cos(theta)*34,y2:y-Math.sin(theta)*34,stroke:'#e16d36','stroke-width':4,'stroke-linecap':'round'}));
      plot.append(element('circle',{cx:x,cy:y,r:16,fill:'#287a9a',stroke:'#fff','stroke-width':3}));
      plot.append(element('text',{x,y:y+5,'text-anchor':'middle',fill:'#fff','font-size':15,'font-weight':800},String(p.number)));
    });
    list.replaceChildren();
    points.forEach(p => {
      const row = document.createElement('div'); row.className='waypoint-row';
      const number = document.createElement('span'); number.className='number'; number.textContent=p.number;
      const top = document.createElement('div'); top.className='topline';
      const title = document.createElement('strong'); title.textContent=`웨이포인트 ${p.number}`;
      const mode = document.createElement('span'); mode.className='mode'; mode.textContent=p.mode==='forward'?'전진':'후진';
      top.append(title,mode);
      const values = document.createElement('small'); values.textContent=`X ${p.x} m · Y ${p.y} m · yaw ${p.yaw}°`;
      row.append(number,top,values); list.append(row);
    });
    document.getElementById('waypoint-count').textContent=`${points.length}개`;
    message.textContent=source === 'bundled' ? `Confluence 버거 1 좌표 ${points.length}개를 표시합니다. 도면과 yaw 방향을 함께 확인하세요.` : `${points.length}개 웨이포인트를 로컬 파일에서 불러왔습니다. 이 화면에서만 표시됩니다.`;
    message.classList.remove('error');
  };
  document.getElementById('waypoint-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { show(JSON.parse(await file.text()), 'local'); }
    catch(error) { message.textContent=`좌표를 열지 못했습니다: ${error.message}`; message.classList.add('error'); }
  });
  fetch('waypoints-burger1.json', {cache:'no-store'}).then(response => response.ok ? response.json() : null).then(data => {if (data) show(data, 'bundled');}).catch(() => {});
})();
