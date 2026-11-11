"""官网监控适配器（§6，M3 收尾升级）：按域名注册适配器，JSON API 直连优先。

- 飞书招聘（MiniMax/Soul 等 *.jobs.feishu.cn）：POST /api/v1/search/job/posts，
  免签名明文 JSON，列表即含完整 JD，官网源不需要详情抓取
- 腾讯：GET /tencentcareer/api/post/Query，明文 JSON，列表含岗位职责（Responsibility）
- B 站：POST jobs.bilibili.com/api/srs/position/positionList，列表含完整 JD
- 字节/小红书/美团：SPA + 签名/交互受阻，本批明确跳过记日志（渲染兜底未做，保持镜像轻量）
- 未注册域名：落回 v1 静态 HTML 链接抽取（文本命中关键词组）
- 与上次结果的 diff 由 dedup_key 天然实现（已入过的链接自动 skipped）
"""

import logging
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

from ..ratelimit import RateLimiter

log = logging.getLogger("official")

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

CST = timezone(timedelta(hours=8))


# ---------- 飞书招聘（API 直连） ----------

FEISHU_PAGE_SIZE = 50
FEISHU_MAX_PAGES = 10  # 单租户最多 500 条，控制请求量

FEISHU_QUERY = {
    "keyword": "",
    "limit": str(FEISHU_PAGE_SIZE),
    "job_category_id_list": "",
    "tag_id_list": "",
    "location_code_list": "",
    "subject_id_list": "",
    "recruitment_id_list": "",
    "portal_type": "6",
    "job_function_id_list": "",
    "storefront_id_list": "",
    "portal_entrance": "1",
}


def feishu_hire_api(
    client: httpx.Client,
    company: dict,
    prefs: dict,
    limiter: RateLimiter,
) -> list[dict]:
    """飞书招聘租户（{tenant}.jobs.feishu.cn）：翻页拉全部在招岗位，列表自带完整 JD。"""
    name = company["name"]
    tenant = urlparse(company["career_url"]).netloc
    url = f"https://{tenant}/api/v1/search/job/posts"
    headers = {
        "content-type": "application/json",
        "portal-channel": "saas-career",
        "portal-platform": "pc",
        "website-path": "index",
        "referer": f"https://{tenant}/index",
        "User-Agent": UA,
    }
    jobs: list[dict] = []
    for page in range(FEISHU_MAX_PAGES):
        offset = page * FEISHU_PAGE_SIZE
        body = {
            "keyword": "",
            "limit": FEISHU_PAGE_SIZE,
            "offset": offset,
            "job_category_id_list": [],
            "tag_id_list": [],
            "location_code_list": [],
            "subject_id_list": [],
            "recruitment_id_list": [],
            "portal_type": 6,
            "job_function_id_list": [],
            "storefront_id_list": [],
            "portal_entrance": 1,
        }
        limiter.wait()
        log.info("POST %s (offset=%d)", url, offset)
        try:
            resp = client.post(url, params={**FEISHU_QUERY, "offset": str(offset)}, json=body, headers=headers)
            resp.raise_for_status()
        except httpx.HTTPError as e:
            log.warning("飞书招聘接口失败 %s：%s", name, e)
            break
        data = (resp.json() or {}).get("data") or {}
        posts = data.get("job_post_list") or []
        total = data.get("count") or 0
        log.info("%s：第 %d 页 %d 条（在招共 %d）", name, page + 1, len(posts), total)
        for p in posts:
            jobs.append(_map_feishu_post(tenant, name, p))
        if not posts or offset + len(posts) >= total:
            break
    log.info("%s：获取岗位 %d 条", name, len(jobs))
    return jobs


def _map_feishu_post(tenant: str, company_name: str, p: dict) -> dict:
    cities = "、".join(
        c.get("name") or "" for c in (p.get("city_list") or []) if c.get("name")
    )
    desc = (p.get("description") or "").strip()
    req = (p.get("requirement") or "").strip()
    jd = f"{desc}\n\n{req}".strip() if req else desc
    ts = p.get("publish_time")  # epoch ms
    posted = (
        datetime.fromtimestamp(int(ts) / 1000, tz=CST).date().isoformat() if ts else None
    )
    return {
        "title": p.get("title") or "",
        "company": company_name,
        "location": cities,
        "salary_min": None,
        "salary_max": None,
        "currency": "CNY",
        "source": "official",
        "source_url": f"https://{tenant}/index/position/{p.get('id')}/detail",
        "description": jd,
        "posted_at": posted,
        "_require_work_years": "",
    }


