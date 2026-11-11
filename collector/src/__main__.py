"""CLI 入口：python -m src —— 一次完整采集（手动触发，每天最多一次）。"""

import logging
import sys

import httpx

from .config import load_config
from .ingest import fetch_existing_job_urls, fetch_preferences, ingest_jobs
from .match import match, normalize_prefs, screen
from .ratelimit import DetailBudget, RateLimitedError, RateLimiter
from .report import print_report
from .sources.liepin import fetch_detail, search_keyword
from .sources.official import monitor_company

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("main")


def to_ingest_payload(job: dict) -> dict:
    return {
        "title": job["title"],
        "company": job["company"],
        "location": job["location"] or None,
        "salaryMin": job["salary_min"],
        "salaryMax": job["salary_max"],
        "currency": job["currency"],
        "source": job["source"],
        "sourceUrl": job["source_url"],
        "description": job["description"],
        "postedAt": job["posted_at"],
    }


def run() -> int:
    cfg = load_config()
    prefs = normalize_prefs(fetch_preferences())
    log.info(
        "偏好：roles=%s locations=%s salary_min=%s experience_min=%s",
        prefs["roles"],
        prefs["locations"],
        prefs["salary_min"],
        prefs["experience_min"],
    )

    keywords = prefs["roles"] or ["产品经理"]
    cities = cfg["liepin"]["cities"]
    search_limiter = RateLimiter(cfg["rate_limit"]["search_interval_sec"])
    detail_limiter = RateLimiter(cfg["rate_limit"]["detail_interval_sec"])
    budget = DetailBudget(cfg["rate_limit"]["detail_cap_per_run"])

    # 1. 搜索 + 初筛（只用列表页字段，保住详情配额）
    candidates: dict[str, dict] = {}  # source_url 去重（本 run 内）
    filtered: dict[str, int] = {}
    with httpx.Client(timeout=30) as client:
        for keyword in keywords:
            for city in cities:
                try:
                    jobs = search_keyword(
                        client,
                        keyword,
                        city,
                        cfg["liepin"]["page_size"],
                        cfg["liepin"]["max_pages_per_keyword"],
                        search_limiter,
                    )
                except httpx.HTTPError as e:
                    log.error("搜索失败「%s」%s：%s", keyword, city, e)
                    continue
                for job in jobs:
                    if job["source_url"] in candidates:
                        continue
                    ok, reason = screen(job, prefs)
                    if not ok:
                        filtered[reason] = filtered.get(reason, 0) + 1
                        continue
                    candidates[job["source_url"]] = job

    # 已在库岗位跳过详情抓取（不消耗详情配额；入库时本来也会被 dedup 跳过）
    known_urls = fetch_existing_job_urls()
    before = len(candidates)
    for url in list(candidates.keys()):
        if url in known_urls:
            del candidates[url]
    log.info("已在库跳过详情：%d（新增候选：%d）", before - len(candidates), len(candidates))

    searched = before + sum(filtered.values())
    log.info("初筛后候选：%d（初筛丢弃：%d）", len(candidates), sum(filtered.values()))

    # 2. 详情抓取 + 完整三规则过滤
    accepted: list[dict] = []
    rate_limited = False
    with httpx.Client(timeout=30) as client:
        for job in candidates.values():
            jd_text = ""
            try:
                detail = fetch_detail(client, job["source_url"], detail_limiter, budget)
                if detail is None:  # 配额耗尽：不抓详情，仍按无 JD 过滤
                    jd_text = ""
                else:
                    jd_text = detail
            except RateLimitedError:
                rate_limited = True
                break
            except httpx.HTTPError as e:
                log.warning("详情抓取失败 %s：%s", job["source_url"], e)

            job["_jd_text"] = jd_text
            job["description"] = jd_text
            ok, reason = match(
                {**job, "require_work_years": job.get("_require_work_years", "")},
                prefs,
                jd_text,
            )
            if not ok:
                filtered[reason] = filtered.get(reason, 0) + 1
                continue
            accepted.append(job)

    if rate_limited:
        log.warning("触发临时限流，本次 run 提前结束；等待 30 分钟以上可再跑")

    # 2.5 官网监控（§6）：按域名分派适配器，API 直连的列表自带 JD，直接用于过滤
    official_accepted: list[dict] = []
    with httpx.Client(timeout=30) as client:
        for company in cfg["official"]["companies"]:
            for job in monitor_company(client, company, prefs, search_limiter):
                if job["source_url"] in candidates:
                    continue
                ok, reason = screen(job, prefs)
                if not ok:
                    filtered[reason] = filtered.get(reason, 0) + 1
                    continue
                ok, reason = match(job, prefs, job.get("description") or "")
                if not ok:
                    filtered[reason] = filtered.get(reason, 0) + 1
                    continue
                candidates[job["source_url"]] = job
                official_accepted.append(job)

    # 3. 入库（dedup_key 幂等；猎聘/官网分开计数）
    liepin_result = ingest_jobs([to_ingest_payload(j) for j in accepted])
    official_result = ingest_jobs([to_ingest_payload(j) for j in official_accepted])

    # 4. 报告
    print_report(
        searched=searched,
        filtered=filtered,
        detail_used=budget.used,
        detail_cap=budget.cap,
        ingest_result=liepin_result,
        rate_limited=rate_limited,
        official_extracted=len(official_accepted),
        official_result=official_result,
    )
    return 0


if __name__ == "__main__":
    sys.exit(run())
