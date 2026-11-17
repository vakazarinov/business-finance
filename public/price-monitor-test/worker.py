"""Price Monitor test worker: GitHub Pages -> Supabase -> local Microsoft Edge.

Install once on Windows:
  py -3 -m pip install playwright
  py -3 public\price-monitor-test\worker.py

Keep this terminal and Edge browser open. In the web dashboard click Start.
The browser remains under your control; when a CAPTCHA appears, solve it
in Edge and press "Continue" in the dashboard. No bookings are performed.
"""
from __future__ import annotations

import getpass
import json
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

PROJECT = "https://vzfpcwfasnqpuzezkbbh.supabase.co/functions/v1/"
FINANCE_API = PROJECT + "finance-direct"
TEST_API = PROJECT + "price-monitor-test"
ROOT = Path(__file__).resolve().parent
PROFILE = ROOT / ".avito-edge-profile"
PRICE_SELECTOR = '[data-marker="item-view/item-price"]'
BLOCK_TEXTS = (
    "доступ ограничен", "доступ с вашего ip", "проверяем ваш браузер",
    "докажите, что вы не робот", "проверка безопасности",
    "подозрительная активность", "подтвердите, что вы человек",
    "пройдите проверку", "access denied", "роботам тут не место",
    "необычная активность", "captcha", "капча", "проверка, что вы не робот",
    "не удалось проверить", "обнаружена подозрительная",
)


def post(url: str, data: dict, timeout: int = 20) -> dict:
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=payload, headers={"Content-Type": "text/plain; charset=utf-8"}, method="POST")
    try:
        with urlopen(request, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        message = exc.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(message).get("error", message)
        except ValueError:
            pass
        raise RuntimeError(f"API {exc.code}: {message}") from exc


class Client:
    def __init__(self, password: str):
        self.password = password
        self.token = ""
        self.login()

    def login(self):
        data = post(FINANCE_API, {"action": "login", "password": self.password})
        self.token = data["token"]

    def call(self, action: str, **kwargs) -> dict:
        try:
            return post(TEST_API, {"token": self.token, "action": action, **kwargs})
        except RuntimeError as exc:
            if "401:" not in str(exc):
                raise
            self.login()
            return post(TEST_API, {"token": self.token, "action": action, **kwargs})


def money_to_int(raw: str | None) -> int | None:
    if not raw:
        return None
    cleaned = re.sub(r"[\s\u00a0\u202f\u2009₽]|руб(?:лей|ля|ль|\.)?", "", raw, flags=re.I)
    if not re.fullmatch(r"\d{2,9}", cleaned):
        return None
    result = int(cleaned)
    return result if result > 0 else None


def build_url(base: str, checkin: date, checkout: date, guests: int) -> str:
    count = json.dumps({
        "version": 1, "totalCount": guests,
        "adultsCount": guests, "children": []
    }, ensure_ascii=False, separators=(",", ":"))
    return base.split("?")[0] + "?" + urlencode({
        "guestsDetailed": count,
        "checkIn": checkin.isoformat(), "checkOut": checkout.isoformat()
    })


def dates_match(page_url: str, checkin: date, checkout: date) -> bool:
    query = parse_qs(urlparse(page_url).query)
    return query.get("checkIn") == [checkin.isoformat()] and query.get("checkOut") == [checkout.isoformat()]


def blocked(page) -> bool:
    try:
        body = page.locator("body").inner_text(timeout=3500).lower()
        return any(marker in body[:7000] for marker in BLOCK_TEXTS)
    except Exception:
        return False


def price_from_page(page) -> tuple[int | None, str]:
    for attempt in range(4):
        try:
            el = page.locator(PRICE_SELECTOR).first
            el.wait_for(state="attached", timeout=5000 if attempt == 0 else 1500)
            value = money_to_int(el.get_attribute("content", timeout=2200))
            if value is not None:
                return value, "item-view/item-price:content"
            value = money_to_int(el.inner_text(timeout=2200))
            if value is not None:
                return value, "item-view/item-price:text"
        except Exception:
            pass
        if attempt < 3:
            page.wait_for_timeout(850)
    return None, ""


def debug(page, day: date, issue: str):
    folder = ROOT / ".avito-debug"
    folder.mkdir(exist_ok=True)
    filename = f"{day.isoformat()}_{issue}"
    try:
        page.screenshot(path=str(folder / (filename + ".png")), full_page=True, timeout=6000)
    except Exception:
        pass
    try:
        text = page.locator("body").inner_text(timeout=3500)
        (folder / (filename + ".txt")).write_text("URL: " + page.url + "\n\n" + text[:12000], encoding="utf-8")
    except Exception:
        pass


def wait_for_captcha(client: Client, page, job: dict, checkin: date):
    """Keep Edge open. Wait for user to solve CAPTCHA and press Continue in web UI."""
    job_id = job["id"]
    client.call("captcha", job_id=job_id)
    print(f"\nCAPTCHA / ограничение Авито на {checkin.isoformat()}.")
    print("Открой окно Microsoft Edge, пройди проверку и нажми «Продолжить» на тестовой веб-странице.")
    print("Текущий период НЕ будет пропущен. Ctrl+C — остановить локальный сборщик.\n")
    debug(page, checkin, "captcha")
    while True:
        time.sleep(5)
        snapshot = client.call("status")
        current = snapshot.get("job") or {}
        if current.get("id") != job_id or current.get("status") == "cancelled":
            return False
        if current.get("status") == "running" and current.get("resume_requested"):
            print("Получена команда продолжить. Проверяю этот же интервал...")
            return True


def run_job(client: Client, job: dict):
    from playwright.sync_api import sync_playwright

    identifier = job["id"]
    start = date.fromisoformat(job["start_date"])
    end = date.fromisoformat(job["end_date"])
    nights, guests = int(job["nights"]), int(job["guests"])
    total = (end-start).days+1
    print(f"\nЗадание {identifier}: {start}—{end}, {nights} ночей, гостей {guests}.")
    print("Цена карточки (card_price_rub), НЕ полная цена проживания.\n")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE), channel="msedge",
            headless=False, locale="ru-RU", timezone_id="Europe/Moscow",
            viewport={"width": 1440, "height": 900}
        )
        try:
            page = browser.pages[0] if browser.pages else browser.new_page()
            # Read saved observations to avoid duplicating an already completed interval.
            previous = client.call("status").get("prices") or []
            completed = {x["checkin"] for x in previous}
            for index in range(total):
                checkin = start + timedelta(days=index)
                checkout = checkin + timedelta(days=nights)
                if checkin.isoformat() in completed:
                    print(f"Пропускаю ранее сохранённый результат: {checkin}")
                    continue
                state = client.call("status").get("job") or {}
                if state.get("id") != identifier or state.get("status") == "cancelled":
                    print("Задание отменено.")
                    return
                url = build_url(job["listing_url"], checkin, checkout, guests)
                print(f"[{index+1:02d}/{total}] {checkin} → {checkout}: ", end="", flush=True)
                while True:
                    navigation_error = ""
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=40000)
                        page.wait_for_timeout(2400)
                    except Exception as exc:
                        navigation_error = str(exc).splitlines()[0][:150]
                    if blocked(page):
                        if not wait_for_captcha(client, page, job, checkin):
                            return
                        continue

                    if not dates_match(page.url, checkin, checkout):
                        debug(page, checkin, "url_changed")
                        result = {
                            "status":"DATES_URL_CHANGED","price_rub":None,"source":"",
                            "note":"Выбранные даты не сохранились в URL браузера"
                        }
                        break

                    value, source = price_from_page(page)
                    if value is not None:
                        page.wait_for_timeout(1100)
                        fresh, fresh_source = price_from_page(page)
                        if fresh is not None:
                            value, source = fresh, fresh_source
                        result = {
                            "status":"CARD_PRICE_FOUND","price_rub":value,"source":source,
                            "note":"Цена карточки при выбранных датах"
                        }
                        break
                    if blocked(page) or navigation_error:
                        if not wait_for_captcha(client, page, job, checkin):
                            return
                        continue
                    debug(page, checkin, "price_missing")
                    result = {
                        "status":"PRICE_NOT_FOUND","price_rub":None,"source":"",
                        "note":"Маркер цены не найден при выбранных датах"
                    }
                    break

                client.call("put", job_id=identifier,
                    checkin=checkin.isoformat(),checkout=checkout.isoformat(),
                    processed=index+1, **result)
                price_text = str(result["price_rub"]) + " ₽" if result["price_rub"] else "—"
                print(result["status"] + " | " + price_text)
                if index < total-1:
                    page.wait_for_timeout(1700)
            state = client.call("status").get("job") or {}
            if state.get("id") == identifier and state.get("status") != "cancelled":
                client.call("finish", job_id=identifier, message="Сбор завершён, данные доступны в тестовом приложении")
                print("Готово. Результаты сохранены в Supabase.")
        finally:
            browser.close()


