// CitationSniper — internal admin tool.
//
// Deliberately NOT part of extension/, so it never ships in the Chrome Web
// Store package. Open admin/index.html locally.
//
// This page holds no privileged secret. It signs in with the admin's ordinary
// Supabase account and passes that session to the admin-activate Edge Function,
// which is what actually enforces the ADMIN_EMAILS / ADMIN_USER_IDS allowlist.
// Anyone opening this file without an allowlisted account gets a 403.

const SUPABASE_URL = 'https://qxtqtzlioaclrhztxoly.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4dHF0emxpb2FjbHJoenR4b2x5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMzgyMzgsImV4cCI6MjA5NjYxNDIzOH0.hkRFdVr0UO8-WsEJ-cje_Gk6BjlEksgPnM0Iv8T1rBU'

const FN = `${SUPABASE_URL}/functions/v1/admin-activate`
const SESSION_KEY = 'citationsniper_admin_session'

const $ = (id) => document.getElementById(id)
let session = null
let currentUser = null

// ---------- helpers ----------

function show(el, on = true) { el.classList.toggle('hidden', !on) }

function message(container, text, kind = 'err') {
  container.innerHTML = text ? `<div class="msg ${kind}">${escapeHtml(text)}</div>` : ''
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

async function callFn(payload) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    signOut()
    throw new Error('Session expired. Sign in again.')
  }
  if (res.status === 403) throw new Error('This account is not on the admin allowlist.')
  if (!res.ok) throw new Error(data.detail ? `${data.error}: ${data.detail}` : (data.error ?? `Request failed (${res.status})`))
  return data
}

// ---------- auth ----------

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description ?? data.msg ?? 'Sign in failed')
  return data
}

function persist(s) {
  session = s
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) session = JSON.parse(raw)
  } catch { session = null }
}

function signOut() {
  session = null
  currentUser = null
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
  render()
}

function render() {
  const signedIn = Boolean(session)
  show($('authCard'), !signedIn)
  show($('lookupCard'), signedIn)
  show($('historyCard'), signedIn)
  show($('signOutBtn'), signedIn)
  $('whoami').textContent = signedIn ? (session.user?.email ?? '') : ''
  if (!signedIn) {
    show($('resultCard'), false)
    show($('activateCard'), false)
  }
}

// ---------- actions ----------

$('signInBtn').addEventListener('click', async () => {
  const btn = $('signInBtn')
  message($('authMsg'), '')
  btn.disabled = true
  try {
    persist(await signIn($('adminEmail').value.trim(), $('adminPassword').value))
    $('adminPassword').value = ''
    render()
    loadHistory()
  } catch (err) {
    message($('authMsg'), err.message)
  } finally {
    btn.disabled = false
  }
})

$('signOutBtn').addEventListener('click', signOut)

