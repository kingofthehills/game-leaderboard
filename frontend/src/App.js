import React, { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || '/api/leaderboard';
const REFRESH_INTERVAL = 10;

function App() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const countdownRef = useRef(REFRESH_INTERVAL);

  // Search state
  const [searchId, setSearchId] = useState('');
  const [playerRank, setPlayerRank] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Submit score state
  const [submitUserId, setSubmitUserId] = useState('');
  const [submitScore, setSubmitScore] = useState('');
  const [submitGameMode, setSubmitGameMode] = useState('classic');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  // Seed state
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  const fetchLeaderboard = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/top`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setLeaderboard(data.data);
        setLastUpdate(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(() => {
      fetchLeaderboard();
      countdownRef.current = REFRESH_INTERVAL;
      setCountdown(REFRESH_INTERVAL);
    }, REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  useEffect(() => {
    const timer = setInterval(() => {
      countdownRef.current = Math.max(0, countdownRef.current - 1);
      setCountdown(countdownRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Search player ──
  const searchPlayer = async (e) => {
    e.preventDefault();
    const id = searchId.trim();
    if (!id) return;

    setSearchLoading(true);
    setSearchError(null);
    setPlayerRank(null);

    try {
      const res = await fetch(`${API_BASE}/rank/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setPlayerRank(data.data);
      } else {
        setSearchError(data.error?.message || data.message || `Player ${id} not found`);
      }
    } catch (err) {
      setSearchError('Network error — could not reach the server');
    } finally {
      setSearchLoading(false);
    }
  };

  // ── Submit score ──
  const handleSubmitScore = async (e) => {
    e.preventDefault();
    const uid = parseInt(submitUserId, 10);
    const sc = parseInt(submitScore, 10);
    if (!uid || uid < 1) { setSubmitError('Enter a valid User ID'); return; }
    if (!sc || sc < 0) { setSubmitError('Enter a valid score (≥ 0)'); return; }

    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitResult(null);

    try {
      const res = await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: uid, score: sc, game_mode: submitGameMode }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSubmitResult(data.data);
        setSubmitUserId('');
        setSubmitScore('');
        await fetchLeaderboard();
      } else {
        setSubmitError(data.error?.message || 'Failed to submit score');
      }
    } catch (err) {
      setSubmitError('Network error — could not reach the server');
    } finally {
      setSubmitLoading(false);
    }
  };

  // ── Submit random score ──
  const submitRandomScore = async () => {
    if (leaderboard.length === 0) return;
    const randomUser = leaderboard[Math.floor(Math.random() * leaderboard.length)];
    const score = Math.floor(Math.random() * 5000) + 100;
    try {
      await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: randomUser.user_id,
          score,
          game_mode: ['classic', 'ranked', 'casual', 'tournament'][Math.floor(Math.random() * 4)],
        }),
      });
      await fetchLeaderboard();
    } catch (err) {
      console.error('Failed to submit score:', err);
    }
  };

  // ── Seed database ──
  const seedDatabase = async (clearExisting = false) => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch(`${API_BASE}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_count: 100, sessions_per_user: 5, clear_existing: clearExisting }),
      });
      const data = await res.json();
      if (data.success) {
        setSeedResult(data.data);
        await fetchLeaderboard();
      } else {
        setSeedResult({ error: data.error?.message || 'Seed failed' });
      }
    } catch (err) {
      setSeedResult({ error: 'Failed to seed database' });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div style={styles.page}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <h1 style={styles.title}>🎮 Gaming Leaderboard</h1>
        <div style={styles.headerMeta}>
          <span style={{
            ...styles.liveDot,
            backgroundColor: isRefreshing ? '#4fc3f7' : '#4caf50',
            boxShadow: isRefreshing ? '0 0 10px #4fc3f7' : '0 0 10px #4caf50',
          }} />
          <span style={styles.metaText}>Auto-refresh: {countdown}s</span>
          {lastUpdate && <span style={styles.metaText}>| Last update: {lastUpdate}</span>}
        </div>
      </header>

      {/* ── Actions Bar ── */}
      <div style={styles.actionsBar}>
        <button onClick={() => seedDatabase(false)} style={{ ...styles.btn, backgroundColor: '#66bb6a' }} disabled={seeding}>
          {seeding ? '⏳ Seeding...' : '🌱 Seed (Add 100 Users)'}
        </button>
        <button onClick={() => seedDatabase(true)} style={{ ...styles.btn, backgroundColor: '#ef5350' }} disabled={seeding}>
          {seeding ? '⏳...' : '🔄 Reset & Reseed'}
        </button>
        <button onClick={submitRandomScore} style={{ ...styles.btn, backgroundColor: '#ffa726' }} disabled={leaderboard.length === 0}>
          🎲 Random Score
        </button>
        {seedResult && !seedResult.error && (
          <span style={styles.seedBadge}>
            ✅ {seedResult.users} users, {seedResult.game_sessions?.toLocaleString()} sessions in {seedResult.elapsed_seconds}s
          </span>
        )}
        {seedResult?.error && <span style={styles.errorBadge}>❌ {seedResult.error}</span>}
      </div>

      {/* ── Main Grid: 3 columns ── */}
      <div style={styles.grid}>
        {/* Left Column — Leaderboard */}
        <div style={{
          ...styles.card,
          flex: '1 1 0',
          minWidth: 0,
          transition: 'box-shadow 0.3s',
          boxShadow: isRefreshing ? '0 0 24px rgba(79,195,247,0.25)' : '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <h2 style={styles.cardTitle}>🏆 Top 10 Players</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Rank</th>
                <th style={styles.th}>Player</th>
                <th style={styles.th}>User ID</th>
                <th style={styles.thRight}>Total Score</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((p) => (
                <tr key={p.user_id} style={styles.tr}>
                  <td style={styles.td}>
                    {p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : `#${p.rank}`}
                  </td>
                  <td style={styles.td}>{p.username}</td>
                  <td style={{ ...styles.td, color: '#888' }}>{p.user_id}</td>
                  <td style={styles.tdScore}>{p.total_score.toLocaleString()}</td>
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr><td colSpan="4" style={styles.empty}>No data — click "Seed" to add players!</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Right Column — stacked cards */}
        <div style={styles.rightCol}>
          {/* Submit Score Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>🎯 Submit Score</h2>
            <form onSubmit={handleSubmitScore} style={styles.formGrid}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ ...styles.fieldRow, flex: 1 }}>
                  <label style={styles.label}>User ID</label>
                  <input
                    type="number"
                    placeholder="e.g. 520"
                    value={submitUserId}
                    onChange={(e) => setSubmitUserId(e.target.value)}
                    style={styles.input}
                    min="1"
                    required
                  />
                </div>
                <div style={{ ...styles.fieldRow, flex: 1 }}>
                  <label style={styles.label}>Score</label>
                  <input
                    type="number"
                    placeholder="e.g. 1500"
                    value={submitScore}
                    onChange={(e) => setSubmitScore(e.target.value)}
                    style={styles.input}
                    min="0"
                    max="1000000"
                    required
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <div style={{ ...styles.fieldRow, flex: 1 }}>
                  <label style={styles.label}>Mode</label>
                  <select
                    value={submitGameMode}
                    onChange={(e) => setSubmitGameMode(e.target.value)}
                    style={styles.select}
                  >
                    <option value="classic">Classic</option>
                    <option value="ranked">Ranked</option>
                    <option value="casual">Casual</option>
                    <option value="tournament">Tournament</option>
                  </select>
                </div>
                <button type="submit" style={{ ...styles.btn, backgroundColor: '#7c4dff', padding: '11px 20px', flex: 1 }} disabled={submitLoading}>
                  {submitLoading ? '⏳ Submitting...' : '🚀 Submit Score'}
                </button>
              </div>
            </form>
            {submitResult && (
              <div style={styles.successBox}>
                ✅ Submitted! Session #{submitResult.session_id} — User {submitResult.user_id} now has <strong>{submitResult.total_score?.toLocaleString()}</strong> total
              </div>
            )}
            {submitError && <p style={styles.error}>{submitError}</p>}
          </div>

          {/* Search Player Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>🔍 Search Player Rank</h2>
            <form onSubmit={searchPlayer} style={styles.formRow}>
              <input
                type="number"
                placeholder="Enter User ID"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                style={styles.input}
                min="1"
                required
              />
              <button type="submit" style={{ ...styles.btn, backgroundColor: '#4fc3f7' }} disabled={searchLoading}>
                {searchLoading ? '⏳...' : 'Search'}
              </button>
            </form>
            {searchError && <p style={styles.error}>{searchError}</p>}
            {playerRank && (
              <div style={styles.resultBox}>
                <div style={styles.resultHeader}>{playerRank.username}</div>
                <div style={styles.resultStats}>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Rank</span>
                    <span style={styles.statValue}>#{playerRank.rank?.toLocaleString() || 'N/A'}</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Total Score</span>
                    <span style={styles.statValue}>{playerRank.total_score?.toLocaleString() || 0}</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>User ID</span>
                    <span style={styles.statValue}>{playerRank.user_id}</span>
                  </div>
                </div>
                {playerRank.message && <p style={{ color: '#ffa726', marginTop: '8px', fontSize: '0.85rem' }}>{playerRank.message}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer style={styles.footer}>
        Node.js + Express + PostgreSQL + Redis &nbsp;|&nbsp; Auto-refresh every {REFRESH_INTERVAL}s
      </footer>
    </div>
  );
}

/* ─── Styles ─── */
const styles = {
  page: {
    width: '100%',
    maxWidth: '100%',
    margin: 0,
    padding: '20px 40px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#e0e0e0',
    backgroundColor: '#121212',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
    flexWrap: 'wrap',
    gap: '12px',
  },
  title: { fontSize: '1.8rem', margin: 0 },
  headerMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.85rem',
    color: '#aaa',
  },
  liveDot: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    transition: 'all 0.3s',
  },
  metaText: { fontFamily: 'monospace', fontSize: '0.85rem', color: '#aaa' },

  /* Actions bar */
  actionsBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    marginBottom: '24px',
    padding: '16px 24px',
    backgroundColor: '#1e1e2e',
    borderRadius: '12px',
  },
  seedBadge: {
    fontSize: '0.8rem', color: '#a5d6a7', backgroundColor: '#1b5e20',
    padding: '6px 12px', borderRadius: '6px',
  },
  errorBadge: {
    fontSize: '0.8rem', color: '#ef9a9a', backgroundColor: '#4e1212',
    padding: '6px 12px', borderRadius: '6px',
  },

  /* Grid */
  grid: {
    display: 'flex',
    gap: '24px',
    alignItems: 'stretch',
  },
  rightCol: {
    flex: '0 0 380px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    minWidth: '380px',
  },

  /* Cards */
  card: {
    backgroundColor: '#1e1e2e',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  cardTitle: {
    fontSize: '1.2rem',
    marginTop: 0,
    marginBottom: '16px',
  },

  /* Table */
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  th: {
    textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #333',
    color: '#aaa', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  thRight: {
    textAlign: 'right', padding: '12px 16px', borderBottom: '2px solid #333',
    color: '#aaa', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  tr: { borderBottom: '1px solid #2a2a3a' },
  td: { padding: '14px 16px', fontSize: '1rem' },
  tdScore: {
    padding: '14px 16px', textAlign: 'right', fontFamily: 'monospace',
    fontWeight: 'bold', color: '#4fc3f7', fontSize: '1.05rem',
  },
  empty: { textAlign: 'center', padding: '24px', color: '#666' },

  /* Forms */
  formRow: { display: 'flex', gap: '10px' },
  formGrid: { display: 'flex', flexDirection: 'column', gap: '10px' },
  fieldRow: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '0.78rem', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: {
    padding: '10px 14px', borderRadius: '8px', border: '1px solid #444',
    backgroundColor: '#2a2a3a', color: '#e0e0e0', fontSize: '0.95rem', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  },
  select: {
    padding: '10px 14px', borderRadius: '8px', border: '1px solid #444',
    backgroundColor: '#2a2a3a', color: '#e0e0e0', fontSize: '0.95rem', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  },

  /* Buttons */
  btn: {
    padding: '10px 18px', borderRadius: '8px', border: 'none',
    backgroundColor: '#4fc3f7', color: '#121212', fontSize: '0.85rem',
    fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap',
  },

  /* Feedback */
  error: { color: '#ef5350', marginTop: '10px', fontSize: '0.9rem' },
  successBox: {
    marginTop: '12px', padding: '10px 14px', backgroundColor: '#1b5e20',
    borderRadius: '8px', fontSize: '0.85rem', color: '#a5d6a7',
  },
  resultBox: {
    marginTop: '14px', padding: '16px', backgroundColor: '#2a2a3a',
    borderRadius: '10px', borderLeft: '4px solid #4fc3f7',
  },
  resultHeader: { fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '10px' },
  resultStats: { display: 'flex', gap: '20px', flexWrap: 'wrap' },
  stat: { display: 'flex', flexDirection: 'column', gap: '2px' },
  statLabel: { fontSize: '0.7rem', color: '#888', textTransform: 'uppercase' },
  statValue: { fontSize: '1rem', fontWeight: 'bold', color: '#4fc3f7', fontFamily: 'monospace' },

  footer: {
    textAlign: 'center', color: '#555', fontSize: '0.75rem', marginTop: '30px',
    padding: '16px 0', borderTop: '1px solid #222',
  },
};

export default App;
