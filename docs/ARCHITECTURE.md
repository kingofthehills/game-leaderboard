# Gaming Leaderboard System — Architecture & Design

---

## 1. High Level Design (HLD)

### System Overview

```
┌──────────┐         ┌──────────────────────────────────────────────┐
│          │  HTTP    │              API SERVER (Node.js)            │
│  Client  │────────▶│                                              │
│ (React)  │◀────────│  Express ─▶ Controller ─▶ Service Layer      │
│          │         │       │                      │    │           │
└──────────┘         │  Rate Limiter   Validation   │    │           │
                     │  Helmet         Joi           │    │           │
                     │  Compression                  │    │           │
                     └──────────────────────────┬────┼────┼───────────┘
                                                │    │    │
                             ┌──────────────────┘    │    └──────────────┐
                             ▼                       ▼                   ▼
                     ┌───────────────┐     ┌──────────────────┐  ┌──────────────┐
                     │  PostgreSQL   │     │      Redis       │  │   BullMQ     │
                     │               │     │                  │  │   Worker     │
                     │ users (1M)    │     │ Sorted Set       │  │              │
                     │ sessions (5M) │     │ (real-time rank) │  │ Rank Recalc  │
                     │ leaderboard   │     │                  │  │ every 5 min  │
                     │               │     │ Top-10 JSON      │  │              │
                     │ Indexes:      │     │ (cached, 15s TTL)│  │ Sorted Set   │
                     │  total_score  │     │                  │  │ Rebuild      │
                     │  user_id      │     │ Per-player cache │  │              │
                     │  timestamp    │     │ (30s TTL)        │  └──────┬───────┘
                     └───────────────┘     └──────────────────┘         │
                                                    ▲                   │
                                                    │                   │
                                           ┌────────┴──────────┐       │
                                           │  Scheduler        │       │
                                           │  (setInterval)    │◀──────┘
                                           │                   │
                                           │  Refresh Top-10   │
                                           │  every 10 seconds │
                                           │  with dist. lock  │
                                           └───────────────────┘
```

### Request Flow — Submit Score

```
Client POST /api/leaderboard/submit { user_id: 42, score: 500 }
  │
  ▼
Rate Limiter (100 req/min/IP) ──▶ reject if exceeded
  │
  ▼
Joi Validation ──▶ reject if invalid
  │
  ▼
Service Layer
  │
  ├──▶ PostgreSQL Transaction (atomic):
  │     1. INSERT INTO game_sessions
  │     2. UPSERT leaderboard SET total_score = total_score + 500
  │     (Uses ON CONFLICT DO UPDATE with increment — no read-modify-write race)
  │
  ├──▶ Redis ZINCRBY leaderboard:scores 500 "42"
  │     (O(log N) — updates sorted set atomically)
  │
  └──▶ Redis DEL leaderboard:rank:42
        (Invalidate cached rank for this user)
  │
  ▼
Response 201: { session_id, user_id, score, total_score }
```

### Request Flow — Get Top 10

```
Client GET /api/leaderboard/top
  │
  ▼
Service Layer
  │
  ├──▶ Redis GET leaderboard:top10
  │     │
  │     ├── HIT ──▶ Return cached JSON (~1ms)
  │     │
  │     └── MISS ──▶ PostgreSQL:
  │                   SELECT * FROM leaderboard
  │                   ORDER BY total_score DESC LIMIT 10
  │                   (Index scan, reads 10 rows, ~5ms)
  │                   │
  │                   └──▶ Redis SET leaderboard:top10 (TTL 15s)
  │
  ▼
Response 200: [ { rank, username, total_score, user_id }, ... ]
```

---

## 2. Low Level Design (LLD)

### Database Schema

```
┌─────────────────┐       ┌──────────────────────┐       ┌─────────────────────┐
│     users        │       │   game_sessions       │       │    leaderboard       │
├─────────────────┤       ├──────────────────────┤       ├─────────────────────┤
│ id       SERIAL │◀──┐   │ id         SERIAL    │       │ id         SERIAL   │
│ username VARCHAR │   │   │ user_id    INT       │──┐    │ user_id    INT (UQ) │──┐
│ join_date TIMESTAMP│  ├──│ score      INT       │  │    │ total_score BIGINT  │  │
└─────────────────┘   │   │ game_mode  VARCHAR   │  │    │ rank       INT      │  │
                      │   │ timestamp  TIMESTAMP │  │    │ updated_at TIMESTAMP│  │
                      │   └──────────────────────┘  │    └─────────────────────┘  │
                      │                              │                             │
                      └──────────────────────────────┘                             │
                      └────────────────────────────────────────────────────────────┘
```

### Index Strategy

