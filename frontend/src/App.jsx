import React from 'react';
import { useEffect, useRef, useState } from 'react';

const API = 'http://127.0.0.1:8000';

function Camera({ onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraError, setCameraError] = useState('');

  async function startCamera() {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    } catch {
      setCameraError('Não foi possível acessar a câmera. Verifique a permissão do navegador.');
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('Ligue a câmera antes de capturar a foto.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => onCapture(blob), 'image/jpeg', 0.9);
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach(track => track.stop()), []);

  return <div className="camera">
    <video ref={videoRef} playsInline muted />
    <div className="camera-actions">
      <button type="button" className="secondary" onClick={startCamera}>Ligar câmera</button>
      <button type="button" onClick={capture}>Capturar foto</button>
    </div>
    {cameraError && <p className="error">{cameraError}</p>}
  </div>;
}

export default function App() {
  const [page, setPage] = useState('register');
  const [photo, setPhoto] = useState(null);
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [role, setRole] = useState('');
  const [punchType, setPunchType] = useState('Entrada');
  const [employees, setEmployees] = useState([]);
  const [punches, setPunches] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadData() {
    try {
      const [e, p] = await Promise.all([fetch(`${API}/employees`), fetch(`${API}/punches`)]);
      if (e.ok) setEmployees(await e.json());
      if (p.ok) setPunches(await p.json());
    } catch {
      setError('Não foi possível conectar à API. Confira se o backend está em execução.');
    }
  }

  useEffect(() => { loadData(); }, []);
  function changePage(next) {
    setPage(next); setPhoto(null); setMessage(''); setError('');
    if (next === 'history') loadData();
  }

  async function submitEmployee(event) {
    event.preventDefault(); setError(''); setMessage('');
    if (!photo) { setError('Capture uma foto antes de cadastrar.'); return; }
    const data = new FormData();
    data.append('name', name); data.append('registration', registration); data.append('role', role);
    data.append('photo', photo, 'rosto.jpg');
    setLoading(true);
    try {
      const response = await fetch(`${API}/employees`, { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Erro ao cadastrar.');
      setMessage(result.message); setName(''); setRegistration(''); setRole(''); setPhoto(null); loadData();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function submitPunch(event) {
    event.preventDefault(); setError(''); setMessage('');
    if (!photo) { setError('Capture seu rosto antes de registrar o ponto.'); return; }
    const data = new FormData();
    data.append('punch_type', punchType); data.append('photo', photo, 'captura.jpg');
    setLoading(true);
    try {
      const response = await fetch(`${API}/punch`, { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Não foi possível registrar.');
      setMessage(`${result.message} Funcionário: ${result.employee.name} | ${result.punch_type} | ${new Date(result.date_time).toLocaleString('pt-BR')}`);
      setPhoto(null); loadData();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return <main className="container">
    <header>
      <div><span className="eyebrow">PROJETO ACADÊMICO</span><h1>Registro de Ponto</h1><p>Identificação por reconhecimento facial</p></div>
      <div className="face-icon">◉</div>
    </header>
    <nav>
      <button className={page === 'register' ? 'active' : ''} onClick={() => changePage('register')}>Cadastro</button>
      <button className={page === 'punch' ? 'active' : ''} onClick={() => changePage('punch')}>Registrar ponto</button>
      <button className={page === 'history' ? 'active' : ''} onClick={() => changePage('history')}>Histórico</button>
    </nav>

    {message && <div className="notice success">{message}</div>}
    {error && <div className="notice danger">{error}</div>}

    {page === 'register' && <section className="panel">
      <h2>Cadastro de funcionário</h2><p className="muted">Preencha os dados e capture uma foto frontal do funcionário.</p>
      <form onSubmit={submitEmployee}>
        <div className="fields">
          <label>Nome completo<input value={name} onChange={e => setName(e.target.value)} required placeholder="Ex.: Maria da Silva" /></label>
          <label>Matrícula<input value={registration} onChange={e => setRegistration(e.target.value)} required placeholder="Ex.: 001" /></label>
          <label className="full">Cargo<input value={role} onChange={e => setRole(e.target.value)} required placeholder="Ex.: Assistente administrativo" /></label>
        </div>
        <h3>Fotografia facial</h3><Camera onCapture={setPhoto} />
        {photo && <p className="photo-ok">✓ Foto capturada e pronta para cadastro.</p>}
        <button disabled={loading} className="submit">{loading ? 'Cadastrando...' : 'Cadastrar funcionário'}</button>
      </form>
      <p className="muted small">Funcionários cadastrados: {employees.length}</p>
    </section>}

    {page === 'punch' && <section className="panel">
      <h2>Registrar ponto</h2><p className="muted">Posicione o rosto no centro da câmera e selecione o tipo de registro.</p>
      <form onSubmit={submitPunch}>
        <label>Tipo de registro<select value={punchType} onChange={e => setPunchType(e.target.value)}>
          <option>Entrada</option><option>Saída</option><option>Intervalo - início</option><option>Intervalo - fim</option>
        </select></label>
        <h3>Identificação facial</h3><Camera onCapture={setPhoto} />
        {photo && <p className="photo-ok">✓ Captura pronta para reconhecimento.</p>}
        <button disabled={loading} className="submit">{loading ? 'Analisando rosto...' : 'Identificar e registrar ponto'}</button>
      </form>
    </section>}

    {page === 'history' && <section className="panel">
      <div className="history-heading"><div><h2>Histórico de pontos</h2><p className="muted">Registros mais recentes.</p></div><button className="secondary" onClick={loadData}>Atualizar</button></div>
      {punches.length === 0 ? <p className="empty">Ainda não existem registros de ponto.</p> :
        <div className="table-wrap"><table><thead><tr><th>Funcionário</th><th>Matrícula</th><th>Tipo</th><th>Data e horário</th></tr></thead>
        <tbody>{punches.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.registration}</td><td><span className="tag">{p.punch_type}</span></td><td>{new Date(p.punch_datetime).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div>}
    </section>}
    <footer>React • Python / FastAPI • DeepFace • SQLite</footer>
  </main>;
}
