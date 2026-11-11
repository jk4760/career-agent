"""三维度硬过滤（§7）：职能方向 / 城市远程 / 职级年限（+ 验收口径的薪资下限）。
全部满足才入库；第一版宁可漏、不可噪。
"""

import re


def normalize_prefs(p: dict) -> dict:
    """API 返回 camelCase，过滤逻辑统一用 snake_case。"""
    return {
        "roles": p.get("roles") or [],
        "locations": p.get("locations") or [],
        "salary_min": p.get("salaryMin"),
        "experience_min": p.get("experienceMin"),
        "keywords_include": p.get("keywordsInclude") or [],
        "keywords_exclude": p.get("keywordsExclude") or [],
    }


def _hit_any(text: str, keywords: list[str]) -> bool:
    low = text.lower()
    return any(k.lower() in low for k in keywords if k)


def screen(job: dict, prefs: dict) -> tuple[bool, str]:
    """初筛（详情抓取前，只用列表页字段）：排除关键词 / 城市 / 薪资。"""
    title = job.get("title") or ""
    location = job.get("location") or ""

    if _hit_any(title, prefs.get("keywords_exclude") or []):
        return False, "命中排除关键词"

    if not location_match(location, title, prefs.get("locations") or []):
        return False, "城市不匹配"

    salary_min_pref = prefs.get("salary_min")
    salary_max = job.get("salary_max")
    if salary_min_pref and salary_max and salary_max < salary_min_pref:
        return False, "薪资上限低于偏好下限"

    return True, ""


def location_match(location: str, title: str, locations: list[str]) -> bool:
    if not locations:
        return True
    # 无地点信息（如官网监控链接文本）→ 放行，与年限「提取不到 → 放行」同原则
    if not location:
        return True
    for loc in locations:
        if loc and loc in location:
            return True
    # 偏好含「远程」时，title/location 含 远程/Remote 也命中
    if "远程" in locations:
        low = f"{location} {title}".lower()
        if "远程" in low or "remote" in low:
            return True
    return False


def match(job: dict, prefs: dict, jd_text: str) -> tuple[bool, str]:
    """入库前完整过滤（§7.2 三条规则 + 薪资下限）。jd_text 可为空串。"""
    title = job.get("title") or ""
    location = job.get("location") or ""

    # 1. 职能方向：title 命中 roles 任一，或 JD 含 keywords_include 任一；命中 exclude 直接丢
    if _hit_any(title, prefs.get("keywords_exclude") or []) or _hit_any(
        jd_text, prefs.get("keywords_exclude") or []
    ):
        return False, "命中排除关键词"
    roles_hit = _hit_any(title, prefs.get("roles") or [])
    include_hit = _hit_any(jd_text, prefs.get("keywords_include") or [])
    if not (roles_hit or include_hit):
        return False, "职能方向不匹配"

    # 2. 城市/远程
    if not location_match(location, title, prefs.get("locations") or []):
        return False, "城市不匹配"

    # 2.5 薪资下限（§9.2 验收口径）
    salary_min_pref = prefs.get("salary_min") or prefs.get("salaryMin")
    salary_max = job.get("salary_max")
    if salary_min_pref and salary_max and salary_max < salary_min_pref:
        return False, "薪资上限低于偏好下限"

    # 3. 职级/年限：提取不到则放行（不误杀）
    exp_min_pref = prefs.get("experience_min")
    if exp_min_pref:
        years = extract_max_years(job.get("require_work_years") or "") or extract_max_years(jd_text)
        if years is not None and years > exp_min_pref:
            return False, f"经验要求 {years} 年超过上限 {exp_min_pref}"

    return True, ""


def extract_max_years(text: str) -> int | None:
    """从文本提取经验要求上限：「3-5年」→5、「5年以上」→5；取所有命中中的最大值。"""
    if not text:
        return None
    best: int | None = None
    for m in re.finditer(r"(\d+)\s*(?:-|~|—|–|到|至)\s*(\d+)\s*年", text):
        v = int(m.group(2))
        best = v if best is None else max(best, v)
    for m in re.finditer(r"(\d+)\s*年以上", text):
        v = int(m.group(1))
        best = v if best is None else max(best, v)
    return best
