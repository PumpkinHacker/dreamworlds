import { useEffect, useState } from "react";
import "./App.css";

const API = "https://dreamworld-auth-api.daviolvcass.workers.dev";
type Player = { playerId: string; username: string; coins: number };
type ApiReply = { token?: string; player?: Player; announcement?: { message?: string }; error?: string };

function App() {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem("dreamworld_session") || ""; } catch { return ""; }
  });

  async function api<T extends ApiReply>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(API + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(init.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({})) as T;
    if (!response.ok) throw new Error(data.error || "The server could not complete that request.");
    return data;
  }

  async function loadAccount(activeToken = token) {
    if (!activeToken) return;
    try {
      const response = await fetch(API + "/auth/me", { headers: { Authorization: "Bearer " + activeToken } });
      const data = await response.json() as ApiReply;
      if (!response.ok || !data.player) {
        localStorage.removeItem("dreamworld_session");
        setToken("");
        setPlayer(null);
        return;
      }
      setPlayer(data.player);
      const stateResponse = await fetch(API + "/player/state", { headers: { Authorization: "Bearer " + activeToken } });
      if (stateResponse.ok) {
        const state = await stateResponse.json() as ApiReply;
        setAnnouncement(state.announcement?.message || "");
        if (state.player) setPlayer({ ...data.player, coins: state.player.coins });
      }
    } catch {
      setMessage("Can't reach the account server right now. Please try again in a moment.");
    }
  }

  useEffect(() => { void loadAccount(token); }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await api(mode === "register" ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!data.token || !data.player) throw new Error("The server returned an incomplete account response.");
      localStorage.setItem("dreamworld_session", data.token);
      setToken(data.token);
      setPlayer(data.player);
      setPassword("");
      setMessage(mode === "register" ? "Account created! Your player ID is saved below." : "Welcome back!");
      await loadAccount(data.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem("dreamworld_session");
    setToken("");
    setPlayer(null);
    setAnnouncement("");
    setMessage("You signed out.");
  }

  return (
    <main className="page">
      <div className="stars" aria-hidden="true">✦　✧　✦　☁　✧　✦</div>
      <section className="shell">
        <div className="brand-mark" aria-hidden="true">🐾</div>
        <p className="eyebrow">YOUR LITTLE CORNER OF MAGIC</p>
        <h1>Dream <span>World</span></h1>
        <p className="subtitle">A cozy place for your next adventure.</p>

        {player ? (
          <section className="account">
            <div className="welcome">✨ You're in, {player.username}!</div>
            <p className="hint">Keep your player ID private. It helps identify your account.</p>
            <div className="stats">
              <div><small>PLAYER ID</small><strong>{player.playerId}</strong></div>
              <div><small>YOUR COINS</small><strong>🪙 {player.coins}</strong></div>
            </div>
            {announcement && <div className="announcement"><strong>📣 Dream World news</strong><p>{announcement}</p></div>}
            <button className="primary" onClick={() => void loadAccount()}>Refresh account</button>
            <button className="secondary" onClick={signOut}>Sign out</button>
            <p className="footnote">Never share your password or session code with anyone.</p>
          </section>
        ) : (
          <>
            <div className="switcher" role="tablist" aria-label="Account action">
              <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>Create account</button>
              <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Log in</button>
            </div>
            <form onSubmit={submit}>
              <label htmlFor="username">Username</label>
              <input id="username" autoComplete="username" minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" required value={username} onChange={e => setUsername(e.target.value)} placeholder="Choose a username" />
              <p className="field-help">3–20 letters, numbers, or underscores.</p>
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : 1} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 8 characters" : "Your password"} />
              {mode === "register" && <p className="field-help">Use a unique password. Don't use your real name or share private information.</p>}
              <button className="primary" disabled={busy}>{busy ? "Please wait…" : mode === "register" ? "✨ Create my account" : "🌙 Log in"}</button>
            </form>
            {message && <p className="message" role="status">{message}</p>}
            <p className="footnote">No real name, phone number, or email is needed to create an account.</p>
          </>
        )}
      </section>
      <footer>Made for magical adventures ✨</footer>
    </main>
  );
}

export default App;
