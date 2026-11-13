# Развёртывание Cloudflare API + D1

Это инструкции по первоначальной настройке защищённой общей базы для Business Finance. GitHub Pages хостит только статический интерфейс; операции находятся в D1.

## Требования
- Бесплатный аккаунт Cloudflare
- GitHub репозиторий vakazarinov/business-finance
- Терминал GitHub Codespaces (без установки ПО на компьютер)

## 1. Создать базу и установить зависимости

В терминале Codespaces, открытом на корне репозитория, переключиться на ветку с API или слить PR с ней:

```bash
npm ci
npx wrangler login
npx wrangler d1 create business-finance
```

Скопировать полученный `database_id` в `worker/wrangler.toml` вместо `REPLACE_WITH_D1_DATABASE_ID`. Нельзя выкладывать пароли или токены в этот файл. ID базы — не секрет.

## 2. Создать таблицы

```bash
npx wrangler d1 execute business-finance --remote --file=worker/migrations/0001_initial.sql --config worker/wrangler.toml
```

## 3. Задать секреты

```bash
npx wrangler secret put FAMILY_PASSWORD --config worker/wrangler.toml
npx wrangler secret put SESSION_SECRET --config worker/wrangler.toml
```

На запрос первого секрета ввести надёжный общий пароль для семьи, второго — длинную случайную строку (минимум 32 символа). Не отправлять их в чат и не сохранять в Git.

## 4. Опубликовать API

```bash
npx wrangler deploy --config worker/wrangler.toml
```

После публикации Cloudflare покажет адрес вида `https://business-finance-api.<your-subdomain>.workers.dev`.

Проверить в браузере `https://...workers.dev/health` — должен быть ответ `{"ok":true}`.

## 5. Подключить GitHub Pages

GitHub → репозиторий → Settings → Secrets and variables → Actions → Variables → New repository variable:

- Name: `NEXT_PUBLIC_API_URL`
- Value: полученный HTTPS-адрес Worker (без /health и без завершающего /).

В workflow GitHub Pages добавлена передача этой **публичной URL-переменной** в сборку. Пароли и ключи никогда не размещать в `NEXT_PUBLIC_*`.

Затем в GitHub → Actions → Deploy GitHub Pages → Run workflow, либо сделать новый коммит в `main`, чтобы обновить сайт.

## Ограничения версии

- Один общий пароль, без персональных аккаунтов; одна семейная сессия действует не более 7 дней.
- Любой вошедший член семьи может редактировать или удалять операции и менять доли.
- Доли общие и применяются ко всем периодам, включая прошлые. Фиксация долей по месяцам — следующий этап.
- Переводы погашения взаиморасчётов пока не регистрируются.
- Чтение истории ограничено 5000 последними операциями; позже добавим серверную пагинацию.
- Cloudflare не связан с GitHub OAuth: развёртывание API выполняется вручную из Codespaces.
- Экспорт резервной копии базы и восстановление — отдельный этап перед длительным использованием.

## Безопасность

Не вводить реальные финансовые данные до выполнения шагов настройки. `FAMILY_PASSWORD` и `SESSION_SECRET` должны быть разными. При смене SESSION_SECRET ранее выданные сессии перестанут работать. Пользователь может выйти на устройстве кнопкой «Выйти», что удаляет токен из памяти текущей вкладки.