# ---------- 腾讯（API 直连） ----------

TENCENT_PAGE_SIZE = 100  # 实测可用上限
TENCENT_MAX_PAGES = 30   # 2178 在招 ≈ 22 页（2026-11 实测），30 页封顶


def tencent_api(
    client: httpx.Client,
    company: dict,
    prefs: dict,
    limiter: RateLimiter,
) -> list[dict]:
    """腾讯 careers：GET /tencentcareer/api/post/Query 翻页，列表含岗位职责。"""
    name = company["name"]
    url = "https://careers.tencent.com/tencentcareer/api/post/Query"
    jobs: list[dict] = []
    for page in range(1, TENCENT_MAX_PAGES + 1):
        params = {
            "timestamp": str(int(time.time() * 1000)),
            "countryId": "",
            "cityId": "",
            "bgIds": "",
            "productId": "",
            "categoryId": "",
            "parentCategoryId": "",
            "attrId": "",
            "keyword": "",
            "pageIndex": str(page),
            "pageSize": str(TENCENT_PAGE_SIZE),
            "language": "zh-cn",
            "area": "cn",
        }
        limiter.wait()
        log.info("GET %s (pageIndex=%d)", url, page)
        try:
            resp = client.get(
                url,
                params=params,
                headers={
                    "User-Agent": UA,
                    "Referer": "https://careers.tencent.com/jobopportunity.html",
                },
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            log.warning("腾讯接口失败 %s：%s", name, e)
            break
        data = (resp.json() or {}).get("Data") or {}
        posts = data.get("Posts") or []
        total = data.get("Count") or 0
        log.info("%s：第 %d 页 %d 条（在招共 %d）", name, page, len(posts), total)
        for p in posts:
            jobs.append(_map_tencent_post(name, p))
        if not posts or page * TENCENT_PAGE_SIZE >= total:
            break
    log.info("%s：获取岗位 %d 条", name, len(jobs))
    return jobs


def _map_tencent_post(company_name: str, p: dict) -> dict:
    posted = None
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", p.get("LastUpdateTime") or "")
    if m:
        posted = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return {
        "title": p.get("RecruitPostName") or "",
        "company": company_name,
        "location": p.get("LocationName") or "",
        "salary_min": None,
        "salary_max": None,
        "currency": "CNY",
        "source": "official",
        "source_url": p.get("PostURL") or "",
        "description": (p.get("Responsibility") or "").strip(),
        "posted_at": posted,
        "_require_work_years": "",
    }


# ---------- B 站（API 直连） ----------

BILIBILI_PAGE_SIZE = 50  # 实测可用上限
BILIBILI_MAX_PAGES = 15  # 488 在招 ≈ 10 页（2026-11 实测），15 页封顶


def bilibili_api(
    client: httpx.Client,
    company: dict,
    prefs: dict,
    limiter: RateLimiter,
) -> list[dict]:
    """B 站 jobs.bilibili.com：先取 csrf token（实测任意非空值可过），再翻页拉社招全职列表。"""
    name = company["name"]
    url = "https://jobs.bilibili.com/api/srs/position/positionList"
    limiter.wait()
    try:
        token_resp = client.get(
            "https://jobs.bilibili.com/api/auth/v1/csrf/token",
            headers={"User-Agent": UA},
        )
        csrf = (token_resp.json() or {}).get("data") or ""
    except httpx.HTTPError:
        csrf = ""
    if not csrf:
        csrf = str(uuid.uuid4())
    headers = {
        "content-type": "application/json",
        "x-appkey": "ops.ehr-api.auth",
        "x-usertype": "2",
        "x-channel": "social",
        "x-csrf": csrf,
        "User-Agent": UA,
    }
    jobs: list[dict] = []
    for page in range(1, BILIBILI_MAX_PAGES + 1):
        body = {
            "pageSize": BILIBILI_PAGE_SIZE,
            "pageNum": page,
            "positionName": "",
            "postCode": [],
            "postCodeList": [],
            "workLocationList": [],
            "workTypeList": ["3"],  # 3=全职（dictMsg 实测）
            "positionTypeList": ["3"],
            "deptCodeList": [],
            "recruitType": 0,
            "practiceTypes": [],
            "onlyHotRecruit": 0,
        }
        limiter.wait()
        log.info("POST %s (pageNum=%d)", url, page)
        try:
            resp = client.post(url, json=body, headers=headers)
            resp.raise_for_status()
        except httpx.HTTPError as e:
            log.warning("B 站接口失败 %s：%s", name, e)
            break
        payload = resp.json() or {}
        if payload.get("code") != 0:
            log.warning("B 站接口返回错误 %s：%s", name, payload.get("message"))
            break
        data = payload.get("data") or {}
        posts = data.get("list") or []
        total = data.get("total") or 0
        log.info("%s：第 %d 页 %d 条（在招共 %d）", name, page, len(posts), total)
        for p in posts:
            jobs.append(_map_bilibili_post(name, p))
        if not posts or page * BILIBILI_PAGE_SIZE >= total:
            break
    log.info("%s：获取岗位 %d 条", name, len(jobs))
    return jobs


def _map_bilibili_post(company_name: str, p: dict) -> dict:
    posted = None
    push_time = p.get("pushTime") or ""  # "2026-11-11 17:42:21"
    if len(push_time) >= 10:
        posted = push_time[:10]
    return {
        "title": p.get("positionName") or "",
        "company": company_name,
        "location": p.get("workLocation") or "",
        "salary_min": None,
        "salary_max": None,
        "currency": "CNY",
        "source": "official",
        "source_url": f"https://jobs.bilibili.com/social/position/{p.get('id')}",
        "description": (p.get("positionDescription") or "").strip(),
        "posted_at": posted,
        "_require_work_years": "",
    }


# ---------- SPA 跳过（渲染兜底本批不做） ----------

def skip_spa(
    client: httpx.Client,
    company: dict,
    prefs: dict,
    limiter: RateLimiter,
) -> list[dict]:
    log.info(
        "跳过（SPA/接口签名受阻，渲染兜底本批不做）：%s（%s）",
        company["name"],
        company.get("career_url"),
    )
    return []


# ---------- v1 静态抓取兜底（未注册域名） ----------

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
    """启发式：去掉 script 后正文文本极少 → 视为 JS 渲染页，跳过。"""
    text = re.sub(r"<script[\s\S]*?</script>", "", html)
    text = re.sub(r"<[^>]+>", "", text)
    return len(text.strip()) < 500


def extract_location(text: str, locations: list[str]) -> str:
    """链接文本里找偏好城市；找不到返回空串（城市规则对无地点信息的官网岗位放行）。"""
    for loc in locations:
        if loc and loc != "远程" and loc in text:
            return loc
    return ""


def static_extract(
    client: httpx.Client,
    company: dict,
    prefs: dict,
    limiter: RateLimiter,
) -> list[dict]:
    name = company["name"]
    url = company["career_url"]

    limiter.wait()
    log.info("GET %s", url)
    try:
        resp = client.get(url, headers={"User-Agent": UA}, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("抓取失败 %s：%s", url, e)
        return []

    if looks_js_rendered(resp.text):
        log.info("跳过（JS 渲染页）：%s（%s）", name, url)
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


# ---------- 按域名分派 ----------

ADAPTERS = {
    "vrfi1sk8a0.jobs.feishu.cn": feishu_hire_api,  # MiniMax
    "soulapp.jobs.feishu.cn": feishu_hire_api,  # Soul
    "careers.tencent.com": tencent_api,
    "www.bilibili.com": bilibili_api,  # career_url 壳页，实际走 jobs.bilibili.com API
    "jobs.bytedance.com": skip_spa,  # 字节：API 强制 _signature
    "job.xiaohongshu.com": skip_spa,  # 小红书：ATS proto 编码
    "zhaopin.meituan.com": skip_spa,  # 美团：列表接口需交互触发
}


def monitor_company(
    client: httpx.Client,
    company: dict,
    prefs: dict,
    limiter: RateLimiter,
) -> list[dict]:
    url = company.get("career_url") or ""
    if not url:
        log.info("跳过（未配置 career_url）：%s", company["name"])
        return []
    adapter = ADAPTERS.get(urlparse(url).netloc)
    if adapter is not None:
        return adapter(client, company, prefs, limiter)
    return static_extract(client, company, prefs, limiter)
