import cors from 'cors'
import dotenv from 'dotenv'
import express, { type Request, type Response } from 'express'

dotenv.config()

interface OrderRequestBody {
  name?: string
  phone?: string
  comment?: string
  pageUrl?: string
  source?: string
}

const app = express()

app.use(express.json({ limit: '64kb' }))

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }

      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('CORS: origin is not allowed'))
    },
  }),
)

const PORT = Number(process.env.PORT ?? 3001)
const TELEGRAM_BOT_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN')
const TELEGRAM_CHAT_IDS = requireEnv('TELEGRAM_CHAT_IDS')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

function requireEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required env variable: ${name}`)
  }

  return value
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function normalizeString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']

  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]
  }

  return req.socket.remoteAddress ?? 'unknown'
}

function buildTelegramMessage(body: Required<OrderRequestBody>, req: Request): string {
  const sentAt = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
  })

  const ip = getClientIp(req)
  const ua = normalizeString(req.headers['user-agent'], 300)

  return [
    '🛎 <b>Новая заявка с сайта</b>',
    '',
    `👤 <b>Имя:</b> ${escapeHtml(body.name)}`,
    `📞 <b>Телефон:</b> ${escapeHtml(body.phone)}`,
    `💬 <b>Комментарий:</b> ${escapeHtml(body.comment || '—')}`,
    `🌐 <b>Страница:</b> ${escapeHtml(body.pageUrl || '—')}`,
    `🏷 <b>Источник:</b> ${escapeHtml(body.source || 'site')}`,
    `🕒 <b>Время:</b> ${escapeHtml(sentAt)}`,
    `🧾 <b>IP:</b> ${escapeHtml(ip)}`,
    `🖥 <b>User-Agent:</b> ${escapeHtml(ua || '—')}`,
  ].join('\n')
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Telegram API error: ${response.status} ${errorText}`)
  }
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'telegram-order-api',
  })
})

app.post('/api/order', async (req: Request, res: Response) => {
  try {
    const payload = req.body as OrderRequestBody

    const name = normalizeString(payload.name, 100)
    const phone = normalizeString(payload.phone, 50)
    const comment = normalizeString(payload.comment, 1000)
    const pageUrl = normalizeString(payload.pageUrl, 500)
    const source = normalizeString(payload.source, 100)

    if (!name || !phone) {
      res.status(400).json({
        ok: false,
        message: 'Имя и телефон обязательны.',
      })
      return
    }

    const body: Required<OrderRequestBody> = {
      name,
      phone,
      comment,
      pageUrl,
      source,
    }

    const text = buildTelegramMessage(body, req)

    await Promise.all(
      TELEGRAM_CHAT_IDS.map(async (chatId) => {
        await sendTelegramMessage(chatId, text)
      }),
    )

    res.status(201).json({
      ok: true,
      message: 'Заявка отправлена.',
    })
  } catch (error) {
    console.error('POST /api/order failed:', error)

    res.status(500).json({
      ok: false,
      message: 'Не удалось отправить заявку.',
    })
  }
})

app.listen(PORT, () => {
  console.log(`Telegram order API is running on http://localhost:${PORT}`)
})