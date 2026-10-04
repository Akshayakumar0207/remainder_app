import { useEffect, useRef, useState } from "react";

const CATS = ["Work", "Personal", "Health", "Study", "Other"];

/* ---------- sound (Web Audio, no files needed) ---------- */
let audioCtx;
const unlockAudio = () => {
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
};
const beep = () => {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = "square"; o.frequency.value = 880; g.gain.value = 0.15;
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + 0.25);
};

/* ---------- api ---------- */
async function api(path, opts = {}, isForm = false) {
  const t = localStorage.getItem("token");
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(t ? { Authorization: "Bearer " + t } : {}) },
    body: isForm ? opts.body : opts.body && JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Something went wrong. Try again.");
  return data;
}

/* ---------- login / register ---------- */
function Auth({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const done = (r) => { localStorage.setItem("token", r.token); onAuth(); };

  const submit = async (e) => {
    e.preventDefault(); setErr("");
    try { done(await api(mode === "login" ? "/login" : "/register", { method: "POST", body: f })); }
    catch (x) { setErr(x.message); }
  };

  useEffect(() => {
    const id = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!id || !window.google) return;
    google.accounts.id.initialize({
      client_id: id,
      callback: async (r) => {
        try { done(await api("/google", { method: "POST", body: { credential: r.credential } })); }
        catch (x) { setErr(x.message); }
      },
    });
    google.accounts.id.renderButton(document.getElementById("gbtn"), { theme: "outline", size: "large", width: 300 });
  }, []);

  return (
    <main className="auth">
      <h1>Nudge</h1>
      <p className="lead">Reminders that take over your screen until you deal with them.</p>
      <form onSubmit={submit}>
        {mode === "register" && <input placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        <input type="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input type="password" placeholder="Password (6+ characters)" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {err && <p className="err">{err}</p>}
        <button className="primary">{mode === "login" ? "Log in" : "Create account"}</button>
      </form>
      <div id="gbtn" />
      <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}
      </button>
    </main>
  );
}

/* ---------- the alarm ---------- */
function Alarm({ r, onDone, onSnooze }) {
  useEffect(() => {
    const speak = () => {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(`Reminder. ${r.title}. ${r.description}`));
    };
    beep(); speak();
    const b = setInterval(beep, 600), s = setInterval(speak, 12000);
    let lock;
    navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => { clearInterval(b); clearInterval(s); speechSynthesis.cancel(); lock?.release(); };
  }, [r.id]);

  return (
    <div className="alarm" role="alertdialog">
      <h1>{r.title}</h1>
      {r.description && <p>{r.description}</p>}
      <small>{r.category} · due {new Date(r.remind_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      <div className="row">
        <button className="ok" onClick={onDone}>Done</button>
        <button onClick={onSnooze}>Snooze 5 min</button>
      </div>
    </div>
  );
}

/* ---------- dashboard ---------- */
function Dashboard({ onLogout }) {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [alarm, setAlarm] = useState(null);
  const [filter, setFilter] = useState("All");
  const [armed, setArmed] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "Work", when: "" });
  const [err, setErr] = useState("");
  const itemsRef = useRef([]); itemsRef.current = items;
  const alarmRef = useRef(null); alarmRef.current = alarm;

  const load = async () => setItems(await api("/reminders"));

  useEffect(() => {
    api("/me").then(setUser).catch(onLogout);
    load().catch(() => {});
    const poll = setInterval(() => load().catch(() => {}), 10000);
    const tick = setInterval(() => {
      if (alarmRef.current) return;
      const due = itemsRef.current.find((r) => r.status === "pending" && new Date(r.remind_at) <= new Date());
      if (due) {
        setAlarm(due);
        if (window.Notification?.permission === "granted") new Notification(due.title, { body: due.description });
      }
    }, 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  const arm = () => { unlockAudio(); window.Notification?.requestPermission(); setArmed(true); };

  const add = async (e) => {
    e.preventDefault(); setErr("");
    try {
      await api("/reminders", { method: "POST", body: { title: form.title, description: form.description, category: form.category, remind_at: new Date(form.when).toISOString() } });
      setForm({ ...form, title: "", description: "", when: "" });
      load();
    } catch (x) { setErr(x.message); }
  };

  const act = async (patch) => {
    await api("/reminders/" + alarm.id, { method: "PATCH", body: patch });
    await load(); setAlarm(null);
  };
  const setStatus = async (id, status) => { await api("/reminders/" + id, { method: "PATCH", body: { status } }); load(); };
  const remove = async (id) => { await api("/reminders/" + id, { method: "DELETE" }); load(); };
  const upload = async (e) => {
    const fd = new FormData(); fd.append("file", e.target.files[0]);
    try { const r = await api("/me/pic", { method: "POST", body: fd }, true); setUser({ ...user, pic: r.pic }); } catch (x) { setErr(x.message); }
  };

  const shown = items.filter((r) => filter === "All" || r.category === filter);

  return (
    <div className="wrap">
      {alarm && <Alarm r={alarm} onDone={() => act({ status: "done" })} onSnooze={() => act({ remind_at: new Date(Date.now() + 5 * 60000).toISOString() })} />}
      <header>
        <h1>Nudge</h1>
        {user && (
          <div className="me">
            <label title="Change profile picture">
              {user.pic ? <img src={user.pic} alt="" /> : <span className="ph">{user.name?.[0]?.toUpperCase()}</span>}
              <input type="file" accept="image/*" hidden onChange={upload} />
            </label>
            <span>{user.name}</span>
            <button className="link" onClick={onLogout}>Log out</button>
          </div>
        )}
      </header>

      {!armed && (
        <div className="arm">
          <p>Alarms only make sound after you switch them on in this tab. Keep this tab open.</p>
          <button className="primary" onClick={arm}>Switch on alarms</button>
        </div>
      )}

      <form className="add" onSubmit={add}>
        <input placeholder="What should I remind you about?" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea placeholder="Message to read out loud when the alarm rings" rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="row">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          <input type="datetime-local" required value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          <button className="primary">Add reminder</button>
        </div>
        {err && <p className="err">{err}</p>}
      </form>

      <nav className="chips">
        {["All", ...CATS].map((c) => <button key={c} className={filter === c ? "on" : ""} onClick={() => setFilter(c)}>{c}</button>)}
      </nav>

      <ul className="list">
        {shown.length === 0 && <li className="empty">No reminders here yet. Add one above.</li>}
        {shown.map((r) => (
          <li key={r.id} className={r.status}>
            <div>
              <b>{r.title}</b>
              <p>{r.description}</p>
              <small>{r.category} · {new Date(r.remind_at).toLocaleString()} · {r.status}</small>
            </div>
            <div className="row">
              {r.status === "pending" && <button onClick={() => setStatus(r.id, "done")}>Mark done</button>}
              <button onClick={() => remove(r.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("token"));
  const logout = () => { localStorage.removeItem("token"); setAuthed(false); };
  return authed ? <Dashboard onLogout={logout} /> : <Auth onAuth={() => setAuthed(true)} />;
}