$('lookupBtn').addEventListener('click', async () => {
  const email = $('lookupEmail').value.trim()
  if (!email) return

  const btn = $('lookupBtn')
  btn.disabled = true
  show($('resultCard'), true)
  show($('activateCard'), false)
  message($('lookupMsg'), '')
  $('userTable').innerHTML = ''
  show($('priorBox'), false)

  try {
    const data = await callFn({ action: 'lookup', email })

    if (!data.found) {
      message($('lookupMsg'), data.message, 'warn')
      return
    }

    const u = data.user
    currentUser = u

    const planClass = u.isAlreadyPro ? 'pro' : 'free'
    $('userTable').innerHTML = `
      <tr><td>Email</td><td>${escapeHtml(u.email)}</td></tr>
      <tr><td>User ID</td><td class="mono">${escapeHtml(u.userId)}</td></tr>
      <tr><td>Account created</td><td>${fmtDate(u.createdAt)}</td></tr>
      <tr><td>Effective plan</td><td><span class="pill ${planClass}">${escapeHtml(u.effectivePlan)}</span></td></tr>
      <tr><td>Subscription row</td><td>${u.planType ? `${escapeHtml(u.planType)} / ${escapeHtml(u.status ?? '—')}` : 'none'}</td></tr>
      <tr><td>Current period ends</td><td>${u.currentPeriodEnd ? fmtDate(u.currentPeriodEnd) : (u.effectivePlan === 'pro_lifetime' ? 'never (lifetime)' : '—')}</td></tr>
    `

    if (u.isAlreadyPro) {
      message($('lookupMsg'), `Already on ${u.effectivePlan}. Activating again is safe but usually unnecessary.`, 'warn')
    } else {
      message($('lookupMsg'), 'Free account — ready to activate.', 'ok')
    }

    if (data.priorActivations?.length) {
      show($('priorBox'), true)
      $('priorList').innerHTML = data.priorActivations.map((a) => `
        <li><strong>${fmtDate(a.created_at)}</strong> — ${escapeHtml(a.plan_type)} by ${escapeHtml(a.admin_email)}${a.was_duplicate ? ' <em>(duplicate — no change)</em>' : ''}<br>
        ${escapeHtml(a.note)}${a.paystack_reference ? ` <span class="mono">(${escapeHtml(a.paystack_reference)})</span>` : ''}</li>
      `).join('')
    }

    // Prefill a sensible note so the audit trail stays consistent.
    if (!$('noteInput').value.trim()) {
      $('noteInput').value = 'UoPeople promo, paid via Paystack Payment Page, ref '
    }
    message($('activateMsg'), '')
    show($('activateCard'), true)
  } catch (err) {
    message($('lookupMsg'), err.message)
  } finally {
    btn.disabled = false
  }
})

$('activateBtn').addEventListener('click', async () => {
  if (!currentUser) return

  const note = $('noteInput').value.trim()
  if (!note) {
    message($('activateMsg'), 'An audit note is required.')
    return
  }

  const plan = $('planSelect').value
  const label = plan === 'pro_lifetime' ? 'LIFETIME Pro' : 'Pro Monthly (+1 month)'
  if (!confirm(`Grant ${label} to ${currentUser.email}?`)) return

  const btn = $('activateBtn')
  btn.disabled = true
  message($('activateMsg'), '')

  try {
    // Amount is entered in cedis but stored in pesewas, matching what
    // create-checkout sends to Paystack.
    const cedis = parseFloat($('amountInput').value)
    const amount = Number.isFinite(cedis) ? Math.round(cedis * 100) : 0

    const data = await callFn({
      action: 'activate',
      userId: currentUser.userId,
      plan,
      reference: $('refInput').value.trim(),
      amount,
      currency: 'GHS',
      note,
      suppressReceipt: $('suppressReceipt').checked,
    })

    const now = data.user?.effectivePlan ?? 'unknown'
    const dupNote = data.wasDuplicate
      ? ` This reference was already recorded, so nothing changed — logged as a duplicate, not a second payment.`
      : ''
    message(
      $('activateMsg'),
      `Done — ${currentUser.email} is now ${now}.${dupNote}` +
        (data.auditLogged ? '' : ' WARNING: the audit row failed to write; check function logs.'),
      data.auditLogged && !data.wasDuplicate ? 'ok' : 'warn'
    )

    $('lookupBtn').click()
    loadHistory()
  } catch (err) {
    message($('activateMsg'), err.message)
  } finally {
    btn.disabled = false
  }
})

async function loadHistory() {
  try {
    const data = await callFn({ action: 'history' })
    $('historyList').innerHTML = data.activations.length
      ? data.activations.map((a) => `
          <li><strong>${fmtDate(a.created_at)}</strong> — ${escapeHtml(a.target_email)}
          → ${escapeHtml(a.plan_type)}${a.amount ? ` (${escapeHtml(a.currency)} ${(a.amount / 100).toFixed(2)})` : ''}${a.was_duplicate ? ' <em>(duplicate — no change)</em>' : ''}
          <br>${escapeHtml(a.note)}${a.paystack_reference ? ` <span class="mono">(${escapeHtml(a.paystack_reference)})</span>` : ''}</li>
        `).join('')
      : '<li>No manual activations yet.</li>'
  } catch (err) {
    $('historyList').innerHTML = `<li>${escapeHtml(err.message)}</li>`
  }
}

$('historyBtn').addEventListener('click', loadHistory)

restore()
render()
if (session) loadHistory()
