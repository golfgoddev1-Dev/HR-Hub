export async function getSession() {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
    })
    if (response.status === 401) return null
    return await response.json()
  } catch {
    return null
  }
}

export async function postLogout() {
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    })
    return response.ok
  } catch {
    return false
  }
}

export async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  return { status: response.status, data }
}
