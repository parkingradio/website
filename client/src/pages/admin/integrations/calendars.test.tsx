import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { held, mockFetch, requestsTo } from '../../../test-utils'
import { CalendarLinks } from './calendars'

const URL = '/api/admin/ics-subscription-token'

function renderLinks() {
  render(
    <MemoryRouter>
      <CalendarLinks />
    </MemoryRouter>,
  )
}

const regenerate = () => screen.getByRole('button', { name: 'régénérer les liens' })

describe('The links to the calendars', () => {
  it("say they're personal, and link to Calendrier, without reading anything", () => {
    mockFetch({})
    renderLinks()

    expect(screen.getByRole('link', { name: 'Calendrier' })).toHaveAttribute('href', '/admin/calendrier')
    expect(regenerate()).not.toHaveAttribute('aria-disabled')
    expect(requestsTo('GET', URL)).toHaveLength(0)
  })

  it('are regenerated once the admin confirms, greyed out meanwhile', async () => {
    const answer = held()
    mockFetch({ [`POST ${URL}`]: answer.body })
    renderLinks()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    fireEvent.click(regenerate())
    expect(confirm).toHaveBeenCalledWith('Régénérer vos liens ? Les calendriers abonnés avec les liens actuels ne seront plus mis à jour.')
    expect(requestsTo('POST', URL)).toHaveLength(0)

    fireEvent.click(regenerate())
    await waitFor(() => expect(regenerate()).toHaveAttribute('aria-disabled', 'true'))
    // Clicking it meanwhile does nothing.
    fireEvent.click(regenerate())
    expect(confirm).toHaveBeenCalledTimes(2)
    await answer.answer({ ok: true, token: 'b'.repeat(64) })
    expect(requestsTo('POST', URL)).toHaveLength(1)
    expect(regenerate()).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Liens régénérés : abonnez-vous à nouveau depuis la légende du Calendrier, puis retirez les anciens calendriers de votre application.',
    )
  })

  it("say why they couldn't be regenerated, until the button is used again", async () => {
    mockFetch({ [`POST ${URL}`]: { ok: false, error: 'Internal server error' } })
    renderLinks()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(regenerate())
    expect(await screen.findByRole('alert')).toHaveTextContent("Les liens n'ont pas pu être régénérés : Internal server error")
    fireEvent.click(regenerate())
    await waitFor(() => expect(requestsTo('POST', URL)).toHaveLength(2))
    expect(confirm).toHaveBeenCalledTimes(2)
  })
})