def main():
    try:
        import playwright.sync_api  # noqa: F401
    except ImportError:
        print("Установи Playwright: py -3 -m pip install playwright")
        return 2
    print("\nPRICE MONITOR · Локальный исполнитель для GitHub Pages")
    print("Используй пароль от Business Finance только здесь, в локальном PowerShell.")
    password = getpass.getpass("Пароль Business Finance: ")
    if not password:
        print("Пароль не указан.")
        return 2
    try:
        client = Client(password)
        print("Подключение к Supabase выполнено. Ожидаю задания из приложения...")
        while True:
            try:
                snapshot = client.call("status")
                job = snapshot.get("job")
                if job and job.get("status") == "queued":
                    claimed = client.call("claim", job_id=job["id"]).get("job")
                    if claimed:
                        try:
                            run_job(client, claimed)
                        except KeyboardInterrupt:
                            raise
                        except Exception as exc:
                            print("Ошибка обработки задания:", str(exc))
                            try:
                                client.call("fail", job_id=claimed["id"], message=str(exc)[:250])
                            except Exception:
                                pass
                time.sleep(5)
            except (URLError, TimeoutError, RuntimeError, OSError) as exc:
                print("Проблема связи с API:", str(exc)[:230], "— повтор через 10 секунд.")
                time.sleep(10)
    except KeyboardInterrupt:
        print("\nИсполнитель остановлен.")
    except Exception as exc:
        print("Не удалось запустить исполнитель:", str(exc))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
