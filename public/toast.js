// toast.js — helper notifikasi global
window.toast = function(msg, type = 'info', duration = 3000) {
    let box = document.getElementById('toast');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast';
        document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast-item' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
        el.style.transition = 'opacity 0.3s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, duration);
};