| Table | Index | Columns | Purpose |
|-------|-------|---------|---------|
| game_sessions | idx_gs_user_score | (user_id, score DESC) | SUM aggregation per user |
| game_sessions | idx_gs_timestamp | (timestamp DESC) | Recent games queries |
| game_sessions | idx_gs_game_mode | (game_mode) | Mode-specific filters |
| leaderboard | idx_lb_total_score | (total_score DESC) | **Top-N query**: backward index scan, reads only N rows |
| leaderboard | idx_lb_rank | (rank) | Direct rank lookup |
| users | idx_users_username | (username) UNIQUE | Username lookups |

### Redis Data Structures

| Key | Type | Purpose | TTL |
|-----|------|---------|-----|
| `leaderboard:scores` | Sorted Set | Real-time ranking backbone. ZINCRBY on submit, ZREVRANK for rank. | None |
| `leaderboard:top10` | String (JSON) | Cached top-10 response. Refreshed by background worker. | 15s |
| `leaderboard:rank:{user_id}` | String (JSON) | Per-player rank cache. Invalidated on score submit. | 30s |
| `leaderboard:lock:refresh` | String | Distributed lock for background refresh. | 12s |

---

## 3. How Leaderboard Updates Every 10 Seconds

### Mechanism

1. **`setInterval`** in `scheduler.js` fires every 10,000ms
2. Acquires **Redis distributed lock** (`SET key NX EX 12`)
   - Only ONE server instance refreshes (prevents duplicate work)
   - Lock auto-expires in 12s (safety margin over 10s interval)
3. Executes `SELECT * FROM leaderboard ORDER BY total_score DESC LIMIT 10` with JOIN on users
   - Uses `idx_lb_total_score` index (backward index scan)
   - Reads exactly 10 index entries + 10 heap tuples
   - **~2-5ms on 1M rows**
4. Serializes result to JSON and `SET leaderboard:top10` in Redis (TTL 15s)
5. Releases lock

### Why This Is Efficient

- **No full table scan**: Index-only scan reads 10 rows
- **No full rank recomputation**: Only top 10 are refreshed
- **Distributed lock**: Multiple API servers don't duplicate work
- **15s TTL**: Even if refresh fails, stale data expires quickly

---

## 4. Database Optimization Explanation

### Connection Pooling (Prisma + DATABASE_URL params)
- **Problem**: Each request creating a new DB connection takes ~50ms handshake
- **Solution**: Pool of 20 persistent connections reused across requests
- **Impact**: Eliminates connection overhead, handles 100+ concurrent requests

### Index on `total_score DESC`
- **Problem**: `ORDER BY total_score DESC LIMIT 10` on 1M rows = full sort = O(N log N)
- **Solution**: B-tree index stores data pre-sorted. PostgreSQL does backward scan.
- **Impact**: 2ms instead of 500ms+

### Composite Index `(user_id, score DESC)` on game_sessions
- **Problem**: `SUM(score) WHERE user_id = X` requires scanning all sessions for user
- **Solution**: Composite index allows index-only scan for that user's scores
- **Impact**: Aggregation from O(N) to O(K) where K = user's session count

### BigInt for total_score
- **Problem**: INT max = 2.1B. Active user with many sessions could overflow.
- **Solution**: BIGINT handles up to 9.2 quintillion
- **Impact**: No overflow risk

### ANALYZE After Bulk Insert
- **Problem**: PostgreSQL query planner uses stale statistics → picks bad plans
- **Solution**: ANALYZE refreshes statistics for accurate cost estimation
- **Impact**: Query planner chooses index scans instead of sequential scans

### Disabling Indexes During Bulk Insert
- **Problem**: Maintaining B-tree during 5M inserts = O(N log N) random I/O
- **Solution**: Drop indexes → bulk insert → rebuild indexes
- **Impact**: 3-5x faster seeding

---

## 5. Caching Strategy

### Three-Layer Cache Architecture

```
Layer 1: Redis Sorted Set (leaderboard:scores)
├── Updated: Real-time via ZINCRBY on every score submit
├── Used for: ZREVRANK (rank lookup), ZREVRANGE (top-N)
├── TTL: None (persistent, rebuilt from DB on startup)
└── WHY: O(log N) rank operations vs O(N log N) SQL ORDER BY

Layer 2: Redis JSON Cache (leaderboard:top10)
├── Updated: Every 10 seconds by background scheduler
├── Used for: GET /api/leaderboard/top response
├── TTL: 15 seconds
└── WHY: Avoids even the Redis sorted set computation on hot path

Layer 3: Per-Player Cache (leaderboard:rank:{user_id})
├── Updated: On cache miss
├── Invalidated: On that user's score submission
├── TTL: 30 seconds
└── WHY: Popular players get many rank lookups; cache prevents Redis ZREVRANK
```

### Cache Invalidation Rules

| Event | Action |
|-------|--------|
| Score submitted for user X | `ZINCRBY` sorted set + `DEL rank:X` |
| Background refresh (10s) | Overwrite `top10` key from DB |
| Redis restart | Sorted set rebuilt from DB on app startup |
| User not found in cache | Compute from DB, cache result |

