const css = `
:root{
  --bg:#0c0f14; --card:#131924; --text:#e8edf3; --muted:#9fb0c2;
  --brand:#22c55e; --brand-2:#16a34a; --stroke:#1f2937;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0; background:var(--bg); color:var(--text);
  font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;
}
button{touch-action:manipulation; -webkit-tap-highlight-color:transparent}

.screen{padding:16px; max-width:820px; margin:0 auto}
.hidden{display:none}

.topbar{display:flex; justify-content:space-between; align-items:center; padding:8px 0}
.brand{font-size:22px; margin:0; color:var(--brand)}
.actions{display:flex; gap:8px; align-items:center}
.weekly-chip{background:#0e1a12; color:var(--brand); border:1px solid #1b2a1f; padding:6px 10px; border-radius:999px; font-size:12px}
.chip{border:1px solid var(--stroke); background:#0f172a; color:#e5e7eb; padding:6px 10px; border-radius:999px; font-size:12px}

.card{
  background:var(--card); border:1px solid var(--stroke); border-radius:16px;
  padding:16px; margin:12px 0; box-shadow:0 10px 30px rgba(0,0,0,.25)
}
.card-title{margin:0 0 6px 0; font-size:18px}
.card-sub{margin:0 0 12px 0; color:var(--muted)}
.small{font-size:14px}
.form{display:grid; gap:12px; margin-top:6px}
.field{display:flex; flex-direction:column; gap:6px; text-align:left}
.field>span{font-size:13px; color:var(--muted)}
input,select{
  width:100%; padding:12px 14px; border-radius:12px; border:1px solid var(--stroke);
  background:#0c1320; color:var(--text); font-size:16px; outline:none
}
.btn{width:100%; padding:14px 16px; border-radius:14px; border:0; font-weight:600; font-size:16px}
.primary{background:var(--brand); color:#001b0a}
.primary:active{background:var(--brand-2)}

.row{display:flex; gap:12px; flex-wrap:wrap}
.grow{flex:1} .gap{gap:12px} .between{justify-content:space-between} .center{align-items:center}
.select-wrap{min-width:150px; flex:1}
.tiny-label{display:block; font-size:12px; color:var(--muted); margin-bottom:6px}

.timer-wrap{display:flex; flex-direction:column; align-items:center; padding:12px 0}
.timer{font-size:56px; font-weight:800; letter-spacing:1px}
.subtimer{font-size:14px; color:var(--muted); margin-top:4px}
.status{margin-top:8px; text-align:center; min-height:28px}

.explain{margin-top:12px; text-align:left; background:#0f172a; border:1px solid var(--stroke); border-radius:12px; padding:12px}
.ex-title{font-weight:700; margin-bottom:6px}
.ex-text{color:var(--muted); line-height:1.45}

.controls{display:flex; justify-content:center; gap:16px; margin-top:14px}
.fab{
  width:64px; height:64px; border-radius:50%; border:none; display:grid; place-items:center;
  background:var(--brand); color:#001b0a; box-shadow:0 10px 20px rgba(34,197,94,.25)
}
.fab.secondary{background:#1f2937; color:#e5e7eb}
.fab.tertiary{background:#0f172a; color:#e5e7eb; border:1px solid var(--stroke)}
.fab[disabled]{opacity:.5}

.metric{font-size:14px; color:var(--muted)}
.foot{padding:12px 0 24px; text-align:center; color:var(--muted); font-size:12px}

/* Modal */
.modal{ position:fixed; inset:0; display:grid; place-items:center; z-index:50; }
.modal-card{ position:relative; z-index:51; }   
.backdrop{ position:fixed; inset:0; z-index:50; background:rgba(0,0,0,.5); backdrop-filter:blur(1px); }

.modal-card{
  width:min(92vw,680px); max-height:80vh; overflow:auto;
  background:var(--card); border:1px solid var(--stroke); border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.45)
}
.modal-head{display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid var(--stroke)}
.modal-title{margin:0; font-size:16px}
.modal-body{padding:12px 14px}
.icon-btn{border:0; background:transparent; color:var(--text); padding:6px; border-radius:10px}
.icon-btn:active{background:#111827}
.backdrop{position:fixed; inset:0; background:rgba(0,0,0,.5); backdrop-filter: blur(1px)}

.hist-item{display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--stroke); padding:10px 0}
.hist-item:last-child{border-bottom:0}
.hist-left{display:flex; flex-direction:column; gap:2px}
.badge{padding:2px 8px; border-radius:999px; font-size:11px; border:1px solid var(--stroke)}
.badge.green{background:#0e1a12; color:#22c55e; border-color:#16331f}
.badge.gray{background:#0f172a; color:#cbd5e1}

.hist-day-sep {
  margin-top: 12px;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--muted);
  border-bottom: 1px solid var(--stroke);
  padding-bottom: 2px;
}


@media (min-width:720px){
  .timer{font-size:72px}
  .fab{width:72px; height:72px}
}
`;
const styleTag = document.createElement("style");
styleTag.textContent = css;
document.head.appendChild(styleTag);
