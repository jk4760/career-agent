"""猎聘适配器（§5）：搜索接口（免登录明文 JSON）+ 详情页 SSR 抓取。

接口细节以 ai-job-search-cn 文档为准（2026-07 实测）：
- currentPage 从 0 起；hasNext 不可信，用 currentPage + 1 < totalPage 翻页
- 详情页：jobKind=2 直招 /job/<id>.shtml，jobKind=1 猎头 /a/<id>.shtml
- 302 = 临时限流 → RateLimitedError，本次 run 停止详情抓取，不绕过
"""

import html as html_lib
import logging
import re
import time
import uuid

import httpx

from ..ratelimit import DetailBudget, RateLimiter, RateLimitedError, check_not_limited

log = logging.getLogger("liepin")

SEARCH_URL = "https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

SEARCH_HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://www.liepin.com",
    "Referer": "https://www.liepin.com/",
    "X-Client-Type": "web",
    "X-Fscp-Version": "1.1",
    "X-Requested-With": "XMLHttpRequest",
    "X-Fscp-Std-Info": '{"client_id": "40108"}',
    "User-Agent": UA,
}

DETAIL_HEADERS = {"User-Agent": UA, "Referer": "https://www.liepin.com/"}


def _request_logged(client: httpx.Client, method: str, url: str, **kwargs) -> httpx.Response:
    log.info("%s %s @ %s", method, url, time.strftime("%H:%M:%S"))
    return client.request(method, url, **kwargs)


def search_keyword(
    client: httpx.Client,
    keyword: str,
    city: str,
    page_size: int,
    max_pages: int,
    limiter: RateLimiter,
) -> list[dict]:
    """搜索一个关键词：按 max_pages 翻页，返回字段映射后的岗位列表。"""
    results: list[dict] = []
    for page in range(max_pages):
        limiter.wait()
        body = {
            "data": {
                "mainSearchPcConditionForm": {
                    "city": city,
                    "dq": city,
                    "pubTime": "",
                    "currentPage": page,
                    "pageSize": page_size,
                    "key": keyword,
                    "suggestTag": "",
                    "workYearCode": "0",
                    "compId": "",
                    "compName": "",
                    "compTag": "",
                    "industry": "",
                    "salary": "",
                    "jobKind": "",
                    "compScale": "",
                    "compKind": "",
                    "compStage": "",
                    "eduLevel": "",
                },
                "passThroughForm": {
                    "scene": "init",
                    "skeyword": keyword,
                    "sfrom": "search_job_pc",
                },
            }
        }
        headers = {**SEARCH_HEADERS, "X-Fscp-Trace-Id": str(uuid.uuid4())}
        resp = _request_logged(client, "POST", SEARCH_URL, json=body, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
        cards = (payload.get("data") or {}).get("data", {}).get("jobCardList") or []
        pagination = (payload.get("data") or {}).get("data", {}).get("pagination") or {}
        log.info("搜索「%s」第 %d 页：%d 条", keyword, page, len(cards))

        for card in cards:
            mapped = map_job_card(card)
            if mapped:
                results.append(mapped)

        # hasNext 不可信：用 currentPage + 1 < totalPage 判断
        total_page = pagination.get("totalPage") or 0
        if page + 1 >= total_page or not cards:
            break
    return results


def map_job_card(card: dict) -> dict | None:
    job = card.get("job") or {}
    comp = card.get("comp") or {}
    link = job.get("link") or ""
    if not link:
        return None
    if link.startswith("/"):
        link = f"https://www.liepin.com{link}"
    salary_min, salary_max = parse_salary(job.get("salary") or "")
    refresh = job.get("refreshTime") or ""
    return {
        "title": job.get("title") or "",
        "company": comp.get("compName") or "",
        "location": (job.get("dq") or "").replace("-", "·"),
        "salary_min": salary_min,
        "salary_max": salary_max,
        "currency": "CNY",
        "source": "liepin",
        "source_url": link,
        "description": "",
        "posted_at": (
            f"{refresh[:4]}-{refresh[4:6]}-{refresh[6:8]}" if len(refresh) >= 8 else None
        ),
        # 以下字段仅采集过程使用，不入库
        "_require_work_years": job.get("requireWorkYears") or "",
    }


def parse_salary(s: str) -> tuple[int | None, int | None]:
    """「15-30k·15薪」→ (15000, 30000)；「薪资面议」→ (None, None)。薪数信息不年化。"""
    m = re.match(r"(\d+)\s*-\s*(\d+)\s*k", s.lower())
    if m:
        return int(m.group(1)) * 1000, int(m.group(2)) * 1000
    return None, None


def fetch_detail(
    client: httpx.Client,
    url: str,
    limiter: RateLimiter,
    budget: DetailBudget,
) -> str:
    """抓详情页 JD 正文。预算耗尽返回 None；302 抛 RateLimitedError；软 404 返回空串。"""
    if not budget.try_consume():
        log.info("详情配额已用完（%d/%d），跳过: %s", budget.used, budget.cap, url)
        return None
    limiter.wait()
    resp = _request_logged(client, "GET", url, headers=DETAIL_HEADERS, follow_redirects=False)
    check_not_limited(resp.status_code, url)
    if "似乎不存在" in resp.text or "找遍了所有地方" in resp.text:
        log.info("岗位已下线（软 404）: %s", url)
        return ""
    return extract_jd(resp.text)


def extract_jd(html: str) -> str:
    """正文锚点 <dd data-selector="job-intro-content">，两类型页面均恰好出现一次。"""
    m = re.search(
        r'<dd[^>]*data-selector="job-intro-content"[^>]*>(.*?)</dd>',
        html,
        re.S,
    )
    if not m:
        return ""
    text = re.sub(r"<[^>]+>", "", m.group(1))
    text = html_lib.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
