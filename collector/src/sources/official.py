"""官网监控适配器（§6）：抓 career_url → 抽取疑似岗位链接（文本命中关键词组）→ 入库。

v1 边界（诚实声明）：
- 只抓静态 HTML；JS 渲染页（多数大厂 SPA/ATS）跳过并记日志，不引入 playwright
- career_url 为空的公司跳过并记日志
- 与上次结果的 diff 由 dedup_key 天然实现（已入过的链接自动 skipped）
"""

import logging
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

import httpx

from ..ratelimit import RateLimiter

log = logging.getLogger("official")

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class LinkExtractor(HTMLParser):
    """抽取 <a href> 链接文本。"""

    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.links: list[tuple[str, str]] = []
        self._cur: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._cur = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._cur is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._cur is not None:
            text = " ".join("".join(self._text).split())
            if self._cur and text:
                self.links.append((urljoin(self.base_url, self._cur), text))
            self._cur = None


def looks_js_rendered(html: str) -> bool:
    """启发式：去掉 script 后正文文本极少 → 视为 JS 渲染页，v1 跳过。"""
    text = re.sub(r"<script[\s\S]*?</script>", "", html)
    text = re.sub(r"<[^>]+>", "", text)
    return len(text.strip()) < 500


def extract_location(text: str, locations: list[str]) -> str:
    """链接文本里找偏好城市；找不到返回空串（城市规则对无地点信息的官网岗位放行）。"""
    for loc in locations:
        if loc and loc != "远程" and loc in text:
            return loc
    return ""


def monitor_company(
    client: httpx.Client,
    company: dict,
    prefs: dict,
    limiter: RateLimiter,
) -> list[dict]:
    name = company["name"]
    url = company.get("career_url") or ""
    if not url:
        log.info("跳过（未配置 career_url）：%s", name)
        return []

    limiter.wait()
    log.info("GET %s", url)
    try:
        resp = client.get(url, headers={"User-Agent": UA}, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("抓取失败 %s：%s", url, e)
        return []

    if looks_js_rendered(resp.text):
        log.info("跳过（JS 渲染页，v1 不抓）：%s（%s）", name, url)
        return []

    extractor = LinkExtractor(str(resp.url))
    extractor.feed(resp.text)

    keywords = [k for k in prefs["roles"] + prefs["keywords_include"] if k]
    jobs: list[dict] = []
    for link, text in extractor.links:
        if len(text) < 4 or len(text) > 60:
            continue
        if not any(k.lower() in text.lower() for k in keywords):
            continue
        jobs.append(
            {
                "title": text,
                "company": name,
                "location": extract_location(text, prefs["locations"]),
                "salary_min": None,
                "salary_max": None,
                "currency": "CNY",
                "source": "official",
                "source_url": link,
                "description": "",
                "posted_at": None,
                "_require_work_years": "",
            }
        )
    log.info("%s：命中关键词的岗位链接 %d 条", name, len(jobs))
    return jobs
