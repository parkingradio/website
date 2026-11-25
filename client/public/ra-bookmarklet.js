// Parking Radio → RA: creates a session's event on Resident Advisor, from RA's own site, as the admin logged in to RA
// there (see docs/design/client/admin/publier-sur-ra.md). The bookmarklet that Intégrations gives admins loads this
// file from Parking Radio's site each time it's clicked, so that fixing it never requires reinstalling it. It's public,
// and holds no secrets.
//
// RA has no public API, so this calls the GraphQL endpoint RA's own site calls, like the server does to read events
// (see server/src/ra-events/routes.ts). The event comes from the site, with the token that the session's page put in the
// address (see docs/design/server/ra-publication.md): the calls to RA are this script's, and only its. It can stop
// working whenever RA changes its site: it then says so, and admins create the event on RA by hand, from the session's
// page.
//
// What it shows comes from the site and from RA: it's only ever shown as text.
;(() => {
  'use strict'

  // The site this was loaded from, which the bookmarklet was installed from, or null when it can't tell. The script is
  // read from the browser itself rather than from `document.currentScript`, which the page's content can replace, e.g.
  // an element named currentScript.
  const SITE = (() => {
    const script = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript').get.call(document)
    try {
      return script instanceof HTMLScriptElement ? new URL(script.src).origin : null
    } catch {
      return null
    }
  })()
  const PANEL_ID = 'parking-radio-ra'
  const CREATE_EVENT = 'mutation createEvent($eventInput: EventInput) { createEvent(eventInput: $eventInput) { id } }'
  // What it checks before showing what it would create, in one request that changes nothing: that the admin is logged
  // in to RA, that Parking Radio's venue is there, and that RA still takes what it sends.
  const CHECKS = `query ($venue: ID!) {
    user { username }
    venue(id: $venue) { name }
    input: __type(name: "EventInput") { inputFields { name defaultValue type { kind } } }
    schema: __schema { mutationType { fields { name } } }
  }`

  // An element, with its text, or its children, and its style.
  function element(tag, content, style = '') {
    const node = document.createElement(tag)
    if (style) node.style.cssText = style
    if (typeof content === 'string') node.textContent = content
    else node.append(...content)
    return node
  }

  document.getElementById(PANEL_ID)?.remove()
  const body = element('div', [])
  const close = element('button', '×', 'float:right;border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:inherit')
  close.type = 'button'
  close.setAttribute('aria-label', 'fermer')
  const panel = element(
    'div',
    [close, element('strong', 'Parking Radio → RA'), body],
    'position:fixed;top:16px;right:16px;z-index:2147483647;box-sizing:border-box;width:440px;max-width:calc(100vw - 32px);' +
      'max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#111;border:2px solid #111;border-radius:8px;' +
      'padding:16px;font:14px/1.4 system-ui,sans-serif;text-align:left;box-shadow:0 8px 24px #0004',
  )
  panel.id = PANEL_ID
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Parking Radio → RA')
  close.addEventListener('click', () => panel.remove())
  document.body.append(panel)

  const paragraph = (content, style = 'margin:12px 0 0') => element('p', content, style)
  const show = (...nodes) => body.replaceChildren(...nodes)
  const fail = (text) => show(paragraph(text, 'margin:12px 0 0;color:#b00020'))
  const SOMETHING_WRONG = 'Quelque chose n’a pas fonctionné'
  const PUBLISH_AGAIN = 'cliquez de nouveau sur « Publier sur RA » sur la page de la session'
  // Outside production, that the event is created on RA all the same, naming the environment as the site's pages do.
  const warning = (environment) => {
    const stamp = environment === 'development' ? 'DEV' : String(environment).toUpperCase()
    return paragraph(`Attention : l’événement sera vraiment créé sur RA, à partir d’une session de ${stamp}.`, 'margin:12px 0 0;color:#b00020;font-weight:bold')
  }

  // The token that the session's page put in the address, #parking-radio=<token>, which it removes from it right away,
  // so that it doesn't stay in the page's address, or its history.
  function token() {
    const match = /(?:^#|&)parking-radio=([^&]*)/.exec(location.hash)
    if (match) history.replaceState(history.state, '', location.pathname + location.search)
    return match?.[1] || null
  }

  // A time in Québec time, without its offset, as RA takes it, in words, whatever the browser's time zone.
  const when = (time) => new Date(`${time}Z`).toLocaleString('fr-CA', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'short' })

  // Sends a request to RA's GraphQL endpoint, as the admin logged in to RA, whose token RA's site keeps in a cookie, and
  // returns its answer, whatever its status, since RA's errors come with it, or throws when there's none.
  async function graphql(token, query, variables) {
    const response = await fetch('/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    })
    const answer = await response.json().catch(() => null)
    if (!answer) throw new Error(`RA a répondu ${response.status}`)
    return answer
  }

  // RA's error messages, as they come.
  const errors = (answer) => (answer.errors ?? []).map((error) => error.message).join(' ')

  // What's wrong with what RA says it takes, if anything, for `input`.
  function changes(checks, input) {
    const problems = []
    if (!checks.schema?.mutationType?.fields?.some((field) => field.name === 'createEvent')) problems.push('createEvent n’existe plus')
    const fields = new Map((checks.input?.inputFields ?? []).map((field) => [field.name, field]))
    for (const name of Object.keys(input)) if (!fields.has(name)) problems.push(`le champ ${name} n’existe plus`)
    for (const [name, field] of fields) {
      if (field.type?.kind === 'NON_NULL' && field.defaultValue == null && !(name in input)) problems.push(`le champ ${name} est requis`)
    }
    if (!checks.venue) problems.push('la salle de Parking Radio est introuvable')
    return problems
  }

  async function main() {
    // RA's site in another language is on a subdomain, e.g. fr.ra.co.
    if (location.hostname !== 'ra.co' && !location.hostname.endsWith('.ra.co')) return fail('Ce favori s’utilise sur ra.co, sur la page qu’ouvre « Publier sur RA ».')
    if (!SITE) return fail('Ce favori n’a pas pu savoir de quel site il vient.')
    const publishing = token()
    if (!publishing) return fail('Aucun événement à créer : cliquez sur « Publier sur RA » sur la page de la session, puis sur ce favori.')
    const LOG_IN = `Connectez-vous à RA, puis ${PUBLISH_AGAIN}.`
    const login = /(?:^|;\s*)next_id_token=([^;]*)/.exec(document.cookie)?.[1]
    if (!login) return fail(`Vous n’êtes pas connecté à RA. ${LOG_IN}`)

    // The event, from the site this was loaded from, and never another, with the token, in a header rather than in the
    // address, which the servers in front of the site's log.
    show(paragraph('Chargement de l’événement…'))
    const headers = { Authorization: `Bearer ${publishing}` }
    const response = await fetch(`${SITE}/api/ra-publication`, { headers, credentials: 'omit', cache: 'no-store' }).catch(() => null)
    if (!response) return fail(`${SITE} n’a pas pu être joint.`)
    if (response.status === 403) return fail(`Ce lien de publication a expiré, ou ne vient pas de ${SITE} : ${PUBLISH_AGAIN}, puis sur le favori de ce site.`)
    const given = await response.json().catch(() => null)
    if (!given?.ok) throw new Error(given?.error ?? `${SITE} a répondu ${response.status}`)
    // Sent to RA as the site gives it.
    const input = given.event

    show(paragraph('Vérification auprès de RA…'))
    const answer = await graphql(login, CHECKS, { venue: input.venueId })
    const checks = answer.data
    if (!checks) throw new Error(errors(answer) || 'RA n’a pas répondu comme prévu')
    if (!checks.user) return fail(`RA ne reconnaît pas votre connexion. ${LOG_IN}`)
    const problems = changes(checks, input)
    if (problems.length > 0) return fail(`RA a changé : ${problems.join(', ')}.`)

    const create = element('button', 'Créer sur RA', 'margin:16px 8px 0 0;padding:8px 12px;cursor:pointer')
    const cancel = element('button', 'Annuler', 'margin:16px 0 0;padding:8px 12px;cursor:pointer')
    create.type = cancel.type = 'button'
    cancel.addEventListener('click', () => panel.remove())
    create.addEventListener('click', () => {
      create.disabled = cancel.disabled = close.disabled = true
      create.textContent = 'Création…'
      createEvent(login, input, given.session).catch((error) => {
        close.disabled = false
        fail(`${SOMETHING_WRONG} : ${error.message.replace(/\.$/, '')}.`)
      })
    })
    const label = (text) => element('strong', text)
    const lines = (text) => element('div', text, 'white-space:pre-wrap')
    show(
      paragraph(`Connecté à RA en tant que ${checks.user.username}. Vérifiez l’événement avant de le créer :`),
      paragraph([label(input.title)]),
      paragraph(`${when(input.startTime)} → ${when(input.endTime)}`),
      paragraph(checks.venue.name),
      paragraph([label('Line-up'), lines(input.lineup)]),
      paragraph([label('Description'), lines(input.content || '-')]),
      paragraph([label('Liens promotionnels'), lines(input.promotionalLinks.map(({ title, url }) => `${title} : ${url}`).join('\n'))]),
      paragraph([label('Liens média'), lines(input.playerLinks.map(({ sourceId }) => sourceId).join('\n'))]),
      ...(given.environment === 'production' ? [] : [warning(given.environment)]),
      element('div', [create, cancel]),
    )
  }

  // Creates the event, once, and says how it went, never trying again on its own, then leads back to `session`'s page.
  async function createEvent(token, input, session) {
    const answer = await graphql(token, CREATE_EVENT, { eventInput: input })
    // Checked, since it goes in the link back to the session.
    const id = answer.data?.createEvent?.id
    close.disabled = false
    if (!/^\d{1,20}$/.test(id)) {
      const refused = errors(answer)
      return fail(refused ? `RA a refusé de créer l’événement : ${refused}` : `${SOMETHING_WRONG}.`)
    }
    const link = (text, href) => {
      const node = element('a', text)
      node.href = href
      node.target = '_blank'
      node.rel = 'noopener'
      return node
    }
    const eventUrl = `https://ra.co/events/${id}`
    const back = `${SITE}/admin/sessions/${encodeURIComponent(session)}?raEvent=${id}`
    show(
      paragraph(['Événement créé sur RA : ', link(eventUrl, eventUrl)]),
      paragraph([link('Enregistrer l’événement dans la session', back), ' (ou collez son lien dans « Événement RA » de la session).']),
      paragraph('Ajoutez le flyer à la main, sur la page de l’événement sur RA.'),
    )
  }

  main().catch((error) => fail(`${SOMETHING_WRONG} : ${error.message.replace(/\.$/, '')}.`))
})()