---

## 6. Concurrency Handling

### Problem: Concurrent Score Submissions

```
Request A: user_id=42, score=100
Request B: user_id=42, score=200

Without protection:
  Thread A reads total_score = 1000
  Thread B reads total_score = 1000
  Thread A writes total_score = 1100
  Thread B writes total_score = 1200  ← Lost update!

Expected: 1300
```

### Solution: Atomic Increment (No Application Lock Needed)

```sql
UPDATE leaderboard
SET total_score = total_score + $1   -- Atomic increment expression
WHERE user_id = $2
```

- PostgreSQL's UPDATE acquires a row-level lock automatically
- The expression is evaluated inside the lock
- No read-then-write at the application level
- Concurrent updates are serialized at the row level

### Redis Concurrency

```
ZINCRBY leaderboard:scores 100 "42"
```

Redis is single-threaded. All commands are serialized. ZINCRBY is atomic.

---

## 7. Setup Steps

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Python 3.9+ (for load testing)

### Step-by-Step

```bash
# 1. Clone and install
cd gaming-leaderboard
npm install

# 2. Start dependencies (Docker)
docker-compose up -d

# 3. Configure
# Edit .env with your connection details

# 4. Create tables
npx prisma db push

# 5. Seed database (1M users + 5M sessions)
npm run db:seed

# 6. Start server + worker
npm run start:all

# 7. Verify
curl http://localhost:3001/health
curl http://localhost:3001/api/leaderboard/top

# 8. Load test
cd load-test && pip install -r requirements.txt
python load_test.py --duration 60 --concurrency 50

# 9. Frontend
cd frontend && npm install && npm start
```

---

## 8. How System Scales to 10M Users

| Component | 1M Users | 10M Users | Solution |
|-----------|----------|-----------|----------|
| PostgreSQL | ✅ | ⚠️ Writes bottleneck | Read replicas + write partitioning |
| Redis sorted set | ✅ (200MB) | ⚠️ (2GB) | Redis Cluster |
| Single API server | ✅ | ❌ | Horizontal scaling (PM2/K8s) |

### Scaling Strategy

1. **Horizontal API Scaling**: Stateless design → deploy 2-20 instances behind load balancer
2. **PostgreSQL**: Read replicas for GET endpoints + PgBouncer for 10K+ connections
3. **Table Partitioning**: Partition game_sessions by month
4. **Redis Cluster**: 3+ nodes for horizontal scaling
5. **Async Writes**: Move submits to BullMQ queue → batch process
6. **Sharding** (100M+): Shard by score ranges, merge top-10 from shard leaders

---

## 9. Interview Questions & Answers

### Q1: Why Redis Sorted Set instead of SQL ORDER BY?

**A**: SQL `ORDER BY total_score DESC` is O(N log N) even with an index for rank computation. Redis `ZREVRANK` is O(log N) — 500x faster for rank lookups at 1M scale.

### Q2: How do you prevent lost updates on concurrent submissions?

**A**: PostgreSQL atomic increment: `SET total_score = total_score + $score`. Evaluated inside row-level lock. No application-level locking needed.

### Q3: Why refresh every 10s instead of real-time?

**A**: With 1000 submits/s, real-time invalidation = 1000 DB queries/s. 10s batch refresh = 0.1 queries/s. Leaderboard staleness of 10s is acceptable in gaming.

### Q4: How does the distributed lock work?

**A**: Redis `SET key NX EX 12` — atomic set-if-not-exists with 12s expiry. Only one instance refreshes. If it crashes, lock auto-expires.

### Q5: What if Redis goes down?

**A**: Graceful degradation: service falls back to PostgreSQL queries. No data loss — PostgreSQL is source of truth. Redis is acceleration layer.

### Q6: Why BigInt for total_score?

**A**: INT max = 2.1B. Power user with 100K sessions × 5000 avg score = 500M. At scale, INT overflows. BigInt handles up to 9.2 × 10¹⁸.

### Q7: How to handle mode-specific leaderboards?

**A**: Namespaced Redis keys per mode (`leaderboard:scores:ranked`). Composite index on `(game_mode, total_score DESC)`. Background refresh runs per mode.

### Q8: How to test with 1M users?

**A**: Raw SQL `generate_series(1, 1M)` for server-side generation. Drop indexes → bulk insert → rebuild. ANALYZE post-seed. Python async load test with 50 concurrent workers.

### Q9: Monitoring strategy?

**A**: New Relic: transaction traces, slow SQL capture (>200ms), custom metrics (refresh time, cache hits), error tracking, P95 latency alerts.

### Q10: How to migrate to microservices?

**A**: Split into Score Service (writes), Leaderboard Service (reads + ranking), User Service (CRUD). Event-driven via Redis Streams or Kafka. Eventually consistent.
