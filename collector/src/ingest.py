"""调 api ingest 接口写入（不直连数据库，写路径保持在 TS/drizzle 层）。"""

import logging
import os

import httpx

log = logging.getLogger("ingest")

API_BASE = os.environ.get("API_BASE", "http://api:3001")


def ingest_jobs(jobs: list[dict]) -> dict:
    """分批入库（api 单批上限 500），返回合计计数。"""
    total = {"inserted": 0, "skipped": 0, "updated": 0}
    for i in range(0, len(jobs), 400):
        batch = jobs[i : i + 400]
        if not batch:
            break
        resp = httpx.post(f"{API_BASE}/api/jobs/ingest", json={"jobs": batch}, timeout=60)
        resp.raise_for_status()
        result = resp.json()
        for k in total:
            total[k] += result.get(k, 0)
    if jobs:
        log.info(
            "ingest: inserted=%d skipped=%d updated=%d",
            total["inserted"],
            total["skipped"],
            total["updated"],
        )
    return total


def fetch_preferences() -> dict:
    resp = httpx.get(f"{API_BASE}/api/preferences", timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_existing_job_urls() -> set[str]:
    """已在库且已有 JD 的岗位 source_url 集合：这些岗位不再抓详情（守住详情请求总量）。
    description 为空的已入库岗位放行重抓详情，经 ingest 的 update 语义补回 JD。"""
    resp = httpx.get(f"{API_BASE}/api/jobs", timeout=30)
    resp.raise_for_status()
    return {
        j["sourceUrl"]
        for j in resp.json()
        if j.get("sourceUrl") and j.get("description")
    }
