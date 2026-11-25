import React, { useCallback, useEffect, useRef, useState } from 'react';

type User = { id: string; email: string; role: 'user' | 'admin' };
type Job = {
  id: string; filename: string; status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number; max_attempts: number; last_error: string | null; owner: string;
  created_at: string; model_version: string | null; outcome: string | null; score: string | null;
};
type Session = { token: string; user: User };

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
    if (typeof body?.message === 'string') message = body.message;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const activeToken = useRef<string | null>(null);
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [simulate, setSimulate] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  useEffect(() => {
    window.history.replaceState(null, '', '/login');
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const loaded = await request<Job[]>('/jobs', session.token);
      if (activeToken.current === session.token) setJobs(loaded);
    } catch (error) {
      if (activeToken.current === session.token) setNotice(error instanceof Error ? error.message : 'Could not load jobs');
    }
  }, [session]);
  useEffect(() => {
    if (!session) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setNotice('');
    try {
      const result = await request<Session>('/auth/login', undefined, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      activeToken.current = result.token; setPassword(''); setSession(result);
      window.history.replaceState(null, '', '/dashboard');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Login failed');
    } finally { setBusy(false); }
  }
  async function logout() {
    if (!session) return;
    setBusy(true);
    let warning = '';
    try {
      await request<void>('/auth/logout', session.token, { method: 'POST' });
    } catch {
      warning = 'Could not revoke the server session. It will expire automatically.';
    } finally {
      activeToken.current = null; setSession(null); setJobs([]); setFile(null); setPassword(''); setNotice(warning); setBusy(false);
      window.history.replaceState(null, '', '/login');
    }
  }
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !session) return;
    setBusy(true); setNotice('');
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('simulateFailure', String(simulate));
      await request('/jobs', session.token, { method: 'POST', body: form });
      setFile(null); setFileKey(value => value + 1); setSimulate(false);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Upload failed');
    } finally { setBusy(false); }
  }

  if (!session) return <main className="login-shell">
    <div className="login-brand"><span className="logo-mark">✳</span><strong>derma<span>lab</span></strong></div>
    <section className="login-card">
      <div className="eyebrow">IMAGE ASSESSMENT LAB</div>
      <h1>Welcome back.</h1>
      <p>Sign in to your workspace to manage and review image assessments.</p>
      {notice && <div className="alert" role="alert">{notice}</div>}
      <form onSubmit={login} className="login-form">
        <label>Email address<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span>→</span></button>
      </form>
      <div className="login-foot">A simulated assessment workspace · Not for clinical use</div>
    </section>
  </main>;

  const count = (status: Job['status']) => jobs.filter(job => job.status === status).length;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="logo-mark">✳</span><strong>derma<span>lab</span></strong></div>
      <div className="side-label">WORKSPACE</div>
      <div className="nav-active"><span>▦</span> Overview</div>
      <div className="sidebar-bottom">
        <div className="user-avatar">{session.user.email[0].toUpperCase()}</div>
        <div className="user-info"><strong>{session.user.email}</strong><small>{session.user.role}</small></div>
        <button className="logout" onClick={() => void logout()} disabled={busy}>Log out</button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><span>Workspace <span className="muted">/</span> Overview</span><span className="environment"><i /> SIMULATION ENVIRONMENT</span></header>
      <div className="content">
        <div className="heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Assessment overview</h1><p>Track image assessments from upload to result.</p></div><div className="live"><i /> Live updates</div></div>
        <div className="disclaimer"><strong>For demonstration only.</strong> Results are generated by a mock model and must not be used for medical decisions.</div>
        {notice && <div className="alert" role="alert">{notice}</div>}
        <div className="stats">
          <div className="stat"><span>Total assessments</span><strong>{jobs.length}</strong><small>Recent jobs</small></div>
          <div className="stat"><span>In progress</span><strong>{count('queued') + count('processing')}</strong><small>Queued or processing</small></div>
          <div className="stat"><span>Completed</span><strong>{count('completed')}</strong><small>Results ready to review</small></div>
          <div className="stat"><span>Failed</span><strong>{count('failed')}</strong><small>Requires attention</small></div>
        </div>
        <section className="upload-card">
          <div><div className="section-icon">↑</div><h2>Start an assessment</h2><p>Upload a simulated lesion image to create a new job.</p></div>
          <form onSubmit={upload} className="upload-form">
            <label className="file-label">Image file <input key={fileKey} type="file" accept="image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0] || null)} required /><small>PNG or JPEG · Maximum 5 MB</small></label>
            <label className="checkbox"><input type="checkbox" checked={simulate} onChange={e => setSimulate(e.target.checked)} /> Simulate a transient failure on the first attempt</label>
            <button disabled={busy || !file}>Create assessment <span>→</span></button>
          </form>
        </section>
        <section className="jobs-card">
          <div className="jobs-heading"><div><h2>Recent assessments</h2><p>{session.user.role === 'admin' ? 'Jobs across all users' : 'Your assessment activity'} · showing up to 200</p></div><button className="refresh" onClick={() => void refresh()}>↻ Refresh</button></div>
          {jobs.length === 0 ? <div className="empty"><div>◇</div><strong>No assessments yet</strong><p>Upload an image to get started.</p></div> :
            <div className="table-wrap"><table><thead><tr><th>IMAGE</th>{session.user.role === 'admin' && <th>OWNER</th>}<th>STATUS</th><th>ATTEMPTS</th><th>RESULT</th><th>MODEL</th><th>CREATED</th></tr></thead>
              <tbody>{jobs.map(job => <tr key={job.id}><td><strong>{job.filename}</strong><small>{job.id.slice(0, 8)}</small></td>{session.user.role === 'admin' && <td>{job.owner}</td>}<td><span className={`badge ${job.status}`}>{job.status}</span>{job.last_error && <small className="error-text">{job.last_error}</small>}</td><td>{job.attempts} / {job.max_attempts}</td><td>{job.outcome ? <>{job.outcome}<small>Score {Number(job.score).toFixed(4)}</small></> : '—'}</td><td>{job.model_version || '—'}</td><td>{new Date(job.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>}
        </section>
        <footer>DERMALAB <span>Built for learning, not diagnosis.</span></footer>
      </div>
    </main>
  </div>;
}

export default App;
