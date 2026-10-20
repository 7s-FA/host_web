(() => {
  const trigger = document.getElementById('open-usage');
  if (!trigger) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'usage-dialog';
  dialog.setAttribute('aria-labelledby', 'usage-title');
  dialog.innerHTML = `<div class="usage-dialog-head"><div><p class="eyebrow">QUICK START</p><h2 id="usage-title">사용방법</h2></div><form method="dialog"><button class="usage-close" type="submit" autofocus aria-label="사용방법 닫기">닫기 ×</button></form></div><iframe id="usage-frame" title="전원부터 실물 시험까지 터미널 실행 순서" data-src="usage.html?v=20261019-reset&embedded=1"></iframe>`;
  document.body.appendChild(dialog);
  const frame = document.getElementById('usage-frame');
  trigger.addEventListener('click', () => {
    if (!frame.hasAttribute('src')) frame.src = frame.dataset.src;
    dialog.showModal();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  frame.addEventListener('load', () => {
    // Escape must also work while a command or copy button inside the frame has focus.
    frame.contentDocument.addEventListener('keydown', event => {
      if (event.key === 'Escape' && dialog.open) {
        event.preventDefault();
        dialog.close();
      }
    });
  });
})();
