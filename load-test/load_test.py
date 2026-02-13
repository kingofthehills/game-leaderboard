#!/usr/bin/env python3
"""
============================================
Gaming Leaderboard - Load Simulation Script
============================================
Simulates real traffic:
  - Randomly picks users from 1M dataset
  - Submits scores continuously
  - Fetches leaderboard
  - Fetches individual ranks
  - Measures latency and throughput

Usage:
  pip install aiohttp
  python load_test.py [--users 1000000] [--duration 60] [--concurrency 50]

Traffic mix: 60% submit, 25% top10, 15% rank
"""

import argparse
import asyncio
import random
import time
import statistics
import sys
from dataclasses import dataclass, field
from typing import List

try:
    import aiohttp
except ImportError:
    print("Install aiohttp: pip install aiohttp")
    sys.exit(1)


BASE_URL = "http://localhost:3001"
API_SUBMIT = f"{BASE_URL}/api/leaderboard/submit"
API_TOP = f"{BASE_URL}/api/leaderboard/top"
API_RANK = f"{BASE_URL}/api/leaderboard/rank"


@dataclass
class Stats:
    submit_latencies: List[float] = field(default_factory=list)
    top_latencies: List[float] = field(default_factory=list)
    rank_latencies: List[float] = field(default_factory=list)
    errors: int = 0
    total_requests: int = 0
    start_time: float = 0.0

    def report(self):
        elapsed = time.time() - self.start_time
        rps = self.total_requests / elapsed if elapsed > 0 else 0

        print("\n" + "=" * 60)
        print("LOAD TEST RESULTS")
        print("=" * 60)
        print(f"Duration:          {elapsed:.1f}s")
        print(f"Total requests:    {self.total_requests:,}")
        print(f"Errors:            {self.errors:,}")
        print(f"Throughput:        {rps:.1f} req/s")
        print(f"Error rate:        {(self.errors / max(self.total_requests, 1)) * 100:.2f}%")

        for name, latencies in [
            ("Submit Score", self.submit_latencies),
            ("Get Top 10", self.top_latencies),
            ("Get Rank", self.rank_latencies),
        ]:
            if latencies:
                sorted_lat = sorted(latencies)
                print(f"\n── {name} ({len(latencies):,} requests) ──")
                print(f"  Min:    {min(latencies):.1f}ms")
                print(f"  Avg:    {statistics.mean(latencies):.1f}ms")
                print(f"  Median: {statistics.median(latencies):.1f}ms")
                print(f"  P95:    {sorted_lat[int(len(sorted_lat) * 0.95)]:.1f}ms")
                print(f"  P99:    {sorted_lat[int(len(sorted_lat) * 0.99)]:.1f}ms")
                print(f"  Max:    {max(latencies):.1f}ms")

        print("=" * 60)


async def submit_score(session: aiohttp.ClientSession, stats: Stats, max_user_id: int):
    user_id = random.randint(1, max_user_id)
    score = random.randint(10, 5000)

    start = time.monotonic()
    try:
        async with session.post(
            API_SUBMIT,
            json={"user_id": user_id, "score": score},
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            elapsed = (time.monotonic() - start) * 1000
            stats.submit_latencies.append(elapsed)
            stats.total_requests += 1
            if resp.status != 201:
                stats.errors += 1
    except Exception:
        stats.errors += 1
        stats.total_requests += 1


async def get_top10(session: aiohttp.ClientSession, stats: Stats):
    start = time.monotonic()
    try:
        async with session.get(
            API_TOP,
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            elapsed = (time.monotonic() - start) * 1000
            stats.top_latencies.append(elapsed)
            stats.total_requests += 1
            if resp.status != 200:
                stats.errors += 1
    except Exception:
        stats.errors += 1
        stats.total_requests += 1


async def get_rank(session: aiohttp.ClientSession, stats: Stats, max_user_id: int):
    user_id = random.randint(1, max_user_id)

    start = time.monotonic()
    try:
        async with session.get(
            f"{API_RANK}/{user_id}",
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            elapsed = (time.monotonic() - start) * 1000
            stats.rank_latencies.append(elapsed)
            stats.total_requests += 1
            if resp.status != 200:
                stats.errors += 1
    except Exception:
        stats.errors += 1
        stats.total_requests += 1


async def worker(session, stats, max_user_id, duration, worker_id):
    end_time = time.time() + duration

    while time.time() < end_time:
        r = random.random()
        if r < 0.60:
            await submit_score(session, stats, max_user_id)
        elif r < 0.85:
            await get_top10(session, stats)
        else:
            await get_rank(session, stats, max_user_id)

        await asyncio.sleep(random.uniform(0.01, 0.05))


async def run_load_test(max_user_id: int, duration: int, concurrency: int):
    stats = Stats()
    stats.start_time = time.time()

    print(f"Starting load test...")
    print(f"  Target:      {BASE_URL}")
    print(f"  Users pool:  {max_user_id:,}")
    print(f"  Duration:    {duration}s")
    print(f"  Concurrency: {concurrency} workers")
    print(f"  Traffic mix: 60% submit, 25% top10, 15% rank")
    print()

    connector = aiohttp.TCPConnector(
        limit=concurrency,
        limit_per_host=concurrency,
        ttl_dns_cache=300,
    )

    async with aiohttp.ClientSession(connector=connector) as session:
        try:
            async with session.get(f"{BASE_URL}/health") as resp:
                if resp.status != 200:
                    print(f"Server health check failed: {resp.status}")
                    return
                print("Server health check passed ✓\n")
        except Exception as e:
            print(f"Cannot reach server at {BASE_URL}: {e}")
            return

        workers = [
            worker(session, stats, max_user_id, duration, i)
            for i in range(concurrency)
        ]

        async def progress_reporter():
            while time.time() < stats.start_time + duration:
                await asyncio.sleep(5)
                elapsed = time.time() - stats.start_time
                rps = stats.total_requests / elapsed
                print(
                    f"  [{elapsed:.0f}s] "
                    f"Requests: {stats.total_requests:,} | "
                    f"Errors: {stats.errors} | "
                    f"RPS: {rps:.0f}"
                )

        await asyncio.gather(*workers, progress_reporter())

    stats.report()


def main():
    parser = argparse.ArgumentParser(description="Gaming Leaderboard Load Tester")
    parser.add_argument("--users", type=int, default=1000000)
    parser.add_argument("--duration", type=int, default=60)
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--url", type=str, default="http://localhost:3001")
    args = parser.parse_args()

    global BASE_URL, API_SUBMIT, API_TOP, API_RANK
    BASE_URL = args.url
    API_SUBMIT = f"{BASE_URL}/api/leaderboard/submit"
    API_TOP = f"{BASE_URL}/api/leaderboard/top"
    API_RANK = f"{BASE_URL}/api/leaderboard/rank"

    asyncio.run(run_load_test(args.users, args.duration, args.concurrency))


if __name__ == "__main__":
    main()
