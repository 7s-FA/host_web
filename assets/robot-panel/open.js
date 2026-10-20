(()=>{
 const button=document.getElementById('open-robot-panel'),dialog=document.getElementById('robot-panel-dialog');
 if(!button||!dialog)return;
 const frame=dialog.querySelector('iframe');
 button.onclick=()=>{frame.src='assets/robot-panel/index.html'+(location.pathname.endsWith('/control.html')?'?host_control=1':'');dialog.showModal();};
 dialog.querySelector('button').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{frame.removeAttribute('src');button.focus();});
})();
